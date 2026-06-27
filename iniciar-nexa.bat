@echo off
title NEXA CLASS
cd /d "C:\dev\pessoal\universidade-app"
start /b cmd /c "npm run web:dev"
timeout /t 3 /nobreak >nul
npm run desktop:dev
