export type MediaKind = 'image' | 'video';

export interface CdnAsset {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: MediaKind;
  bucket: string;
  folderId?: string;
  width?: number;
  height?: number;
  durationMillis?: number;
  thumbnailLink?: string;
  webViewLink?: string;
  isPublic: boolean;
  createdTime: string;
  publishedAt?: string;
  uploadedBy?: string;
  ownerName?: string;
  ownerEmail?: string;
}

export interface DriveStorageQuota {
  limit: number;
  usage: number;
  usageInDrive: number;
  usageInDriveTrash: number;
}

export interface DriveUser {
  displayName: string;
  emailAddress: string;
  photoLink?: string;
}

export interface DriveFolder {
  id: string;
  name: string;
  createdTime?: string;
}

export interface PublicRelayStatus {
  enabled: boolean;
  active: boolean;
  mode?: 'oauth' | 'bridge';
  bridgeConfigured?: boolean;
  bridgeError?: string;
  rootFolderId?: string;
  ownerName?: string;
  ownerEmail?: string;
  expiresAt?: number;
  buckets: DriveFolder[];
  storageQuota?: DriveStorageQuota | null;
}

export interface UploadTask {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  kind: MediaKind;
  bucket: string;
  progress: number;
  speedBps: number;
  status: 'queued' | 'uploading' | 'publishing' | 'completed' | 'error';
  error?: string;
  asset?: CdnAsset;
}

export type WorkspaceTab = 'library' | 'upload' | 'docs' | 'admin';

export type WorkspacePanel = 'user' | 'admin';
export type UserRole = 'admin' | 'user';
export type UserStatus = 'pending' | 'approved' | 'revoked';

export interface UserAccount {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  status: UserStatus;
  canView: boolean;
  canUpload: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

