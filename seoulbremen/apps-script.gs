/****************************************************************
 * 서울 브레멘 - 구글 시트 백엔드 (Google Apps Script)
 * ---------------------------------------------------------------
 * 이 코드를 구글 시트에 붙여서 "웹앱"으로 배포하면,
 * 사이트에서 합주/연습곡/사진을 추가·수정·삭제할 때
 * 구글 시트에 그대로 반영됩니다.
 *
 * [설치 방법]
 *  1) 데이터를 담을 구글 시트를 엽니다.
 *  2) 탭(시트)을 4개 만들고 이름을 정확히 맞춥니다:
 *       rehearsals / songs / photos / members
 *     각 탭의 1번째 줄(머리글)을 SETUP.md 의 형식대로 입력합니다.
 *  3) 시트 메뉴 [확장 프로그램] → [Apps Script] 를 엽니다.
 *  4) 기존 코드를 지우고 이 파일 전체를 붙여넣습니다.
 *  5) 아래 EDIT_KEY 를 원하는 비밀번호로 바꿉니다.
 *     (사이트 config.js 의 EDIT_KEY 와 똑같이 맞추세요!)
 *  6) 우측 상단 [배포] → [새 배포] → 유형: "웹 앱"
 *       - 실행 계정: 나
 *       - 액세스 권한: "모든 사용자"
 *     배포하면 나오는 웹앱 URL(.../exec)을 복사해
 *     config.js 의 SCRIPT_URL 에 붙여넣습니다.
 *  ※ 코드를 수정하면 [배포] → [배포 관리] → 편집 → 새 버전으로 다시 배포하세요.
 ****************************************************************/

// 편집 비밀번호 — 반드시 바꾸고, config.js 의 EDIT_KEY 와 동일하게!
var EDIT_KEY = "change-me";

var TABS = ["rehearsals", "songs", "photos", "members"];

// ----- 읽기: GET 요청 시 모든 탭의 데이터를 JSON으로 반환 -----
function doGet(e) {
  var out = {};
  TABS.forEach(function (name) {
    out[name] = readSheet(name);
  });
  return json(out);
}

// ----- 쓰기: POST 요청 (add / update / delete) -----
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: "잘못된 요청 형식" });
  }

  if (data.key !== EDIT_KEY) {
    return json({ ok: false, error: "비밀번호가 올바르지 않습니다." });
  }
  if (TABS.indexOf(data.tab) === -1) {
    return json({ ok: false, error: "알 수 없는 탭: " + data.tab });
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(data.tab);
  if (!sheet) return json({ ok: false, error: "탭이 없습니다: " + data.tab });

  var headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(function (h) {
      return String(h).trim().toLowerCase();
    });

  try {
    if (data.action === "add") {
      var row = headers.map(function (h) {
        return data.values[h] != null ? data.values[h] : "";
      });
      sheet.appendRow(row);
      return json({ ok: true });
    }

    if (data.action === "update") {
      var rowNum = Number(data.row); // 1-based 시트 행 번호
      if (!rowNum || rowNum < 2) return json({ ok: false, error: "행 번호 오류" });
      headers.forEach(function (h, i) {
        if (data.values[h] != null) {
          sheet.getRange(rowNum, i + 1).setValue(data.values[h]);
        }
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

// 시트를 [{헤더:값, _row: 시트행번호}, ...] 로 읽기
function readSheet(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (h) {
    return String(h).trim().toLowerCase();
  });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = { _row: r + 1 }; // 시트의 실제 행 번호(1-based)
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
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
