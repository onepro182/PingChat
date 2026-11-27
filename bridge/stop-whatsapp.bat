@echo off
chcp 65001 >nul
echo Arret du pont PingChat / WhatsApp...
set found=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:"127.0.0.1:3000 .*LISTENING"') do (
  taskkill /F /PID %%a >nul 2>nul
  set found=1
)
if "%found%"=="1" (echo Arrete. WhatsApp reste lie : relance start-hidden.vbs pour redemarrer sans rescanner.) else (echo Le pont ne tournait pas.)
pause
