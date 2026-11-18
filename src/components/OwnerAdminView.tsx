import { useState } from 'react';
import { Check, Copy, FolderPlus, HardDrive, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import type { DriveFolder, DriveStorageQuota, DriveUser, PublicRelayStatus } from '../types/cdn';
import { formatBytes } from '../lib/format';
import { GoogleSignInButton } from './GoogleSignInButton';

const APPS_SCRIPT_CODE = `function doGet(e) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('BRIDGE_SECRET') || '';
  if (secret && (!e || !e.parameter || e.parameter.secret !== secret)) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var requestedFolderId = (e && e.parameter && e.parameter.folderId) ? String(e.parameter.folderId).trim() : '';
  var savedFolderId = requestedFolderId || props.getProperty('PINNED_FOLDER_ID') || '';
  var root = null;
  if (savedFolderId) {
    try {
      var candidate = DriveApp.getFolderById(savedFolderId);
      if (candidate && !candidate.isTrashed()) {
        root = candidate;
      }
    } catch (err) {}
  }
  if (!root) {
    var rootIter = DriveApp.getFoldersByName('DriveCDN');
    root = rootIter.hasNext() ? rootIter.next() : DriveApp.createFolder('DriveCDN');
    props.setProperty('PINNED_FOLDER_ID', root.getId());
  }
  var buckets = [{ id: root.getId(), name: 'DriveCDN' }];
  var subIter = root.getFolders();
  while (subIter.hasNext()) {
    var f = subIter.next();
    buckets.push({ id: f.getId(), name: f.getName() });
  }
  return ContentService.createTextOutput(JSON.stringify({
    accessToken: ScriptApp.getOAuthToken(),
    expiresIn: 2700,
    ownerEmail: Session.getEffectiveUser().getEmail() || '',
    rootFolderId: root.getId(),
    buckets: buckets,
    storageQuota: {
      limit: DriveApp.getStorageLimit(),
      usage: DriveApp.getStorageUsed(),
      usageInDrive: DriveApp.getStorageUsed(),
      usageInDriveTrash: 0
    }
  })).setMimeType(ContentService.MimeType.JSON);
}`;

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
  const [copiedScript, setCopiedScript] = useState(false);

  const handleCopyScript = async () => {
    await navigator.clipboard.writeText(APPS_SCRIPT_CODE);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2000);
  };

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
          Host Google Drive (Dành cho Admin)
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Kết nối tài khoản Google Drive chủ sở hữu để cấp dung lượng lưu trữ, xóa/quản lý tệp và mở cổng tải lên cho User đã được duyệt.
        </p>
      </div>

      {relayStatus.active && relayStatus.mode === 'bridge' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="text-sm font-semibold text-emerald-950">
            Cổng Drive vĩnh viễn 24/7 đang hoạt động ({relayStatus.ownerEmail || 'DRIVE_BRIDGE_URL'})
          </div>
          <p className="mt-1 text-xs leading-relaxed text-emerald-800">
            Mọi ảnh &amp; video do Admin và User được cấp quyền tải lên sẽ được lưu tập trung vào 1 thư mục cố định duy nhất trên Drive
            {relayStatus.rootFolderId ? (
              <>
                {' '}
                (Folder ID: <code className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-emerald-950">{relayStatus.rootFolderId}</code>)
              </>
            ) : null}
            , không tạo thêm thư mục trùng lặp kể cả khi redeploy app.
          </p>
        </div>
      )}

      {relayStatus.bridgeError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          Lỗi DRIVE_BRIDGE_URL: {relayStatus.bridgeError}
        </div>
      )}

      {!isAuthenticated ? (
        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-6">
            <div className="max-w-xl">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-zinc-900">
                Cách 1 · Mở cổng nhanh qua trình duyệt (hiệu lực ~58 phút)
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                Đăng nhập Google Drive tại đây để mở cổng tải lên ngay lập tức và quản lý (đổi tên, xóa, ẩn) tệp. Lưu ý: Token đăng nhập Google trên trình duyệt sẽ hết hạn sau ~1 giờ; để chạy 24/7 trên Vercel không bao giờ phải đăng nhập lại, hãy thiết lập Cách 2 bên dưới.
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
                Cổng lưu trữ Google Drive (Cloud Relay)
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                Khi bật, các tài khoản Google đã được Admin cấp quyền tải lên trong tab Quản lý User có thể tải ảnh và video thẳng vào thư mục <span className="font-mono text-zinc-800">DriveCDN</span> của bạn.
              </p>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <div className="text-xs">
                  <div className="font-semibold text-zinc-900">
                    {relayStatus.active ? 'Đang mở cho User đã cấp quyền' : 'Đang tạm đóng'}
                  </div>
                  <div className="mt-0.5 text-zinc-500 tabular-nums">
                    {relayStatus.active
                      ? `Phiên kết nối hiện tại còn hiệu lực ~${minutesRemaining} phút`
                      : 'Nhấn Bật cổng tải lên để cho phép User được duyệt gửi tệp'}
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

      {relayStatus.mode !== 'bridge' && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-900">
                Kết nối Google Drive vĩnh viễn 24/7 trên Vercel (Không cần đăng nhập lại)
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">
                Dùng Google Apps Script miễn phí chính chủ từ tài khoản Drive của bạn để tự động cấp phiên tải lên 24/7. Khách vãng lai tải ảnh/video thoải mái mà chủ sở hữu không bao giờ phải đăng nhập lại sau 1 giờ hay khi Vercel khởi động lại.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleCopyScript()}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 whitespace-nowrap shrink-0"
            >
              {copiedScript ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Đã chép mã Script
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Sao chép mã Apps Script
                </>
              )}
            </button>
          </div>

          <ol className="mt-4 space-y-2 text-xs leading-relaxed text-zinc-700 list-decimal pl-4">
            <li>
              Truy cập <span className="font-mono font-medium text-zinc-900">script.google.com</span> bằng tài khoản Google Drive chứa dữ liệu → bấm <strong>Dự án mới (New project)</strong>.
            </li>
            <li>Xóa code mặc định, dán đoạn mã bên dưới vào và nhấn Lưu.</li>
            <li>
              Bấm <strong>Deploy → New deployment → Web app</strong>. Mục <em>Execute as</em> chọn <strong>Me (Tôi)</strong>, mục <em>Who has access</em> chọn <strong>Anyone (Bất kỳ ai)</strong> → Cấp quyền Google Drive và chép URL <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono">/exec</code>.
            </li>
            <li>
              Thêm biến môi trường <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono font-semibold">DRIVE_BRIDGE_URL</code> = URL đó trong Vercel Settings. (Tùy chọn: thêm <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono font-semibold">DRIVE_FOLDER_ID</code> = ID thư mục Google Drive cụ thể nếu muốn mọi tệp luôn lưu cố định vào đúng thư mục đó kể cả khi redeploy) → <strong>Redeploy</strong>.
            </li>
          </ol>

          <pre className="mt-4 max-h-56 overflow-auto rounded-lg border border-zinc-200 bg-zinc-950 p-3.5 font-mono text-[11px] leading-relaxed text-zinc-100">
            <code>{APPS_SCRIPT_CODE}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
