@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Installe la version LTS depuis https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installation des modules ^(une seule fois, 1 a 2 minutes^)...
  call npm install
)
start "" http://localhost:3000/
node server.mjs
pause
