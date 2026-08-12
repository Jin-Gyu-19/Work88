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

## 배포 전 최종 점검 (필수)

아래 두 가지는 **코드가 자동으로 강제**하지만, 배포 전에 직접 확인해 두면 좋습니다.

### 1. SESSION_SECRET — 반드시 긴 무작위 값

```bash
openssl rand -hex 32                      # 64자 무작위 값 생성
npx wrangler secret put SESSION_SECRET    # 생성된 값 붙여넣기
```

이 키로 로그인 세션에 서명합니다. 키가 짧거나 예시값 그대로면 **다른 사람의 세션을
위조할 수 있으므로**, 서버가 실제 도메인에서 32자 미만·미등록·예시값을 감지하면
모든 요청을 500으로 막고 조치 방법을 안내합니다. (localhost 개발은 예외)

### 2. DEV_MODE — 운영에서는 "0"

`wrangler.jsonc`의 `vars.DEV_MODE`가 `"0"`인지 확인하세요. 로컬 개발용 값은
git에 올라가지 않는 `.dev.vars`에 따로 둡니다.

실수로 `"1"`인 채 배포하더라도, 테스트 로그인(`/auth/dev`)은 **localhost 접속일 때만**
열리도록 이중으로 막혀 있어 실제 도메인에서는 404가 됩니다.

### 3. Azure 리디렉션 URI

앱 등록의 리디렉션 URI가 실제 배포 도메인과 정확히 일치해야 합니다.
`https://<도메인>/auth/callback`


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

## 회사 로고 넣기

`public/logo.png` 위치에 로고 이미지를 저장하면 상단바에 자동으로 표시됩니다.
(파일이 없으면 텍스트 로고 "BDO Survey System"이 표시됩니다.)

1. https://www.bdo.kr 접속 → 좌측 상단 로고에서 마우스 오른쪽 클릭 → **이미지를 다른 이름으로 저장**
2. 파일명을 `logo.png` 로 저장 (배경이 투명한 PNG 권장)
3. 프로젝트 폴더의 `public` 폴더 안에 넣기
4. `start.bat` 실행 후 브라우저에서 Ctrl+F5

높이 26px에 맞춰 자동 축소되므로 원본이 커도 괜찮습니다.
