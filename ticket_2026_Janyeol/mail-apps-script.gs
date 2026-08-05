// ===================================================================
//  잔열 티켓 — 입금확인 시 "입장 티켓 이메일" 발송 웹훅 (Google Apps Script)
// -------------------------------------------------------------------
//  배포 방법
//  1) https://script.google.com → 새 프로젝트 → 이 코드 전체 붙여넣기
//  2) 아래 ADMIN_KEY 를 "관리자 비밀번호"와 똑같이 맞추기
//     (관리자 페이지에서 비밀번호를 바꿨다면 그 값으로)
//  3) 배포 → 새 배포 → 유형 "웹 앱"
//     - 실행: 나(내 계정)
//     - 액세스 권한: 모든 사용자
//     - 배포 → 권한 허용(Gmail 발송 권한) → /exec 로 끝나는 웹앱 URL 복사
//  4) 그 URL 을 관리자 페이지 상단 "이메일 알림 설정"에 붙여넣기(또는 tk_config.mail_webhook)
//
//  * 발송량: 개인 Gmail 하루 약 100통, Workspace 계정은 약 1,500통.
//  * 발신자: 이 스크립트를 만든 구글 계정의 이메일로 나갑니다.
// ===================================================================

var ADMIN_KEY = 'janyeol-admin-2026'; // ← 관리자 비밀번호와 동일하게
var CONTACT   = '010-2598-2629';      // 문의 번호(이메일 하단 표기)

function doPost(e) {
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (p.key !== ADMIN_KEY) return _json({ ok: false, error: 'unauthorized' });
    if (!p.to) return _json({ ok: false, error: 'no_recipient' });

    var name = p.name || '고객';
    var qty  = (p.quantity || 1) + '인';
    var won  = Number(p.amount || 0).toLocaleString('ko-KR') + '원';
    var url  = p.url || 'https://minhjih.github.io/ticket_2026_Janyeol/';
    var code = String(p.code || '');
    var qr   = 'https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=' + encodeURIComponent(code);

    var html =
      '<div style="margin:0;padding:24px 12px;background:#0f0806;font-family:Apple SD Gothic Neo,Malgun Gothic,sans-serif;">' +
      '<div style="max-width:480px;margin:0 auto;background:#160c09;border:1px solid #3a221a;border-radius:16px;overflow:hidden;color:#f4ebe4;">' +
        '<div style="background:linear-gradient(180deg,#ff7132,#e2360d);padding:22px 20px;text-align:center;">' +
          '<div style="font-size:13px;letter-spacing:4px;color:#2a0d06;font-weight:800;">JANYEOL · LIVE</div>' +
          '<div style="font-size:26px;font-weight:900;color:#fff;margin-top:4px;">입장 티켓 발급 완료 🎫</div>' +
        '</div>' +
        '<div style="padding:22px 20px;">' +
          '<p style="font-size:15px;margin:0 0 14px;"><b>' + _esc(name) + '</b>님, 입금이 확인되어 <b>입장 티켓(QR)</b>이 발급되었습니다.</p>' +
          '<div style="text-align:center;background:#fff;border-radius:14px;padding:16px;margin:8px 0 14px;">' +
            '<img src="' + qr + '" alt="입장 QR" width="240" height="240" style="display:block;margin:0 auto;width:240px;height:240px;"/>' +
            '<div style="font-family:monospace;font-size:11px;color:#555;margin-top:8px;word-break:break-all;">CODE: ' + _esc(code) + '</div>' +
          '</div>' +
          '<table style="width:100%;font-size:14px;border-collapse:collapse;">' +
            _row('공연', '잔열 · 8.29 (금) 5:30PM') +
            _row('장소', '001 라이브홀 (서울 마포구 월드컵로 140 지하1층)') +
            _row('예매자', _esc(name)) +
            _row('수량 / 금액', qty + ' · ' + won) +
          '</table>' +
          '<a href="' + url + '" style="display:block;text-align:center;margin:18px 0 6px;padding:14px;background:#ff5a1e;color:#fff;font-weight:800;text-decoration:none;border-radius:12px;">웹에서 내 티켓 열기 →</a>' +
          '<p style="font-size:12.5px;color:#c49a8e;line-height:1.7;margin:12px 0 0;">입장 시 이 QR(또는 웹의 티켓 QR)을 확인자에게 보여주세요. 확인되면 QR은 자동으로 만료됩니다. 화면 밝기를 최대로 해주세요.</p>' +
        '</div>' +
        '<div style="padding:14px 20px;border-top:1px solid #3a221a;font-size:11.5px;color:#8a655c;text-align:center;">잔열 · 001 라이브홀 · 문의 ' + _esc(CONTACT) + '</div>' +
      '</div></div>';

    MailApp.sendEmail({
      to: p.to,
      subject: '[잔열] 입장 티켓이 발급되었어요 🎫',
      htmlBody: html,
      name: '잔열 티켓',
    });
    return _json({ ok: true });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _row(k, v) {
  return '<tr>' +
    '<td style="padding:7px 0;color:#b08a7d;width:96px;border-bottom:1px solid #2a1a14;">' + k + '</td>' +
    '<td style="padding:7px 0;font-weight:700;border-bottom:1px solid #2a1a14;">' + v + '</td></tr>';
}
function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function _json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
