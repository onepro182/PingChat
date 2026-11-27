@echo off
chcp 65001 >nul
set "TARGET=%~dp0start-hidden.vbs"
set "WD=%~dp0"
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PingChat WhatsApp.lnk"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath='wscript.exe'; $s.Arguments='\"' + $env:TARGET + '\" silent'; $s.WorkingDirectory=$env:WD; $s.Save()"
if exist "%LNK%" (
  echo Demarrage automatique ACTIVE : le pont se lancera a l'ouverture de ta session Windows, sans fenetre.
  echo Pour l'enlever : remove-autostart.bat
) else (
  echo Echec : le raccourci n'a pas pu etre cree.
)
pause
