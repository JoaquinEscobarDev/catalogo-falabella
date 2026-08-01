@echo off
cd /d "%~dp0"
call open-tunnel.bat
node scripts\refresh-local.js >> refresh-local.log 2>&1
