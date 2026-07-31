@echo off
cd /d "%~dp0"
for /f "tokens=*" %%i in ('where python') do set PYTHON=%%i
"%PYTHON%" build.py
pause
