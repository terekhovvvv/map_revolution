@echo off
chcp 65001 >nul
title БЕРЕСТА
cd /d "%~dp0"

rem Берём портативный Node.js из папки runtime, если его нет — системный
set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" (
  where node >nul 2>&1
  if errorlevel 1 (
    echo.
    echo   [ОШИБКА] Node.js не найден ни в папке runtime, ни в системе!
    echo.
    pause
    exit /b 1
  )
  set "NODE=node"
)

echo.
echo   ======================================================
echo    БЕРЕСТА - Учебная топографическая система
echo   ======================================================
echo.
echo   Адрес:      http://localhost:7100/
echo   Остановка:  закройте это окно или нажмите Ctrl+C
echo.

rem Браузер открываем с задержкой 2 сек, чтобы сервер успел подняться
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:7100/"

"%NODE%" server.js
pause
