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
  mode?: 'oauth' | 'bridge';
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
const DRIVE_BRIDGE_URL = (process.env.DRIVE_BRIDGE_URL || '').trim();
const DRIVE_BRIDGE_SECRET = (process.env.DRIVE_BRIDGE_SECRET || '').trim();
const PINNED_DRIVE_FOLDER_ID = (process.env.DRIVE_FOLDER_ID || '').trim();
const BOOTSTRAPPED_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'karestmoe@gmail.com').trim().toLowerCase();

const DATA_DIR = IS_VERCEL ? '/tmp/drivecdn-data' : path.resolve(process.cwd(), 'data');
const CATALOG_PATH = path.join(DATA_DIR, 'cdn-catalog.json');
const RELAY_PATH = path.join(DATA_DIR, 'relay.json');

// In-memory cache
let memoryRelay: OwnerCloudRelay | null = null;
let bridgeRefreshPromise: Promise<OwnerCloudRelay | null> | null = null;
let lastBridgeError: string | null = null;
let cachedDriveCatalog: { items: CatalogEntry[]; fetchedAt: number } | null = null;

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

function readRelayFromDisk(): OwnerCloudRelay | null {
  try {
    if (!fs.existsSync(RELAY_PATH)) return null;
    const raw = fs.readFileSync(RELAY_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as OwnerCloudRelay;
    if (!parsed || !parsed.accessToken || !parsed.enabled) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRelayToDisk(relay: OwnerCloudRelay | null): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!relay) {
      if (fs.existsSync(RELAY_PATH)) fs.unlinkSync(RELAY_PATH);
      return;
    }
    fs.writeFileSync(RELAY_PATH, JSON.stringify(relay, null, 2), 'utf-8');
  } catch {
    // Ignore read-only FS errors
  }
}

async function setActiveRelay(relay: OwnerCloudRelay | null): Promise<void> {
  memoryRelay = relay;
  writeRelayToDisk(relay);
  if (HAS_KV) {
    if (relay) {
      const ttl = Math.max(60, Math.floor((relay.expiresAt - Date.now()) / 1000));
      await kvSet('drivecdn:relay', relay, ttl);
    } else {
      await kvDel('drivecdn:relay');
    }
  }
}

async function fetchBridgeRelay(): Promise<OwnerCloudRelay | null> {
  if (!DRIVE_BRIDGE_URL) return null;
  if (bridgeRefreshPromise) return bridgeRefreshPromise;

  bridgeRefreshPromise = (async () => {
    try {
      const url = new URL(DRIVE_BRIDGE_URL);
      if (DRIVE_BRIDGE_SECRET) {
        url.searchParams.set('secret', DRIVE_BRIDGE_SECRET);
      }
      if (PINNED_DRIVE_FOLDER_ID) {
        url.searchParams.set('folderId', PINNED_DRIVE_FOLDER_ID);
      }

      const res = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: 'application/json' },
      });

      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || contentType.includes('text/html')) {
        lastBridgeError =
          'DRIVE_BRIDGE_URL không trả về JSON. Hãy kiểm tra lại bước Deploy Apps Script chọn "Who has access: Anyone".';
        return null;
      }

      const data = (await res.json()) as {
        error?: string;
        accessToken?: string;
        expiresIn?: number;
        ownerName?: string;
        ownerEmail?: string;
        rootFolderId?: string;
        buckets?: DriveFolderRef[];
        storageQuota?: StorageQuotaRef | null;
      };

      const resolvedRootId = PINNED_DRIVE_FOLDER_ID || data.rootFolderId || '';
      if (data.error || !data.accessToken || !resolvedRootId) {
        lastBridgeError = data.error || 'Dữ liệu từ DRIVE_BRIDGE_URL thiếu accessToken hoặc rootFolderId.';
        return null;
      }

      const rawBuckets = Array.isArray(data.buckets) ? data.buckets : [];
      const bucketMap = new Map<string, DriveFolderRef>();
      bucketMap.set(resolvedRootId, { id: resolvedRootId, name: 'DriveCDN' });
      for (const b of rawBuckets) {
        if (b?.id && !bucketMap.has(b.id)) {
          bucketMap.set(b.id, b);
        }
      }

      lastBridgeError = null;
      const ttlMs = Math.min(Number(data.expiresIn || 2700), 3000) * 1000;
      const relay: OwnerCloudRelay = {
        enabled: true,
        mode: 'bridge',
        accessToken: data.accessToken,
        expiresAt: Date.now() + ttlMs,
        ownerName: data.ownerName || (data.ownerEmail ? data.ownerEmail.split('@')[0] : 'Google Drive Cloud'),
        ownerEmail: data.ownerEmail || '',
        rootFolderId: resolvedRootId,
        buckets: Array.from(bucketMap.values()),
        storageQuota: data.storageQuota ?? null,
      };

      await setActiveRelay(relay);
      return relay;
    } catch (err) {
      lastBridgeError = err instanceof Error ? err.message : 'Không thể kết nối DRIVE_BRIDGE_URL.';
      return null;
    } finally {
      bridgeRefreshPromise = null;
    }
  })();

  return bridgeRefreshPromise;
}

async function getActiveRelay(forceRefreshBridge = false): Promise<OwnerCloudRelay | null> {
  if (!forceRefreshBridge) {
    let relay = memoryRelay;
    if (!relay && HAS_KV) {
      const fromKv = await kvGet<OwnerCloudRelay>('drivecdn:relay');
      if (fromKv) relay = fromKv;
    }
    if (!relay) {
      relay = readRelayFromDisk();
    }
    if (relay && relay.enabled && relay.accessToken && Date.now() < relay.expiresAt) {
      memoryRelay = relay;
      return relay;
    }
  }

  if (DRIVE_BRIDGE_URL) {
    return fetchBridgeRelay();
  }

  return null;
}

async function listDriveFilesFromRelay(relay: OwnerCloudRelay): Promise<CatalogEntry[]> {
  if (cachedDriveCatalog && Date.now() - cachedDriveCatalog.fetchedAt < 20_000) {
    return cachedDriveCatalog.items;
  }

  try {
    const items: CatalogEntry[] = [];
    const seenFileIds = new Set<string>();
    const foldersToScan = new Map<string, DriveFolderRef>();
    if (PINNED_DRIVE_FOLDER_ID) {
      foldersToScan.set(PINNED_DRIVE_FOLDER_ID, { id: PINNED_DRIVE_FOLDER_ID, name: 'DriveCDN' });
    }
    if (relay.rootFolderId) {
      foldersToScan.set(relay.rootFolderId, { id: relay.rootFolderId, name: 'DriveCDN' });
    }
    for (const b of relay.buckets) {
      if (b.id && !foldersToScan.has(b.id)) {
        foldersToScan.set(b.id, b);
      }
    }

    for (const folder of foldersToScan.values()) {
      const q = `'${folder.id}' in parents and trashed = false`;
      const fields =
        'files(id,name,mimeType,size,thumbnailLink,webViewLink,createdTime,imageMediaMetadata,videoMediaMetadata,permissions(id,type,role))';
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&orderBy=createdTime desc&pageSize=100`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${relay.accessToken}` },
      });
      if (!res.ok) continue;

      const data = (await res.json()) as {
        files?: Array<{
          id: string;
          name: string;
          mimeType: string;
          size?: string;
          thumbnailLink?: string;
          webViewLink?: string;
          createdTime?: string;
          imageMediaMetadata?: { width?: number; height?: number };
          videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
          permissions?: Array<{ id: string; type: string; role: string }>;
        }>;
      };

      for (const f of data.files ?? []) {
        if (seenFileIds.has(f.id)) continue;
        if (!f.mimeType.startsWith('image/') && !f.mimeType.startsWith('video/')) continue;
        const isAnyonePublic = Boolean((f.permissions ?? []).some((p) => p.type === 'anyone'));
        if (!isAnyonePublic) continue;

        seenFileIds.add(f.id);
        const kind: 'image' | 'video' = f.mimeType.startsWith('video/') ? 'video' : 'image';
        const logicalBucket =
          folder.name && folder.name !== 'DriveCDN'
            ? folder.name
            : kind === 'video'
            ? 'Videos'
            : 'Images';

        items.push({
          fileId: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: Number(f.size || 0),
          kind,
          bucket: logicalBucket,
          folderId: folder.id,
          width: f.imageMediaMetadata?.width ?? f.videoMediaMetadata?.width,
          height: f.imageMediaMetadata?.height ?? f.videoMediaMetadata?.height,
          durationMillis: f.videoMediaMetadata?.durationMillis
            ? Number(f.videoMediaMetadata.durationMillis)
            : undefined,
          thumbnailLink: f.thumbnailLink,
          webViewLink: f.webViewLink,
          isPublic: true,
          createdTime: f.createdTime || new Date().toISOString(),
          publishedAt: f.createdTime || new Date().toISOString(),
          ownerName: relay.ownerName,
          ownerEmail: relay.ownerEmail,
        });
      }
    }

    cachedDriveCatalog = { items, fetchedAt: Date.now() };
    return items;
  } catch {
    return cachedDriveCatalog?.items ?? [];
  }
}

async function collectRequestBuffer(req: Request, maxBytes: number): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) {
      throw new Error('Tệp vượt quá giới hạn tải qua proxy máy chủ.');
    }
    return req.body;
  }
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        settled = true;
        reject(new Error('Tệp vượt quá giới hạn tải qua proxy máy chủ.'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
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

interface FirebaseServerConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket: string;
  messagingSenderId: string;
  firestoreDatabaseId: string;
}

function resolveFirebaseServerConfig(): FirebaseServerConfig | null {
  const apiKey = process.env.FIREBASE_API_KEY;
  const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const appId = process.env.FIREBASE_APP_ID;

  if (apiKey && authDomain && projectId && appId) {
    return {
      apiKey,
      authDomain,
      projectId,
      appId,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
      firestoreDatabaseId: process.env.FIREBASE_FIRESTORE_DATABASE_ID || '(default)',
    };
  }

  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as Record<string, string>;
      if (parsed.apiKey && parsed.authDomain && parsed.projectId && parsed.appId) {
        return {
          apiKey: parsed.apiKey,
          authDomain: parsed.authDomain,
          projectId: parsed.projectId,
          appId: parsed.appId,
          storageBucket: parsed.storageBucket || '',
          messagingSenderId: parsed.messagingSenderId || '',
          firestoreDatabaseId: parsed.firestoreDatabaseId || '(default)',
        };
      }
    }
  } catch {
    // Ignore read error
  }

  return null;
}

interface VerifiedUserAccess {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  isAdmin: boolean;
  canView: boolean;
  canUpload: boolean;
  status: 'pending' | 'approved' | 'revoked';
}

const idTokenIdentityCache = new Map<
  string,
  { uid: string; email: string; emailVerified: boolean; displayName: string; expiresAt: number }
>();

function extractFirebaseIdToken(req: Request): string | null {
  const headerToken = req.headers['x-firebase-id-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  const queryToken = req.query.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const candidate = authHeader.slice('Bearer '.length).trim();
    if (candidate && !candidate.startsWith('ya29.')) {
      return candidate;
    }
  }
  return null;
}

async function verifyUserAccess(req: Request): Promise<VerifiedUserAccess | null> {
  const idToken = extractFirebaseIdToken(req);
  if (!idToken) return null;

  const cfg = resolveFirebaseServerConfig();
  if (!cfg) return null;

  let identity = idTokenIdentityCache.get(idToken);
  if (!identity || Date.now() >= identity.expiresAt) {
    try {
      const lookupRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(cfg.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );
      if (!lookupRes.ok) return null;
      const lookupData = (await lookupRes.json()) as {
        users?: Array<{
          localId?: string;
          email?: string;
          emailVerified?: boolean;
          displayName?: string;
        }>;
      };
      const u = lookupData.users?.[0];
      if (!u?.localId || !u.email) return null;

      identity = {
        uid: u.localId,
        email: u.email,
        emailVerified: Boolean(u.emailVerified),
        displayName: u.displayName || u.email.split('@')[0],
        expiresAt: Date.now() + 5 * 60 * 1000,
      };
      idTokenIdentityCache.set(idToken, identity);
    } catch {
      return null;
    }
  }

  if (!identity.emailVerified) {
    return null;
  }

  if (identity.email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL) {
    return {
      uid: identity.uid,
      email: identity.email,
      emailVerified: true,
      displayName: identity.displayName,
      isAdmin: true,
      canView: true,
      canUpload: true,
      status: 'approved',
    };
  }

  const dbId = cfg.firestoreDatabaseId || '(default)';
  const fsBase = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/${encodeURIComponent(dbId)}/documents`;

  try {
    const adminRes = await fetch(`${fsBase}/admins/${encodeURIComponent(identity.uid)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (adminRes.ok) {
      return {
        uid: identity.uid,
        email: identity.email,
        emailVerified: true,
        displayName: identity.displayName,
        isAdmin: true,
        canView: true,
        canUpload: true,
        status: 'approved',
      };
    }

    const userRes = await fetch(`${fsBase}/users/${encodeURIComponent(identity.uid)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!userRes.ok) {
      return {
        uid: identity.uid,
        email: identity.email,
        emailVerified: true,
        displayName: identity.displayName,
        isAdmin: false,
        canView: false,
        canUpload: false,
        status: 'pending',
      };
    }

    const docData = (await userRes.json()) as {
      fields?: {
        role?: { stringValue?: string };
        status?: { stringValue?: string };
        canView?: { booleanValue?: boolean };
        canUpload?: { booleanValue?: boolean };
      };
    };

    const fields = docData.fields || {};
    const statusRaw = fields.status?.stringValue;
    const status: 'pending' | 'approved' | 'revoked' =
      statusRaw === 'approved' || statusRaw === 'revoked' ? statusRaw : 'pending';
    const isAdminDoc = fields.role?.stringValue === 'admin';
    const canView = isAdminDoc || (status === 'approved' && Boolean(fields.canView?.booleanValue));
    const canUpload = isAdminDoc || (status === 'approved' && Boolean(fields.canUpload?.booleanValue));

    return {
      uid: identity.uid,
      email: identity.email,
      emailVerified: true,
      displayName: identity.displayName,
      isAdmin: isAdminDoc,
      canView,
      canUpload,
      status,
    };
  } catch {
    return null;
  }
}

export function createApiApp(): Express {
  ensureCatalogFile();
  const app = express();

  // Fallback raw streaming upload (used on local/Cloud Run or small <= 4.5MB files)
  app.post('/api/public/upload', async (req: Request, res: Response) => {
    const access = await verifyUserAccess(req);
    if (!access) {
      res.status(401).json({ error: 'Vui lòng đăng nhập tài khoản Google để tải tệp lên.' });
      return;
    }
    if (!access.canUpload) {
      res.status(403).json({
        error: 'Tài khoản Google của bạn chưa được Admin cấp quyền tải tệp lên.',
      });
      return;
    }

    const relay = await getActiveRelay();
    if (!relay) {
      res.status(503).json({
        error:
          'Cổng nhận tải lên hiện chưa được Admin kích hoạt hoặc phiên kết nối Drive đã hết hạn.',
      });
      return;
    }

    const rawName = String(req.headers['x-file-name'] || '').trim();
    const fileName = rawName ? decodeURIComponent(rawName) : `media-${Date.now()}`;
    const mimeType = String(req.headers['x-file-type'] || req.headers['content-type'] || 'application/octet-stream');
    const fileSize = Number(req.headers['x-file-size'] || req.headers['content-length'] || 0);
    const requestedBucket = String(req.headers['x-bucket-name'] || '').trim();
    const uploadedBy = access.displayName || access.email;

    if (!mimeType.startsWith('image/') && !mimeType.startsWith('video/')) {
      res.status(400).json({ error: 'Chỉ hỗ trợ tải lên tệp hình ảnh hoặc video.' });
      return;
    }

    const kind: 'image' | 'video' = mimeType.startsWith('video/') ? 'video' : 'image';
    const singleFolderId = PINNED_DRIVE_FOLDER_ID || relay.rootFolderId || relay.buckets[0]?.id;
    const logicalBucket =
      requestedBucket && requestedBucket !== 'AUTO' && requestedBucket !== 'DriveCDN'
        ? requestedBucket
        : kind === 'video'
        ? 'Videos'
        : 'Images';
    const targetBucket = singleFolderId ? { id: singleFolderId, name: logicalBucket } : null;

    if (!targetBucket) {
      res.status(500).json({ error: 'Không tìm thấy thư mục lưu trữ trên Google Drive.' });
      return;
    }

    try {
      const fileBuffer = await collectRequestBuffer(req, IS_VERCEL ? 5 * 1024 * 1024 : 50 * 1024 * 1024);
      const effectiveLength = fileBuffer.length;

      const initHeaders: Record<string, string> = {
        Authorization: `Bearer ${relay.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
      };
      if (effectiveLength > 0) {
        initHeaders['X-Upload-Content-Length'] = String(effectiveLength);
      }

      let initRes = await fetch(
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

      if (initRes.status === 401 && DRIVE_BRIDGE_URL) {
        const refreshed = await getActiveRelay(true);
        if (refreshed) {
          relay.accessToken = refreshed.accessToken;
          initHeaders['Authorization'] = `Bearer ${refreshed.accessToken}`;
          initRes = await fetch(
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
        }
      }

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

      const putHeaders: Record<string, string> = {
        'Content-Type': mimeType,
        'Content-Length': String(effectiveLength),
      };

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: putHeaders,
        body: new Uint8Array(fileBuffer),
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
        effectiveLength || fileSize
      );

      cachedDriveCatalog = null;

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
    const cfg = resolveFirebaseServerConfig();
    if (cfg) {
      res.setHeader('Cache-Control', 'no-store');
      res.json(cfg);
      return;
    }

    res.status(404).json({ error: 'Chưa cấu hình Firebase Auth.' });
  });

  // Vercel-friendly Direct-to-Drive Resumable Upload Session (bypasses 4.5MB serverless limit!)
  app.post('/api/public/upload-session', async (req: Request, res: Response) => {
    const access = await verifyUserAccess(req);
    if (!access) {
      res.status(401).json({ error: 'Vui lòng đăng nhập tài khoản Google để tải tệp lên.' });
      return;
    }
    if (!access.canUpload) {
      res.status(403).json({
        error: 'Tài khoản Google của bạn chưa được Admin cấp quyền tải tệp lên.',
      });
      return;
    }

    const relay = await getActiveRelay();
    if (!relay) {
      res.status(503).json({
        error:
          'Cổng nhận tải lên hiện chưa được Admin kích hoạt hoặc phiên kết nối Drive đã hết hạn.',
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
    const singleFolderId = PINNED_DRIVE_FOLDER_ID || relay.rootFolderId || relay.buckets[0]?.id;
    const logicalBucket =
      bucketName && bucketName !== 'AUTO' && bucketName !== 'DriveCDN'
        ? bucketName
        : kind === 'video'
        ? 'Videos'
        : 'Images';
    const targetBucket = singleFolderId ? { id: singleFolderId, name: logicalBucket } : null;

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
      let clientOrigin = req.headers.origin;
      if (!clientOrigin && req.headers.referer) {
        try {
          clientOrigin = new URL(req.headers.referer).origin;
        } catch {
          // Ignore malformed referer
        }
      }
      if (clientOrigin) {
        initHeaders['Origin'] = clientOrigin;
      }

      let initRes = await fetch(
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

      if (initRes.status === 401 && DRIVE_BRIDGE_URL) {
        const refreshed = await getActiveRelay(true);
        if (refreshed) {
          initHeaders['Authorization'] = `Bearer ${refreshed.accessToken}`;
          initRes = await fetch(
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
        }
      }

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
    const access = await verifyUserAccess(req);
    if (!access) {
      res.status(401).json({ error: 'Vui lòng đăng nhập tài khoản Google.' });
      return;
    }
    if (!access.canUpload) {
      res.status(403).json({ error: 'Tài khoản chưa được Admin cấp quyền tải tệp lên.' });
      return;
    }

    const relay = await getActiveRelay();
    if (!relay) {
      res.status(503).json({ error: 'Phiên kết nối Drive của chủ sở hữu không còn hoạt động.' });
      return;
    }

    const { fileId, bucketName, folderId, fileName, mimeType, fileSize } = req.body as {
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
        access.displayName || access.email,
        relay.ownerName,
        relay.ownerEmail,
        fileName,
        mimeType,
        fileSize
      );

      cachedDriveCatalog = null;

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
      mode: relay?.mode,
      bridgeConfigured: Boolean(DRIVE_BRIDGE_URL),
      bridgeError: !relay && lastBridgeError ? lastBridgeError : undefined,
      rootFolderId: PINNED_DRIVE_FOLDER_ID || relay?.rootFolderId,
      ownerName: relay?.ownerName,
      ownerEmail: relay?.ownerEmail,
      expiresAt: relay?.expiresAt,
      buckets: relay?.buckets ?? [],
      storageQuota: relay?.storageQuota ?? null,
    });
  });

  app.post('/api/cloud/activate', async (req: Request, res: Response) => {
    const access = await verifyUserAccess(req);
    if (!access?.isAdmin) {
      res.status(403).json({ error: 'Chỉ tài khoản Admin mới có quyền kích hoạt cổng Drive.' });
      return;
    }

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
      mode: 'oauth',
      accessToken: token,
      expiresAt: Date.now() + 58 * 60 * 1000,
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
      mode: nextRelay.mode,
      bridgeConfigured: Boolean(DRIVE_BRIDGE_URL),
      rootFolderId: PINNED_DRIVE_FOLDER_ID || nextRelay.rootFolderId,
      ownerName: nextRelay.ownerName,
      ownerEmail: nextRelay.ownerEmail,
      expiresAt: nextRelay.expiresAt,
      buckets: nextRelay.buckets,
      storageQuota: nextRelay.storageQuota,
    });
  });

  app.post('/api/cloud/deactivate', async (req: Request, res: Response) => {
    const access = await verifyUserAccess(req);
    if (!access?.isAdmin) {
      res.status(403).json({ error: 'Chỉ tài khoản Admin mới có quyền tạm ngưng cổng Drive.' });
      return;
    }
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const driveUser = await verifyDriveToken(authHeader);
      if (!driveUser) {
        res.status(401).json({ error: 'Token không hợp lệ.' });
        return;
      }
    }
    await setActiveRelay(null);
    res.json({
      enabled: false,
      active: false,
      bridgeConfigured: Boolean(DRIVE_BRIDGE_URL),
    });
  });

  app.get('/api/cdn/catalog', async (req: Request, res: Response) => {
    const access = await verifyUserAccess(req);
    if (!access) {
      res.status(401).json({ error: 'Vui lòng đăng nhập tài khoản Google để xem thư viện.' });
      return;
    }
    if (!access.canView) {
      res.status(403).json({
        error: 'Tài khoản của bạn chưa được Admin cấp quyền xem thư viện media.',
      });
      return;
    }

    const localEntries = (await readCatalog()).filter((item) => item.isPublic);
    const mergedMap = new Map<string, CatalogEntry>();
    for (const item of localEntries) {
      mergedMap.set(item.fileId, item);
    }

    const relay = await getActiveRelay();
    if (relay) {
      const driveItems = await listDriveFilesFromRelay(relay);
      for (const drv of driveItems) {
        const existing = mergedMap.get(drv.fileId);
        mergedMap.set(drv.fileId, existing ? { ...drv, ...existing, thumbnailLink: drv.thumbnailLink || existing.thumbnailLink } : drv);
      }
    }

    const entries = Array.from(mergedMap.values()).sort(
      (a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime()
    );
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
    const access = await verifyUserAccess(req);
    if (!access?.isAdmin) {
      res.status(403).json({ error: 'Chỉ Admin mới có quyền quản trị danh mục trực tiếp.' });
      return;
    }
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
      cachedDriveCatalog = null;

      res.json({ item: entry });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lỗi máy chủ khi đăng ký tệp CDN.';
      res.status(500).json({ error: message });
    }
  });

  app.patch('/api/cdn/catalog/:fileId', async (req: Request, res: Response) => {
    const access = await verifyUserAccess(req);
    if (!access?.isAdmin) {
      res.status(403).json({ error: 'Chỉ Admin mới có quyền chỉnh sửa tệp.' });
      return;
    }
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
    cachedDriveCatalog = null;
    res.json({ item: catalog[idx] });
  });

  app.delete('/api/cdn/catalog/:fileId', async (req: Request, res: Response) => {
    const access = await verifyUserAccess(req);
    if (!access?.isAdmin) {
      res.status(403).json({ error: 'Chỉ Admin mới có quyền xóa tệp.' });
      return;
    }
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
    cachedDriveCatalog = null;
    res.json({ removed: catalog.length !== next.length });
  });

  app.get('/api/cdn/raw/:fileId', async (req: Request, res: Response) => {
    const access = await verifyUserAccess(req);
    if (!access?.canView) {
      res.status(access ? 403 : 401).json({
        error: access
          ? 'Tài khoản của bạn chưa được Admin cấp quyền xem tệp này.'
          : 'Vui lòng đăng nhập tài khoản Google được cấp quyền để xem.',
      });
      return;
    }

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
