@echo off
chcp 65001 >nul
title 卷心菜自由城 Formal Edition 1.00 - 卷心菜精心制作
cd /d "%~dp0"
echo ========================================================
echo   正在启动《卷心菜自由城 Formal Edition 1.00》...
echo   卷心菜精心制作 · 开源正式版
echo ========================================================
node server.mjs
pause
