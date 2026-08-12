@echo off
chcp 65001 >nul
title BOSS AI 助手
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0"
