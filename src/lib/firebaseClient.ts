import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import defaultFirebaseConfig from '../../firebase-applet-config.json';
import type { UserAccount, UserStatus } from '../types/cdn';

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const AI_STUDIO_WORKSPACE_PROJECT_ID = 'gen-lang-client-0616030898';
const AI_STUDIO_WORKSPACE_ADMIN_EMAIL = 'karestmoe@gmail.com';

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  firestoreDatabaseId?: string;
  adminEmail?: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

let activeFirebaseConfig: FirebaseClientConfig = defaultFirebaseConfig;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;
let servicesPromise: Promise<{
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  config: FirebaseClientConfig;
}> | null = null;

// Strict in-memory caching for Drive OAuth access token (never localStorage or sessionStorage)
let cachedDriveAccessToken: string | null = null;

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = cachedAuth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid,
      email: currentUser?.email,
      emailVerified: currentUser?.emailVerified,
      isAnonymous: currentUser?.isAnonymous,
      tenantId: currentUser?.tenantId,
      providerInfo:
        currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(db: Firestore): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function formatFirestoreUiError(rawMessage: string): string {
  let detail = rawMessage;
  let path = '';
  try {
    const parsed = JSON.parse(rawMessage) as { error?: string; path?: string };
    if (parsed.error) detail = parsed.error;
    if (parsed.path) path = parsed.path;
  } catch {
    // Plain message
  }

  const lower = detail.toLowerCase();
  if (lower.includes('client is offline') || lower.includes('timed out') || lower.includes('timeout')) {
    return `Không thể kết nối tới Cloud Firestore (${path || 'database'}) trên project "${activeFirebaseConfig.projectId}". Hãy kiểm tra: (1) Đã tạo Cloud Firestore Database trên Firebase Console chưa, (2) Nếu dùng database mặc định thì FIREBASE_FIRESTORE_DATABASE_ID phải là "(default)" (không phải "default"), và (3) Kiểm tra mạng/VPN/chặn quảng cáo.`;
  }
  if (lower.includes('permission') || lower.includes('insufficient')) {
    return `Firestore từ chối quyền truy cập (${path || 'users'}). Hãy kiểm tra bạn đã copy nội dung file firestore.rules lên Firebase Console -> Firestore Database -> Rules và bấm Publish chưa.`;
  }
  if (lower.includes('not_found') || lower.includes('does not exist')) {
    return `Không tìm thấy Firestore database "${activeFirebaseConfig.firestoreDatabaseId || '(default)'}" trên project "${activeFirebaseConfig.projectId}". Hãy kiểm tra lại FIREBASE_FIRESTORE_DATABASE_ID.`;
  }
  return detail;
}

export async function getFirebaseServices(): Promise<{
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  config: FirebaseClientConfig;
}> {
  if (!servicesPromise) {
    servicesPromise = (async () => {
      let resolved: FirebaseClientConfig = defaultFirebaseConfig;
      try {
        const res = await fetch('/api/firebase-config', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as Partial<FirebaseClientConfig>;
          if (data.apiKey && data.authDomain && data.projectId && data.appId) {
            resolved = {
              apiKey: data.apiKey,
              authDomain: data.authDomain,
              projectId: data.projectId,
              appId: data.appId,
              storageBucket: data.storageBucket || '',
              messagingSenderId: data.messagingSenderId || '',
              firestoreDatabaseId: data.firestoreDatabaseId || '',
              adminEmail: data.adminEmail || '',
            };
          }
        }
      } catch {
        // Fallback to bundled config
      }

      activeFirebaseConfig = resolved;
      const existing = getApps()[0];
      const app = existing ?? initializeApp(resolved);
      const rawDbId = resolved.firestoreDatabaseId?.trim() || '';
      const db =
        rawDbId && rawDbId !== '(default)' && rawDbId !== 'default'
          ? getFirestore(app, rawDbId)
          : getFirestore(app);
      const auth = getAuth(app);

      cachedAuth = auth;
      cachedDb = db;

      void testConnection(db);

      return { app, auth, db, config: resolved };
    })();
  }
  return servicesPromise;
}

export function getActiveProjectId(): string {
  return activeFirebaseConfig.projectId;
}

export function getCachedDriveToken(): string | null {
  return cachedDriveAccessToken;
}

export function getCurrentAuthUser(): User | null {
  return cachedAuth?.currentUser ?? null;
}

export async function getFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  const { auth } = await getFirebaseServices();
  if (!auth.currentUser) return null;
  return auth.currentUser.getIdToken(forceRefresh);
}

export function subscribeAuthUser(callback: (user: User | null) => void): () => void {
  let active = true;
  let unsub: (() => void) | null = null;
  void getFirebaseServices().then(({ auth }) => {
    if (!active) return;
    unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        cachedDriveAccessToken = null;
      }
      callback(user);
    });
  });
  return () => {
    active = false;
    unsub?.();
  };
}

function mapFirebaseAuthError(err: unknown, projectId: string): Error {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  if (code === 'auth/unauthorized-domain') {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'domain-hien-tai';
    return new Error(
      `Tên miền "${host}" chưa được thêm vào Authorized domains của Firebase project "${projectId}". Mở Firebase Console -> Authentication -> Settings -> Authorized domains để thêm "${host}".`
    );
  }
  if (code === 'auth/popup-closed-by-user') {
    return new Error('Bạn đã đóng hộp thoại đăng nhập Google.');
  }
  return err instanceof Error ? err : new Error('Đăng nhập Google thất bại.');
}

// Regular User Google Sign-In (NO Drive OAuth scopes requested)
export async function signInRegularUser(): Promise<User> {
  const { auth, config } = await getFirebaseServices();
  const userProvider = new GoogleAuthProvider();
  userProvider.setCustomParameters({ prompt: 'select_account' });
  try {
    const result = await signInWithPopup(auth, userProvider);
    return result.user;
  } catch (err) {
    throw mapFirebaseAuthError(err, config.projectId);
  }
}

// Admin Google Sign-In WITH Drive OAuth Scope (used exclusively in Admin Dashboard)
export async function signInAdminWithDrive(): Promise<{ user: User; accessToken: string }> {
  const { auth, config } = await getFirebaseServices();
  const adminProvider = new GoogleAuthProvider();
  for (const scope of DRIVE_SCOPES) {
    adminProvider.addScope(scope);
  }
  adminProvider.setCustomParameters({ prompt: 'consent select_account' });

  try {
    const result = await signInWithPopup(auth, adminProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Không thể nhận Access Token Google Drive từ phiên đăng nhập.');
    }

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
          'Bạn chưa tích chọn quyền truy cập Google Drive trong hộp thoại đăng nhập Google.'
        );
      }
    }

    cachedDriveAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedDriveAccessToken };
  } catch (err) {
    throw mapFirebaseAuthError(err, config.projectId);
  }
}

export async function signOutAccount(): Promise<void> {
  const { auth } = await getFirebaseServices();
  await auth.signOut();
  cachedDriveAccessToken = null;
}

// ---------------- Firestore RBAC Sync & Admin Controls ----------------

function getConfiguredAdminEmail(config: FirebaseClientConfig): string {
  if (config.adminEmail?.trim()) {
    return config.adminEmail.trim().toLowerCase();
  }
  if (config.projectId === AI_STUDIO_WORKSPACE_PROJECT_ID) {
    return AI_STUDIO_WORKSPACE_ADMIN_EMAIL;
  }
  return '';
}

export function isAdminEmailConfigured(): boolean {
  return Boolean(getConfiguredAdminEmail(activeFirebaseConfig));
}

export async function checkIsAdminUser(user: User): Promise<boolean> {
  const { db, config } = await getFirebaseServices();
  const adminEmail = getConfiguredAdminEmail(config);
  if (adminEmail && user.emailVerified && user.email?.toLowerCase() === adminEmail) {
    return true;
  }
  try {
    const snap = await withTimeout(
      getDoc(doc(db, 'admins', user.uid)),
      10000,
      'Firestore request timed out while checking admin record.'
    );
    return snap.exists();
  } catch {
    return false;
  }
}

const syncInFlightByUid = new Map<string, Promise<UserAccount>>();

export async function syncUserProfileOnSignIn(user: User): Promise<UserAccount> {
  const existingTask = syncInFlightByUid.get(user.uid);
  if (existingTask) return existingTask;

  const task = (async (): Promise<UserAccount> => {
    const { db, config } = await getFirebaseServices();
    const adminEmail = getConfiguredAdminEmail(config);
    const isAdmin = await checkIsAdminUser(user);
    const safeDisplayName = (user.displayName || user.email?.split('@')[0] || 'Google User').slice(0, 120);
    const safeEmail = (user.email || '').slice(0, 254);
    const safePhoto = user.photoURL ? user.photoURL.slice(0, 500) : undefined;

    if (isAdmin && adminEmail && user.emailVerified && user.email?.toLowerCase() === adminEmail) {
      const adminRef = doc(db, 'admins', user.uid);
      try {
        const adminSnap = await withTimeout(
          getDoc(adminRef),
          12000,
          'Firestore request timed out (the client is offline).'
        );
        if (!adminSnap.exists()) {
          await withTimeout(
            setDoc(adminRef, {
              uid: user.uid,
              email: safeEmail,
              displayName: safeDisplayName,
              createdAt: serverTimestamp(),
            }),
            12000,
            'Firestore write timed out (the client is offline).'
          );
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `admins/${user.uid}`);
      }
    }

    const userPath = `users/${user.uid}`;
    const userRef = doc(db, 'users', user.uid);

    try {
      const snap = await withTimeout(
        getDoc(userRef),
        12000,
        'Firestore read timed out (the client is offline).'
      );
      if (!snap.exists()) {
        const payload: Record<string, unknown> = {
          uid: user.uid,
          email: safeEmail,
          displayName: safeDisplayName,
          role: isAdmin ? 'admin' : 'user',
          status: isAdmin ? 'approved' : 'pending',
          canView: isAdmin,
          canUpload: isAdmin,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        if (safePhoto) {
          payload.photoURL = safePhoto;
        }
        await withTimeout(
          setDoc(userRef, payload),
          12000,
          'Firestore create user profile timed out (the client is offline).'
        );

        return {
          uid: user.uid,
          email: safeEmail,
          displayName: safeDisplayName,
          photoURL: safePhoto,
          role: isAdmin ? 'admin' : 'user',
          status: isAdmin ? 'approved' : 'pending',
          canView: isAdmin,
          canUpload: isAdmin,
        };
      }

      const existing = snap.data() as UserAccount;
      const patch: Record<string, unknown> = {
        displayName: safeDisplayName,
        updatedAt: serverTimestamp(),
      };
      if (safePhoto) {
        patch.photoURL = safePhoto;
      }

      // Ensure bootstrapped admin always keeps admin flags
      if (isAdmin && (existing.role !== 'admin' || existing.status !== 'approved' || !existing.canView || !existing.canUpload)) {
        patch.role = 'admin';
        patch.status = 'approved';
        patch.canView = true;
        patch.canUpload = true;
      }

      await withTimeout(
        updateDoc(userRef, patch),
        12000,
        'Firestore update user profile timed out (the client is offline).'
      );

      return {
        ...existing,
        displayName: safeDisplayName,
        photoURL: safePhoto || existing.photoURL,
        role: isAdmin ? 'admin' : existing.role,
        status: isAdmin ? 'approved' : existing.status,
        canView: isAdmin ? true : Boolean(existing.canView),
        canUpload: isAdmin ? true : Boolean(existing.canUpload),
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }
  })();

  syncInFlightByUid.set(user.uid, task);
  try {
    return await task;
  } finally {
    syncInFlightByUid.delete(user.uid);
  }
}

export function subscribeMyUserProfile(
  uid: string,
  onProfile: (profile: UserAccount | null) => void,
  onError?: (err: Error) => void
): () => void {
  let active = true;
  let unsub: (() => void) | null = null;
  const path = `users/${uid}`;

  void getFirebaseServices().then(({ db }) => {
    if (!active) return;
    unsub = onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        if (!snap.exists()) {
          onProfile(null);
          return;
        }
        onProfile(snap.data() as UserAccount);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.GET, path);
        } catch (wrapped) {
          onError?.(wrapped instanceof Error ? wrapped : new Error('Lỗi đọc quyền người dùng.'));
        }
      }
    );
  });

  return () => {
    active = false;
    unsub?.();
  };
}

export function subscribeAllUsers(
  onUsers: (users: UserAccount[]) => void,
  onError?: (err: Error) => void
): () => void {
  let active = true;
  let unsub: (() => void) | null = null;
  const path = 'users';

  void getFirebaseServices().then(({ db }) => {
    if (!active) return;
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as UserAccount);
        onUsers(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError?.(wrapped instanceof Error ? wrapped : new Error('Lỗi tải danh sách tài khoản.'));
        }
      }
    );
  });

  return () => {
    active = false;
    unsub?.();
  };
}

export async function adminUpdateUserPermissions(
  uid: string,
  patch: { canView: boolean; canUpload: boolean; status: UserStatus }
): Promise<void> {
  const { db } = await getFirebaseServices();
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      canView: patch.canView,
      canUpload: patch.canUpload,
      status: patch.status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminDeleteUserRecord(uid: string): Promise<void> {
  const { db } = await getFirebaseServices();
  const path = `users/${uid}`;
  try {
    await deleteDoc(doc(db, 'users', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function getCachedFirestore(): Firestore | null {
  return cachedDb;
}
