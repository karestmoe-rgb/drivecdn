# Security Specification & Payload-First TDD (`DriveCDN` RBAC)

## 1. Data Invariants
1. **Strict Identity Binding**: A user creating `/users/{userId}` MUST have `userId == request.auth.uid`, `uid == request.auth.uid`, `email == request.auth.token.email`, and `request.auth.token.email_verified == true`.
2. **Prevent Self-Assigned Privileges**: When a non-admin user registers `/users/{userId}`, `role` MUST equal `'user'`, `status` MUST equal `'pending'`, `canView` MUST be `false`, and `canUpload` MUST be `false`.
3. **Immutable Ownership & Timestamps**: `uid`, `email`, and `createdAt` on `/users/{userId}` can never be modified after creation. Both `createdAt` and `updatedAt` are strictly checked against `request.time`.
4. **Tiered Update Isolation**: Regular users can ONLY update `['displayName', 'photoURL', 'updatedAt']` on their own document. Only Admin can modify `role`, `status`, `canView`, or `canUpload`.
5. **PII Isolation**: `/users/{userId}` contains `email` PII; `get` is strictly restricted to `isOwner(userId) || isAdmin()`, and `list` is strictly restricted to `isAdmin()`.
6. **Zero-Cost List Rule Compliance**: Neither `allow list` on `/admins` nor `/users` relies on per-document `get()` loops; admin checks are bounded to the caller's single identity check.

## 2. The "Dirty Dozen" Attack Payloads (All MUST Return `PERMISSION_DENIED`)
1. **Unauthenticated Read**: Anonymous client attempts `get(/users/user123)`.
2. **Unauthenticated Write**: Anonymous client attempts `create(/users/user123)`.
3. **Self-Assigned Admin Role**: User creates `/users/uid1` with `{ role: 'admin', status: 'approved', canView: true, canUpload: true }`.
4. **Self-Approved Upload**: User creates `/users/uid1` with `{ role: 'user', status: 'approved', canView: false, canUpload: true }`.
5. **Privilege Escalation Update**: Approved user updates `/users/uid1` with `{ canUpload: true }` or `{ status: 'approved' }`.
6. **Shadow Ghost Field Injection**: User creates `/users/uid1` with valid fields plus `{ isSuperAdmin: true }`.
7. **Cross-User PII Read**: User `uid1` attempts `get(/users/uid2)`.
8. **Blanket List Scraping**: User `uid1` attempts `list(/users)`.
9. **Spoofed Email Creation**: Unverified account (`email_verified: false`) or mismatched `email` attempts `create(/users/uid1)`.
10. **Path Variable ID Poisoning**: Attacker attempts `create(/users/invalid..id$123)` or oversized 1KB ID.
11. **Backdated Timestamp**: User creates `/users/uid1` with `createdAt` != `request.time` or alters `createdAt` on update.
12. **Unauthorized Admin Record Creation**: Non-admin user attempts `create(/admins/uid1)`.
