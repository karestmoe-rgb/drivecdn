import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Folder, HardDrive, Menu, UploadCloud, X } from 'lucide-react';
import type {
  CdnAsset,
  DriveFolder,
  DriveStorageQuota,
  DriveUser,
  PublicRelayStatus,
  UploadTask,
  WorkspaceTab,
} from './types/cdn';
import {
  createBucketFolder,
  deleteDriveFile,
  ensureCdnWorkspace,
  getAccessToken,
  getCurrentFirebaseUser,
  getDriveAbout,
  googleSignIn,
  initAuth,
  listDriveCdnFiles,
  logout,
  makeFilePrivate,
  makeFilePublic,
  renameDriveFile,
  uploadMediaToDrive,
  uploadToPublicCloudRelay,
} from './lib/googleDrive';
import { formatBytes } from './lib/format';
import { LibraryView } from './components/LibraryView';
import { UploaderView } from './components/UploaderView';
import { ApiDocsView } from './components/ApiDocsView';
import { OwnerAdminView } from './components/OwnerAdminView';
import { AssetInspectorModal } from './components/AssetInspectorModal';
import { GoogleSignInButton } from './components/GoogleSignInButton';

const INITIAL_RELAY_STATUS: PublicRelayStatus = {
  enabled: false,
  active: false,
  buckets: [],
  storageQuota: null,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('library');
  const [activeBucket, setActiveBucket] = useState<string>('ALL');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Owner Google Drive Session
  const [isOwnerSignedIn, setIsOwnerSignedIn] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [driveUser, setDriveUser] = useState<DriveUser | null>(null);
  const [storageQuota, setStorageQuota] = useState<DriveStorageQuota | null>(null);
  const [rootFolder, setRootFolder] = useState<DriveFolder | null>(null);
  const [driveBuckets, setDriveBuckets] = useState<DriveFolder[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);

  // Refs to prevent infinite useEffect / refresh loops
  const rootFolderRef = useRef<DriveFolder | null>(null);
  const isSyncingRef = useRef(false);
  const manualSignInRef = useRef(false);

  // Public Cloud Relay Status
  const [relayStatus, setRelayStatus] = useState<PublicRelayStatus>(INITIAL_RELAY_STATUS);

  // Media Catalog & Drive Assets
  const [publicAssets, setPublicAssets] = useState<CdnAsset[]>([]);
  const [driveAssets, setDriveAssets] = useState<CdnAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<CdnAsset | null>(null);

  // Upload Queue
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);

  const fetchPublicData = useCallback(async () => {
    try {
      const [catalogRes, statusRes] = await Promise.all([
        fetch('/api/cdn/catalog'),
        fetch('/api/cloud/status'),
      ]);
      if (catalogRes.ok) {
        const data = (await catalogRes.json()) as { items?: CdnAsset[] };
        setPublicAssets(data.items ?? []);
      }
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as PublicRelayStatus;
        setRelayStatus(statusData);
      }
    } catch {
      // Ignore transient errors
    }
  }, []);

  const activateRelayWithToken = useCallback(
    async (token: string, rootId: string, buckets: DriveFolder[]) => {
      try {
        const res = await fetch('/api/cloud/activate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            rootFolderId: rootId,
            buckets,
            enabled: true,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as PublicRelayStatus;
          setRelayStatus(data);
        }
      } catch {
        // Non-fatal
      }
    },
    []
  );

  const syncOwnerDriveWorkspace = useCallback(
    async (token: string, autoEnableRelay = true) => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      setLoadingAssets(true);
      setAuthError(null);
      try {
        const [aboutResult, workspaceResult] = await Promise.allSettled([
          getDriveAbout(token),
          ensureCdnWorkspace(token),
        ]);

        const fbUser = getCurrentFirebaseUser();
        let resolvedUser: DriveUser | null = fbUser
          ? {
              displayName: fbUser.displayName || fbUser.email || 'Chủ sở hữu Drive',
              emailAddress: fbUser.email || '',
              photoLink: fbUser.photoURL || undefined,
            }
          : null;

        if (aboutResult.status === 'fulfilled') {
          resolvedUser = aboutResult.value.user;
          setDriveUser(aboutResult.value.user);
          setStorageQuota(aboutResult.value.storageQuota);
        } else {
          setDriveUser(resolvedUser);
          setStorageQuota(null);
        }

        if (workspaceResult.status === 'fulfilled') {
          const workspace = workspaceResult.value;
          rootFolderRef.current = workspace.rootFolder;
          setRootFolder(workspace.rootFolder);
          setDriveBuckets(workspace.buckets);

          const files = await listDriveCdnFiles(token, workspace.buckets, resolvedUser);
          setDriveAssets(files);

          if (autoEnableRelay) {
            await activateRelayWithToken(token, workspace.rootFolder.id, workspace.buckets);
          }
        } else {
          const reason =
            workspaceResult.reason instanceof Error
              ? workspaceResult.reason.message
              : 'Không thể khởi tạo thư mục DriveCDN trên Google Drive.';
          setAuthError(reason);
        }
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Không thể đồng bộ Google Drive.');
      } finally {
        isSyncingRef.current = false;
        setLoadingAssets(false);
      }
    },
    [activateRelayWithToken]
  );

  const refreshAll = useCallback(async () => {
    setLoadingAssets(true);
    try {
      await fetchPublicData();
      const token = await getAccessToken();
      if (token) {
        await syncOwnerDriveWorkspace(token, !rootFolderRef.current);
      }
    } finally {
      setLoadingAssets(false);
    }
  }, [fetchPublicData, syncOwnerDriveWorkspace]);

  // Mount-only initialization (prevents infinite refresh loop)
  useEffect(() => {
    void refreshAll();
    const unsub = initAuth(
      (_user, token) => {
        setIsOwnerSignedIn(true);
        if (!manualSignInRef.current) {
          void syncOwnerDriveWorkspace(token, true);
        }
      },
      () => {
        setIsOwnerSignedIn(false);
        setDriveUser(null);
        setStorageQuota(null);
        rootFolderRef.current = null;
        setRootFolder(null);
        setDriveBuckets([]);
        setDriveAssets([]);
        setLoadingAssets(false);
      }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOwnerLogin = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    manualSignInRef.current = true;
    try {
      const result = await googleSignIn();
      if (result) {
        setIsOwnerSignedIn(true);
        await syncOwnerDriveWorkspace(result.accessToken, true);
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Đăng nhập Google thất bại.');
    } finally {
      manualSignInRef.current = false;
      setIsSigningIn(false);
    }
  };

  const handleOwnerLogout = async () => {
    const token = await getAccessToken();
    if (token) {
      await fetch('/api/cloud/deactivate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    await logout();
    setIsOwnerSignedIn(false);
    setDriveUser(null);
    setStorageQuota(null);
    rootFolderRef.current = null;
    setRootFolder(null);
    setDriveBuckets([]);
    setDriveAssets([]);
    setSelectedAsset(null);
    await fetchPublicData();
  };

  const handleToggleRelay = async (enabled: boolean) => {
    const token = await getAccessToken();
    if (!token) throw new Error('Vui lòng đăng nhập Google Drive trước.');
    if (!enabled) {
      const res = await fetch('/api/cloud/deactivate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setRelayStatus((prev) => ({ ...prev, enabled: false, active: false }));
      return;
    }
    if (!rootFolder || driveBuckets.length === 0) {
      await syncOwnerDriveWorkspace(token, true);
      return;
    }
    await activateRelayWithToken(token, rootFolder.id, driveBuckets);
  };

  const mergedAssets = useMemo(() => {
    const map = new Map<string, CdnAsset>();
    for (const pub of publicAssets) {
      map.set(pub.fileId, pub);
    }
    for (const drv of driveAssets) {
      const existing = map.get(drv.fileId);
      map.set(drv.fileId, {
        ...existing,
        ...drv,
        isPublic: drv.isPublic || Boolean(existing?.isPublic),
      });
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime()
    );
  }, [publicAssets, driveAssets]);

  const bucketNames = useMemo(() => {
    const set = new Set<string>();
    for (const b of driveBuckets) set.add(b.name);
    for (const b of relayStatus.buckets) set.add(b.name);
    for (const item of mergedAssets) set.add(item.bucket);
    return Array.from(set).sort();
  }, [driveBuckets, relayStatus.buckets, mergedAssets]);

  const registerInPublicCatalog = async (token: string, asset: CdnAsset): Promise<CdnAsset> => {
    const res = await fetch('/api/cdn/catalog', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(asset),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error || 'Không thể đăng ký tệp vào danh mục công khai.');
    }
    const data = (await res.json()) as { item: CdnAsset };
    return data.item;
  };

  const handleUploadFiles = async (
    files: File[],
    bucketName: string,
    bucketId?: string,
    uploaderName?: string
  ) => {
    const newTasks: UploadTask[] = files.map((file) => {
      const resolvedBucket =
        bucketName === 'AUTO'
          ? file.type.startsWith('video/')
            ? 'Videos'
            : 'Images'
          : bucketName;
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        kind: file.type.startsWith('video/') ? 'video' : 'image',
        bucket: resolvedBucket,
        progress: 0,
        speedBps: 0,
        status: 'queued',
      };
    });

    setUploadTasks((prev) => [...newTasks, ...prev]);

    const token = await getAccessToken();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const task = newTasks[i];

      const updateTask = (patch: Partial<UploadTask>) => {
        setUploadTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...patch } : t)));
      };

      try {
        updateTask({ status: 'uploading', progress: 0 });

        if (token && isOwnerSignedIn) {
          let activeBuckets = driveBuckets;
          if (activeBuckets.length === 0) {
            const ws = await ensureCdnWorkspace(token);
            rootFolderRef.current = ws.rootFolder;
            setRootFolder(ws.rootFolder);
            setDriveBuckets(ws.buckets);
            activeBuckets = ws.buckets;
          }

          const targetFolder =
            (bucketId && activeBuckets.find((b) => b.id === bucketId)) ||
            activeBuckets.find((b) => b.name === task.bucket) ||
            activeBuckets[0];

          if (!targetFolder) {
            throw new Error('Không tìm thấy thư mục lưu trữ trên Google Drive.');
          }

          const uploaded = await uploadMediaToDrive(token, file, targetFolder.id, (progress, speedBps) => {
            updateTask({ progress, speedBps });
          });

          updateTask({ status: 'publishing', progress: 100 });
          await makeFilePublic(token, uploaded.id);

          const asset = await registerInPublicCatalog(token, {
            fileId: uploaded.id,
            name: uploaded.name || file.name,
            mimeType: uploaded.mimeType || file.type,
            size: Number(uploaded.size || file.size),
            kind: task.kind,
            bucket: targetFolder.name,
            folderId: targetFolder.id,
            width: uploaded.imageMediaMetadata?.width ?? uploaded.videoMediaMetadata?.width,
            height: uploaded.imageMediaMetadata?.height ?? uploaded.videoMediaMetadata?.height,
            durationMillis: uploaded.videoMediaMetadata?.durationMillis
              ? Number(uploaded.videoMediaMetadata.durationMillis)
              : undefined,
            thumbnailLink: uploaded.thumbnailLink,
            webViewLink: uploaded.webViewLink,
            isPublic: true,
            createdTime: uploaded.createdTime || new Date().toISOString(),
            uploadedBy: uploaderName || driveUser?.displayName || 'Chủ sở hữu',
            ownerName: driveUser?.displayName,
            ownerEmail: driveUser?.emailAddress,
          });

          updateTask({ status: 'completed', progress: 100, asset });
        } else {
          const asset = await uploadToPublicCloudRelay(
            file,
            task.bucket,
            uploaderName,
            (progress, speedBps) => {
              updateTask({
                status: progress >= 95 ? 'publishing' : 'uploading',
                progress,
                speedBps,
              });
            }
          );
          updateTask({ status: 'completed', progress: 100, asset });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Tải lên thất bại.';
        updateTask({ status: 'error', error: message });
      }
    }

    await refreshAll();
  };

  const handleCreateBucket = async (name: string): Promise<DriveFolder | null> => {
    const token = await getAccessToken();
    if (!token || !rootFolder) return null;
    const created = await createBucketFolder(token, rootFolder.id, name);
    const nextBuckets = [...driveBuckets, created];
    setDriveBuckets(nextBuckets);
    if (relayStatus.active) {
      await activateRelayWithToken(token, rootFolder.id, nextBuckets);
    }
    return created;
  };

  const handleTogglePublic = async (asset: CdnAsset, nextPublic: boolean) => {
    const token = await getAccessToken();
    if (!token) throw new Error('Cần đăng nhập chủ sở hữu để thay đổi quyền.');

    if (nextPublic) {
      await makeFilePublic(token, asset.fileId);
      const updated = await registerInPublicCatalog(token, { ...asset, isPublic: true });
      setSelectedAsset(updated);
    } else {
      await makeFilePrivate(token, asset.fileId);
      await fetch(`/api/cdn/catalog/${encodeURIComponent(asset.fileId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setSelectedAsset({ ...asset, isPublic: false });
    }
    await refreshAll();
  };

  const handleRenameAsset = async (asset: CdnAsset, newName: string) => {
    const token = await getAccessToken();
    if (!token) throw new Error('Cần đăng nhập chủ sở hữu để đổi tên tệp.');

    await renameDriveFile(token, asset.fileId, newName);
    if (asset.isPublic) {
      await fetch(`/api/cdn/catalog/${encodeURIComponent(asset.fileId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: newName }),
      });
    }
    setSelectedAsset({ ...asset, name: newName });
    await refreshAll();
  };

  const handleDeleteAsset = async (asset: CdnAsset) => {
    const token = await getAccessToken();
    if (!token) throw new Error('Cần đăng nhập chủ sở hữu để xóa tệp.');

    await deleteDriveFile(token, asset.fileId);
    await fetch(`/api/cdn/catalog/${encodeURIComponent(asset.fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    await refreshAll();
  };

  const canManageAsset = (asset: CdnAsset) => {
    if (!isOwnerSignedIn) return false;
    if (!asset.ownerEmail || !driveUser?.emailAddress) return true;
    return asset.ownerEmail === driveUser.emailAddress;
  };

  const activeQuota = storageQuota || relayStatus.storageQuota;
  const quotaPct =
    activeQuota && activeQuota.limit > 0
      ? Math.min(100, Math.round((activeQuota.usage / activeQuota.limit) * 100))
      : 0;
  const totalCatalogBytes = publicAssets.reduce((sum, item) => sum + (item.size || 0), 0);

  const navItems: { id: WorkspaceTab; label: string }[] = [
    { id: 'library', label: 'Thư viện Media' },
    { id: 'upload', label: 'Tải lên Cloud' },
    { id: 'docs', label: 'Nhúng & Vercel' },
    { id: 'admin', label: 'Quản trị Drive' },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-zinc-50 text-zinc-900">
      {/* Top Bar Contract: 3 zones separated by gap-8 (compact 56px on mobile to stay well within 15% sticky cap) */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:h-16 sm:gap-8 sm:px-6">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className="font-display text-lg font-bold tracking-tight text-zinc-900 whitespace-nowrap shrink-0"
          >
            DriveCDN
          </button>

          {/* Zone 2: 4 concise single-line nav links */}
          <nav className="hidden items-center gap-7 md:flex" aria-label="Điều hướng chính">
            {navItems.map((nav) => (
              <button
                key={nav.id}
                type="button"
                onClick={() => setActiveTab(nav.id)}
                className={`border-b-2 py-5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === nav.id
                    ? 'border-blue-600 text-zinc-900'
                    : 'border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-900'
                }`}
              >
                {nav.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('upload')}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              <span>Tải lên ngay</span>
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Mở menu điều hướng"
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 md:hidden"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="border-t border-zinc-200 bg-white px-4 py-3 md:hidden">
            <div className="grid grid-cols-2 gap-2">
              {navItems.map((nav) => (
                <button
                  key={nav.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(nav.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`min-h-[44px] rounded-lg px-3 py-2 text-left text-sm font-medium ${
                    activeTab === nav.id
                      ? 'bg-zinc-900 text-white'
                      : 'border border-zinc-200 bg-zinc-50 text-zinc-700'
                  }`}
                >
                  {nav.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Mobile Horizontal Bucket Strip (visible < lg so main content stays above the fold!) */}
      {activeTab === 'library' && (
        <div className="border-b border-zinc-200 bg-white px-4 py-2.5 lg:hidden">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setActiveBucket('ALL')}
              className={`min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                activeBucket === 'ALL'
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-700'
              }`}
            >
              Tất cả ({mergedAssets.length})
            </button>
            {bucketNames.map((bucket) => {
              const count = mergedAssets.filter((a) => a.bucket === bucket).length;
              return (
                <button
                  key={bucket}
                  type="button"
                  onClick={() => setActiveBucket(bucket)}
                  className={`min-h-[38px] rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                    activeBucket === bucket
                      ? 'bg-zinc-900 text-white'
                      : 'bg-zinc-100 text-zinc-700'
                  }`}
                >
                  {bucket} ({count})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Workspace Shell (Main first on mobile, Sidebar second on mobile / left on desktop) */}
      <div className="mx-auto flex max-w-[1440px] flex-col-reverse gap-6 px-4 py-5 sm:px-6 sm:py-8 lg:flex-row lg:gap-8">
        {/* Sidebar (260px on desktop, compact bottom summary on mobile) */}
        <aside className="w-full shrink-0 space-y-5 lg:w-[260px]">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
              <HardDrive className="h-4 w-4 text-blue-600" />
              Dung lượng Cloud Google Drive
            </div>

            {activeQuota ? (
              <div className="mt-3 space-y-2.5">
                <div className="flex items-baseline justify-between text-xs tabular-nums">
                  <span className="font-semibold text-zinc-900">
                    {formatBytes(activeQuota.usage)}
                  </span>
                  <span className="text-zinc-500">
                    / {activeQuota.limit > 0 ? formatBytes(activeQuota.limit) : 'Không giới hạn'}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full bg-blue-600 transition-all" style={{ width: `${quotaPct}%` }} />
                </div>
                <div className="text-xs text-zinc-500 tabular-nums">
                  Đã dùng {quotaPct}% · {publicAssets.length} tệp công khai
                </div>
              </div>
            ) : (
              <div className="mt-3 space-y-2 text-xs text-zinc-600 tabular-nums">
                <div className="flex items-center justify-between">
                  <span>Tệp đang lưu trữ</span>
                  <span className="font-mono font-semibold text-zinc-900">{publicAssets.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Tổng dung lượng tệp</span>
                  <span className="font-mono font-semibold text-zinc-900">
                    {formatBytes(totalCatalogBytes)}
                  </span>
                </div>
              </div>
            )}

            <div className="mt-4 border-t border-zinc-100 pt-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Tải lên công khai</span>
                <span className={relayStatus.active ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'}>
                  {relayStatus.active ? 'Đang mở' : 'Tạm đóng'}
                </span>
              </div>
              {!isOwnerSignedIn && (
                <div className="mt-3">
                  <GoogleSignInButton
                    onClick={() => void handleOwnerLogin()}
                    disabled={isSigningIn}
                    label={isSigningIn ? 'Đang kết nối...' : 'Sign in with Google'}
                  />
                  <p className="mt-1.5 text-[11px] text-zinc-500">
                    Chỉ dành cho chủ sở hữu cấp quyền Drive. Khách không cần đăng nhập.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Desktop Bucket Navigation */}
          <div className="hidden rounded-xl border border-zinc-200 bg-white p-3 lg:block">
            <div className="px-2.5 py-1.5 text-xs font-semibold text-zinc-500">
              Thư mục (Buckets)
            </div>
            <div className="mt-1 space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  setActiveBucket('ALL');
                  setActiveTab('library');
                }}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  activeBucket === 'ALL' && activeTab === 'library'
                    ? 'bg-zinc-100 text-zinc-900'
                    : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  Tất cả tệp
                </span>
                <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                  {mergedAssets.length}
                </span>
              </button>

              {bucketNames.map((bucket) => {
                const count = mergedAssets.filter((a) => a.bucket === bucket).length;
                return (
                  <button
                    key={bucket}
                    type="button"
                    onClick={() => {
                      setActiveBucket(bucket);
                      setActiveTab('library');
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                      activeBucket === bucket && activeTab === 'library'
                        ? 'bg-zinc-100 text-zinc-900'
                        : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      <span className="truncate">{bucket}</span>
                    </span>
                    <span className="font-mono text-[11px] text-zinc-500 tabular-nums">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {authError && (
            <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4 text-xs leading-relaxed text-red-700 break-words">
              <p>{authError.replace(/https:\/\/\S+/g, '').trim()}</p>
              {authError.match(/https:\/\/\S+/) && (
                <a
                  href={authError.match(/https:\/\/\S+/)?.[0]}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block font-semibold text-blue-700 underline hover:text-blue-800"
                >
                  Mở Google Cloud Console để bật Drive API
                </a>
              )}
              {isOwnerSignedIn && (
                <button
                  type="button"
                  onClick={() => void refreshAll()}
                  className="block min-h-[36px] rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                >
                  Thử kết nối lại Drive
                </button>
              )}
            </div>
          )}
        </aside>

        {/* Main Viewport */}
        <main className="min-w-0 flex-1">
          {activeTab === 'library' && (
            <LibraryView
              assets={mergedAssets}
              loading={loadingAssets}
              isOwnerSignedIn={isOwnerSignedIn}
              activeBucket={activeBucket}
              onRefresh={() => void refreshAll()}
              onInspect={(asset) => setSelectedAsset(asset)}
              onGoToUpload={() => setActiveTab('upload')}
              onGoToDocs={() => setActiveTab('docs')}
            />
          )}

          {activeTab === 'upload' && (
            <UploaderView
              isOwnerSignedIn={isOwnerSignedIn}
              relayStatus={relayStatus}
              ownerBuckets={driveBuckets}
              tasks={uploadTasks}
              onUploadFiles={handleUploadFiles}
              onInspectAsset={(asset) => setSelectedAsset(asset)}
              onGoToAdmin={() => setActiveTab('admin')}
            />
          )}

          {activeTab === 'docs' && <ApiDocsView sampleAsset={publicAssets[0] || mergedAssets[0]} />}

          {activeTab === 'admin' && (
            <OwnerAdminView
              isAuthenticated={isOwnerSignedIn}
              isSigningIn={isSigningIn}
              driveUser={driveUser}
              storageQuota={storageQuota}
              buckets={driveBuckets}
              relayStatus={relayStatus}
              onSignIn={() => void handleOwnerLogin()}
              onSignOut={() => void handleOwnerLogout()}
              onToggleRelay={handleToggleRelay}
              onCreateBucket={handleCreateBucket}
            />
          )}
        </main>
      </div>

      {/* Asset Inspector / Video & Image Viewer Modal */}
      <AssetInspectorModal
        asset={selectedAsset}
        canManage={selectedAsset ? canManageAsset(selectedAsset) : false}
        onClose={() => setSelectedAsset(null)}
        onTogglePublic={handleTogglePublic}
        onRename={handleRenameAsset}
        onDelete={handleDeleteAsset}
      />
    </div>
  );
}
