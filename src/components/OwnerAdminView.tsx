import { useState } from 'react';
import { FolderPlus, HardDrive, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import type { DriveFolder, DriveStorageQuota, DriveUser, PublicRelayStatus } from '../types/cdn';
import { formatBytes } from '../lib/format';
import { GoogleSignInButton } from './GoogleSignInButton';

interface OwnerAdminViewProps {
  isAuthenticated: boolean;
  isSigningIn: boolean;
  driveUser: DriveUser | null;
  storageQuota: DriveStorageQuota | null;
  buckets: DriveFolder[];
  relayStatus: PublicRelayStatus;
  onSignIn: () => void;
  onSignOut: () => void;
  onToggleRelay: (enabled: boolean) => Promise<void>;
  onCreateBucket: (name: string) => Promise<DriveFolder | null>;
}

export function OwnerAdminView({
  isAuthenticated,
  isSigningIn,
  driveUser,
  storageQuota,
  buckets,
  relayStatus,
  onSignIn,
  onSignOut,
  onToggleRelay,
  onCreateBucket,
}: OwnerAdminViewProps) {
  const [newBucketName, setNewBucketName] = useState('');
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newBucketName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await onCreateBucket(newBucketName.trim());
      setNewBucketName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tạo thư mục mới.');
    } finally {
      setCreating(false);
    }
  };

  const handleRelayAction = async (enable: boolean) => {
    setToggling(true);
    setError(null);
    try {
      await onToggleRelay(enable);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật trạng thái cổng Cloud.');
    } finally {
      setToggling(false);
    }
  };

  const quotaPct =
    storageQuota && storageQuota.limit > 0
      ? Math.min(100, Math.round((storageQuota.usage / storageQuota.limit) * 100))
      : 0;

  const minutesRemaining =
    relayStatus.active && relayStatus.expiresAt
      ? Math.max(1, Math.round((relayStatus.expiresAt - Date.now()) / 60000))
      : 0;

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-200 pb-5">
        <h1 className="text-xl font-semibold text-zinc-900">
          Quản trị Google Drive (Dành cho chủ sở hữu)
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Kết nối tài khoản Google Drive của bạn tại đây để cấp dung lượng lưu trữ và mở cổng cho phép người dùng tải lên mà không cần đăng nhập.
        </p>
      </div>

      {!isAuthenticated ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8">
          <div className="max-w-lg">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-zinc-900">
              Kết nối tài khoản Google Drive làm máy chủ lưu trữ
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              Chỉ chủ sở hữu dung lượng mới cần đăng nhập một lần để kích hoạt Cloud. Sau khi kết nối, toàn bộ khách truy cập web app đều có thể tải lên video, hình ảnh và xem trực tiếp mà không cần đăng nhập.
            </p>
            <div className="mt-5">
              <GoogleSignInButton
                onClick={onSignIn}
                disabled={isSigningIn}
                label={isSigningIn ? 'Đang kết nối...' : 'Sign in with Google'}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Account & Public Upload Gate */}
          <div className="space-y-5 rounded-xl border border-zinc-200 bg-white p-6 lg:col-span-7">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 pb-4">
              <div>
                <div className="text-xs font-medium text-zinc-500">Tài khoản Drive đang kết nối</div>
                <div className="mt-1 text-base font-semibold text-zinc-900">
                  {driveUser?.displayName}
                </div>
                <div className="text-xs text-zinc-500">{driveUser?.emailAddress}</div>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 whitespace-nowrap"
              >
                <LogOut className="h-3.5 w-3.5" />
                Ngắt kết nối
              </button>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                {error}
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                Cổng tải lên công khai (Public Cloud Relay)
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                Khi bật, bất kỳ ai truy cập web app này đều có thể tải video và hình ảnh thẳng vào thư mục <span className="font-mono text-zinc-800">DriveCDN</span> trên Google Drive của bạn mà không cần đăng nhập.
              </p>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-xs">
                  <div className="font-semibold text-zinc-900">
                    {relayStatus.active ? 'Đang mở cho người dùng công khai' : 'Đang tạm đóng'}
                  </div>
                  <div className="mt-0.5 text-zinc-500 tabular-nums">
                    {relayStatus.active
                      ? `Phiên kết nối hiện tại còn hiệu lực ~${minutesRemaining} phút`
                      : 'Nhấn Bật cổng tải lên để cho phép khách gửi tệp'}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {relayStatus.active ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleRelayAction(true)}
                        disabled={toggling}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 whitespace-nowrap"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Làm mới phiên
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRelayAction(false)}
                        disabled={toggling}
                        className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 whitespace-nowrap"
                      >
                        Tạm ngưng
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRelayAction(true)}
                      disabled={toggling}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap"
                    >
                      Bật cổng tải lên công khai
                    </button>
                  )}
                </div>
              </div>
            </div>

            {storageQuota && (
              <div className="border-t border-zinc-100 pt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-900">
                    <HardDrive className="h-4 w-4 text-blue-600" />
                    Dung lượng Google Drive
                  </span>
                  <span className="font-mono text-zinc-700 tabular-nums">
                    {formatBytes(storageQuota.usage)} /{' '}
                    {storageQuota.limit > 0 ? formatBytes(storageQuota.limit) : 'Không giới hạn'} ({quotaPct}%)
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full bg-blue-600" style={{ width: `${quotaPct}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Buckets / Folders Management */}
          <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 lg:col-span-5">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">Thư mục lưu trữ (Buckets)</h3>
              <p className="mt-1 text-xs text-zinc-600">
                Tạo thêm thư mục trong <span className="font-mono text-zinc-800">DriveCDN</span> để phân loại video, hình ảnh theo từng dự án.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newBucketName}
                onChange={(e) => setNewBucketName(e.target.value)}
                placeholder="Tên thư mục mới..."
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-blue-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || !newBucketName.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                {creating ? 'Đang tạo...' : 'Tạo'}
              </button>
            </div>

            <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
              {buckets.map((b) => (
                <div key={b.id} className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                  <span className="font-medium text-zinc-900">DriveCDN / {b.name}</span>
                  <span className="font-mono text-[11px] text-zinc-400 truncate max-w-[140px]">
                    {b.id}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
