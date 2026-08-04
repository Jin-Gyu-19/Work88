# AI 활용 사례 공유 (ai-usecase-hub)

법인 내 AI 활용 사례(AI 사용, 앱 개발 등)를 수집하는 사내 웹앱입니다.
관리자가 캠페인을 만들어 링크를 공지하면, 구성원이 Microsoft 계정으로 로그인해
사례를 제출합니다. 전체가 Cloudflare(Workers + D1 + R2) 위에서 동작합니다.

## 주요 기능

- **Microsoft Entra ID(SSO) 로그인** — 이름·부서가 자동으로 입력됩니다.
- **사례 제출** — 제목 / 내용 / 첨부(선택) / 앱 URL·앱 파일(선택)
- **첨부 3종** — 🖥️ 화면 캡쳐(+ Ctrl+V 붙여넣기), 🎥 동영상 촬영(카메라·화면 녹화, 최대 1분), 📎 파일 업로드
- **관리자 페이지** — 캠페인 생성/링크 복사/마감, 제출 현황 조회, 사용자 권한 관리
- **엑셀 다운로드** — 첨부파일이 클릭 가능한 하이퍼링크로 연동된 xlsx
- **전체 ZIP 다운로드** — 첨부 원본 + 상대경로 링크가 걸린 엑셀 (오프라인 보관용)

용량 제한: 이미지 10MB · 동영상 80MB(1분) · 앱 파일 50MB · 기타 25MB, 제출당 최대 10개

## 배포 순서

### 1. Azure에서 앱 등록 (MS SSO)

1. [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID → 앱 등록 → 새 등록**
2. 이름: `AI 활용 사례 공유`, 지원 계정 유형: **이 조직 디렉터리의 계정만**
3. 리디렉션 URI(웹): `https://<워커이름>.<계정>.workers.dev/auth/callback`
   (커스텀 도메인을 쓰면 그 도메인으로)
4. 등록 후 **개요**에서 `애플리케이션(클라이언트) ID`, `디렉터리(테넌트) ID` 복사
5. **인증서 및 암호 → 새 클라이언트 암호** 생성 후 값 복사
6. **API 사용 권한**에 `Microsoft Graph → User.Read`(위임)가 있는지 확인 (기본 포함)

> 부서 자동 입력은 Entra ID 사용자 프로필의 `department` 필드를 읽습니다.
> 프로필에 부서가 비어 있으면 빈 값으로 들어옵니다.

### 2. Cloudflare 리소스 생성

```bash
npm install
npx wrangler login

# D1 데이터베이스
npx wrangler d1 create ai-usecase-hub
# → 출력된 database_id를 wrangler.jsonc 의 REPLACE_WITH_YOUR_D1_DATABASE_ID 자리에 붙여넣기

# 테이블 생성
npm run db:init

# R2 버킷
npx wrangler r2 bucket create ai-usecase-files
```

### 3. 시크릿 등록

```bash
npx wrangler secret put MS_TENANT_ID      # Azure 테넌트 ID
npx wrangler secret put MS_CLIENT_ID      # Azure 클라이언트 ID
npx wrangler secret put MS_CLIENT_SECRET  # Azure 클라이언트 암호
npx wrangler secret put SESSION_SECRET    # 아무 긴 랜덤 문자열 (예: openssl rand -hex 32)
```

`wrangler.jsonc`의 `ADMIN_EMAILS`를 본인 MS 로그인 계정 이메일로 수정하세요.
(쉼표로 여러 명 지정 가능. 여기 지정된 계정은 항상 관리자입니다.)

### 4. 배포

```bash
npm run deploy
```

배포 후 `https://<워커이름>.<계정>.workers.dev/admin` 에 접속해 첫 캠페인을 만들고
**링크 복사** 버튼으로 참여 링크를 공지하면 됩니다.

## 로컬 개발 (MS SSO 없이 테스트)

`.dev.vars` 파일을 만들고:

```
DEV_MODE=1
SESSION_SECRET=dev-secret
```

```bash
npm run db:init:local
npm run dev
```

`http://localhost:8787` 접속 → 로그인 버튼을 누르면 `/auth/dev` 테스트 계정으로 로그인됩니다.
관리자 테스트: `http://localhost:8787/auth/dev?email=kimdlaek@gmail.com&name=관리자&dept=경영지원`
(ADMIN_EMAILS에 있는 이메일이면 관리자 권한)

## 구조

```
src/index.js   Worker 본체 (Hono 라우팅: 인증/제출/관리자/파일/내보내기)
src/auth.js    세션 쿠키 서명·검증 (HMAC)
src/excel.js   xlsx 생성 (첨부 하이퍼링크 포함)
schema.sql     D1 테이블 정의
public/        정적 페이지 (랜딩 / 제출 / 관리자)
```
