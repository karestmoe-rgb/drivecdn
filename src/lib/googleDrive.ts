import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import defaultFirebaseConfig from '../../firebase-applet-config.json';
import type { CdnAsset, DriveFolder, DriveStorageQuota, DriveUser, MediaKind } from '../types/cdn';

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

let activeFirebaseConfig: FirebaseClientConfig = defaultFirebaseConfig;
let firebaseInitPromise: Promise<{ app: FirebaseApp; auth: Auth; config: FirebaseClientConfig }> | null = null;
let cachedAuthInstance: Auth | null = null;

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({
  prompt: 'consent select_account',
});

async function getFirebaseAuth(): Promise<{ app: FirebaseApp; auth: Auth; config: FirebaseClientConfig }> {
  if (!firebaseInitPromise) {
    firebaseInitPromise = (async () => {
      let resolvedConfig: FirebaseClientConfig = defaultFirebaseConfig;
      try {
        const res = await fetch('/api/firebase-config', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as Partial<FirebaseClientConfig>;
          if (data.apiKey && data.authDomain && data.projectId && data.appId) {
            resolvedConfig = {
              apiKey: data.apiKey,
              authDomain: data.authDomain,
              projectId: data.projectId,
              appId: data.appId,
              storageBucket: data.storageBucket || '',
              messagingSenderId: data.messagingSenderId || '',
            };
          }
        }
      } catch {
        // Fallback to bundled firebase-applet-config.json
      }

      activeFirebaseConfig = resolvedConfig;
      const existing = getApps()[0];
      const app = existing ?? initializeApp(resolvedConfig);
      const auth = getAuth(app);
      cachedAuthInstance = auth;
      return { app, auth, config: resolvedConfig };
    })();
  }
  return firebaseInitPromise;
}

// Strict in-memory caching for access token (never localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  let active = true;
  let innerUnsub: (() => void) | null = null;

  void getFirebaseAuth().then(({ auth }) => {
    if (!active) return;
    innerUnsub = onAuthStateChanged(auth, (user: User | null) => {
      if (user) {
        if (cachedAccessToken) {
          onAuthSuccess?.(user, cachedAccessToken);
        } else if (!isSigningIn) {
          cachedAccessToken = null;
          onAuthFailure?.();
        }
      } else {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    });
  });

  return () => {
    active = false;
    innerUnsub?.();
  };
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  const { auth, config } = await getFirebaseAuth();
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Không thể nhận Access Token từ Google Auth.');
    }

    // Verify that the user actually granted Google Drive scope in the consent popup
    const tokenInfoRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(credential.accessToken)}`
    );
    if (tokenInfoRes.ok) {
      const info = (await tokenInfoRes.json()) as { scope?: string };
      const grantedScopes = (info.scope || '').split(/\s+/);
      const hasDriveScope = grantedScopes.some(
        (s) =>
          s === 'https://www.googleapis.com/auth/drive.file' ||
          s === 'https://www.googleapis.com/auth/drive'
      );
      if (!hasDriveScope) {
        throw new Error(
          'Bạn chưa tích chọn quyền truy cập Google Drive trong hộp thoại đăng nhập Google. Vui lòng đăng nhập lại và cấp quyền Google Drive.'
        );
      }
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code || '')
        : '';
    if (code === 'auth/unauthorized-domain') {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'domain-hien-tai';
      throw new Error(
        `Tên miền "${host}" chưa được thêm vào Authorized domains của Firebase project "${config.projectId}". Mở Firebase Console -> Authentication -> Settings -> Authorized domains để thêm "${host}".`
      );
    }
    throw err;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const getCurrentFirebaseUser = (): User | null => {
  return cachedAuthInstance?.currentUser ?? null;
};

export const logout = async (): Promise<void> => {
  const { auth } = await getFirebaseAuth();
  await auth.signOut();
  cachedAccessToken = null;
};

// ---------------- Google Drive v3 API Operations ----------------

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const CDN_ROOT_FOLDER_NAME = 'DriveCDN';

async function parseDriveError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as {
      error?: {
        code?: number;
        message?: string;
        errors?: { reason?: string; message?: string }[];
      };
    };
    const reason = data.error?.errors?.[0]?.reason;
    const msg = data.error?.message;
    if (reason === 'accessNotConfigured') {
      return `Google Drive API chưa được bật trên project "${activeFirebaseConfig.projectId}". Vui lòng mở link sau và nhấn Enable (Bật): https://console.cloud.google.com/apis/library/drive.googleapis.com?project=${activeFirebaseConfig.projectId}`;
    }
    if (reason === 'insufficientPermissions') {
      return 'Tài khoản chưa được cấp đủ quyền Google Drive (drive.file). Vui lòng đăng xuất và đăng nhập lại, nhớ tích chọn quyền Google Drive.';
    }
    if (msg) {
      return `${fallback} (HTTP ${res.status}: ${msg})`;
    }
  } catch {
    // Ignore JSON parse error
  }
  return `${fallback} (HTTP ${res.status})`;
}

export async function getDriveAbout(token: string): Promise<{
  user: DriveUser;
  storageQuota: DriveStorageQuota | null;
}> {
  const res = await fetch(
    `${DRIVE_API}/about?fields=user(displayName,emailAddress,photoLink),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(await parseDriveError(res, 'Không thể đọc thông tin dung lượng Google Drive'));
  }
  const data = (await res.json()) as {
    user: DriveUser;
    storageQuota?: {
      limit?: string;
      usage?: string;
      usageInDrive?: string;
      usageInDriveTrash?: string;
    };
  };
  return {
    user: data.user,
    storageQuota: data.storageQuota
      ? {
          limit: Number(data.storageQuota.limit || 0),
          usage: Number(data.storageQuota.usage || 0),
          usageInDrive: Number(data.storageQuota.usageInDrive || 0),
          usageInDriveTrash: Number(data.storageQuota.usageInDriveTrash || 0),
        }
      : null,
  };
}

const workspaceLocks = new Map<
  string,
  Promise<{ rootFolder: DriveFolder; buckets: DriveFolder[] }>
>();

async function findFolderByName(token: string, name: string, parentId?: string): Promise<DriveFolder | null> {
  const escapedName = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}' and trashed = false${parentClause}`;
  const res = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime)&orderBy=createdTime asc&pageSize=10`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    throw new Error(await parseDriveError(res, `Không thể tìm thư mục "${name}" trên Google Drive`));
  }
  const data = (await res.json()) as { files?: DriveFolder[] };
  return data.files?.[0] ?? null;
}

async function createFolder(token: string, name: string, parentId?: string): Promise<DriveFolder> {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }
  const res = await fetch(`${DRIVE_API}/files?fields=id,name,createdTime`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) {
    throw new Error(await parseDriveError(res, `Không thể tạo thư mục "${name}" trên Google Drive`));
  }
  return (await res.json()) as DriveFolder;
}

export async function ensureCdnWorkspace(token: string): Promise<{
  rootFolder: DriveFolder;
  buckets: DriveFolder[];
}> {
  const existingLock = workspaceLocks.get(token);
  if (existingLock) return existingLock;

  const task = (async () => {
    let rootFolder = await findFolderByName(token, CDN_ROOT_FOLDER_NAME);
    if (!rootFolder) {
      rootFolder = await createFolder(token, CDN_ROOT_FOLDER_NAME);
    }

    // Read any existing subfolders (for backwards compatibility with previously uploaded files)
    // without creating any new folders. All new uploads go directly into the single rootFolder.
    const q = `mimeType = 'application/vnd.google-apps.folder' and '${rootFolder.id}' in parents and trashed = false`;
    const listRes = await fetch(
      `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime)&orderBy=name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const existingData = listRes.ok ? ((await listRes.json()) as { files?: DriveFolder[] }) : { files: [] };

    return {
      rootFolder,
      buckets: [rootFolder, ...(existingData.files ?? [])],
    };
  })();

  workspaceLocks.set(token, task);
  try {
    return await task;
  } catch (err) {
    workspaceLocks.delete(token);
    throw err;
  }
}

export async function createBucketFolder(
  token: string,
  rootFolderId: string,
  name: string
): Promise<DriveFolder> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Tên thư mục (Bucket) không được để trống.');
  const existing = await findFolderByName(token, trimmed, rootFolderId);
  if (existing) return existing;
  return createFolder(token, trimmed, rootFolderId);
}

interface RawDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  thumbnailLink?: string;
  webViewLink?: string;
  createdTime?: string;
  shared?: boolean;
  permissions?: { id: string; type: string; role: string }[];
  imageMediaMetadata?: { width?: number; height?: number };
  videoMediaMetadata?: { width?: number; height?: number; durationMillis?: string };
}

export async function listDriveCdnFiles(
  token: string,
  buckets: DriveFolder[],
  owner?: DriveUser | null
): Promise<CdnAsset[]> {
  if (buckets.length === 0) return [];
  const uniqueFolders = Array.from(new Map(buckets.map((b) => [b.id, b])).values());
  const bucketMap = new Map<string, string>();
  const parentQueries = uniqueFolders.map((b) => {
    bucketMap.set(b.id, b.name);
    return `'${b.id}' in parents`;
  });

  const q = `(${parentQueries.join(' or ')}) and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')`;
  const fields =
    'files(id,name,mimeType,size,parents,thumbnailLink,webViewLink,createdTime,shared,permissions(id,type,role),imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis))';

  const res = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&orderBy=createdTime desc&pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    throw new Error(await parseDriveError(res, 'Không thể tải danh sách tệp từ Google Drive'));
  }

  const data = (await res.json()) as { files?: RawDriveFile[] };
  return (data.files ?? []).map((f): CdnAsset => {
    const kind: MediaKind = f.mimeType.startsWith('video/') ? 'video' : 'image';
    const parentId = f.parents?.[0];
    const folderName = parentId ? bucketMap.get(parentId) : undefined;
    const bucket =
      folderName && folderName !== CDN_ROOT_FOLDER_NAME
        ? folderName
        : kind === 'video'
        ? 'Videos'
        : 'Images';
    const isAnyonePublic = Boolean(
      f.permissions?.some((p) => p.type === 'anyone') || f.shared
    );
    const width = f.imageMediaMetadata?.width ?? f.videoMediaMetadata?.width;
    const height = f.imageMediaMetadata?.height ?? f.videoMediaMetadata?.height;
    const durationMillis = f.videoMediaMetadata?.durationMillis
      ? Number(f.videoMediaMetadata.durationMillis)
      : undefined;

    return {
      fileId: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: Number(f.size || 0),
      kind,
      bucket,
      folderId: parentId,
      width,
      height,
      durationMillis,
      thumbnailLink: f.thumbnailLink,
      webViewLink: f.webViewLink,
      isPublic: isAnyonePublic,
      createdTime: f.createdTime || new Date().toISOString(),
      ownerName: owner?.displayName,
      ownerEmail: owner?.emailAddress,
    };
  });
}

export async function uploadMediaToDrive(
  token: string,
  file: File,
  folderId: string,
  onProgress?: (progress: number, speedBps: number) => void
): Promise<RawDriveFile> {
  const mimeType = file.type || 'application/octet-stream';

  const initRes = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,mimeType,size,parents,thumbnailLink,webViewLink,createdTime,imageMediaMetadata,videoMediaMetadata`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(file.size),
      },
      body: JSON.stringify({
        name: file.name,
        parents: [folderId],
      }),
    }
  );

  if (!initRes.ok) {
    throw new Error(await parseDriveError(initRes, 'Không thể khởi tạo phiên tải lên Drive'));
  }

  const uploadUrl = initRes.headers.get('Location');
  if (!uploadUrl) {
    throw new Error('Google Drive không trả về URL tải lên.');
  }

  return new Promise<RawDriveFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startTime = Date.now();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', mimeType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const pct = Math.min(100, Math.round((event.loaded / event.total) * 100));
        const elapsedSec = Math.max(0.25, (Date.now() - startTime) / 1000);
        const speedBps = event.loaded / elapsedSec;
        onProgress(pct, speedBps);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as RawDriveFile;
          onProgress?.(100, 0);
          resolve(parsed);
        } catch {
          reject(new Error('Phản hồi tải lên Google Drive không hợp lệ.'));
        }
      } else {
        reject(new Error(`Tải lên thất bại (HTTP ${xhr.status}).`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Lỗi kết nối mạng khi tải tệp lên Google Drive.'));
    };

    xhr.send(file);
  });
}

// Public visitor upload via Direct-to-Drive Resumable Session (bypasses Vercel 4.5MB limit, zero login required)
export async function uploadToPublicCloudRelay(
  file: File,
  bucketName: string,
  uploaderName?: string,
  onProgress?: (progress: number, speedBps: number) => void
): Promise<CdnAsset> {
  const mimeType = file.type || 'application/octet-stream';

  // Step 1: Request a single-use Google Drive resumable upload URL from server
  const sessionRes = await fetch('/api/public/upload-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType,
      fileSize: file.size,
      bucketName,
    }),
  });

  if (!sessionRes.ok) {
    const errData = (await sessionRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(errData.error || `Không thể khởi tạo phiên tải lên (HTTP ${sessionRes.status}).`);
  }

  const session = (await sessionRes.json()) as {
    uploadUrl: string;
    bucketName: string;
    folderId: string;
  };

  // Step 2: Upload binary directly from browser to Google Drive (0 bytes through Vercel)
  try {
    const uploadedFile = await new Promise<{ id: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const startTime = Date.now();
      xhr.open('PUT', session.uploadUrl, true);
      xhr.setRequestHeader('Content-Type', mimeType);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const pct = Math.min(95, Math.round((event.loaded / event.total) * 95));
          const elapsedSec = Math.max(0.25, (Date.now() - startTime) / 1000);
          const speedBps = event.loaded / elapsedSec;
          onProgress(pct, speedBps);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const parsed = JSON.parse(xhr.responseText) as { id: string };
            resolve(parsed);
          } catch {
            reject(new Error('Phản hồi từ Google Drive không hợp lệ.'));
          }
        } else {
          reject(new Error(`Google Drive trả về HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('DIRECT_CORS_ERROR'));
      xhr.send(file);
    });

    // Step 3: Publish file as public & register in catalog
    const completeRes = await fetch('/api/public/upload-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId: uploadedFile.id,
        bucketName: session.bucketName,
        folderId: session.folderId,
        uploaderName,
        fileName: file.name,
        mimeType,
        fileSize: file.size,
      }),
    });

    if (!completeRes.ok) {
      const errData = (await completeRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || 'Không thể hoàn tất xuất bản tệp.');
    }

    const completeData = (await completeRes.json()) as { item: CdnAsset };
    onProgress?.(100, 0);
    return completeData.item;
  } catch (err) {
    // Fallback via /api/public/upload if browser blocked direct CORS PUT
    if (err instanceof Error && err.message === 'DIRECT_CORS_ERROR') {
      if (file.size <= 4.5 * 1024 * 1024) {
        return new Promise<CdnAsset>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const startTime = Date.now();
          xhr.open('POST', '/api/public/upload', true);
          xhr.setRequestHeader('Content-Type', mimeType);
          xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
          xhr.setRequestHeader('X-File-Type', mimeType);
          xhr.setRequestHeader('X-File-Size', String(file.size));
          xhr.setRequestHeader('X-Bucket-Name', bucketName);
          if (uploaderName?.trim()) {
            xhr.setRequestHeader('X-Uploader-Name', encodeURIComponent(uploaderName.trim()));
          }

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && onProgress) {
              const pct = Math.min(95, Math.round((event.loaded / event.total) * 95));
              const elapsedSec = Math.max(0.25, (Date.now() - startTime) / 1000);
              onProgress(pct, event.loaded / elapsedSec);
            }
          };

          xhr.onload = () => {
            try {
              const data = JSON.parse(xhr.responseText) as { item?: CdnAsset; error?: string };
              if (xhr.status >= 200 && xhr.status < 300 && data.item) {
                onProgress?.(100, 0);
                resolve(data.item);
              } else {
                reject(new Error(data.error || `Tải lên thất bại (HTTP ${xhr.status}).`));
              }
            } catch {
              reject(new Error(`Phản hồi máy chủ không hợp lệ (HTTP ${xhr.status}).`));
            }
          };

          xhr.onerror = () => reject(new Error('Lỗi kết nối mạng khi gửi tệp lên Cloud.'));
          xhr.send(file);
        });
      }
      throw new Error(
        'Trình duyệt hoặc trình chặn quảng cáo đã chặn tải lên trực tiếp Google Drive. Vui lòng thử tắt chặn quảng cáo hoặc thử tệp nhỏ hơn 4.5MB.'
      );
    }
    throw err;
  }
}

export async function makeFilePublic(token: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: 'reader',
      type: 'anyone',
    }),
  });
  if (!res.ok) {
    throw new Error(await parseDriveError(res, 'Không thể bật quyền chia sẻ công khai cho tệp'));
  }
}

export async function makeFilePrivate(token: string, fileId: string): Promise<void> {
  const listRes = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,type,role)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!listRes.ok) {
    throw new Error(await parseDriveError(listRes, 'Không thể đọc danh sách quyền chia sẻ của tệp'));
  }
  const data = (await listRes.json()) as {
    permissions?: { id: string; type: string; role: string }[];
  };
  const publicPerms = (data.permissions ?? []).filter((p) => p.type === 'anyone');
  for (const perm of publicPerms) {
    const delRes = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(perm.id)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!delRes.ok) {
      throw new Error(await parseDriveError(delRes, 'Không thể thu hồi quyền truy cập công khai'));
    }
  }
}

export async function renameDriveFile(token: string, fileId: string, newName: string): Promise<void> {
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: newName.trim() }),
  });
  if (!res.ok) {
    throw new Error(await parseDriveError(res, 'Không thể đổi tên tệp trên Google Drive'));
  }
}

export async function deleteDriveFile(token: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await parseDriveError(res, 'Không thể xóa tệp khỏi Google Drive'));
  }
}
