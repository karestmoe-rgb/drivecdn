import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  CheckCircle2,
  Clock,
  Folder,
  LogOut,
  Menu,
  Shield,
  ShieldAlert,
  UploadCloud,
  X,
} from 'lucide-react';
import type {
  CdnAsset,
  PublicRelayStatus,
  UploadTask,
  UserAccount,
} from '../types/cdn';
import { GoogleSignInButton } from './GoogleSignInButton';
import { LibraryView } from './LibraryView';
import { UploaderView } from './UploaderView';

type UserTab = 'library' | 'upload';

interface UserPortalProps {
  authUser: User | null;
  authLoading: boolean;
  isSigningIn: boolean;
  authError: string | null;
  userProfile: UserAccount | null;
  firebaseIdToken: string | null;
  relayStatus: PublicRelayStatus;
  assets: CdnAsset[];
  loadingAssets: boolean;
  bucketNames: string[];
  uploadTasks: UploadTask[];
  onSignInUser: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSwitchToAdmin: () => void;
  onRefreshAssets: () => void;
  onInspectAsset: (asset: CdnAsset) => void;
  onUploadFiles: (
    files: File[],
    bucketName: string,
    bucketId?: string,
    uploaderName?: string
  ) => Promise<void>;
}

export function UserPortal({
  authUser,
  authLoading,
  isSigningIn,
  authError,
  userProfile,
  firebaseIdToken,
  relayStatus,
  assets,
  loadingAssets,
  bucketNames,
  uploadTasks,
  onSignInUser,
  onSignOut,
  onSwitchToAdmin,
  onRefreshAssets,
  onInspectAsset,
  onUploadFiles,
}: UserPortalProps) {
  const [activeTab, setActiveTab] = useState<UserTab>('library');
  const [activeBucket, setActiveBucket] = useState<string>('ALL');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const canView = Boolean(
    userProfile && (userProfile.role === 'admin' || (userProfile.status === 'approved' && userProfile.canView))
  );
  const canUpload = Boolean(
    userProfile && (userProfile.role === 'admin' || (userProfile.status === 'approved' && userProfile.canUpload))
  );

  useEffect(() => {
    if (activeTab === 'library' && !canView && canUpload) {
      setActiveTab('upload');
    } else if (activeTab === 'upload' && !canUpload && canView) {
      setActiveTab('library');
    }
  }, [activeTab, canView, canUpload]);

  // 1. Loading Auth
  if (authLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
        <p className="mt-3 text-sm text-zinc-600">Đang kiểm tra phiên đăng nhập...</p>
      </div>
    );
  }

  // 2. Unauthenticated Google Sign-In Gate
  if (!authUser) {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6">
            <span className="font-display text-lg font-bold tracking-tight text-zinc-900">
              DriveCDN
            </span>
            <button
              type="button"
              onClick={onSwitchToAdmin}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <Shield className="h-3.5 w-3.5 text-blue-600" />
              Admin Dashboard
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-xl px-4 py-12 sm:py-20">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8">
            <h1 className="text-xl font-semibold text-zinc-900">
              Đăng nhập Google để sử dụng DriveCDN
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              Vui lòng đăng nhập bằng tài khoản Google của bạn để yêu cầu quyền truy cập kho lưu trữ hình ảnh và video.
            </p>

            <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-600 space-y-1.5">
              <div>• Chỉ xác thực danh tính Google cơ bản (không truy cập Google Drive cá nhân của bạn).</div>
              <div>• Sau khi đăng nhập lần đầu, Admin sẽ cấp quyền <strong>Xem file</strong> hoặc <strong>Đăng tải file</strong>.</div>
              <div>• User chỉ có quyền xem / đăng tải, không có quyền xóa tệp trên hệ thống.</div>
            </div>

            {authError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 break-words">
                {authError}
              </div>
            )}

            <div className="mt-6">
              <GoogleSignInButton
                onClick={() => void onSignInUser()}
                disabled={isSigningIn}
                label={isSigningIn ? 'Đang đăng nhập...' : 'Đăng nhập với Google'}
              />
            </div>
          </div>
        </main>
      </div>
    );
  }

  // 3. Profile Loading
  if (!userProfile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
        <p className="mt-3 text-sm text-zinc-600">Đang tải thông tin quyền truy cập...</p>
      </div>
    );
  }

  // 4. Waiting for Admin Approval / Revoked Screen
  if (!canView && !canUpload) {
    const isRevoked = userProfile.status === 'revoked';
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-6">
            <span className="font-display text-lg font-bold tracking-tight text-zinc-900">
              DriveCDN
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSwitchToAdmin}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Admin Dashboard
              </button>
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                Đăng xuất
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-lg px-4 py-12 sm:py-20">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8">
            <div className="flex items-center gap-3.5">
              {userProfile.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  alt={userProfile.displayName}
                  referrerPolicy="no-referrer"
                  className="h-12 w-12 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-700 shrink-0">
                  {userProfile.displayName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-zinc-900">
                  {userProfile.displayName}
                </div>
                <div className="truncate text-xs text-zinc-500">{userProfile.email}</div>
              </div>
            </div>

            <div
              className={`mt-5 flex items-start gap-3 rounded-xl border p-4 ${
                isRevoked
                  ? 'border-red-200 bg-red-50 text-red-900'
                  : 'border-amber-200 bg-amber-50 text-amber-950'
              }`}
            >
              {isRevoked ? (
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              ) : (
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              )}
              <div className="text-xs leading-relaxed">
                <div className="font-semibold text-sm">
                  {isRevoked ? 'Tài khoản đã bị thu hồi quyền truy cập' : 'Đang chờ Admin cấp quyền'}
                </div>
                <p className="mt-1">
                  {isRevoked
                    ? 'Admin đã thu hồi quyền xem và đăng tải của tài khoản này. Vui lòng liên hệ quản trị viên nếu bạn cần mở lại.'
                    : 'Tài khoản Google của bạn đã được ghi nhận trên hệ thống. Trang này sẽ tự động mở khóa ngay khi Admin bật quyền Xem file hoặc Đăng tải file trong Admin Dashboard.'}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="min-h-[40px] rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Đăng xuất / Đổi tài khoản Google
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // 5. Approved User Portal
  const navItems: { id: UserTab; label: string }[] = [
    ...(canView ? [{ id: 'library' as const, label: 'Thư viện Media' }] : []),
    ...(canUpload ? [{ id: 'upload' as const, label: 'Tải lên Cloud' }] : []),
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-zinc-50 text-zinc-900">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:h-16 sm:gap-8 sm:px-6">
          <button
            type="button"
            onClick={() => setActiveTab(canView ? 'library' : 'upload')}
            className="font-display text-lg font-bold tracking-tight text-zinc-900 whitespace-nowrap shrink-0"
          >
            DriveCDN
          </button>

          <nav className="hidden items-center gap-7 md:flex" aria-label="Điều hướng người dùng">
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

          <div className="flex items-center gap-2 shrink-0">
            {canUpload && (
              <button
                type="button"
                onClick={() => setActiveTab('upload')}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                <span>Tải lên ngay</span>
              </button>
            )}

            {userProfile.role === 'admin' && (
              <button
                type="button"
                onClick={onSwitchToAdmin}
                className="hidden sm:inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 whitespace-nowrap shrink-0"
              >
                <Shield className="h-3.5 w-3.5 text-blue-600" />
                Admin Dashboard
              </button>
            )}

            <button
              type="button"
              onClick={() => void onSignOut()}
              className="hidden sm:inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 whitespace-nowrap shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
              Đăng xuất
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Mở menu người dùng"
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
                  className={`min-h-[44px] rounded-lg px-3 py-2 text-left text-sm font-medium ${
                    activeTab === nav.id
                      ? 'bg-zinc-900 text-white'
                      : 'border border-zinc-200 bg-zinc-50 text-zinc-700'
                  }`}
                >
                  {nav.label}
                </button>
              ))}
              {userProfile.role === 'admin' && (
                <button
                  type="button"
                  onClick={onSwitchToAdmin}
                  className="col-span-2 min-h-[44px] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-xs font-medium text-zinc-700"
                >
                  Mở Admin Dashboard →
                </button>
              )}
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="col-span-2 min-h-[44px] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-xs font-medium text-red-600"
              >
                Đăng xuất ({userProfile.email})
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Mobile Bucket Strip */}
      {activeTab === 'library' && canView && (
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
              Tất cả ({assets.length})
            </button>
            {bucketNames.map((bucket) => {
              const count = assets.filter((a) => a.bucket === bucket).length;
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

      <div className="mx-auto flex max-w-[1440px] flex-col-reverse gap-6 px-4 py-5 sm:px-6 sm:py-8 lg:flex-row lg:gap-8">
        {/* Sidebar */}
        <aside className="w-full shrink-0 space-y-5 lg:w-[260px]">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="flex items-center gap-3">
              {userProfile.photoURL ? (
                <img
                  src={userProfile.photoURL}
                  alt={userProfile.displayName}
                  referrerPolicy="no-referrer"
                  className="h-9 w-9 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700 shrink-0">
                  {userProfile.displayName.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900">
                  {userProfile.displayName}
                </div>
                <div className="truncate text-xs text-zinc-500">{userProfile.email}</div>
              </div>
            </div>

            <div className="mt-4 space-y-2 border-t border-zinc-100 pt-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Quyền xem file</span>
                <span className={canView ? 'font-medium text-emerald-700' : 'text-zinc-400'}>
                  {canView ? 'Đã cấp' : 'Chưa cấp'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Quyền đăng tải</span>
                <span className={canUpload ? 'font-medium text-blue-700' : 'text-zinc-400'}>
                  {canUpload ? 'Đã cấp' : 'Chưa cấp'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Cổng lưu trữ Drive</span>
                <span className={relayStatus.active ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'}>
                  {relayStatus.active ? 'Đang mở' : 'Tạm đóng'}
                </span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-1.5 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span>Chế độ User: chỉ xem &amp; tải lên, không xóa tệp.</span>
            </div>
          </div>

          {canView && (
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
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium ${
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
                    {assets.length}
                  </span>
                </button>
                {bucketNames.map((bucket) => {
                  const count = assets.filter((a) => a.bucket === bucket).length;
                  return (
                    <button
                      key={bucket}
                      type="button"
                      onClick={() => {
                        setActiveBucket(bucket);
                        setActiveTab('library');
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium ${
                        activeBucket === bucket && activeTab === 'library'
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
        </aside>

        {/* Main Viewport */}
        <main className="min-w-0 flex-1">
          {activeTab === 'library' && canView && (
            <LibraryView
              assets={assets}
              loading={loadingAssets}
              canManage={false}
              canUpload={canUpload}
              authToken={firebaseIdToken}
              activeBucket={activeBucket}
              onRefresh={onRefreshAssets}
              onInspect={onInspectAsset}
              onGoToUpload={canUpload ? () => setActiveTab('upload') : undefined}
            />
          )}

          {activeTab === 'upload' && canUpload && (
            <UploaderView
              isOwnerSignedIn={false}
              relayStatus={relayStatus}
              ownerBuckets={[]}
              tasks={uploadTasks}
              currentUserName={userProfile.displayName}
              currentUserEmail={userProfile.email}
              onUploadFiles={onUploadFiles}
              onInspectAsset={onInspectAsset}
            />
          )}
        </main>
      </div>
    </div>
  );
}
