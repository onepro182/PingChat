@echo off
rem ==========================================================
rem  PingChat - lanceur Windows
rem  Ouvre linterface dans le navigateur par defaut.
rem  Aucune installation requise.
rem ==========================================================
title PingChat
echo Demarrage de PingChat...
start "" "%~dp0index.html"
exit /b 0
