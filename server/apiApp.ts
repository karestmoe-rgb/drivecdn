import express from 'express';
import type { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';

export interface CatalogEntry {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'video';
  bucket: string;
  folderId?: string;
  width?: number;
  height?: number;
  durationMillis?: number;
  thumbnailLink?: string;
  webViewLink?: string;
  isPublic: boolean;
  createdTime: string;
  publishedAt: string;
  uploadedBy?: string;
  ownerName?: string;
  ownerEmail?: string;
}

export interface DriveFolderRef {
  id: string;
  name: string;
  createdTime?: string;
}

export interface StorageQuotaRef {
  limit: number;
  usage: number;
  usageInDrive: number;
  usageInDriveTrash: number;
}

interface OwnerCloudRelay {
  enabled: boolean;
  accessToken: string;
  expiresAt: number;
  ownerName: string;
  ownerEmail: string;
  rootFolderId: string;
  buckets: DriveFolderRef[];
  storageQuota: StorageQuotaRef | null;
}

const IS_VERCEL = Boolean(process.env.VERCEL);
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const HAS_KV = Boolean(KV_URL && KV_TOKEN);

const DATA_DIR = IS_VERCEL ? '/tmp/drivecdn-data' : path.resolve(process.cwd(), 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'cdn-catalog.json');

// In-memory fallback relay session
let memoryRelay: OwnerCloudRelay | null = null;

async function kvGet<T>(key: string): Promise<T | null> {
  if (!HAS_KV) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: string | null };
    if (!data.result) return null;
    return JSON.parse(data.result) as T;
  } catch {
    return null;
  }
}

async function kvSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  if (!HAS_KV) return;
  try {
    const payload = JSON.stringify(value);
    const endpoint = ttlSeconds
      ? `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}/EX/${ttlSeconds}`
      : `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`;
    await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
  } catch {
    // Ignore KV transient error
  }
}

async function kvDel(key: string): Promise<void> {
  if (!HAS_KV) return;
  try {
    await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
  } catch {
    // Ignore
  }
}

function ensureCatalogFile(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(CATALOG_PATH)) {
      fs.writeFileSync(CATALOG_PATH, JSON.stringify([], null, 2), 'utf-8');
    }
  } catch {
    // Fallback gracefully if directory cannot be created
  }
}

async function readCatalog(): Promise<CatalogEntry[]> {
  if (HAS_KV) {
    const fromKv = await kvGet<CatalogEntry[]>('drivecdn:catalog');
    if (Array.isArray(fromKv)) return fromKv;
  }
  ensureCatalogFile();
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeCatalog(entries: CatalogEntry[]): Promise<void> {
  if (HAS_KV) {
    await kvSet('drivecdn:catalog', entries);
  }
  ensureCatalogFile();
  try {
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(entries, null, 2), 'utf-8');
  } catch {
    // Ignore read-only FS error when KV is active
  }
}

async function getActiveRelay(): Promise<OwnerCloudRelay | null> {
  let relay = memoryRelay;
  if (HAS_KV) {
    const fromKv = await kvGet<OwnerCloudRelay>('drivecdn:relay');
    if (fromKv) relay = fromKv;
  }
  if (!relay || !relay.enabled || !relay.accessToken || Date.now() >= relay.expiresAt) {
    return null;
  }
  return relay;
}

async function setActiveRelay(relay: OwnerCloudRelay | null): Promise<void> {
  memoryRelay = relay;
  if (HAS_KV) {
    if (relay) {
      await kvSet('drivecdn:relay', relay, 3600);
    } else {
      await kvDel('drivecdn:relay');
    }
  }
}

async function verifyDriveToken(
  authHeader: string | undefined
): Promise<{
  emailAddress?: string;
  displayName?: string;
  storageQuota?: StorageQuotaRef;
} | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const rawToken = authHeader.slice('Bearer '.length).trim();
  if (!rawToken) return null;

  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)',
      { headers: { Authorization: authHeader } }
    );
    if (res.ok) {
      const data = (await res.json()) as {
        user?: { displayName?: string; emailAddress?: string };
        storageQuota?: {
          limit?: string;
          usage?: string;
          usageInDrive?: string;
          usageInDriveTrash?: string;
        };
      };
      return {
        displayName: data.user?.displayName,
        emailAddress: data.user?.emailAddress,
        storageQuota: data.storageQuota
          ? {
              limit: Number(data.storageQuota.limit || 0),
              usage: Number(data.storageQuota.usage || 0),
              usageInDrive: Number(data.storageQuota.usageInDrive || 0),
              usageInDriveTrash: Number(data.storageQuota.usageInDriveTrash || 0),
            }
          : undefined,
      };
    }

    const infoRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(rawToken)}`
    );
    if (!infoRes.ok) return null;
    const info = (await infoRes.json()) as { email?: string; scope?: string };
    const scopes = (info.scope || '').split(/\s+/);
    const hasDrive = scopes.some(
      (s) =>
        s === 'https://www.googleapis.com/auth/drive.file' ||
        s === 'https://www.googleapis.com/auth/drive'
    );
    if (!hasDrive) return null;

    return {
      emailAddress: info.email,
      displayName: info.email ? info.email.split('@')[0] : 'Google Drive Owner',
    };
  } catch {
    return null;
  }
}

async function fetchDriveDownloadResponse(
  fileId: string,
  rangeHeader?: string
): Promise<globalThis.Response> {
  const baseHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; DriveCDN/1.0)',
  };
  if (rangeHeader) {
    baseHeaders['Range'] = rangeHeader;
  }

  const initialUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  const firstRes = await fetch(initialUrl, {
    headers: baseHeaders,
    redirect: 'follow',
  });

  const contentType = firstRes.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return firstRes;
  }

  const html = await firstRes.text();
  const confirmMatch =
    html.match(/name="confirm"\s+value="([^"]+)"/) || html.match(/confirm=([0-9A-Za-z_-]+)/);
  const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);

  if (confirmMatch) {
    const confirmToken = confirmMatch[1];
    const uuidParam = uuidMatch ? `&uuid=${encodeURIComponent(uuidMatch[1])}` : '';
    const confirmedUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=${encodeURIComponent(confirmToken)}${uuidParam}`;

    const setCookie = firstRes.headers.get('set-cookie');
    const retryHeaders: Record<string, string> = { ...baseHeaders };
    if (setCookie) {
      retryHeaders['Cookie'] = setCookie.split(';')[0];
    }

    const confirmedRes = await fetch(confirmedUrl, {
      headers: retryHeaders,
      redirect: 'follow',
    });
    if (confirmedRes.ok || confirmedRes.status === 206) {
      return confirmedRes;
    }
  }

  const relay = await getActiveRelay();
  if (relay) {
    const apiHeaders: Record<string, string> = {
      Authorization: `Bearer ${relay.accessToken}`,
    };
    if (rangeHeader) apiHeaders['Range'] = rangeHeader;
    return fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: apiHeaders }
    );
  }

  throw new Error('Tệp không ở chế độ công khai hoặc không thể tải xuống từ Google Drive.');
}

async function publishAndIndexDriveFile(
  accessToken: string,
  fileId: string,
  bucketName: string,
  folderId: string,
  uploadedBy: string,
  ownerName: string,
  ownerEmail: string,
  fallbackName?: string,
  fallbackMime?: string,
  fallbackSize?: number
): Promise<CatalogEntry> {
  const permRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    }
  );

  if (!permRes.ok) {
    throw new Error('Đã lưu tệp nhưng không thể bật quyền xem công khai trên Google Drive.');
  }

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,thumbnailLink,webViewLink,createdTime,imageMediaMetadata,videoMediaMetadata`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const driveFile = metaRes.ok
    ? ((await metaRes.json()) as {
        id: string;
        name?: string;
        mimeType?: string;
        size?: string;
        thumbnailLink?: string;
        webViewLink?: string;
        createdTime?: string;
        imageMediaMetadata?: { width?: number; height?: number };
        videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
      })
    : { id: fileId };

  const mimeType = driveFile.mimeType || fallbackMime || 'application/octet-stream';
  const kind: 'image' | 'video' = mimeType.startsWith('video/') ? 'video' : 'image';
  const actualSize = Number(driveFile.size || fallbackSize || 0);

  const entry: CatalogEntry = {
    fileId: driveFile.id || fileId,
    name: driveFile.name || fallbackName || `media-${fileId.slice(0, 8)}`,
    mimeType,
    size: actualSize,
    kind,
    bucket: bucketName,
    folderId,
    width: driveFile.imageMediaMetadata?.width ?? driveFile.videoMediaMetadata?.width,
    height: driveFile.imageMediaMetadata?.height ?? driveFile.videoMediaMetadata?.height,
    durationMillis: driveFile.videoMediaMetadata?.durationMillis
      ? Number(driveFile.videoMediaMetadata.durationMillis)
      : undefined,
    thumbnailLink: driveFile.thumbnailLink,
    webViewLink: driveFile.webViewLink,
    isPublic: true,
    createdTime: driveFile.createdTime || new Date().toISOString(),
    publishedAt: new Date().toISOString(),
    uploadedBy,
    ownerName,
    ownerEmail,
  };

  const catalog = await readCatalog();
  const next = [entry, ...catalog.filter((item) => item.fileId !== entry.fileId)];
  await writeCatalog(next);

  return entry;
}

export function createApiApp(): Express {
  ensureCatalogFile();
  const app = express();

  // Fallback raw streaming upload (used on local/Cloud Run or small <= 4MB files)
  app.post('/api/public/upload', async (req: Request, res: Response) => {
    const relay = await getActiveRelay();
    if (!relay) {
      res.status(503).json({
        error:
          'Cổng nhận tải lên công khai hiện chưa được chủ sở hữu kích hoạt hoặc phiên kết nối Drive đã hết hạn.',
      });
      return;
    }

    const rawName = String(req.headers['x-file-name'] || '').trim();
    const fileName = rawName ? decodeURIComponent(rawName) : `media-${Date.now()}`;
    const mimeType = String(req.headers['x-file-type'] || req.headers['content-type'] || 'application/octet-stream');
    const fileSize = Number(req.headers['x-file-size'] || req.headers['content-length'] || 0);
    const requestedBucket = String(req.headers['x-bucket-name'] || '').trim();
    const rawUploader = String(req.headers['x-uploader-name'] || '').trim();
    const uploadedBy = rawUploader ? decodeURIComponent(rawUploader).slice(0, 60) : 'Khách công khai';

    if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
      res.status(400).json({ error: 'Chỉ hỗ trợ tải lên tệp hình ảnh hoặc video.' });
      return;
    }

    const kind: 'image' | 'video' = mimeType.startsWith('video/') ? 'video' : 'image';
    const targetBucket =
      relay.buckets.find((b) => b.name === requestedBucket) ||
      relay.buckets.find((b) => b.name === (kind === 'video' ? 'Videos' : 'Images')) ||
      relay.buckets[0];

    if (!targetBucket) {
      res.status(500).json({ error: 'Không tìm thấy thư mục lưu trữ trên Google Drive.' });
      return;
    }

    try {
      const initHeaders: Record<string, string> = {
        Authorization: `Bearer ${relay.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
      };
      if (fileSize > 0) {
        initHeaders['X-Upload-Content-Length'] = String(fileSize);
      }

      const initRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
        {
          method: 'POST',
          headers: initHeaders,
          body: JSON.stringify({
            name: fileName,
            parents: [targetBucket.id],
          }),
        }
      );

      if (initRes.status === 401) {
        await setActiveRelay(null);
        res.status(503).json({
          error: 'Phiên kết nối Google Drive của chủ sở hữu đã hết hạn. Vui lòng chờ chủ sở hữu kết nối lại.',
        });
        return;
      }

      if (!initRes.ok) {
        const msg = await initRes.text();
        res.status(502).json({ error: `Google Drive từ chối khởi tạo tải lên: ${msg || initRes.statusText}` });
        return;
      }

      const uploadUrl = initRes.headers.get('Location');
      if (!uploadUrl) {
        res.status(502).json({ error: 'Google Drive không trả về địa chỉ truyền tệp.' });
        return;
      }

      const putHeaders: Record<string, string> = { 'Content-Type': mimeType };
      if (fileSize > 0) putHeaders['Content-Length'] = String(fileSize);

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: putHeaders,
        body: Readable.toWeb(req) as unknown as BodyInit,
        // @ts-expect-error Node fetch streaming requires duplex: 'half'
        duplex: 'half',
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        res.status(502).json({ error: `Lỗi truyền tải lên Google Drive: ${errText || uploadRes.statusText}` });
        return;
      }

      const uploaded = (await uploadRes.json()) as { id: string };
      const entry = await publishAndIndexDriveFile(
        relay.accessToken,
        uploaded.id,
        targetBucket.name,
        targetBucket.id,
        uploadedBy,
        relay.ownerName,
        relay.ownerEmail,
        fileName,
        mimeType,
        fileSize
      );

      if (relay.storageQuota) {
        relay.storageQuota.usage += entry.size;
        await setActiveRelay(relay);
      }

      res.status(201).json({ item: entry });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi máy chủ khi tải lên Google Drive.';
      res.status(500).json({ error: message });
    }
  });

  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'DriveCDN',
      platform: IS_VERCEL ? 'vercel' : 'node',
      persistentStore: HAS_KV ? 'kv' : 'filesystem',
      timestamp: new Date().toISOString(),
    });
  });

  // Runtime Firebase public Web SDK configuration (avoids VITE_ build-time env var warnings on Vercel)
  app.get('/api/firebase-config', (_req: Request, res: Response) => {
    const apiKey = process.env.FIREBASE_API_KEY;
    const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const appId = process.env.FIREBASE_APP_ID;

    if (apiKey && authDomain && projectId && appId) {
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        apiKey,
        authDomain,
        projectId,
        appId,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      });
      return;
    }

    try {
      const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(cfgPath)) {
        const raw = fs.readFileSync(cfgPath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, string>;
        res.setHeader('Cache-Control', 'no-store');
        res.json({
          apiKey: parsed.apiKey || '',
          authDomain: parsed.authDomain || '',
          projectId: parsed.projectId || '',
          appId: parsed.appId || '',
          storageBucket: parsed.storageBucket || '',
          messagingSenderId: parsed.messagingSenderId || '',
        });
        return;
      }
    } catch {
      // Ignore fallback read failure
    }

    res.status(404).json({ error: 'Chưa cấu hình Firebase Auth.' });
  });

  // Vercel-friendly Direct-to-Drive Resumable Upload Session (bypasses 4.5MB serverless limit!)
  app.post('/api/public/upload-session', async (req: Request, res: Response) => {
    const relay = await getActiveRelay();
    if (!relay) {
      res.status(503).json({
        error:
          'Cổng nhận tải lên công khai hiện chưa được chủ sở hữu kích hoạt hoặc phiên kết nối Drive đã hết hạn.',
      });
      return;
    }

    const { fileName, mimeType, fileSize, bucketName } = req.body as {
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
      bucketName?: string;
    };

    if (!fileName || !mimeType) {
      res.status(400).json({ error: 'Thiếu tên tệp hoặc định dạng MIME.' });
      return;
    }
    if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
      res.status(400).json({ error: 'Chỉ hỗ trợ tải lên tệp hình ảnh hoặc video.' });
      return;
    }

    const kind: 'image' | 'video' = mimeType.startsWith('video/') ? 'video' : 'image';
    const targetBucket =
      relay.buckets.find((b) => b.name === bucketName) ||
      relay.buckets.find((b) => b.name === (kind === 'video' ? 'Videos' : 'Images')) ||
      relay.buckets[0];

    if (!targetBucket) {
      res.status(500).json({ error: 'Không tìm thấy thư mục lưu trữ trên Google Drive.' });
      return;
    }

    try {
      const initHeaders: Record<string, string> = {
        Authorization: `Bearer ${relay.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
      };
      if (fileSize && fileSize > 0) {
        initHeaders['X-Upload-Content-Length'] = String(fileSize);
      }
      const clientOrigin = req.headers.origin;
      if (clientOrigin) {
        initHeaders['Origin'] = clientOrigin;
      }

      const initRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size',
        {
          method: 'POST',
          headers: initHeaders,
          body: JSON.stringify({
            name: fileName,
            parents: [targetBucket.id],
          }),
        }
      );

      if (initRes.status === 401) {
        await setActiveRelay(null);
        res.status(503).json({
          error: 'Phiên kết nối Google Drive của chủ sở hữu đã hết hạn.',
        });
        return;
      }

      if (!initRes.ok) {
        const msg = await initRes.text();
        res.status(502).json({ error: `Không thể tạo phiên tải lên Google Drive: ${msg || initRes.statusText}` });
        return;
      }

      const uploadUrl = initRes.headers.get('Location');
      if (!uploadUrl) {
        res.status(502).json({ error: 'Google Drive không trả về URL tải lên trực tiếp.' });
        return;
      }

      res.json({
        uploadUrl,
        bucketName: targetBucket.name,
        folderId: targetBucket.id,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Lỗi khởi tạo phiên tải lên trực tiếp.',
      });
    }
  });

  app.post('/api/public/upload-complete', async (req: Request, res: Response) => {
    const relay = await getActiveRelay();
    if (!relay) {
      res.status(503).json({ error: 'Phiên kết nối Drive của chủ sở hữu không còn hoạt động.' });
      return;
    }

    const { fileId, bucketName, folderId, uploaderName, fileName, mimeType, fileSize } = req.body as {
      fileId?: string;
      bucketName?: string;
      folderId?: string;
      uploaderName?: string;
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
    };

    if (!fileId) {
      res.status(400).json({ error: 'Thiếu fileId vừa tải lên.' });
      return;
    }

    try {
      const entry = await publishAndIndexDriveFile(
        relay.accessToken,
        fileId,
        bucketName || 'Images',
        folderId || '',
        (uploaderName || '').trim().slice(0, 60) || 'Khách công khai',
        relay.ownerName,
        relay.ownerEmail,
        fileName,
        mimeType,
        fileSize
      );

      if (relay.storageQuota) {
        relay.storageQuota.usage += entry.size;
        await setActiveRelay(relay);
      }

      res.status(201).json({ item: entry });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Không thể hoàn tất xuất bản tệp công khai.',
      });
    }
  });

  app.get('/api/cloud/status', async (_req: Request, res: Response) => {
    const relay = await getActiveRelay();
    res.json({
      enabled: Boolean(relay?.enabled),
      active: Boolean(relay),
      ownerName: relay?.ownerName,
      ownerEmail: relay?.ownerEmail,
      expiresAt: relay?.expiresAt,
      buckets: relay?.buckets ?? [],
      storageQuota: relay?.storageQuota ?? null,
    });
  });

  app.post('/api/cloud/activate', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const driveUser = await verifyDriveToken(authHeader);
    if (!driveUser || !authHeader) {
      res.status(401).json({ error: 'Token Google Drive không hợp lệ.' });
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const { rootFolderId, buckets, enabled = true } = req.body as {
      rootFolderId?: string;
      buckets?: DriveFolderRef[];
      enabled?: boolean;
    };

    if (!rootFolderId || !Array.isArray(buckets) || buckets.length === 0) {
      res.status(400).json({ error: 'Thiếu thông tin thư mục lưu trữ DriveCDN.' });
      return;
    }

    const nextRelay: OwnerCloudRelay = {
      enabled: Boolean(enabled),
      accessToken: token,
      expiresAt: Date.now() + 55 * 60 * 1000,
      ownerName: driveUser.displayName || 'Chủ sở hữu Drive',
      ownerEmail: driveUser.emailAddress || '',
      rootFolderId,
      buckets,
      storageQuota: driveUser.storageQuota ?? null,
    };

    await setActiveRelay(nextRelay);

    res.json({
      enabled: nextRelay.enabled,
      active: true,
      ownerName: nextRelay.ownerName,
      ownerEmail: nextRelay.ownerEmail,
      expiresAt: nextRelay.expiresAt,
      buckets: nextRelay.buckets,
      storageQuota: nextRelay.storageQuota,
    });
  });

  app.post('/api/cloud/deactivate', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const driveUser = await verifyDriveToken(authHeader);
      if (!driveUser) {
        res.status(401).json({ error: 'Token không hợp lệ.' });
        return;
      }
    }
    await setActiveRelay(null);
    res.json({ enabled: false, active: false });
  });

  app.get('/api/cdn/catalog', async (_req: Request, res: Response) => {
    const entries = (await readCatalog()).filter((item) => item.isPublic);
    const totalBytes = entries.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    const imageCount = entries.filter((item) => item.kind === 'image').length;
    const videoCount = entries.filter((item) => item.kind === 'video').length;
    const buckets = Array.from(new Set(entries.map((item) => item.bucket))).sort();

    res.json({
      items: entries,
      stats: {
        totalFiles: entries.length,
        totalBytes,
        imageCount,
        videoCount,
        buckets,
      },
    });
  });

  app.post('/api/cdn/catalog', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const driveUser = await verifyDriveToken(authHeader);
    if (!driveUser) {
      res.status(401).json({ error: 'Cần xác thực Google Drive hợp lệ.' });
      return;
    }

    const body = req.body as Partial<CatalogEntry>;
    if (!body.fileId || !body.name || !body.mimeType) {
      res.status(400).json({ error: 'Thiếu thông tin tệp (fileId, name, mimeType).' });
      return;
    }

    try {
      const verifyRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(body.fileId)}?fields=id,name,mimeType,size,thumbnailLink,webViewLink,createdTime,imageMediaMetadata,videoMediaMetadata,shared`,
        { headers: { Authorization: authHeader! } }
      );
      if (!verifyRes.ok) {
        res.status(403).json({ error: 'Không thể xác minh quyền sở hữu tệp trên Google Drive.' });
        return;
      }

      const driveFile = (await verifyRes.json()) as {
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        thumbnailLink?: string;
        webViewLink?: string;
        createdTime?: string;
        imageMediaMetadata?: { width?: number; height?: number };
        videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
      };

      const kind: 'image' | 'video' = driveFile.mimeType.startsWith('video/') ? 'video' : 'image';
      const width = driveFile.imageMediaMetadata?.width ?? driveFile.videoMediaMetadata?.width ?? body.width;
      const height = driveFile.imageMediaMetadata?.height ?? driveFile.videoMediaMetadata?.height ?? body.height;
      const durationMillis = driveFile.videoMediaMetadata?.durationMillis
        ? Number(driveFile.videoMediaMetadata.durationMillis)
        : body.durationMillis;

      const entry: CatalogEntry = {
        fileId: driveFile.id,
        name: driveFile.name || body.name,
        mimeType: driveFile.mimeType || body.mimeType,
        size: Number(driveFile.size || body.size || 0),
        kind,
        bucket: body.bucket || (kind === 'video' ? 'Videos' : 'Images'),
        folderId: body.folderId,
        width,
        height,
        durationMillis,
        thumbnailLink: driveFile.thumbnailLink || body.thumbnailLink,
        webViewLink: driveFile.webViewLink || body.webViewLink,
        isPublic: true,
        createdTime: driveFile.createdTime || body.createdTime || new Date().toISOString(),
        publishedAt: new Date().toISOString(),
        uploadedBy: body.uploadedBy || driveUser.displayName,
        ownerName: driveUser.displayName || body.ownerName,
        ownerEmail: driveUser.emailAddress || body.ownerEmail,
      };

      const catalog = await readCatalog();
      const idx = catalog.findIndex((item) => item.fileId === entry.fileId);
      if (idx >= 0) {
        catalog[idx] = entry;
      } else {
        catalog.unshift(entry);
      }
      await writeCatalog(catalog);

      res.json({ item: entry });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi máy chủ khi đăng ký tệp CDN.';
      res.status(500).json({ error: message });
    }
  });

  app.patch('/api/cdn/catalog/:fileId', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const driveUser = await verifyDriveToken(authHeader);
    if (!driveUser) {
      res.status(401).json({ error: 'Yêu cầu xác thực Google Drive.' });
      return;
    }

    const { fileId } = req.params;
    const { name, bucket } = req.body as { name?: string; bucket?: string };
    const catalog = await readCatalog();
    const idx = catalog.findIndex((item) => item.fileId === fileId);
    if (idx === -1) {
      res.status(404).json({ error: 'Không tìm thấy tệp trong danh mục công khai.' });
      return;
    }

    if (name) catalog[idx].name = name;
    if (bucket) catalog[idx].bucket = bucket;
    await writeCatalog(catalog);
    res.json({ item: catalog[idx] });
  });

  app.delete('/api/cdn/catalog/:fileId', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const driveUser = await verifyDriveToken(authHeader);
    if (!driveUser) {
      res.status(401).json({ error: 'Yêu cầu xác thực Google Drive.' });
      return;
    }

    const { fileId } = req.params;
    const catalog = await readCatalog();
    const next = catalog.filter((item) => item.fileId !== fileId);
    await writeCatalog(next);
    res.json({ removed: catalog.length !== next.length });
  });

  app.get('/api/cdn/raw/:fileId', async (req: Request, res: Response) => {
    const fileId = String(req.params.fileId || '').trim();
    if (!fileId || !/^[A-Za-z0-9_-]{10,}$/.test(fileId)) {
      res.status(400).json({ error: 'Mã fileId Google Drive không hợp lệ.' });
      return;
    }

    try {
      const rangeHeader = req.headers.range;
      const upstream = await fetchDriveDownloadResponse(fileId, rangeHeader);

      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).json({
          error: 'Không thể truy xuất nội dung từ Google Drive.',
        });
        return;
      }

      const catalog = await readCatalog();
      const known = catalog.find((item) => item.fileId === fileId);

      const upstreamContentType = upstream.headers.get('content-type');
      const resolvedType =
        upstreamContentType && !upstreamContentType.includes('application/octet-stream')
          ? upstreamContentType
          : known?.mimeType || 'application/octet-stream';

      res.status(upstream.status);
      res.setHeader('Content-Type', resolvedType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Accept-Ranges', 'bytes');

      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);

      if (known?.name) {
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(known.name)}"`);
      }

      if (!upstream.body) {
        res.status(502).end();
        return;
      }

      const nodeStream = Readable.fromWeb(upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
      nodeStream.on('error', () => {
        if (!res.headersSent) res.status(502).end();
        else res.end();
      });
      nodeStream.pipe(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi proxy CDN.';
      if (!res.headersSent) {
        res.status(502).json({ error: message });
      }
    }
  });

  return app;
}
