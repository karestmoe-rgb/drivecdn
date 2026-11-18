import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { CdnAsset } from '../types/cdn';

interface ApiDocsViewProps {
  sampleAsset?: CdnAsset;
}

export function ApiDocsView({ sampleAsset }: ApiDocsViewProps) {
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-app.vercel.app';
  const fileId = sampleAsset?.fileId || '1A2B3C4D5E6F7G8H9I0J';

  const copyCode = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedBlock(key);
    setTimeout(() => setCopiedBlock(null), 1800);
  };

  const blocks = [
    {
      key: 'img',
      title: '01. Nhúng ảnh trực tiếp từ Google CDN',
      description: 'Tải trực tiếp từ máy chủ Google (lh3.googleusercontent.com), không tốn băng thông Vercel.',
      code: `<img\n  src="https://lh3.googleusercontent.com/d/${fileId}=w1600"\n  alt="DriveCDN Asset"\n  referrerPolicy="no-referrer"\n  loading="lazy"\n/>`,
    },
    {
      key: 'video',
      title: '02. Nhúng Video không giới hạn dung lượng',
      description: 'Dùng trình phát Drive Stream hoặc Proxy Range để phát mượt video HD trên mọi thiết bị.',
      code: `<iframe\n  src="https://drive.google.com/file/d/${fileId}/preview"\n  allow="autoplay; fullscreen"\n  allowFullScreen\n  style="width:100%;aspect-ratio:16/9;border:0;"\n></iframe>`,
    },
    {
      key: 'catalog',
      title: '03. API lấy danh sách media (Đã bảo vệ RBAC)',
      description: 'Yêu cầu X-Firebase-Id-Token của tài khoản Google đã được Admin cấp quyền Xem file.',
      code: `const res = await fetch('${origin}/api/cdn/catalog', {\n  headers: { 'X-Firebase-Id-Token': firebaseIdToken },\n});\nconst { items, stats } = await res.json();\nconsole.log('Tổng số tệp:', stats.totalFiles);`,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid items-stretch gap-6 rounded-xl border border-zinc-200 bg-white p-5 sm:p-6 lg:grid-cols-12">
        <div className="flex flex-col justify-center lg:col-span-7">
          <div className="text-xs font-medium text-blue-600">Kiến trúc tối ưu cho Vercel Free</div>
          <h1 className="mt-2 text-xl sm:text-2xl font-semibold tracking-tight text-zinc-900">
            Upload trực tiếp lên Google Drive &amp; Phân phối không tốn băng thông server
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600">
            Khi người dùng tải video dung lượng lớn (50MB – vài GB), trình duyệt sẽ nhận phiên tải lên bảo mật từ API và đẩy dữ liệu trực tiếp lên Google Drive, hoàn toàn vượt qua giới hạn 4.5MB của Vercel Hobby miễn phí.
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 lg:col-span-5">
          <img
            src="/src/assets/images/cdn_media_showcase_1795009316196.jpg"
            alt="Kiến trúc hạ tầng lưu trữ media DriveCDN"
            referrerPolicy="no-referrer"
            className="h-44 w-full object-cover sm:h-52 lg:h-full"
          />
        </div>
      </div>

      {/* Vercel Free Hosting Checklist */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 sm:p-6">
        <h2 className="text-base font-semibold text-zinc-900">
          Hướng dẫn deploy miễn phí lên Vercel (Hobby Plan)
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <div className="font-mono text-xs font-semibold text-blue-600">Bước 1 · Build &amp; Routes</div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">
              File <code className="rounded bg-white px-1 py-0.5 font-mono text-zinc-800">vercel.json</code> và <code className="rounded bg-white px-1 py-0.5 font-mono text-zinc-800">/api/index.ts</code> đã được cấu hình sẵn. Chỉ cần đẩy code lên GitHub và bấm Import vào Vercel.
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <div className="font-mono text-xs font-semibold text-blue-600">Bước 2 · Lưu trữ danh mục bền vững</div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">
              Trên Vercel, hãy gắn miễn phí 1 database <strong>Upstash Redis</strong> (từ Vercel Marketplace) để biến môi trường <code className="rounded bg-white px-1 py-0.5 font-mono text-zinc-800">KV_REST_API_URL</code> và <code className="rounded bg-white px-1 py-0.5 font-mono text-zinc-800">KV_REST_API_TOKEN</code> tự động lưu danh sách file &amp; phiên Cloud vĩnh viễn.
            </p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <div className="font-mono text-xs font-semibold text-blue-600">Bước 3 · Tên miền Firebase Auth</div>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">
              Sau khi có tên miền <code className="rounded bg-white px-1 py-0.5 font-mono text-zinc-800">*.vercel.app</code>, hãy thêm domain đó vào mục <strong>Authorized domains</strong> trong Firebase Authentication để nút Sign in with Google hoạt động trên Vercel.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {blocks.map((block) => (
          <div key={block.key} className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-5">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">{block.title}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">{block.description}</p>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-zinc-200 bg-zinc-50 px-3 py-2">
                <span className="font-mono text-[11px] text-zinc-500">Snippet</span>
                <button
                  type="button"
                  onClick={() => copyCode(block.key, block.code)}
                  className="inline-flex min-h-[32px] items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
                >
                  {copiedBlock === block.key ? (
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
              <pre className="overflow-x-auto rounded-b-lg border border-zinc-200 bg-zinc-950 p-3.5 font-mono text-[11px] leading-relaxed text-zinc-100">
                <code>{block.code}</code>
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
