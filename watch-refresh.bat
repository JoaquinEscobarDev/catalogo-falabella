@echo off
cd /d "%~dp0"
node watch-refresh.js >> watch-refresh.log 2>&1
