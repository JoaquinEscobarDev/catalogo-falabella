@echo off
cd /d "%~dp0"
call open-tunnel.bat
node scripts\watch-refresh.js >> watch-refresh.log 2>&1
