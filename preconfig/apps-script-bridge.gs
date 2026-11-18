/**
 * DriveCDN 24/7 Google Drive Bridge (Google Apps Script)
 *
 * Huong dan cai dat nhanh:
 * 1. Mo https://script.google.com bang tai khoan Google Drive dung de host file.
 * 2. Tao du an moi (New project), xoa code mac dinh va dan toan bo file nay vao.
 * 3. (Tuy chon bao mat) Vao Project Settings -> Script Properties:
 *    - BRIDGE_SECRET    : chuoi bi mat bat ky (khop voi bien DRIVE_BRIDGE_SECRET tren Vercel/.env)
 *    - PINNED_FOLDER_ID : ID thu muc DriveCDN co dinh (khop voi DRIVE_FOLDER_ID neu co)
 * 4. Nhan Deploy -> New deployment -> Web app:
 *    - Execute as     : Me (Toi)
 *    - Who has access : Anyone (Bat ky ai)
 * 5. Cap quyen truy cap Google Drive va sao chep URL ket thuc bang `/exec`
 *    de dan vao bien moi truong `DRIVE_BRIDGE_URL`.
 */
function doGet(e) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('BRIDGE_SECRET') || '';
  if (secret && (!e || !e.parameter || e.parameter.secret !== secret)) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var requestedFolderId = (e && e.parameter && e.parameter.folderId) ? String(e.parameter.folderId).trim() : '';
  var savedFolderId = requestedFolderId || props.getProperty('PINNED_FOLDER_ID') || '';
  var root = null;

  if (savedFolderId) {
    try {
      var candidate = DriveApp.getFolderById(savedFolderId);
      if (candidate && !candidate.isTrashed()) {
        root = candidate;
      }
    } catch (err) {}
  }

  if (!root) {
    var rootIter = DriveApp.getFoldersByName('DriveCDN');
    root = rootIter.hasNext() ? rootIter.next() : DriveApp.createFolder('DriveCDN');
    props.setProperty('PINNED_FOLDER_ID', root.getId());
  }

  var buckets = [{ id: root.getId(), name: 'DriveCDN' }];
  var subIter = root.getFolders();
  while (subIter.hasNext()) {
    var f = subIter.next();
    buckets.push({ id: f.getId(), name: f.getName() });
  }

  return ContentService.createTextOutput(JSON.stringify({
    accessToken: ScriptApp.getOAuthToken(),
    expiresIn: 2700,
    ownerEmail: Session.getEffectiveUser().getEmail() || '',
    rootFolderId: root.getId(),
    buckets: buckets,
    storageQuota: {
      limit: DriveApp.getStorageLimit(),
      usage: DriveApp.getStorageUsed(),
      usageInDrive: DriveApp.getStorageUsed(),
      usageInDriveTrash: 0
    }
  })).setMimeType(ContentService.MimeType.JSON);
}
