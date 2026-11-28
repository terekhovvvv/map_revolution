@echo off
chcp 65001 >nul
title УТС БЕРЕСТА
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [ОШИБКА] Node.js не найден!
  echo   Установите Node.js с https://nodejs.org и запустите снова.
  echo.
  pause
  exit /b 1
)

echo.
echo   ======================================================
echo    УТС БЕРЕСТА - Учебная топографическая система
echo   ======================================================
echo.
echo   Адрес:      http://localhost:7100/
echo   Остановка:  закройте это окно или нажмите Ctrl+C
echo.

rem Браузер открываем с задержкой 2 сек, чтобы сервер успел подняться
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:7100/"

node server.js
pause
