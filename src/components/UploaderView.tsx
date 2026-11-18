import { useRef, useState, type DragEvent } from 'react';
import { Check, Copy, Play, UploadCloud, UserCheck } from 'lucide-react';
import type { CdnAsset, DriveFolder, PublicRelayStatus, UploadTask } from '../types/cdn';
import { buildCdnUrls, formatBytes } from '../lib/format';

interface UploaderViewProps {
  isOwnerSignedIn: boolean;
  relayStatus: PublicRelayStatus;
  ownerBuckets: DriveFolder[];
  tasks: UploadTask[];
  currentUserName?: string;
  currentUserEmail?: string;
  onUploadFiles: (
    files: File[],
    bucketName: string,
    bucketId?: string,
    uploaderName?: string
  ) => Promise<void>;
  onInspectAsset: (asset: CdnAsset) => void;
  onGoToAdmin?: () => void;
}

export function UploaderView({
  isOwnerSignedIn,
  relayStatus,
  ownerBuckets,
  tasks,
  currentUserName,
  currentUserEmail,
  onUploadFiles,
  onInspectAsset,
  onGoToAdmin,
}: UploaderViewProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<string>('AUTO');
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const canUpload = isOwnerSignedIn || relayStatus.active;
  const customBuckets = (ownerBuckets.length > 0 ? ownerBuckets : relayStatus.buckets).filter(
    (b) => b.name !== 'DriveCDN'
  );
  const availableBuckets =
    customBuckets.length > 0
      ? customBuckets
      : [
          { id: 'Images', name: 'Images' },
          { id: 'Videos', name: 'Videos' },
        ];

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);

    if (!canUpload) {
      setError('Cổng lưu trữ Google Drive hiện đang tạm đóng. Vui lòng liên hệ Admin.');
      return;
    }

    const mediaFiles = Array.from(fileList).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
    );

    if (mediaFiles.length === 0) {
      setError('Chỉ hỗ trợ tệp hình ảnh (PNG, JPG, WebP, GIF, SVG, AVIF) và video (MP4, WebM, MOV).');
      return;
    }

    const chosen = availableBuckets.find((b) => b.name === selectedBucket);
    await onUploadFiles(
      mediaFiles,
      chosen ? chosen.name : 'AUTO',
      chosen?.id,
      currentUserName || currentUserEmail
    );
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (!canUpload) return;
    void handleFiles(e.dataTransfer.files);
  };

  const handleCopyUrl = async (asset: CdnAsset) => {
    const urls = buildCdnUrls(asset, window.location.origin);
    const link = asset.kind === 'image' ? urls.googleImageUrl : urls.proxyUrl;
    await navigator.clipboard.writeText(link);
    setCopiedId(asset.fileId);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-200 pb-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">
            Tải lên Hình ảnh &amp; Video lên Cloud
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Tệp tải lên được lưu trữ trực tiếp vào thư mục Google Drive chung do Admin quản lý.
          </p>
        </div>
        <div className="text-xs text-zinc-600 shrink-0">
          {canUpload ? (
            <span className="font-medium text-emerald-700">
              Cổng Cloud đang mở{relayStatus.ownerName ? ` · ${relayStatus.ownerName}` : ''}
            </span>
          ) : (
            <span className="font-medium text-amber-700">Cổng lưu trữ đang tạm đóng</span>
          )}
        </div>
      </div>

      {!canUpload && (
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-5 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-sm font-semibold text-amber-950">
              Admin chưa kích hoạt cổng lưu trữ Google Drive
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">
              {onGoToAdmin
                ? 'Hãy kết nối tài khoản Google Drive Host hoặc thiết lập DRIVE_BRIDGE_URL trong tab Host Google Drive để mở tải lên 24/7.'
                : 'Vui lòng liên hệ Admin để bật cổng kết nối Google Drive trước khi tải tệp lên.'}
            </p>
          </div>
          {onGoToAdmin && (
            <button
              type="button"
              onClick={onGoToAdmin}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-800 whitespace-nowrap shrink-0"
            >
              Mở Host Google Drive
            </button>
          )}
        </div>
      )}

      {/* Upload Settings */}
      <div className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-5 md:grid-cols-2">
        <div>
          <label htmlFor="bucket-select" className="text-xs font-medium text-zinc-700">
            Thư mục lưu trữ trên Cloud
          </label>
          <select
            id="bucket-select"
            value={selectedBucket}
            onChange={(e) => setSelectedBucket(e.target.value)}
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-600 focus:outline-none"
          >
            <option value="AUTO">Tự động phân loại (Images / Videos)</option>
            {availableBuckets.map((bucket) => (
              <option key={bucket.id} value={bucket.name}>
                {bucket.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="text-xs font-medium text-zinc-700">Tài khoản đăng tải</div>
          <div className="mt-2 flex min-h-[38px] items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800">
            <UserCheck className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="truncate font-medium">
              {currentUserName || currentUserEmail || 'Tài khoản đã xác thực'}
            </span>
            {currentUserEmail && currentUserName && currentUserName !== currentUserEmail && (
              <span className="hidden truncate text-xs text-zinc-500 sm:inline">
                ({currentUserEmail})
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Drag & Drop Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (canUpload) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
          !canUpload
            ? 'border-zinc-200 bg-zinc-50 opacity-75'
            : isDragging
            ? 'border-blue-600 bg-blue-50/50'
            : 'border-zinc-300 bg-white hover:border-zinc-400'
        }`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700">
          <UploadCloud className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-zinc-900">
          Kéo thả hình ảnh hoặc video vào đây để tải lên
        </h3>
        <p className="mt-1.5 text-sm text-zinc-500">
          Hỗ trợ PNG, JPG, WebP, GIF, SVG, MP4, WebM, MOV. Tải trực tiếp không giới hạn 5MB.
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          disabled={!canUpload}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
          className="hidden"
        />

        <button
          type="button"
          disabled={!canUpload}
          onClick={() => inputRef.current?.click()}
          className="mt-5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          Chọn tệp từ thiết bị
        </button>
      </div>

      {/* Upload Queue */}
      {tasks.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 px-5 py-3.5">
            <h3 className="text-sm font-semibold text-zinc-900">Tiến trình tải lên</h3>
          </div>
          <div className="divide-y divide-zinc-100">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-zinc-900">{task.fileName}</span>
                    <span className="text-xs text-zinc-500 tabular-nums">
                      · {formatBytes(task.fileSize)} · {task.bucket}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className={`h-full transition-all duration-150 ${
                          task.status === 'error'
                            ? 'bg-red-600'
                            : task.status === 'completed'
                            ? 'bg-emerald-600'
                            : 'bg-blue-600'
                        }`}
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                    <span className="w-32 text-right font-mono text-xs text-zinc-600 tabular-nums">
                      {task.status === 'uploading' &&
                        `${task.progress}%${task.speedBps > 0 ? ` · ${formatBytes(task.speedBps)}/s` : ''}`}
                      {task.status === 'publishing' && 'Đang lưu Drive...'}
                      {task.status === 'completed' && 'Hoàn tất'}
                      {task.status === 'error' && 'Lỗi'}
                      {task.status === 'queued' && 'Đang chờ...'}
                    </span>
                  </div>

                  {task.error && <p className="mt-1.5 text-xs text-red-600">{task.error}</p>}
                </div>

                {task.asset && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopyUrl(task.asset!)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 whitespace-nowrap"
                    >
                      {copiedId === task.asset.fileId ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                          Đã chép link
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Chép link
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onInspectAsset(task.asset!)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 whitespace-nowrap"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Xem ngay
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
