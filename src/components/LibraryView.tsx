import { useState } from 'react';
import {
  Check,
  Copy,
  Film,
  Globe,
  Grid,
  Image as ImageIcon,
  List,
  Lock,
  Play,
  RefreshCw,
  Search,
  UploadCloud,
} from 'lucide-react';
import type { CdnAsset, MediaKind } from '../types/cdn';
import { buildCdnUrls, formatBytes, formatDateVi, formatDuration } from '../lib/format';

interface LibraryViewProps {
  assets: CdnAsset[];
  loading: boolean;
  isOwnerSignedIn: boolean;
  activeBucket: string;
  onRefresh: () => void;
  onInspect: (asset: CdnAsset) => void;
  onGoToUpload: () => void;
  onGoToDocs: () => void;
}

export function LibraryView({
  assets,
  loading,
  isOwnerSignedIn,
  activeBucket,
  onRefresh,
  onInspect,
  onGoToUpload,
  onGoToDocs,
}: LibraryViewProps) {
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | MediaKind>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'private'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [imgFallbackStage, setImgFallbackStage] = useState<Record<string, 'proxy' | 'error'>>({});

  const filtered = assets.filter((item) => {
    if (activeBucket !== 'ALL' && item.bucket !== activeBucket) return false;
    if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
    if (visibilityFilter === 'public' && !item.isPublic) return false;
    if (visibilityFilter === 'private' && item.isPublic) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.bucket.toLowerCase().includes(q) ||
        (item.uploadedBy || '').toLowerCase().includes(q) ||
        item.fileId.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleCopy = async (e: React.MouseEvent, asset: CdnAsset) => {
    e.stopPropagation();
    const urls = buildCdnUrls(asset, window.location.origin);
    const link = asset.kind === 'image' ? urls.googleImageUrl : urls.proxyUrl;
    await navigator.clipboard.writeText(link);
    setCopiedId(asset.fileId);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleImgError = (fileId: string) => {
    setImgFallbackStage((prev) => {
      if (!prev[fileId]) return { ...prev, [fileId]: 'proxy' };
      return { ...prev, [fileId]: 'error' };
    });
  };

  return (
    <div className="space-y-5">
      {/* Header & Toolbar */}
      <div className="flex flex-col justify-between gap-4 border-b border-zinc-200 pb-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">
            {activeBucket === 'ALL' ? 'Thư viện Media Cloud' : `Thư mục: ${activeBucket}`}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 tabular-nums">
            Xem trực tiếp video và hình ảnh được lưu trữ trên Google Drive · Không cần đăng nhập ({filtered.length} tệp).
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex min-h-[44px] sm:min-h-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
          <button
            type="button"
            onClick={onGoToUpload}
            className="inline-flex min-h-[44px] sm:min-h-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            <UploadCloud className="h-3.5 w-3.5" />
            Tải lên media
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 lg:max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên tệp, thư mục hoặc người gửi..."
            className="min-h-[44px] sm:min-h-0 w-full rounded-lg border border-zinc-200 bg-white py-2 pr-3 pl-9 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
            {(
              [
                { id: 'all', label: 'Tất cả' },
                { id: 'image', label: 'Hình ảnh' },
                { id: 'video', label: 'Video' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setKindFilter(tab.id)}
                className={`min-h-[36px] sm:min-h-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  kindFilter === tab.id
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {isOwnerSignedIn && (
            <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
              {(
                [
                  { id: 'all', label: 'Mọi quyền' },
                  { id: 'public', label: 'Công khai' },
                  { id: 'private', label: 'Riêng tư' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setVisibilityFilter(tab.id)}
                  className={`min-h-[36px] sm:min-h-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    visibilityFilter === tab.id
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Chế độ lưới"
              className={`min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 flex items-center justify-center rounded-md p-1.5 transition-colors ${
                viewMode === 'grid' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              <Grid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-label="Chế độ bảng"
              className={`min-h-[36px] min-w-[36px] sm:min-h-0 sm:min-w-0 flex items-center justify-center rounded-md p-1.5 transition-colors ${
                viewMode === 'table' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && assets.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="aspect-[16/10] animate-pulse bg-zinc-100" />
              <div className="space-y-2 p-4">
                <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-100" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-100" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        /* Empty State */
        <div className="grid items-stretch gap-6 overflow-hidden rounded-xl border border-zinc-200 bg-white lg:grid-cols-12">
          <div className="flex flex-col justify-center p-6 sm:p-8 lg:col-span-7">
            <h2 className="text-lg font-semibold text-zinc-900">
              {search || kindFilter !== 'all'
                ? 'Không tìm thấy tệp phù hợp'
                : 'Cloud hiện chưa có video hoặc hình ảnh nào'}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-zinc-600">
              {search || kindFilter !== 'all'
                ? 'Thử xóa từ khóa tìm kiếm hoặc chuyển bộ lọc sang Tất cả.'
                : 'Tải lên video hoặc hình ảnh đầu tiên để lưu trữ trực tiếp trên dung lượng Google Drive và xem ngay trên ứng dụng web này.'}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onGoToUpload}
                className="min-h-[44px] sm:min-h-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                Tải lên tệp đầu tiên
              </button>
              <button
                type="button"
                onClick={onGoToDocs}
                className="min-h-[44px] sm:min-h-0 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 whitespace-nowrap shrink-0"
              >
                Hướng dẫn &amp; Deploy Vercel
              </button>
            </div>
          </div>
          <div className="hidden bg-zinc-100 lg:col-span-5 lg:block">
            <img
              src="/src/assets/images/cdn_video_studio_1795009316556.jpg"
              alt="Lưu trữ hình ảnh và video trên DriveCDN"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        /* Grid View */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((asset) => {
            const urls = buildCdnUrls(asset, window.location.origin);
            const stage = imgFallbackStage[asset.fileId];
            const imgSrc =
              stage === 'proxy'
                ? urls.proxyUrl
                : asset.isPublic
                ? `https://lh3.googleusercontent.com/d/${asset.fileId}=w800`
                : asset.thumbnailLink || urls.proxyUrl;

            return (
              <div
                key={asset.fileId}
                onClick={() => onInspect(asset)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onInspect(asset);
                  }
                }}
                role="button"
                tabIndex={0}
                className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-left transition-colors hover:border-zinc-300 focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                {/* Media Preview */}
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-100">
                  {asset.kind === 'image' && stage !== 'error' ? (
                    <img
                      src={imgSrc}
                      alt={asset.name}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      onError={() => handleImgError(asset.fileId)}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                    />
                  ) : asset.kind === 'video' ? (
                    <div className="relative flex h-full w-full items-center justify-center bg-zinc-900">
                      {asset.thumbnailLink && stage !== 'error' ? (
                        <img
                          src={asset.thumbnailLink}
                          alt={asset.name}
                          referrerPolicy="no-referrer"
                          onError={() => setImgFallbackStage((prev) => ({ ...prev, [asset.fileId]: 'error' }))}
                          className="h-full w-full object-cover opacity-85"
                        />
                      ) : (
                        <Film className="h-8 w-8 text-zinc-500" />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/70 via-black/20 to-transparent">
                        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-zinc-900 shadow-sm">
                          <Play className="ml-0.5 h-4 w-4 fill-current" />
                        </div>
                      </div>
                      {asset.durationMillis && (
                        <span className="absolute right-2.5 bottom-2 font-mono text-[11px] font-medium text-white tabular-nums">
                          {formatDuration(asset.durationMillis)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-zinc-400">
                      <ImageIcon className="h-7 w-7" />
                      <span className="text-[11px]">{asset.mimeType}</span>
                    </div>
                  )}
                </div>

                {/* Card Body */}
                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <h3 className="truncate text-sm font-medium text-zinc-900" title={asset.name}>
                      {asset.name}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-500 tabular-nums">
                      <span className={asset.isPublic ? 'font-medium text-emerald-700' : 'font-medium text-amber-700'}>
                        {asset.isPublic ? 'Công khai' : 'Riêng tư'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{formatBytes(asset.size)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{asset.bucket}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2.5">
                    <span className="max-w-[140px] truncate text-[11px] text-zinc-500">
                      {asset.uploadedBy || formatDateVi(asset.createdTime)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => handleCopy(e, asset)}
                      className="inline-flex min-h-[32px] items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
                    >
                      {copiedId === asset.fileId ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Đã chép
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Chép link
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                <th className="px-4 py-3">Tên tệp</th>
                <th className="px-4 py-3">Loại</th>
                <th className="px-4 py-3">Thư mục</th>
                <th className="px-4 py-3">Người gửi</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3 text-right">Dung lượng</th>
                <th className="px-4 py-3 text-right">Ngày tạo</th>
                <th className="px-4 py-3 text-right">Liên kết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.map((asset) => (
                <tr
                  key={asset.fileId}
                  onClick={() => onInspect(asset)}
                  className="cursor-pointer transition-colors hover:bg-zinc-50"
                >
                  <td className="max-w-[220px] truncate px-4 py-3 font-medium text-zinc-900">
                    {asset.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                    {asset.kind === 'video' ? 'Video' : 'Hình ảnh'}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600">{asset.bucket}</td>
                  <td className="px-4 py-3 text-xs text-zinc-600">
                    {asset.uploadedBy || 'Chủ sở hữu'}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {asset.isPublic ? (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <Globe className="h-3.5 w-3.5" />
                        Công khai
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                        <Lock className="h-3.5 w-3.5" />
                        Riêng tư
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-zinc-700 tabular-nums">
                    {formatBytes(asset.size)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500 tabular-nums">
                    {formatDateVi(asset.createdTime)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={(e) => handleCopy(e, asset)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
                    >
                      {copiedId === asset.fileId ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Đã chép
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Chép URL
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
