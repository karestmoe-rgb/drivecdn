import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Film,
  Globe,
  Image as ImageIcon,
  Lock,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import type { CdnAsset } from '../types/cdn';
import { buildCdnUrls, formatBytes, formatDateVi, formatDuration } from '../lib/format';
import { ConfirmModal } from './ConfirmModal';

interface AssetInspectorModalProps {
  asset: CdnAsset | null;
  canManage: boolean;
  onClose: () => void;
  onTogglePublic: (asset: CdnAsset, nextPublic: boolean) => Promise<void>;
  onRename: (asset: CdnAsset, newName: string) => Promise<void>;
  onDelete: (asset: CdnAsset) => Promise<void>;
}

export function AssetInspectorModal({
  asset,
  canManage,
  onClose,
  onTogglePublic,
  onRename,
  onDelete,
}: AssetInspectorModalProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [imgStage, setImgStage] = useState<'google' | 'proxy' | 'error'>('google');
  const [videoMode, setVideoMode] = useState<'html5' | 'drive'>('html5');
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | 'delete' | 'private' | 'rename'>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setImgStage('google');
    setVideoMode('html5');
    setIsRenaming(false);
    setActionError(null);
  }, [asset?.fileId]);

  if (!asset) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const urls = buildCdnUrls(asset, origin);

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const executeConfirmedAction = async () => {
    setBusy(true);
    setActionError(null);
    try {
      if (confirmAction === 'delete') {
        await onDelete(asset);
        setConfirmAction(null);
        onClose();
      } else if (confirmAction === 'private') {
        await onTogglePublic(asset, false);
        setConfirmAction(null);
      } else if (confirmAction === 'rename' && renameValue.trim()) {
        await onRename(asset, renameValue.trim());
        setConfirmAction(null);
        setIsRenaming(false);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Thao tác thất bại.');
    } finally {
      setBusy(false);
    }
  };

  const handleMakePublic = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await onTogglePublic(asset, true);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể bật công khai.');
    } finally {
      setBusy(false);
    }
  };

  const snippetRows = [
    ...(asset.kind === 'image'
      ? [
          { key: 'lh3', label: 'Google Direct CDN URL (Nhanh, miễn phí băng thông)', value: urls.googleImageUrl },
          { key: 'proxy', label: 'Proxy CDN URL', value: urls.proxyUrl },
        ]
      : [
          { key: 'drivePreview', label: 'Google Drive Stream Embed (Video lớn)', value: urls.googlePreviewUrl },
          { key: 'proxy', label: 'Proxy Stream URL', value: urls.proxyUrl },
        ]),
    { key: 'html', label: 'HTML Embed Tag', value: urls.htmlTag },
    { key: 'md', label: 'Markdown', value: urls.markdown },
  ];

  const activeImageSrc =
    imgStage === 'google' ? urls.googleImageUrl : urls.proxyUrl;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-zinc-950/60 sm:items-center sm:p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Chi tiết tệp ${asset.name}`}
    >
      <div className="flex h-[100dvh] w-full max-w-5xl flex-col overflow-y-auto bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-xl sm:border sm:border-zinc-200 lg:flex-row lg:overflow-hidden">
        {/* Mobile Sticky Close Bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 lg:hidden">
          <span className="truncate text-sm font-semibold text-zinc-900">{asset.name}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Media Viewport */}
        <div className="relative flex min-h-[240px] flex-col items-center justify-center bg-zinc-950 p-4 sm:p-6 lg:min-h-[540px] lg:flex-1">
          {asset.kind === 'video' ? (
            <div className="flex w-full flex-col items-center gap-3">
              {videoMode === 'html5' ? (
                <video
                  key={asset.fileId}
                  src={urls.proxyUrl}
                  controls
                  playsInline
                  preload="metadata"
                  onError={() => setVideoMode('drive')}
                  className="max-h-[42dvh] w-full rounded-lg bg-black object-contain lg:max-h-[70vh]"
                />
              ) : (
                <iframe
                  title={asset.name}
                  src={urls.googlePreviewUrl}
                  allow="autoplay; fullscreen"
                  allowFullScreen
                  className="aspect-video w-full max-h-[45dvh] rounded-lg border-0 bg-black lg:max-h-[70vh]"
                />
              )}

              <div className="flex items-center gap-1 rounded-lg bg-zinc-900 p-1">
                <button
                  type="button"
                  onClick={() => setVideoMode('html5')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    videoMode === 'html5' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Trình phát trực tiếp
                </button>
                <button
                  type="button"
                  onClick={() => setVideoMode('drive')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    videoMode === 'drive' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Drive Stream (Video lớn)
                </button>
              </div>
            </div>
          ) : imgStage !== 'error' ? (
            <img
              src={activeImageSrc}
              alt={asset.name}
              referrerPolicy="no-referrer"
              onError={() => {
                if (imgStage === 'google') setImgStage('proxy');
                else setImgStage('error');
              }}
              className="max-h-[44dvh] max-w-full rounded-lg object-contain lg:max-h-[76vh]"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 text-zinc-400">
              <ImageIcon className="h-10 w-10" />
              <p className="text-center text-sm">
                Không thể tải bản xem trước trực tiếp (kiểm tra quyền công khai).
              </p>
            </div>
          )}
        </div>

        {/* Inspector Sidebar */}
        <div className="flex w-full flex-col border-t border-zinc-200 bg-white lg:w-[400px] lg:border-t-0 lg:border-l">
          <div className="hidden items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 lg:flex">
            <div className="min-w-0 flex-1">
              {isRenaming ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-900 focus:border-blue-600 focus:outline-none"
                    placeholder="Tên tệp mới..."
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (renameValue.trim() && renameValue.trim() !== asset.name) {
                        setConfirmAction('rename');
                      } else {
                        setIsRenaming(false);
                      }
                    }}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
                  >
                    Lưu
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsRenaming(false)}
                    className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 whitespace-nowrap shrink-0"
                  >
                    Hủy
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-semibold text-zinc-900" title={asset.name}>
                    {asset.name}
                  </h2>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => {
                        setRenameValue(asset.name);
                        setIsRenaming(true);
                      }}
                      title="Đổi tên tệp"
                      className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 tabular-nums">
                <span className="inline-flex items-center gap-1">
                  {asset.kind === 'video' ? <Film className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {asset.mimeType}
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatBytes(asset.size)}</span>
                {asset.width && asset.height && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {asset.width}×{asset.height}
                    </span>
                  </>
                )}
                {asset.durationMillis && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{formatDuration(asset.durationMillis)}</span>
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng cửa sổ"
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-5 p-4 sm:p-5 lg:overflow-y-auto">
            {actionError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                {actionError}
              </div>
            )}

            {/* Status & Metadata */}
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3.5 text-xs">
              <div>
                <div className="text-zinc-500">Trạng thái</div>
                <div className="mt-1 flex items-center gap-1.5 font-medium text-zinc-900">
                  {asset.isPublic ? (
                    <>
                      <Globe className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Công khai (Public)</span>
                    </>
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5 text-amber-600" />
                      <span className="text-amber-700">Riêng tư (Private)</span>
                    </>
                  )}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Thư mục / Dung lượng</div>
                <div className="mt-1 font-medium text-zinc-900 tabular-nums">
                  {asset.bucket} · {formatBytes(asset.size)}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Drive File ID</div>
                <div className="mt-1 truncate font-mono text-zinc-700" title={asset.fileId}>
                  {asset.fileId}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Ngày tạo</div>
                <div className="mt-1 font-medium text-zinc-900 tabular-nums">
                  {formatDateVi(asset.createdTime)}
                </div>
              </div>
            </div>

            {/* CDN Links & Snippets */}
            <div className="space-y-3">
              <div className="text-xs font-semibold text-zinc-900">Liên kết &amp; Mã nhúng CDN</div>
              {!asset.isPublic && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  Tệp đang ở chế độ riêng tư. Bật chia sẻ công khai để đường dẫn hoạt động với mọi người dùng.
                </div>
              )}
              {snippetRows.map((row) => (
                <div key={row.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>{row.label}</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(row.key, row.value)}
                      className="inline-flex min-h-[32px] items-center gap-1 font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
                    >
                      {copiedKey === row.key ? (
                        <>
                          <Check className="h-3 w-3" />
                          Đã chép
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Sao chép
                        </>
                      )}
                    </button>
                  </div>
                  <div className="truncate rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 font-mono text-[11px] text-zinc-700 select-all">
                    {row.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-4 py-3.5 sm:px-5">
            <div className="flex items-center gap-2">
              <a
                href={urls.googleDirectDownload}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Tải về
              </a>
              {asset.webViewLink && (
                <a
                  href={asset.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 whitespace-nowrap shrink-0"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Mở Drive
                </a>
              )}
            </div>

            {canManage && (
              <div className="flex items-center gap-2">
                {asset.isPublic ? (
                  <button
                    type="button"
                    onClick={() => setConfirmAction('private')}
                    disabled={busy}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 whitespace-nowrap shrink-0"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    Tắt công khai
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleMakePublic}
                    disabled={busy}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    Bật công khai
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmAction('delete')}
                  disabled={busy}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 whitespace-nowrap shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Xóa
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmAction === 'delete'}
        title="Xóa tệp khỏi Google Drive?"
        description="Tệp sẽ bị xóa vĩnh viễn khỏi Google Drive và gỡ khỏi danh mục công khai."
        items={[`${asset.name} (${formatBytes(asset.size)})`]}
        confirmLabel="Xác nhận xóa"
        variant="danger"
        busy={busy}
        onConfirm={executeConfirmedAction}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmModal
        open={confirmAction === 'private'}
        title="Chuyển tệp sang chế độ riêng tư?"
        description="Thao tác này sẽ thu hồi quyền truy cập công khai trên Google Drive và gỡ tệp khỏi thư viện công khai."
        items={[asset.name]}
        confirmLabel="Chuyển riêng tư"
        variant="primary"
        busy={busy}
        onConfirm={executeConfirmedAction}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmModal
        open={confirmAction === 'rename'}
        title="Đổi tên tệp trên Google Drive?"
        description={`Xác nhận đổi tên tệp thành "${renameValue.trim()}".`}
        items={[`Cũ: ${asset.name}`, `Mới: ${renameValue.trim()}`]}
        confirmLabel="Xác nhận đổi tên"
        variant="primary"
        busy={busy}
        onConfirm={executeConfirmedAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
