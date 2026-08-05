# 잔열 Apple Wallet 발급 API

기존 사이트는 GitHub Pages에 그대로 두고, 이 폴더만 별도 Vercel 프로젝트로 배포합니다.
Supabase 관리자 권한이나 서비스 역할 키는 사용하지 않습니다. 사용자의 로그인 JWT와 기존 RLS로
본인 주문인지 확인한 뒤, 60초 동안만 유효한 암호화 다운로드 링크를 발급합니다.

## 준비물

- Apple Developer Program 계정
- Pass Type ID와 해당 Pass Type ID 인증서
- 인증서와 함께 생성된 개인키
- Apple WWDR 중간 인증서
- Apple이 제공하는 한국어 `Apple 지갑에 추가` SVG 배지

Pass Type ID와 인증서 생성은 [Apple 공식 가이드](https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates/)를 따릅니다.
배지는 [Apple 지갑 배지 가이드](https://developer.apple.com/kr/wallet/add-to-apple-wallet-guidelines/)에서 약관에 동의한 뒤 내려받아야 합니다.

현재 운영 배포는 Pass Type ID `pass.io.github.minhjih.janyeol2026`, Team ID `AN9C542482`를 사용합니다.
Pass Type ID 인증서 `6R3TW44947`의 만료일은 `2027-09-04`입니다.
`2026-08-05`에 실제 iPhone에서 서명된 패스 설치를 확인했습니다.
패스 배경은 기존 공연 포스터에서 텍스트가 없는 영역을 사용하며, `background.png`,
`background@2x.png`, `background@3x.png`를 각각 `180x220`, `360x440`, `540x660`으로 유지합니다.

## 인증서 변환

키체인에서 Pass Type ID 인증서와 개인키를 하나의 `pass.p12`로 내보낸 뒤 PEM으로 변환합니다.

```bash
openssl pkcs12 -in pass.p12 -clcerts -nokeys -out signer-cert.pem
openssl pkcs12 -in pass.p12 -nocerts -out signer-key.pem
```

개인키 암호는 `APPLE_SIGNER_KEY_PASSPHRASE`에 넣습니다. 인증서, 개인키, `.p12`, 로컬 환경변수 파일은 절대 Git에 커밋하지 않습니다.

## Vercel 배포

```bash
cd wallet-api
npm install
vercel login
vercel link
```

`.env.example`의 항목을 Vercel Production 환경변수로 등록합니다. `SUPABASE_URL`과
`SUPABASE_ANON_KEY`는 관객 페이지 `config.js`에 이미 공개된 값을 그대로 사용합니다.

파일형 인증서는 줄바꿈 없는 Base64로 등록합니다.

```bash
base64 -i signer-cert.pem | tr -d '\n' | vercel env add APPLE_SIGNER_CERT_BASE64 production
base64 -i signer-key.pem | tr -d '\n' | vercel env add APPLE_SIGNER_KEY_BASE64 production
base64 -i AppleWWDR.cer | tr -d '\n' | vercel env add APPLE_WWDR_CERT_BASE64 production
openssl rand -base64 48 | tr -d '\n' | vercel env add WALLET_DOWNLOAD_SECRET production
```

환경변수를 모두 등록한 다음 배포합니다.

```bash
vercel --prod
```

## 관객 페이지 연결

1. Apple에서 받은 한국어 SVG 배지를 `ticket_2026_Janyeol/img/add-to-apple-wallet-ko.svg`로 둡니다.
2. `ticket_2026_Janyeol/config.js`의 `APPLE_WALLET.endpoint`에 배포된 `/api/janyeol-wallet` URL을 넣습니다.
3. 실제 iPhone에서 패스 설치와 QR 스캔을 확인한 뒤 `APPLE_WALLET.enabled`를 `true`로 바꿉니다.

`WALLET_EVENT_RELEVANT_ISO`와 `WALLET_EVENT_EXPIRATION_ISO`는 ISO 8601 형식으로 설정합니다.
현재 페이지 기준 공연 일시는 `2026-08-29 (토) 17:30 KST`이며, 운영 시간이 최종 확정되면 관련 시각과 만료 시각을 함께 등록합니다.
