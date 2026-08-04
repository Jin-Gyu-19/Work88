@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   AI 활용 사례 공유 - 로컬 테스트 실행
echo ============================================
echo.
echo [1/4] 최신 코드 업데이트 중...
git pull

echo.
echo [2/4] 패키지 확인 중...
call npm install --no-audit --no-fund

echo.
echo [3/4] 로컬 설정 확인 중...
if not exist .dev.vars (
  echo DEV_MODE=1> .dev.vars
  echo SESSION_SECRET=dev-secret>> .dev.vars
)
call npm run db:init:local >nul

echo.
echo [4/4] 서버 시작! 잠시 후 브라우저가 자동으로 열립니다.
echo       종료하려면 이 창에서 Ctrl+C 를 누르세요.
echo.
echo   관리자 로그인 주소:
echo   http://localhost:8787/auth/dev?email=kimdlaek@gmail.com^&name=김진규^&dept=BDO
echo.
start "" /b cmd /c "timeout /t 8 >nul && start http://localhost:8787"
call npm run dev
