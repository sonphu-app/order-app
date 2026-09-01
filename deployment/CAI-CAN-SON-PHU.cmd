@echo off
chcp 65001 >nul
title Cai dat Can Son Phu 2026
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-on-scale-pc.ps1"
pause
