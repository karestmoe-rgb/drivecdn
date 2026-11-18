import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  ArrowLeft,
  CheckCircle2,
  Folder,
  HardDrive,
  LogOut,
  Menu,
  Search,
  Shield,
  ShieldAlert,
  Trash2,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import type {
  CdnAsset,
  DriveFolder,
  DriveStorageQuota,
  DriveUser,
  PublicRelayStatus,
  UploadTask,
  UserAccount,
  UserStatus,
} from '../types/cdn';
import {
  adminDeleteUserRecord,
  adminUpdateUserPermissions,
  subscribeAllUsers,
} from '../lib/firebaseClient';
import { formatBytes } from '../lib/format';
import { GoogleSignInButton } from './GoogleSignInButton';
import { LibraryView } from './LibraryView';
import { UploaderView } from './UploaderView';
import { OwnerAdminView } from './OwnerAdminView';
import { ApiDocsView } from './ApiDocsView';
import { ConfirmModal } from './ConfirmModal';

type AdminTab = 'users' | 'media' | 'drive' | 'docs';
type MediaSubTab = 'library' | 'upload';
type UserFilter = 'all' | UserStatus;

interface AdminDashboardProps {
  authUser: User | null;
  authLoading: boolean;
  isSigningIn: boolean;
  authError: string | null;
  userProfile: UserAccount | null;
  firebaseIdToken: string | null;
  isDriveConnected: boolean;
  isSigningInDrive: boolean;
  driveUser: DriveUser | null;
  storageQuota: DriveStorageQuota | null;
  buckets: DriveFolder[];
  bucketNames: string[];
  relayStatus: PublicRelayStatus;
  assets: CdnAsset[];
  loadingAssets: boolean;
  uploadTasks: UploadTask[];
  driveError: string | null;
  onSignInAdminGoogle: () => Promise<void>;
  onConnectDriveHost: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSwitchToUserPortal: () => void;
  onRefreshAssets: () => void;
  onInspectAsset: (asset: CdnAsset) => void;
  onUploadFiles: (
    files: File[],
    bucketName: string,
    bucketId?: string,
    uploaderName?: string
  ) => Promise<void>;
  onToggleRelay: (enabled: boolean) => Promise<void>;
  onCreateBucket: (name: string) => Promise<DriveFolder | null>;
}

export function AdminDashboard({
  authUser,
  authLoading,
  isSigningIn,
  authError,
  userProfile,
  firebaseIdToken,
  isDriveConnected,
  isSigningInDrive,
  driveUser,
  storageQuota,
  buckets,
  bucketNames,
  relayStatus,
  assets,
  loadingAssets,
  uploadTasks,
  driveError,
  onSignInAdminGoogle,
  onConnectDriveHost,
  onSignOut,
  onSwitchToUserPortal,
  onRefreshAssets,
  onInspectAsset,
  onUploadFiles,
  onToggleRelay,
  onCreateBucket,
}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [mediaSubTab, setMediaSubTab] = useState<MediaSubTab>('library');
  const [activeBucket, setActiveBucket] = useState<string>('ALL');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // User management state
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<UserFilter>('all');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{
    action: 'revoke' | 'delete';
    user: UserAccount;
  } | null>(null);

  const isAdmin = Boolean(authUser && userProfile?.role === 'admin');

  useEffect(() => {
    if (!isAdmin) {
      setUsers([]);
      setUsersLoading(false);
      return;
    }

    setUsersLoading(true);
    setUsersError(null);
    const unsub = subscribeAllUsers(
      (list) => {
        setUsers(list);
        setUsersLoading(false);
      },
      (err) => {
        setUsersError(err.message);
        setUsersLoading(false);
      }
    );

    return () => unsub();
  }, [isAdmin]);

  const userStats = useMemo(() => {
    const nonAdmins = users.filter((u) => u.role !== 'admin');
    return {
      total: users.length,
      pending: nonAdmins.filter((u) => u.status === 'pending').length,
      approved: nonAdmins.filter((u) => u.status === 'approved' && (u.canView || u.canUpload)).length,
      revoked: nonAdmins.filter((u) => u.status === 'revoked' || (u.status === 'approved' && !u.canView && !u.canUpload)).length,
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (userFilter !== 'all' && u.status !== userFilter) return false;
      if (userSearch.trim()) {
        const q = userSearch.trim().toLowerCase();
        return (
          u.email.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q) ||
          u.uid.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [users, userFilter, userSearch]);

  const handleTogglePermission = async (
    target: UserAccount,
    field: 'canView' | 'canUpload',
    nextValue: boolean
  ) => {
    setBusyUid(target.uid);
    setUsersError(null);
    try {
      const nextView = field === 'canView' ? nextValue : Boolean(target.canView);
      const nextUpload = field === 'canUpload' ? nextValue : Boolean(target.canUpload);
      const nextStatus: UserStatus = nextView || nextUpload ? 'approved' : 'revoked';
      await adminUpdateUserPermissions(target.uid, {
        canView: nextView,
        canUpload: nextUpload,
        status: nextStatus,
      });
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Không thể cập nhật quyền tài khoản.');
    } finally {
      setBusyUid(null);
    }
  };

  const handleApproveBoth = async (target: UserAccount) => {
    setBusyUid(target.uid);
    setUsersError(null);
    try {
      await adminUpdateUserPermissions(target.uid, {
        canView: true,
        canUpload: true,
        status: 'approved',
      });
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Không thể phê duyệt tài khoản.');
    } finally {
      setBusyUid(null);
    }
  };

  const executeConfirmedUserAction = async () => {
    if (!confirmTarget) return;
    setBusyUid(confirmTarget.user.uid);
    setUsersError(null);
    try {
      if (confirmTarget.action === 'revoke') {
        await adminUpdateUserPermissions(confirmTarget.user.uid, {
          canView: false,
          canUpload: false,
          status: 'revoked',
        });
      } else {
        await adminDeleteUserRecord(confirmTarget.user.uid);
      }
      setConfirmTarget(null);
    } catch (err) {
      setUsersError(err instanceof Error ? err.message : 'Không thể thực hiện thao tác.');
    } finally {
      setBusyUid(null);
    }
  };

  // Auth Gate 1: Loading
  if (authLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
        <p className="mt-3 text-sm text-zinc-600">Đang xác thực quyền Admin...</p>
      </div>
    );
  }

  // Auth Gate 2: Not signed in
  if (!authUser) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-2.5">
              <span className="font-display text-lg font-bold tracking-tight text-zinc-900">
                DriveCDN
              </span>
              <span className="font-mono text-xs font-semibold text-blue-600">ADMIN</span>
            </div>
            <button
              type="button"
              onClick={onSwitchToUserPortal}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Về User UI
            </button>
          </div>
        </header>

        <main className="mx-auto flex max-w-xl flex-col justify-center px-4 py-12 sm:py-20">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-blue-600">
              <Shield className="h-5 w-5" />
            </div>
            <h1 className="mt-4 text-xl font-semibold text-zinc-900">
              Đăng nhập Admin Dashboard
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              Khu vực này dành riêng cho tài khoản Google chủ sở hữu host tệp trên Google Drive, xét duyệt quyền cho User và xóa/quản lý tệp media.
            </p>

            {authError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 break-words">
                {authError}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3">
              <GoogleSignInButton
                onClick={() => void onConnectDriveHost()}
                disabled={isSigningInDrive || isSigningIn}
                label={
                  isSigningInDrive
                    ? 'Đang kết nối Google Drive Host...'
                    : 'Đăng nhập & Kết nối Google Drive Host'
                }
              />

              <button
                type="button"
                onClick={() => void onSignInAdminGoogle()}
                disabled={isSigningIn || isSigningInDrive}
                className="min-h-[44px] rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50"
              >
                {isSigningIn ? 'Đang đăng nhập...' : 'Chỉ đăng nhập Admin (Dùng Bridge 24/7)'}
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Auth Gate 3: Signed in, waiting profile OR not admin
  if (!userProfile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
        <p className="mt-3 text-sm text-zinc-600">Đang kiểm tra hồ sơ Admin...</p>
      </div>
    );
  }

  if (userProfile.role !== 'admin') {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6">
            <span className="font-display text-lg font-bold tracking-tight text-zinc-900">
              DriveCDN
            </span>
            <button
              type="button"
              onClick={onSwitchToUserPortal}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Về User UI
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-lg px-4 py-16">
          <div className="rounded-2xl border border-red-200 bg-white p-6 sm:p-8">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <h1 className="mt-4 text-lg font-semibold text-zinc-900">
              Không có quyền truy cập Admin Dashboard
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              Tài khoản <span className="font-medium text-zinc-900">{userProfile.email}</span> là tài khoản User thông thường, không phải Admin host Google Drive.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onSwitchToUserPortal}
                className="min-h-[40px] rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800"
              >
                Mở User UI
              </button>
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="min-h-[40px] rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Đăng xuất để đổi tài khoản
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const activeQuota = storageQuota || relayStatus.storageQuota;
  const quotaPct =
    activeQuota && activeQuota.limit > 0
      ? Math.min(100, Math.round((activeQuota.usage / activeQuota.limit) * 100))
      : 0;

  const navItems: { id: AdminTab; label: string; count?: number }[] = [
    { id: 'users', label: 'Quản lý User', count: userStats.pending },
    { id: 'media', label: 'Kho Media & Tải lên' },
    { id: 'drive', label: 'Host Google Drive' },
    { id: 'docs', label: 'Nhúng & Vercel' },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-zinc-50 text-zinc-900">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:h-16 sm:gap-8 sm:px-6">
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('users')}
              className="font-display text-lg font-bold tracking-tight text-zinc-900 whitespace-nowrap"
            >
              DriveCDN
            </button>
            <span className="font-mono text-xs font-semibold text-blue-600">ADMIN</span>
          </div>

          <nav className="hidden items-center gap-6 md:flex" aria-label="Điều hướng Admin">
            {navItems.map((nav) => (
              <button
                key={nav.id}
                type="button"
                onClick={() => setActiveTab(nav.id)}
                className={`inline-flex items-center gap-1.5 border-b-2 py-5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === nav.id
                    ? 'border-blue-600 text-zinc-900'
                    : 'border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-900'
                }`}
              >
                <span>{nav.label}</span>
                {nav.count && nav.count > 0 ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-800 tabular-nums">
                    {nav.count}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onSwitchToUserPortal}
              className="hidden sm:inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              User UI
            </button>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 whitespace-nowrap"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Mở menu quản trị"
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 md:hidden"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

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
                  className={`flex min-h-[44px] items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium ${
                    activeTab === nav.id
                      ? 'bg-zinc-900 text-white'
                      : 'border border-zinc-200 bg-zinc-50 text-zinc-700'
                  }`}
                >
                  <span>{nav.label}</span>
                  {nav.count && nav.count > 0 ? (
                    <span className="rounded bg-amber-200 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-950">
                      {nav.count}
                    </span>
                  ) : null}
                </button>
              ))}
              <button
                type="button"
                onClick={onSwitchToUserPortal}
                className="col-span-2 min-h-[44px] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-xs font-medium text-zinc-700"
              >
                ← Chuyển sang giao diện User UI
              </button>
            </div>
          </div>
        )}
      </header>

      <div className="mx-auto flex max-w-[1440px] flex-col-reverse gap-6 px-4 py-5 sm:px-6 sm:py-8 lg:flex-row lg:gap-8">
        {/* Sidebar */}
        <aside className="w-full shrink-0 space-y-5 lg:w-[260px]">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="text-xs font-medium text-zinc-500">Tài khoản Admin</div>
            <div className="mt-1 truncate text-sm font-semibold text-zinc-900">
              {userProfile.displayName}
            </div>
            <div className="truncate text-xs text-zinc-500">{userProfile.email}</div>

            <div className="mt-4 border-t border-zinc-100 pt-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
                <HardDrive className="h-4 w-4 text-blue-600" />
                Google Drive Host
              </div>

              {isDriveConnected ? (
                <div className="mt-2 text-xs text-emerald-700">
                  Đã kết nối OAuth ({driveUser?.emailAddress || userProfile.email})
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <div className="text-xs text-amber-700">
                    {relayStatus.active && relayStatus.mode === 'bridge'
                      ? 'Đang dùng Bridge 24/7 (cần OAuth nếu muốn xóa tệp)'
                      : 'Chưa kết nối Drive OAuth'}
                  </div>
                  <button
                    type="button"
                    onClick={() => void onConnectDriveHost()}
                    disabled={isSigningInDrive}
                    className="w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                  >
                    {isSigningInDrive ? 'Đang kết nối...' : 'Kết nối Drive Host'}
                  </button>
                </div>
              )}

              {activeQuota && (
                <div className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3 text-xs tabular-nums">
                  <div className="flex justify-between">
                    <span className="font-semibold text-zinc-900">
                      {formatBytes(activeQuota.usage)}
                    </span>
                    <span className="text-zinc-500">
                      / {activeQuota.limit > 0 ? formatBytes(activeQuota.limit) : '∞'}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full bg-blue-600" style={{ width: `${quotaPct}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>

          {activeTab === 'media' && mediaSubTab === 'library' && (
            <div className="hidden rounded-xl border border-zinc-200 bg-white p-3 lg:block">
              <div className="px-2.5 py-1.5 text-xs font-semibold text-zinc-500">
                Thư mục (Buckets)
              </div>
              <div className="mt-1 space-y-0.5">
                <button
                  type="button"
                  onClick={() => setActiveBucket('ALL')}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium ${
                    activeBucket === 'ALL'
                      ? 'bg-zinc-100 text-zinc-900'
                      : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    Tất cả tệp
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                    {assets.length}
                  </span>
                </button>
                {bucketNames.map((bucket) => {
                  const count = assets.filter((a) => a.bucket === bucket).length;
                  return (
                    <button
                      key={bucket}
                      type="button"
                      onClick={() => setActiveBucket(bucket)}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium ${
                        activeBucket === bucket
                          ? 'bg-zinc-100 text-zinc-900'
                          : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                        <span className="truncate">{bucket}</span>
                      </span>
                      <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {driveError && (
            <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4 text-xs leading-relaxed text-red-700 break-words">
              <p>{driveError.replace(/https:\/\/\S+/g, '').trim()}</p>
              {driveError.match(/https:\/\/\S+/) && (
                <a
                  href={driveError.match(/https:\/\/\S+/)?.[0]}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block font-semibold text-blue-700 underline"
                >
                  Mở Google Cloud Console để bật Drive API
                </a>
              )}
            </div>
          )}
        </aside>

        {/* Main Viewport */}
        <main className="min-w-0 flex-1">
          {activeTab === 'users' && (
            <div className="space-y-5">
              <div className="border-b border-zinc-200 pb-5">
                <h1 className="text-xl font-semibold text-zinc-900">
                  Quản lý Tài khoản User &amp; Cấp quyền
                </h1>
                <p className="mt-1 text-sm text-zinc-600">
                  Mọi người dùng đăng nhập Google lần đầu đều ở trạng thái Chờ duyệt. Hãy bật quyền <strong>Xem file</strong> và <strong>Đăng tải file</strong> cho từng tài khoản tại đây.
                </p>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="text-xs text-zinc-500">Tổng tài khoản</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-zinc-900 tabular-nums">
                    {userStats.total}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                  <div className="text-xs text-amber-800">Đang chờ duyệt</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-amber-900 tabular-nums">
                    {userStats.pending}
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                  <div className="text-xs text-emerald-800">Đã cấp quyền</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-emerald-900 tabular-nums">
                    {userStats.approved}
                  </div>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="text-xs text-zinc-500">Đã thu hồi</div>
                  <div className="mt-1 font-mono text-xl font-semibold text-zinc-700 tabular-nums">
                    {userStats.revoked}
                  </div>
                </div>
              </div>

              {usersError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                  {usersError}
                </div>
              )}

              {/* Search & Filter */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 sm:max-w-sm">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Tìm theo email hoặc tên Google..."
                    className="min-h-[42px] w-full rounded-lg border border-zinc-200 bg-white py-2 pr-3 pl-9 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1 rounded-lg bg-zinc-100 p-1">
                  {(
                    [
                      { id: 'all', label: 'Tất cả' },
                      { id: 'pending', label: 'Chờ duyệt' },
                      { id: 'approved', label: 'Đã duyệt' },
                      { id: 'revoked', label: 'Thu hồi' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setUserFilter(f.id)}
                      className={`min-h-[34px] rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        userFilter === f.id
                          ? 'bg-white text-zinc-900 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Users List */}
              {usersLoading ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
                  Đang tải danh sách tài khoản từ Firestore...
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
                  <Users className="mx-auto h-8 w-8 text-zinc-400" />
                  <h2 className="mt-3 text-sm font-semibold text-zinc-900">
                    Chưa có tài khoản phù hợp
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Khi người dùng đăng nhập bằng Google tại trang User UI, tài khoản của họ sẽ tự động xuất hiện ở đây để bạn cấp quyền.
                  </p>
                </div>
              ) : (
                <>
                  {/* Mobile Cards */}
                  <div className="space-y-3 md:hidden">
                    {filteredUsers.map((u) => {
                      const isRowAdmin = u.role === 'admin';
                      const isBusy = busyUid === u.uid;
                      return (
                        <div
                          key={u.uid}
                          className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              {u.photoURL ? (
                                <img
                                  src={u.photoURL}
                                  alt={u.displayName}
                                  referrerPolicy="no-referrer"
                                  className="h-9 w-9 rounded-full object-cover shrink-0"
                                />
                              ) : (
                                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700 shrink-0">
                                  {u.displayName.slice(0, 2).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-zinc-900">
                                  {u.displayName}
                                </div>
                                <div className="truncate text-xs text-zinc-500">{u.email}</div>
                              </div>
                            </div>

                            <span
                              className={`text-xs font-semibold shrink-0 ${
                                isRowAdmin
                                  ? 'text-blue-700'
                                  : u.status === 'approved'
                                  ? 'text-emerald-700'
                                  : u.status === 'revoked'
                                  ? 'text-red-600'
                                  : 'text-amber-700'
                              }`}
                            >
                              {isRowAdmin
                                ? 'Admin'
                                : u.status === 'approved'
                                ? 'Đã duyệt'
                                : u.status === 'revoked'
                                ? 'Đã thu hồi'
                                : 'Chờ duyệt'}
                            </span>
                          </div>

                          {!isRowAdmin && (
                            <div className="space-y-2.5 border-t border-zinc-100 pt-3">
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleTogglePermission(u, 'canView', !u.canView)
                                  }
                                  className={`min-h-[40px] rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                                    u.canView
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                      : 'border-zinc-200 bg-zinc-50 text-zinc-600'
                                  }`}
                                >
                                  Xem file: {u.canView ? 'Bật' : 'Tắt'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleTogglePermission(u, 'canUpload', !u.canUpload)
                                  }
                                  className={`min-h-[40px] rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                                    u.canUpload
                                      ? 'border-blue-200 bg-blue-50 text-blue-800'
                                      : 'border-zinc-200 bg-zinc-50 text-zinc-600'
                                  }`}
                                >
                                  Đăng tải: {u.canUpload ? 'Bật' : 'Tắt'}
                                </button>
                              </div>

                              <div className="flex items-center gap-2">
                                {(!u.canView || !u.canUpload || u.status !== 'approved') && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => void handleApproveBoth(u)}
                                    className="flex-1 min-h-[38px] rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
                                  >
                                    Duyệt đủ quyền
                                  </button>
                                )}
                                {u.status !== 'revoked' && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      setConfirmTarget({ action: 'revoke', user: u })
                                    }
                                    className="min-h-[38px] rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                                  >
                                    Thu hồi
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => setConfirmTarget({ action: 'delete', user: u })}
                                  aria-label="Xóa hồ sơ"
                                  className="min-h-[38px] rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop Table */}
                  <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 bg-white md:block">
                    <table className="w-full min-w-[740px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                          <th className="px-4 py-3">Tài khoản Google</th>
                          <th className="px-4 py-3">Trạng thái</th>
                          <th className="px-4 py-3">Quyền Xem file</th>
                          <th className="px-4 py-3">Quyền Đăng tải</th>
                          <th className="px-4 py-3 text-right">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {filteredUsers.map((u) => {
                          const isRowAdmin = u.role === 'admin';
                          const isBusy = busyUid === u.uid;
                          return (
                            <tr key={u.uid} className="hover:bg-zinc-50/70">
                              <td className="px-4 py-3.5">
                                <div className="flex items-center gap-3">
                                  {u.photoURL ? (
                                    <img
                                      src={u.photoURL}
                                      alt={u.displayName}
                                      referrerPolicy="no-referrer"
                                      className="h-8 w-8 rounded-full object-cover shrink-0"
                                    />
                                  ) : (
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700 shrink-0">
                                      {u.displayName.slice(0, 2).toUpperCase()}
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <div className="truncate font-medium text-zinc-900">
                                      {u.displayName}
                                    </div>
                                    <div className="truncate text-xs text-zinc-500">{u.email}</div>
                                  </div>
                                </div>
                              </td>

                              <td className="px-4 py-3.5 text-xs">
                                {isRowAdmin ? (
                                  <span className="font-semibold text-blue-700">
                                    Admin hệ thống
                                  </span>
                                ) : u.status === 'approved' ? (
                                  <span className="font-semibold text-emerald-700">
                                    Đã duyệt
                                  </span>
                                ) : u.status === 'revoked' ? (
                                  <span className="font-semibold text-red-600">
                                    Đã thu hồi
                                  </span>
                                ) : (
                                  <span className="font-semibold text-amber-700">
                                    Chờ duyệt
                                  </span>
                                )}
                              </td>

                              <td className="px-4 py-3.5">
                                {isRowAdmin ? (
                                  <span className="text-xs text-zinc-500">Toàn quyền</span>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      void handleTogglePermission(u, 'canView', !u.canView)
                                    }
                                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                                      u.canView
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                        : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                                    }`}
                                  >
                                    {u.canView ? 'Đang bật' : 'Đang tắt'}
                                  </button>
                                )}
                              </td>

                              <td className="px-4 py-3.5">
                                {isRowAdmin ? (
                                  <span className="text-xs text-zinc-500">Toàn quyền</span>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      void handleTogglePermission(u, 'canUpload', !u.canUpload)
                                    }
                                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                                      u.canUpload
                                        ? 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100'
                                        : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                                    }`}
                                  >
                                    {u.canUpload ? 'Đang bật' : 'Đang tắt'}
                                  </button>
                                )}
                              </td>

                              <td className="px-4 py-3.5 text-right">
                                {isRowAdmin ? (
                                  <span className="text-xs text-zinc-400">Không thể khóa</span>
                                ) : (
                                  <div className="inline-flex items-center gap-2">
                                    {(!u.canView || !u.canUpload || u.status !== 'approved') && (
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => void handleApproveBoth(u)}
                                        className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-800 whitespace-nowrap"
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        Duyệt tất cả
                                      </button>
                                    )}
                                    {u.status !== 'revoked' && (
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() =>
                                          setConfirmTarget({ action: 'revoke', user: u })
                                        }
                                        className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 whitespace-nowrap"
                                      >
                                        Thu hồi
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() =>
                                        setConfirmTarget({ action: 'delete', user: u })
                                      }
                                      title="Xóa hồ sơ tài khoản"
                                      className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-500 hover:bg-zinc-50 hover:text-red-600"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'media' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 rounded-lg bg-zinc-200/70 p-1">
                  <button
                    type="button"
                    onClick={() => setMediaSubTab('library')}
                    className={`min-h-[36px] rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      mediaSubTab === 'library'
                        ? 'bg-white text-zinc-900 shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    Kho Media (Xóa / Đổi tên / Quyền)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMediaSubTab('upload')}
                    className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      mediaSubTab === 'upload'
                        ? 'bg-white text-zinc-900 shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                    Đăng tải tệp (Admin)
                  </button>
                </div>

                {!isDriveConnected && (
                  <button
                    type="button"
                    onClick={() => void onConnectDriveHost()}
                    className="min-h-[36px] rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                  >
                    Kết nối Google Drive OAuth để mở quyền Xóa / Đổi tên tệp
                  </button>
                )}
              </div>

              {mediaSubTab === 'library' ? (
                <LibraryView
                  assets={assets}
                  loading={loadingAssets}
                  canManage={isDriveConnected}
                  canUpload={true}
                  authToken={firebaseIdToken}
                  activeBucket={activeBucket}
                  onRefresh={onRefreshAssets}
                  onInspect={onInspectAsset}
                  onGoToUpload={() => setMediaSubTab('upload')}
                  onGoToDocs={() => setActiveTab('docs')}
                />
              ) : (
                <UploaderView
                  isOwnerSignedIn={isDriveConnected}
                  relayStatus={relayStatus}
                  ownerBuckets={buckets}
                  tasks={uploadTasks}
                  currentUserName={userProfile.displayName}
                  currentUserEmail={userProfile.email}
                  onUploadFiles={onUploadFiles}
                  onInspectAsset={onInspectAsset}
                  onGoToAdmin={() => setActiveTab('drive')}
                />
              )}
            </div>
          )}

          {activeTab === 'drive' && (
            <OwnerAdminView
              isAuthenticated={isDriveConnected}
              isSigningIn={isSigningInDrive}
              driveUser={driveUser}
              storageQuota={storageQuota}
              buckets={buckets}
              relayStatus={relayStatus}
              onSignIn={() => void onConnectDriveHost()}
              onSignOut={() => void onSignOut()}
              onToggleRelay={onToggleRelay}
              onCreateBucket={onCreateBucket}
            />
          )}

          {activeTab === 'docs' && <ApiDocsView sampleAsset={assets[0]} />}
        </main>
      </div>

      <ConfirmModal
        open={Boolean(confirmTarget)}
        title={
          confirmTarget?.action === 'revoke'
            ? 'Thu hồi quyền truy cập của User?'
            : 'Xóa hồ sơ tài khoản User khỏi Firestore?'
        }
        description={
          confirmTarget?.action === 'revoke'
            ? 'User sẽ bị tắt cả quyền Xem file và Đăng tải file ngay lập tức.'
            : 'Hồ sơ quyền của User sẽ bị xóa khỏi danh sách. Nếu họ đăng nhập lại sau này, tài khoản sẽ trở lại trạng thái Chờ duyệt.'
        }
        items={
          confirmTarget
            ? [`${confirmTarget.user.displayName} (${confirmTarget.user.email})`]
            : []
        }
        confirmLabel={confirmTarget?.action === 'revoke' ? 'Thu hồi quyền' : 'Xóa hồ sơ'}
        variant="danger"
        busy={Boolean(busyUid)}
        onConfirm={executeConfirmedUserAction}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
