#!/data/data/com.termux/files/usr/bin/bash
# Deja corriendo el worker de precios en Termux. Si se cae, lo vuelve a
# levantar solo. Para detenerlo: Ctrl+C dos veces seguidas.
#
# Uso: bash ~/catalogo-falabella/scripts/termux/iniciar.sh

cd "$(dirname "$0")/../.." || exit 1

# Evita que Android duerma a Termux con la pantalla apagada.
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

echo "Worker de precios corriendo. Dejá Termux abierto en segundo plano."
echo "El registro también queda en: $(pwd)/worker-telefono.log"

while true; do
  node scripts/worker-telefono.js 2>&1 | tee -a worker-telefono.log
  echo "[$(date '+%H:%M:%S')] El worker se detuvo; reinicia en 15 s (Ctrl+C para salir)." | tee -a worker-telefono.log
  sleep 15 || exit 0
done
