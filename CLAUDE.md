# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

SupportDeck — Windows용 플로팅 런처 위젯 앱. PyQt6 + QWebEngineView 하이브리드 구조로, UI는 HTML/CSS/JS(widget.html), 로직은 Python이 담당한다. 주석·문서·응답은 한국어로 작성한다.

## 명령어

- 실행(개발): `py main_qtweb.py` — Windows 전용 (PyQt6, 트레이, 프레임리스)
- 빌드: `build.bat` → `build.py`가 3단계 실행: `create_icon.py` → PyInstaller(`SupportDeck.spec`) → Inno Setup(`setup.iss`)
- 버전 변경: `py bump_version.py major|minor|patch` (또는 버전 직접 지정)
  - `version.txt`, `setup.iss`, `main_qtweb.py`의 `APP_VERSION`, `download_page/latest.json`을 일괄 갱신하므로 **버전은 절대 개별 파일에서 직접 수정하지 말 것**

참고: `widget.html`, `SupportDeck.spec`, `setup.iss`, `version.txt`는 아직 저장소에 커밋되지 않았다 — 로컬 개발 환경에만 존재하니 없다고 새로 만들지 말고 사용자에게 확인할 것.

## 아키텍처

- `main_qtweb.py` — 진입점이자 몸통 (~1,900줄)
  - `SupportDeckWindow`: 프레임리스 메인 창. `resource_path()`로 정적 리소스 탐색(PyInstaller `_MEIPASS` 대응)
  - `Bridge(QObject)`: **Python ↔ JS 통신의 핵심.** QWebChannel로 widget.html의 JS와 연결되며, UI에서 일어나는 모든 동작이 Bridge의 슬롯을 통해 Python으로 들어온다
  - `UpdateChecker`: R2의 `latest.json`으로 업데이트 확인. `UPDATE_MANIFEST_URL`은 **보안상 의도적으로 코드에 고정** — config로 옮기면 가짜 업데이트 서버 유도 공격이 가능해지므로 절대 config로 빼지 말 것
  - lazy import 패턴: WebEngine·actions 모듈은 시작 속도를 위해 지연 로드한다. 새 의존성 추가 시 이 패턴을 유지할 것
- `actions.py` — 버튼 실행 디스패처. 버튼 dict의 `action_type`(url/folder/cmd/app/copy/show_desktop/shortcut/timer/counter)별 분기. 새 액션 타입은 여기에 추가
- `config.py` — 설정 저장/로드. 개발 시 스크립트 폴더, exe 빌드 시 `%APPDATA%\SupportDeck`의 `config.json` 사용. 파일 경로 생성 시 ID sanitize 등 기존 방어 로직을 따를 것
- `button_editor.py` / `image_editor.py` — 버튼·이미지 편집 다이얼로그 (PyQt6 위젯). 스타일은 `design_tokens.py`의 토큰 함수를 재사용
- `download_page/` — Cloudflare Pages 배포용 다운로드 페이지 + 업데이트 매니페스트(`latest.json`)

## 코딩 규칙

1. **BAT/스크립트 생성 시 한글 인코딩 주의** — BAT 파일에는 UTF-8 선언(`chcp 65001`)을 포함하거나 CP949로 저장. 한글 출력이 깨지면 인코딩부터 확인
2. **효율적인 코드 작성** — 중복 구현 금지. 기존 함수(`resource_path`, `design_tokens`, config 헬퍼)와 lazy import 패턴을 재사용
3. **하드코딩 금지** — 경로·URL·설정값은 `config.py`/`config.json`으로. 예외: `UPDATE_MANIFEST_URL`(위 보안 사유로 코드 고정 유지)
4. **보안 측면 고려** — 외부 입력값(버튼 설정, import된 config)은 항상 검증. `config.json`·`favorites.json`은 회사 내부 URL이 포함된 개인 데이터이므로 **절대 커밋 금지** (.gitignore 유지)
