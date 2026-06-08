/****************************************************************
 * 서울 브레멘 - 구글 시트 + 드라이브 백엔드 (Google Apps Script)
 * ---------------------------------------------------------------
 * 이 코드를 구글 시트에 붙여 "웹앱"으로 배포하면,
 *  - 합주/연습곡/멤버: 구글 시트에서 읽고, 사이트에서 추가·수정·삭제
 *  - 사진: 공유 드라이브 "폴더 하나"에 올린 사진들을 사이트에 자동 표시
 *          (사이트의 "사진 올리기" 버튼으로 누구나 폴더에 업로드 가능)
 *
 * [설치 방법]
 *  1) 데이터를 담을 구글 시트를 엽니다. (탭: rehearsals / songs / members)
 *     ※ photos 탭은 폴더 방식을 쓰면 필요 없습니다.
 *  2) 구글 드라이브에 사진 보관용 "폴더"를 하나 만듭니다.
 *     - 폴더를 "공유 → 링크가 있는 모든 사용자 - 뷰어"로 설정하세요.
 *     - 폴더 주소  https://drive.google.com/drive/folders/<여기가_폴더ID>
 *       에서 폴더 ID를 복사해 아래 PHOTOS_FOLDER_ID 에 붙여넣습니다.
 *  3) 시트 메뉴 [확장 프로그램] → [Apps Script] 를 열고,
 *     기존 코드를 지운 뒤 이 파일 전체를 붙여넣습니다.
 *  4) 아래 EDIT_KEY 와 PHOTOS_FOLDER_ID 를 채웁니다.
 *  5) [배포] → [새 배포] → 유형 "웹 앱"
 *       - 실행 계정: 나
 *       - 액세스 권한: "모든 사용자"
 *     배포 후 나오는 웹앱 URL(.../exec)을 config.js 의 SCRIPT_URL 에 넣습니다.
 *  ※ 코드 수정 시 [배포]→[배포 관리]→편집→새 버전으로 다시 배포하세요.
 ****************************************************************/

// 편집 비밀번호(관리자) — 반드시 바꾸고, config.js 의 EDIT_KEY 와 동일하게!
var EDIT_KEY = "change-me";

// 사진 업로드 비밀번호 — config.js 의 UPLOAD_KEY 와 동일하게!
var UPLOAD_KEY = "bremen0101";

// 사진을 보관할 공유 드라이브 "폴더" ID (없으면 photos 탭/데모로 동작)
var PHOTOS_FOLDER_ID = "";

// 시트 탭 이름 (사진은 폴더에서 가져오므로 photos 탭은 선택)
var TABS = ["rehearsals", "songs", "members"];

// ----- 읽기: GET 요청 시 모든 데이터를 JSON으로 반환 -----
function doGet(e) {
  var out = {};
  TABS.forEach(function (name) {
    out[name] = readSheet(name);
  });
  // 사진: 폴더가 설정돼 있으면 폴더에서, 아니면 photos 탭에서
  out.photos = PHOTOS_FOLDER_ID ? listPhotos() : readSheet("photos");
  return json(out);
}

// ----- 쓰기: POST 요청 -----
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: "잘못된 요청 형식" });
  }

  try {
    // 사진 업로드 — 업로드 비밀번호(또는 관리자 비밀번호) 필요
    if (data.action === "uploadPhoto") {
      if (data.key !== UPLOAD_KEY && data.key !== EDIT_KEY) {
        return json({ ok: false, error: "업로드 비밀번호가 올바르지 않습니다." });
      }
      return uploadPhoto(data);
    }
    // 사진 삭제는 관리자만
    if (data.action === "deletePhoto") {
      if (data.key !== EDIT_KEY) return json({ ok: false, error: "비밀번호가 올바르지 않습니다." });
      DriveApp.getFileById(data.id).setTrashed(true);
      return json({ ok: true });
    }

    // 시트 편집 (add / update / delete) — 관리자만
    if (data.key !== EDIT_KEY) return json({ ok: false, error: "비밀번호가 올바르지 않습니다." });
    if (TABS.indexOf(data.tab) === -1) return json({ ok: false, error: "알 수 없는 탭: " + data.tab });

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(data.tab);
    if (!sheet) return json({ ok: false, error: "탭이 없습니다: " + data.tab });
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h).trim().toLowerCase(); });

    if (data.action === "add") {
      sheet.appendRow(headers.map(function (h) {
        return data.values[h] != null ? data.values[h] : "";
      }));
      return json({ ok: true });
    }
    if (data.action === "update") {
      var rowNum = Number(data.row);
      if (!rowNum || rowNum < 2) return json({ ok: false, error: "행 번호 오류" });
      headers.forEach(function (h, i) {
        if (data.values[h] != null) sheet.getRange(rowNum, i + 1).setValue(data.values[h]);
      });
      return json({ ok: true });
    }
    if (data.action === "delete") {
      var rNum = Number(data.row);
      if (!rNum || rNum < 2) return json({ ok: false, error: "행 번호 오류" });
      sheet.deleteRow(rNum);
      return json({ ok: true });
    }
    return json({ ok: false, error: "알 수 없는 동작: " + data.action });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// ----- 드라이브 폴더의 사진 목록 -----
function listPhotos() {
  if (!PHOTOS_FOLDER_ID) return [];
  var folder = DriveApp.getFolderById(PHOTOS_FOLDER_ID);
  var files = folder.getFiles();
  var arr = [];
  while (files.hasNext()) {
    var f = files.next();
    if (String(f.getMimeType()).indexOf("image/") !== 0) continue;
    arr.push({
      id: f.getId(),
      link: "https://drive.google.com/file/d/" + f.getId() + "/view",
      caption: f.getName().replace(/\.[^.]+$/, ""),
      date: Utilities.formatDate(f.getDateCreated(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
      _ts: f.getDateCreated().getTime(),
    });
  }
  arr.sort(function (a, b) { return b._ts - a._ts; }); // 최신순
  return arr;
}

// ----- 사진 업로드 (base64 → 폴더에 저장) -----
function uploadPhoto(data) {
  if (!PHOTOS_FOLDER_ID) return json({ ok: false, error: "PHOTOS_FOLDER_ID 가 설정되지 않았습니다." });
  if (!data.fileData) return json({ ok: false, error: "파일 데이터가 없습니다." });
  var folder = DriveApp.getFolderById(PHOTOS_FOLDER_ID);
  var mime = data.mimeType || "image/jpeg";
  var ext = mime.indexOf("png") > -1 ? ".png" : ".jpg";
  var base = (data.caption || "photo").replace(/[\\/:*?"<>|]/g, " ").trim() || "photo";
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
  var name = base + " (" + stamp + ")" + ext;
  var bytes = Utilities.base64Decode(data.fileData);
  var file = folder.createFile(Utilities.newBlob(bytes, mime, name));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return json({ ok: true, id: file.getId() });
}

// 시트를 [{헤더:값, _row: 시트행번호}, ...] 로 읽기
function readSheet(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = { _row: r + 1 };
    var hasData = false;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      var v = values[r][c];
      if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
      obj[headers[c]] = v;
      if (v !== "" && v != null) hasData = true;
    }
    if (hasData) rows.push(obj);
  }
  return rows;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
