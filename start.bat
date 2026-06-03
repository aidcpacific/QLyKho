@echo off
REM Hien thi tieng Viet dung (UTF-8)
chcp 65001 >nul
REM Chuyen ve dung thu muc chua file nay
cd /d "%~dp0"
REM Tu them Node.js vao PATH (Node cai o C:\Program Files\nodejs nhung chua co trong PATH)
set "PATH=C:\Program Files\nodejs;%PATH%"

echo ============================================
echo   Khoi dong he thong Quan Ly Kho
echo   Mo trinh duyet: https://quanlykhohang.vercel.app
echo   Nhan Ctrl+C de dung
echo ============================================

REM Neu cong 3000 dang bi chiem -> bao va dong cac tien trinh node cu
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel%==0 (
  echo.
  echo [!] Cong 3000 dang bi chiem - dang dong tien trinh node cu...
  taskkill /F /IM node.exe >nul 2>&1
  timeout /t 1 >nul
)

REM Cai dependencies neu chua co
if not exist "node_modules" (
  echo Dang cai dat thu vien lan dau, vui long doi...
  call npm install
)

node server.js
echo.
echo === Server da dung. Nhan phim bat ky de dong cua so. ===
pause
