import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type {
  CdnAsset,
  DriveFolder,
  DriveStorageQuota,
  DriveUser,
  PublicRelayStatus,
  UploadTask,
  UserAccount,
  WorkspacePanel,
} from './types/cdn';
import {
  getCachedDriveToken,
  getFirebaseIdToken,
  signInAdminWithDrive,
  signInRegularUser,
  signOutAccount,
  subscribeAuthUser,
  subscribeMyUserProfile,
  syncUserProfileOnSignIn,
} from './lib/firebaseClient';
import {
  createBucketFolder,
  deleteDriveFile,
  ensureCdnWorkspace,
  getDriveAbout,
  listDriveCdnFiles,
  makeFilePrivate,
  makeFilePublic,
  renameDriveFile,
  uploadMediaToDrive,
  uploadToPublicCloudRelay,
} from './lib/googleDrive';
import { AdminDashboard } from './components/AdminDashboard';
import { UserPortal } from './components/UserPortal';
import { AssetInspectorModal } from './components/AssetInspectorModal';

const INITIAL_RELAY_STATUS: PublicRelayStatus = {
  enabled: false,
  active: false,
  buckets: [],
  storageQuota: null,
};

function resolvePanelFromPath(): WorkspacePanel {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
    return 'admin';
  }
  return 'user';
}

export default function App() {
  const [panel, setPanel] = useState<WorkspacePanel>(() => resolvePanelFromPath());

  // Firebase Auth & RBAC User Profile
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserAccount | null>(null);
  const [firebaseIdToken, setFirebaseIdToken] = useState<string | null>(null);

  // Admin Google Drive Host OAuth Session
  const [isDriveConnected, setIsDriveConnected] = useState(false);
  const [isSigningInDrive, setIsSigningInDrive] = useState(false);
  const [driveUser, setDriveUser] = useState<DriveUser | null>(null);
  const [storageQuota, setStorageQuota] = useState<DriveStorageQuota | null>(null);
  const [rootFolder, setRootFolder] = useState<DriveFolder | null>(null);
  const [driveBuckets, setDriveBuckets] = useState<DriveFolder[]>([]);
  const [driveError, setDriveError] = useState<string | null>(null);

  // Refs to prevent refresh loops
  const rootFolderRef = useRef<DriveFolder | null>(null);
  const isSyncingRef = useRef(false);

  // Relay Status & Media Assets
  const [relayStatus, setRelayStatus] = useState<PublicRelayStatus>(INITIAL_RELAY_STATUS);
  const [publicAssets, setPublicAssets] = useState<CdnAsset[]>([]);
  const [driveAssets, setDriveAssets] = useState<CdnAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<CdnAsset | null>(null);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);

  const switchPanel = useCallback((next: WorkspacePanel) => {
    setPanel(next);
    if (typeof window !== 'undefined') {
      const targetPath = next === 'admin' ? '/admin' : '/';
      if (window.location.pathname !== targetPath) {
        window.history.pushState({}, '', targetPath);
      }
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setPanel(resolvePanelFromPath());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const fetchRelayStatus = useCallback(async () => {
    try {
      const statusRes = await fetch('/api/cloud/status');
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as PublicRelayStatus;
        setRelayStatus(statusData);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const fetchProtectedCatalog = useCallback(async () => {
    const token = await getFirebaseIdToken();
    if (!token) {
      setPublicAssets([]);
      return;
    }
    setFirebaseIdToken(token);
    try {
      const catalogRes = await fetch('/api/cdn/catalog', {
        headers: { 'X-Firebase-Id-Token': token },
      });
      if (catalogRes.ok) {
        const data = (await catalogRes.json()) as { items?: CdnAsset[] };
        setPublicAssets(data.items ?? []);
      } else if (catalogRes.status === 401 || catalogRes.status === 403) {
        setPublicAssets([]);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const activateRelayWithToken = useCallback(
    async (driveToken: string, rootId: string, buckets: DriveFolder[]) => {
      const idToken = await getFirebaseIdToken();
      if (!idToken) return;
      try {
        const res = await fetch('/api/cloud/activate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${driveToken}`,
            'X-Firebase-Id-Token': idToken,
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
    async (driveToken: string, userHint: User | null, autoEnableRelay = true) => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      setLoadingAssets(true);
      setDriveError(null);
      try {
        const [aboutResult, workspaceResult] = await Promise.allSettled([
          getDriveAbout(driveToken),
          ensureCdnWorkspace(driveToken),
        ]);

        let resolvedUser: DriveUser | null = userHint
          ? {
              displayName: userHint.displayName || userHint.email || 'Admin Drive Host',
              emailAddress: userHint.email || '',
              photoLink: userHint.photoURL || undefined,
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

          const files = await listDriveCdnFiles(driveToken, workspace.buckets, resolvedUser);
          setDriveAssets(files);

          if (autoEnableRelay) {
            await activateRelayWithToken(driveToken, workspace.rootFolder.id, workspace.buckets);
          }
        } else {
          const reason =
            workspaceResult.reason instanceof Error
              ? workspaceResult.reason.message
              : 'Không thể khởi tạo thư mục DriveCDN trên Google Drive.';
          setDriveError(reason);
        }
      } catch (err) {
        setDriveError(err instanceof Error ? err.message : 'Không thể đồng bộ Google Drive.');
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
      await Promise.all([fetchRelayStatus(), fetchProtectedCatalog()]);
      const driveToken = getCachedDriveToken();
      if (driveToken) {
        await syncOwnerDriveWorkspace(driveToken, authUser, !rootFolderRef.current);
      }
    } finally {
      setLoadingAssets(false);
    }
  }, [authUser, fetchProtectedCatalog, fetchRelayStatus, syncOwnerDriveWorkspace]);

  // Mount-only Firebase Auth & Relay Status Initialization
  useEffect(() => {
    void fetchRelayStatus();
    let profileUnsub: (() => void) | null = null;

    const authUnsub = subscribeAuthUser((user) => {
      profileUnsub?.();
      profileUnsub = null;

      setAuthUser(user);
      setAuthError(null);

      if (!user) {
        setUserProfile(null);
        setFirebaseIdToken(null);
        setIsDriveConnected(false);
        setDriveUser(null);
        setStorageQuota(null);
        rootFolderRef.current = null;
        setRootFolder(null);
        setDriveBuckets([]);
        setDriveAssets([]);
        setPublicAssets([]);
        setSelectedAsset(null);
        setAuthLoading(false);
        return;
      }

      setAuthLoading(false);

      void (async () => {
        try {
          const token = await user.getIdToken();
          setFirebaseIdToken(token);
          const synced = await syncUserProfileOnSignIn(user);
          setUserProfile(synced);
        } catch (err) {
          setAuthError(
            err instanceof Error ? err.message : 'Không thể đồng bộ hồ sơ tài khoản Google.'
          );
        }

        profileUnsub = subscribeMyUserProfile(
          user.uid,
          (profile) => {
            if (profile) {
              setUserProfile(profile);
            }
          },
          (err) => {
            setAuthError(err.message);
          }
        );
      })();
    });

    return () => {
      authUnsub();
      profileUnsub?.();
    };
  }, [fetchRelayStatus]);

  // Auto-load protected catalog whenever user becomes authorized to view
  const userCanView = Boolean(
    userProfile &&
      (userProfile.role === 'admin' || (userProfile.status === 'approved' && userProfile.canView))
  );

  useEffect(() => {
    if (!authUser || !userCanView) {
      setPublicAssets([]);
      return;
    }
    setLoadingAssets(true);
    void fetchProtectedCatalog().finally(() => setLoadingAssets(false));
  }, [authUser, userCanView, fetchProtectedCatalog]);

  // Regular User Sign-In (NO Drive OAuth scope requested)
  const handleSignInRegularUser = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      await signInRegularUser();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Đăng nhập Google thất bại.');
    } finally {
      setIsSigningIn(false);
    }
  };

  // Admin Connect Google Drive Host (WITH Drive OAuth scope)
  const handleConnectDriveHost = async () => {
    setIsSigningInDrive(true);
    setAuthError(null);
    setDriveError(null);
    try {
      const { user, accessToken } = await signInAdminWithDrive();
      const profile = await syncUserProfileOnSignIn(user);
      setUserProfile(profile);
      setFirebaseIdToken(await user.getIdToken());

      if (profile.role !== 'admin') {
        setIsDriveConnected(false);
        setAuthError(
          `Tài khoản ${profile.email} không có quyền Admin để quản trị Google Drive Host.`
        );
        return;
      }

      setIsDriveConnected(true);
      await syncOwnerDriveWorkspace(accessToken, user, true);
      await fetchProtectedCatalog();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Kết nối Google Drive Host thất bại.';
      setAuthError(msg);
      setDriveError(msg);
    } finally {
      setIsSigningInDrive(false);
    }
  };

  const handleSignOut = async () => {
    const driveToken = getCachedDriveToken();
    const idToken = await getFirebaseIdToken();
    if (driveToken && idToken && userProfile?.role === 'admin') {
      await fetch('/api/cloud/deactivate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${driveToken}`,
          'X-Firebase-Id-Token': idToken,
        },
      }).catch(() => undefined);
    }
    await signOutAccount();
    setSelectedAsset(null);
    await fetchRelayStatus();
  };

  const handleToggleRelay = async (enabled: boolean) => {
    const driveToken = getCachedDriveToken();
    const idToken = await getFirebaseIdToken();
    if (!driveToken) throw new Error('Vui lòng kết nối Google Drive Host trước.');
    if (!idToken) throw new Error('Phiên đăng nhập Admin đã hết hạn.');

    if (!enabled) {
      const res = await fetch('/api/cloud/deactivate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${driveToken}`,
          'X-Firebase-Id-Token': idToken,
        },
      });
      if (res.ok) setRelayStatus((prev) => ({ ...prev, enabled: false, active: false }));
      return;
    }
    if (!rootFolder || driveBuckets.length === 0) {
      await syncOwnerDriveWorkspace(driveToken, authUser, true);
      return;
    }
    await activateRelayWithToken(driveToken, rootFolder.id, driveBuckets);
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
    const set = new Set<string>(['Images', 'Videos']);
    for (const b of driveBuckets) {
      if (b.name !== 'DriveCDN') set.add(b.name);
    }
    for (const b of relayStatus.buckets) {
      if (b.name !== 'DriveCDN') set.add(b.name);
    }
    for (const item of mergedAssets) set.add(item.bucket);
    return Array.from(set).sort();
  }, [driveBuckets, relayStatus.buckets, mergedAssets]);

  const registerInPublicCatalog = async (
    driveToken: string,
    asset: CdnAsset
  ): Promise<CdnAsset> => {
    const idToken = await getFirebaseIdToken();
    if (!idToken) throw new Error('Phiên đăng nhập Admin không hợp lệ.');

    const res = await fetch('/api/cdn/catalog', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${driveToken}`,
        'X-Firebase-Id-Token': idToken,
      },
      body: JSON.stringify(asset),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
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

    const driveToken = getCachedDriveToken();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const task = newTasks[i];

      const updateTask = (patch: Partial<UploadTask>) => {
        setUploadTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...patch } : t)));
      };

      try {
        updateTask({ status: 'uploading', progress: 0 });

        const useBridgeRelay = relayStatus.active && relayStatus.mode === 'bridge';

        if (
          panel === 'admin' &&
          userProfile?.role === 'admin' &&
          driveToken &&
          isDriveConnected &&
          !useBridgeRelay
        ) {
          let activeRoot = rootFolder || rootFolderRef.current;
          if (!activeRoot) {
            const ws = await ensureCdnWorkspace(driveToken);
            rootFolderRef.current = ws.rootFolder;
            setRootFolder(ws.rootFolder);
            setDriveBuckets(ws.buckets);
            activeRoot = ws.rootFolder;
          }

          const targetFolderId =
            (bucketId &&
              driveBuckets.find((b) => b.id === bucketId && b.name !== 'DriveCDN')?.id) ||
            activeRoot?.id;

          if (!targetFolderId) {
            throw new Error('Không tìm thấy thư mục lưu trữ trên Google Drive.');
          }

          const uploaded = await uploadMediaToDrive(
            driveToken,
            file,
            targetFolderId,
            (progress, speedBps) => {
              updateTask({ progress, speedBps });
            }
          );

          updateTask({ status: 'publishing', progress: 100 });
          await makeFilePublic(driveToken, uploaded.id);

          const asset = await registerInPublicCatalog(driveToken, {
            fileId: uploaded.id,
            name: uploaded.name || file.name,
            mimeType: uploaded.mimeType || file.type,
            size: Number(uploaded.size || file.size),
            kind: task.kind,
            bucket: task.bucket,
            folderId: targetFolderId,
            width: uploaded.imageMediaMetadata?.width ?? uploaded.videoMediaMetadata?.width,
            height: uploaded.imageMediaMetadata?.height ?? uploaded.videoMediaMetadata?.height,
            durationMillis: uploaded.videoMediaMetadata?.durationMillis
              ? Number(uploaded.videoMediaMetadata.durationMillis)
              : undefined,
            thumbnailLink: uploaded.thumbnailLink,
            webViewLink: uploaded.webViewLink,
            isPublic: true,
            createdTime: uploaded.createdTime || new Date().toISOString(),
            uploadedBy: uploaderName || driveUser?.displayName || userProfile.displayName,
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
    const driveToken = getCachedDriveToken();
    if (!driveToken || !rootFolder) return null;
    const created = await createBucketFolder(driveToken, rootFolder.id, name);
    const nextBuckets = [...driveBuckets, created];
    setDriveBuckets(nextBuckets);
    if (relayStatus.active) {
      await activateRelayWithToken(driveToken, rootFolder.id, nextBuckets);
    }
    return created;
  };

  // Admin-only Media Mutations
  const handleTogglePublic = async (asset: CdnAsset, nextPublic: boolean) => {
    const driveToken = getCachedDriveToken();
    const idToken = await getFirebaseIdToken();
    if (!driveToken || !idToken || userProfile?.role !== 'admin') {
      throw new Error('Cần kết nối Google Drive Host bằng tài khoản Admin để thay đổi quyền.');
    }

    if (nextPublic) {
      await makeFilePublic(driveToken, asset.fileId);
      const updated = await registerInPublicCatalog(driveToken, { ...asset, isPublic: true });
      setSelectedAsset(updated);
    } else {
      await makeFilePrivate(driveToken, asset.fileId);
      await fetch(`/api/cdn/catalog/${encodeURIComponent(asset.fileId)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${driveToken}`,
          'X-Firebase-Id-Token': idToken,
        },
      });
      setSelectedAsset({ ...asset, isPublic: false });
    }
    await refreshAll();
  };

  const handleRenameAsset = async (asset: CdnAsset, newName: string) => {
    const driveToken = getCachedDriveToken();
    const idToken = await getFirebaseIdToken();
    if (!driveToken || !idToken || userProfile?.role !== 'admin') {
      throw new Error('Cần kết nối Google Drive Host bằng tài khoản Admin để đổi tên tệp.');
    }

    await renameDriveFile(driveToken, asset.fileId, newName);
    if (asset.isPublic) {
      await fetch(`/api/cdn/catalog/${encodeURIComponent(asset.fileId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${driveToken}`,
          'X-Firebase-Id-Token': idToken,
        },
        body: JSON.stringify({ name: newName }),
      });
    }
    setSelectedAsset({ ...asset, name: newName });
    await refreshAll();
  };

  const handleDeleteAsset = async (asset: CdnAsset) => {
    const driveToken = getCachedDriveToken();
    const idToken = await getFirebaseIdToken();
    if (!driveToken || !idToken || userProfile?.role !== 'admin') {
      throw new Error('Cần kết nối Google Drive Host bằng tài khoản Admin để xóa tệp.');
    }

    await deleteDriveFile(driveToken, asset.fileId);
    await fetch(`/api/cdn/catalog/${encodeURIComponent(asset.fileId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${driveToken}`,
        'X-Firebase-Id-Token': idToken,
      },
    });
    await refreshAll();
  };

  const canManageSelectedAsset =
    panel === 'admin' && userProfile?.role === 'admin' && isDriveConnected;

  return (
    <>
      {panel === 'admin' ? (
        <AdminDashboard
          authUser={authUser}
          authLoading={authLoading}
          isSigningIn={isSigningIn}
          authError={authError}
          userProfile={userProfile}
          firebaseIdToken={firebaseIdToken}
          isDriveConnected={isDriveConnected}
          isSigningInDrive={isSigningInDrive}
          driveUser={driveUser}
          storageQuota={storageQuota}
          buckets={driveBuckets}
          bucketNames={bucketNames}
          relayStatus={relayStatus}
          assets={mergedAssets}
          loadingAssets={loadingAssets}
          uploadTasks={uploadTasks}
          driveError={driveError}
          onSignInAdminGoogle={handleSignInRegularUser}
          onConnectDriveHost={handleConnectDriveHost}
          onSignOut={handleSignOut}
          onSwitchToUserPortal={() => switchPanel('user')}
          onRefreshAssets={() => void refreshAll()}
          onInspectAsset={(asset) => setSelectedAsset(asset)}
          onUploadFiles={handleUploadFiles}
          onToggleRelay={handleToggleRelay}
          onCreateBucket={handleCreateBucket}
        />
      ) : (
        <UserPortal
          authUser={authUser}
          authLoading={authLoading}
          isSigningIn={isSigningIn}
          authError={authError}
          userProfile={userProfile}
          firebaseIdToken={firebaseIdToken}
          relayStatus={relayStatus}
          assets={mergedAssets}
          loadingAssets={loadingAssets}
          bucketNames={bucketNames}
          uploadTasks={uploadTasks}
          onSignInUser={handleSignInRegularUser}
          onSignOut={handleSignOut}
          onSwitchToAdmin={() => switchPanel('admin')}
          onRefreshAssets={() => void refreshAll()}
          onInspectAsset={(asset) => setSelectedAsset(asset)}
          onUploadFiles={handleUploadFiles}
        />
      )}

      <AssetInspectorModal
        asset={selectedAsset}
        canManage={canManageSelectedAsset}
        authToken={firebaseIdToken}
        onClose={() => setSelectedAsset(null)}
        onTogglePublic={handleTogglePublic}
        onRename={handleRenameAsset}
        onDelete={handleDeleteAsset}
      />
    </>
  );
}
