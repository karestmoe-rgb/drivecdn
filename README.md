# DriveCDN — Google Drive Media CDN & RBAC Uploader

Biến **Google Drive cá nhân** của bạn thành hệ thống **Media CDN & Kho lưu trữ Ảnh/Video dùng chung**, hỗ trợ phân quyền chi tiết cho từng tài khoản Google, upload tệp dung lượng lớn vượt giới hạn 4.5MB của Vercel Hobby miễn phí và lưu tập trung vào **1 thư mục `DriveCDN` duy nhất**.

---

## Tính năng chính

- **Tách biệt 2 giao diện rõ ràng**:
  - **User Portal (`/`)**: Người dùng đăng nhập Google (chỉ xác thực danh tính, **không** xin quyền Drive cá nhân). Tài khoản mới mặc định ở trạng thái `pending` (chờ duyệt). Khi được Admin cấp quyền, User chỉ thấy các tab được phép (**Thư viện Media** / **Tải lên Cloud**) và **không có quyền xóa, đổi tên hoặc ẩn tệp**.
  - **Admin Dashboard (`/admin`)**: Dành riêng cho Admin (tài khoản host Google Drive). Duyệt/thu hồi quyền User theo thời gian thực qua Firestore, quản lý kho Media (tải lên, đổi tên, bật/tắt công khai, xóa trực tiếp trên Google Drive) và quản trị kết nối Google Drive Host.
- **Upload trực tiếp lên Google Drive (Resumable Direct-to-Drive)**: Trình duyệt đẩy trực tiếp file (video vài trăm MB – vài GB) thẳng lên Google Drive, hoàn toàn không đi qua giới hạn payload 4.5MB của Vercel Serverless.
- **Kết nối Drive 24/7 qua Google Apps Script Bridge**: Không cần Admin đăng nhập lại OAuth mỗi ~58 phút, không bị tạo trùng thư mục `DriveCDN` khi redeploy.
- **Tối ưu Vercel Hobby (Miễn phí)**: Không dùng biến `VITE_*` build-time (nạp cấu hình Firebase động qua `/api/firebase-config`), hỗ trợ Upstash Redis KV miễn phí và route `/api/index.ts`.

---

## 1. Các tệp Preconfig & Cấu trúc dự án

Khi clone repo về để tự host bằng **tài khoản Google Drive & Firebase của riêng bạn**, hãy nắm các tệp cấu hình sau:

| Tệp / Thư mục | Vai trò | Khi nào cần chỉnh? |
| :--- | :--- | :--- |
| `.env.example` | Mẫu toàn bộ biến môi trường cho Local & Vercel | Tham khảo hoặc copy thành `.env` (khi chạy `npm run setup` sẽ tự tạo `.env`) |
| `firebase-applet-config.json` | Cấu hình Firebase Web SDK fallback cho local/preview | Tự động cập nhật khi chạy `npm run setup`, hoặc chép từ `preconfig/firebase-applet-config.template.json`. Trên Vercel có thể **ghi đè hoàn toàn bằng biến môi trường `FIREBASE_*`** |
| `firestore.rules` | Luật bảo mật Cloud Firestore (RBAC Admin/User) | **Bắt buộc thay email Admin** thành email Google của bạn (tự sinh khi chạy `npm run setup`) rồi Publish lên Firebase Console |
| `preconfig/firebase-applet-config.template.json` | File mẫu cấu hình Firebase Web SDK sạch | Dùng làm mẫu khi cấu hình thủ công |
| `preconfig/firestore.rules.template` | Mẫu Firestore Rules chứa placeholder `{{ADMIN_EMAIL}}` | Dùng làm mẫu hoặc để `npm run setup` sinh ra `firestore.rules` |
| `preconfig/apps-script-bridge.gs` | Mã Google Apps Script làm cầu nối Drive 24/7 | Copy toàn bộ nội dung dán vào `script.google.com` để lấy `DRIVE_BRIDGE_URL` |
| `vercel.json` & `api/index.ts` | Cấu hình Serverless & SPA rewrite cho Vercel | **Giữ nguyên**, không cần sửa |

---

## 2. Danh sách Biến môi trường (Environment Variables)

Ứng dụng **không sử dụng prefix `VITE_`** nên rất an toàn và không bị Vercel cảnh báo khi deploy.

### Nhóm A — Bắt buộc

| Biến | Mô tả | Giá trị mẫu |
| :--- | :--- | :--- |
| `FIREBASE_API_KEY` | Web API Key của Firebase App | `AIzaSy...` |
| `FIREBASE_AUTH_DOMAIN` | Auth domain của Firebase Project | `my-cdn.firebaseapp.com` |
| `FIREBASE_PROJECT_ID` | ID của Firebase Project | `my-cdn` |
| `FIREBASE_APP_ID` | App ID của Firebase Web App | `1:123456789:web:abcdef` |
| `FIREBASE_FIRESTORE_DATABASE_ID` | ID của Cloud Firestore database (nếu dùng DB mặc định thì điền `(default)`) | `(default)` |
| `ADMIN_EMAIL` | **Email Google của bạn** (tài khoản chủ sở hữu host Drive & quyền Admin tối cao) | `your-email@gmail.com` |

### Nhóm B — Tùy chọn (Khuyên dùng khi chạy Production trên Vercel)

| Biến | Mô tả | Giá trị mẫu |
| :--- | :--- | :--- |
| `FIREBASE_STORAGE_BUCKET` | Storage bucket từ Firebase SDK config | `my-cdn.firebasestorage.app` |
| `FIREBASE_MESSAGING_SENDER_ID` | Sender ID từ Firebase SDK config | `123456789` |
| `DRIVE_BRIDGE_URL` | URL `/exec` của Google Apps Script Web App để giữ kết nối Drive 24/7 không cần OAuth lại | `https://script.google.com/macros/s/.../exec` |
| `DRIVE_BRIDGE_SECRET` | Chuỗi bí mật bảo vệ `DRIVE_BRIDGE_URL` (khớp với Script Property `BRIDGE_SECRET`) | `chuoi-bi-mat-cua-ban` |
| `DRIVE_FOLDER_ID` | ID của **1 thư mục `DriveCDN` duy nhất** trên Google Drive (trích từ URL `drive.google.com/drive/folders/<ID>`) | `1AbCdEfGhIjKlMnOpQrStUvWxYz` |
| `KV_REST_API_URL` | REST URL của Upstash Redis (tạo miễn phí trong Vercel Marketplace) để lưu danh mục & relay bền vững | `https://...upstash.io` |
| `KV_REST_API_TOKEN` | REST Token của Upstash Redis | `AX...` |

---

## 3. Hướng dẫn cài đặt từng bước cho người mới

### Bước 1: Tạo Project Firebase & Firestore (Miễn phí - Spark Plan)

1. Truy cập [Firebase Console](https://console.firebase.google.com/) → bấm **Create a project**.
2. Vào **Project settings** (biểu tượng bánh răng) → mục **Your apps** → bấm biểu tượng Web (`</>`) để đăng ký Web App và lấy bộ thông số `apiKey`, `authDomain`, `projectId`, `appId`, `storageBucket`, `messagingSenderId`.
3. Vào **Build → Authentication → Sign-in method** → bật nhà cung cấp **Google** (nhập Support email là email của bạn).
4. Vào **Build → Firestore Database → Create database**:
   - Giữ nguyên Database ID mặc định **`(default)`** (khi điền biến môi trường nhớ ghi đúng `(default)`).
   - Chọn region gần người dùng (ví dụ `asia-southeast1`) và khởi tạo ở **Production mode**.

### Bước 2: Clone mã nguồn & chạy Preconfig Setup

```bash
git clone <url-repo-cua-ban>
cd drivecdn
npm install
npm run setup
```

Trình cài đặt `npm run setup` sẽ hỏi lần lượt thông số Firebase + `ADMIN_EMAIL` + các biến tùy chọn và **tự động sinh ra 3 tệp**:
1. `.env` (chạy local)
2. `firebase-applet-config.json` (fallback config)
3. `firestore.rules` (đã thay sẵn `ADMIN_EMAIL` của bạn vào `isBootstrappedAdmin()`)

> **Mẹo kiểm tra cú pháp rules:** Chạy `npm run rules:lint` để kiểm tra file `firestore.rules` không có lỗi bảo mật.

### Bước 3: Publish Firestore Security Rules

1. Mở tệp `firestore.rules` vừa sinh ở Bước 2 (đảm bảo dòng `request.auth.token.email == 'email-cua-ban@gmail.com'` đã đúng email của bạn).
2. Vào **Firebase Console → Firestore Database → tab Rules** → dán toàn bộ nội dung `firestore.rules` và bấm **Publish**.

### Bước 4: Kích hoạt Google Drive API & Kết nối tài khoản Drive Host

Bạn có **2 cách** để host bằng tài khoản Google Drive của mình:

#### Cách 1: Kết nối nhanh qua Google OAuth (Tốt cho chạy thử / Local)
1. Bật Google Drive API cho project Google Cloud tương ứng với Firebase Project của bạn tại:
   `https://console.cloud.google.com/apis/library/drive.googleapis.com?project=<FIREBASE_PROJECT_ID>` → bấm **Enable**.
2. Chạy app (`npm run dev`), mở `/admin` và bấm **Đăng nhập & Kết nối Google Drive Host**.
3. *Lưu ý:* Token OAuth trình duyệt có hiệu lực ~58 phút; khi hết hạn bạn chỉ cần bấm kết nối lại.

#### Cách 2: Kết nối vĩnh viễn 24/7 bằng Google Apps Script (Khuyên dùng cho Vercel)
1. Đăng nhập [script.google.com](https://script.google.com/) bằng **chính tài khoản Google Drive dùng để lưu file**.
2. Bấm **New project**, xóa code mặc định, copy toàn bộ mã trong tệp `preconfig/apps-script-bridge.gs` dán vào và nhấn Lưu (`Ctrl+S`).
3. *(Tùy chọn)* Vào **Project Settings → Script Properties**:
   - Thêm `BRIDGE_SECRET` = một chuỗi ngẫu nhiên khó đoán.
   - Nếu bạn đã tạo sẵn thư mục `DriveCDN` trên Google Drive, thêm `PINNED_FOLDER_ID` = ID của thư mục đó.
4. Bấm **Deploy → New deployment**:
   - Type: **Web app**
   - Execute as: **Me (Tôi)**
   - Who has access: **Anyone (Bất kỳ ai)**
   - Bấm **Deploy**, cấp quyền Google Drive (nếu thấy cảnh báo *"Google hasn't verified this app"*, bấm **Advanced → Go to ... (unsafe) → Allow**).
5. Copy đường dẫn Web App kết thúc bằng `/exec` và gán vào biến `DRIVE_BRIDGE_URL` (cùng `DRIVE_BRIDGE_SECRET`, `DRIVE_FOLDER_ID` nếu có).

---

## 4. Chạy Local & Deploy miễn phí lên Vercel

### Chạy trên máy cá nhân (Local)

```bash
npm run dev
```

Mở trình duyệt tại `http://localhost:3000` (User UI) hoặc `http://localhost:3000/admin` (Admin Dashboard).

### Deploy lên Vercel Hobby (Miễn phí)

1. Push mã nguồn lên GitHub cá nhân của bạn (**lưu ý:** `.env` đã nằm trong `.gitignore`, không đẩy bí mật lên repo public).
2. Vào [Vercel Dashboard](https://vercel.com/new) → **Import** repository.
3. Trong mục **Environment Variables**, thêm toàn bộ biến ở Mục 2 (`FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, `FIREBASE_FIRESTORE_DATABASE_ID`, `ADMIN_EMAIL`, `DRIVE_BRIDGE_URL`, `DRIVE_BRIDGE_SECRET`, `DRIVE_FOLDER_ID`).
4. *(Khuyên dùng)* Vào tab **Storage** trên Vercel → gắn miễn phí **Upstash Redis** để Vercel tự thêm `KV_REST_API_URL` và `KV_REST_API_TOKEN`.
5. Bấm **Deploy**.
6. **Quan trọng — Thêm Authorized Domain cho Firebase Auth:**
   Sau khi Vercel cấp domain (ví dụ `https://drivecdn-cua-ban.vercel.app`), vào **Firebase Console → Authentication → Settings → Authorized domains** → bấm **Add domain** và dán `drivecdn-cua-ban.vercel.app` (nếu không thêm sẽ gặp lỗi `Firebase: Error (auth/unauthorized-domain)`).

---

## 5. Luồng phân quyền & sử dụng hàng ngày

1. **Admin (`/admin`)**:
   - Đăng nhập bằng tài khoản Google khớp với `ADMIN_EMAIL`.
   - Khi có `DRIVE_BRIDGE_URL`, Admin **chỉ cần đăng nhập Google 1 lần duy nhất** là có toàn quyền tải lên, đổi tên, bật/tắt công khai và xóa tệp trên Drive mà không cần xác thực Drive OAuth thêm lần nữa.
2. **User (`/`)**:
   - Người dùng khác bấm **Đăng nhập với Google** ở trang chủ `/`.
   - Lần đầu đăng nhập, trạng thái là **Đang chờ Admin cấp quyền**.
   - Admin vào tab **Quản lý User** trong `/admin` để bật/tắt riêng từng quyền: **Xem file** (`canView`) và **Đăng tải** (`canUpload`), hoặc **Thu hồi quyền** bất cứ lúc nào.

---

## 6. Xử lý sự cố thường gặp (FAQ)

- **Lỗi `Firebase: Error (auth/unauthorized-domain)`**: Tên miền Vercel hoặc custom domain chưa được thêm vào **Firebase Console → Authentication → Settings → Authorized domains**.
- **Treo trạng thái `"Đang kiểm tra hồ sơ..."` hoặc lỗi Firestore offline**:
  1. Kiểm tra đã tạo **Cloud Firestore Database** trên Firebase Console chưa.
  2. Biến `FIREBASE_FIRESTORE_DATABASE_ID` phải là `(default)` (có ngoặc đơn), không viết `default`.
  3. Đảm bảo đã **Publish** file `firestore.rules` lên Firebase Console.
- **Đăng nhập `/admin` nhưng báo *"là tài khoản User thông thường"***: Kiểm tra lại biến `ADMIN_EMAIL` trên Vercel đã trùng khớp email Google bạn dùng chưa, và kiểm tra email trong `firestore.rules` đã đúng chưa rồi **Redeploy** Vercel.
- **Bị tạo nhiều thư mục `DriveCDN` trên Drive**: Hãy cấu hình `DRIVE_BRIDGE_URL` (hoặc gán cố định `DRIVE_FOLDER_ID` bằng ID của 1 thư mục `DriveCDN` duy nhất) và xóa các thư mục `DriveCDN` rỗng cũ trên Google Drive.
- **`DRIVE_BRIDGE_URL` báo lỗi trả về HTML**: Khi Deploy Google Apps Script Web App, mục *Who has access* phải chọn **Anyone (Bất kỳ ai)**, không chọn *Only myself*.
