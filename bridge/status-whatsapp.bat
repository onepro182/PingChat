@echo off
chcp 65001 >nul
echo Verification du pont PingChat...
powershell -NoProfile -Command "try { $s = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 http://localhost:3000/api/state).Content | ConvertFrom-Json; switch ($s.status) { 'open' { 'EN MARCHE : WhatsApp est connecte.' } 'qr' { 'EN MARCHE : en attente du scan QR. Ouvre http://localhost:3000/' } 'reconnecting' { 'EN MARCHE : reconnexion en cours...' } default { 'EN MARCHE : etat = ' + $s.status } } } catch { 'ARRETE : le pont ne tourne pas. Lance start-hidden.vbs' }"
echo.
echo Derniers messages du journal :
if exist "%~dp0data\bridge.log" (powershell -NoProfile -Command "Get-Content -Tail 8 '%~dp0data\bridge.log'") else (echo ^(pas de journal^))
echo.
pause
