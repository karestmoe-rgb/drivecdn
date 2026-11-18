import type { CdnAsset } from '../types/cdn';

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : dm)} ${sizes[i]}`;
}

export function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatDateVi(isoString?: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function buildCdnUrls(asset: CdnAsset, origin: string) {
  const cleanOrigin = origin.replace(/\/$/, '');
  const proxyUrl = `${cleanOrigin}/api/cdn/raw/${asset.fileId}`;
  const googleImageUrl = `https://lh3.googleusercontent.com/d/${asset.fileId}`;
  const googleDirectDownload = `https://drive.google.com/uc?export=download&id=${asset.fileId}`;
  const googlePreviewUrl = `https://drive.google.com/file/d/${asset.fileId}/preview`;

  const primaryUrl = proxyUrl;
  const htmlTag =
    asset.kind === 'video'
      ? `<video src="${proxyUrl}" controls playsinline preload="metadata" style="max-width:100%;border-radius:8px;"></video>`
      : `<img src="${proxyUrl}" alt="${escapeHtmlAttr(asset.name)}" loading="lazy" />`;

  const markdown =
    asset.kind === 'video'
      ? `[${asset.name}](${proxyUrl})`
      : `![${asset.name}](${proxyUrl})`;

  return {
    proxyUrl,
    googleImageUrl,
    googleDirectDownload,
    googlePreviewUrl,
    primaryUrl,
    htmlTag,
    markdown,
  };
}

export function buildAuthedProxyUrl(proxyUrl: string, authToken?: string | null): string {
  if (!authToken) return proxyUrl;
  const separator = proxyUrl.includes('?') ? '&' : '?';
  return `${proxyUrl}${separator}token=${encodeURIComponent(authToken)}`;
}

function escapeHtmlAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
