@echo off
cd /d "%~dp0"
node refresh-local.js >> refresh-local.log 2>&1
