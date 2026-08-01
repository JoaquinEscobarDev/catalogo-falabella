@echo off
:: Abre (si no está ya abierto) el túnel SSH hacia el Postgres del VPS de
:: Hostinger, que solo escucha en 127.0.0.1 dentro del VPS (nunca expuesto a
:: internet). Ver DEPLOY.md para la config de ~/.ssh/config del alias usado acá.
setlocal
set VPS_HOST=catalogo-vps
set LOCAL_PORT=5433

powershell -NoProfile -Command "if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port %LOCAL_PORT% -InformationLevel Quiet -WarningAction SilentlyContinue)) { Start-Process ssh -ArgumentList '-N','-L','%LOCAL_PORT%:127.0.0.1:5432','%VPS_HOST%' -WindowStyle Hidden }"
:: Da un momento para que el túnel termine de levantar antes de que Node se conecte
timeout /t 2 /nobreak >nul
endlocal
