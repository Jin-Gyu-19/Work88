@echo off
REM SupportDeck - run from source without building
cd /d "%~dp0"
for /f "tokens=*" %%i in ('where python') do set PYTHON=%%i
if not defined PYTHON (
    echo Python not found! Please install Python first.
    pause
    exit /b 1
)
echo Starting SupportDeck...
"%PYTHON%" main_qtweb.py
if errorlevel 1 pause
