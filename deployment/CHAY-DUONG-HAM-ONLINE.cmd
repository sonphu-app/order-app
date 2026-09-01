@echo off
chcp 65001 >nul
title Duong ham online Can Son Phu 2026
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\start-online-tunnel.ps1"
pause
