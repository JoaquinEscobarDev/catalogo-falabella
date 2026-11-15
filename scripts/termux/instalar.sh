#!/data/data/com.termux/files/usr/bin/bash
# Instala en Termux (Android) el worker que refresca precios desde el teléfono.
#
# Uso, dentro de Termux:
#   curl -fsSL https://raw.githubusercontent.com/JoaquinEscobarDev/catalogo-falabella/main/scripts/termux/instalar.sh -o instalar.sh
#   bash instalar.sh
#
# Se puede volver a correr cuando quieras: actualiza el código y conserva la
# configuración.

set -e

REPO=https://github.com/JoaquinEscobarDev/catalogo-falabella.git
DIR="$HOME/catalogo-falabella"

echo "== 1/4 Instalando Node, git y curl =="
# Hay que ACTUALIZAR todo antes de instalar: si git/curl nuevos quedan junto a
# un openssl viejo, fallan con "CANNOT LINK EXECUTABLE ... libcurl.so".
# Se usa apt y no pkg: pkg llama a curl para elegir mirror, y si curl ya quedó
# roto por una actualización a medias, pkg tampoco funciona.
apt update
apt full-upgrade -y -o Dpkg::Options::="--force-confnew"
apt install -y nodejs-lts git curl

echo "== 2/4 Descargando el proyecto =="
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"

echo "== 3/4 Instalando dependencias =="
# --ignore-scripts: en el teléfono no se usa (ni se puede instalar) el browser.
npm install --omit=dev --ignore-scripts --no-audit --no-fund

echo "== 4/4 Conexión a la base de datos =="
if [ -f .env ] && grep -q '^DATABASE_URL=' .env; then
  echo "Ya hay una DATABASE_URL guardada en $DIR/.env (se conserva)."
else
  echo "Pegá la dirección PÚBLICA de la base de datos (empieza con postgresql://)"
  echo "y apretá Enter. No se muestra en pantalla mientras la pegás."
  read -r -s -p "DATABASE_URL: " URL
  echo
  echo "Recibida (${#URL} caracteres)."
  case "$URL" in
    postgres://*|postgresql://*) ;;
    *) echo "Eso no parece una dirección de Postgres. Volvé a correr: bash instalar.sh"; exit 1 ;;
  esac
  case "$URL" in
    *railway.internal*) echo "Esa es la dirección INTERNA de Railway y desde el teléfono no se alcanza."
                        echo "Usá la pública (DATABASE_PUBLIC_URL). Volvé a correr: bash instalar.sh"; exit 1 ;;
  esac
  umask 077
  printf 'DATABASE_URL=%s\n' "$URL" > .env
  echo "Guardada en $DIR/.env"
fi

echo
echo "== Probando =="
node scripts/worker-telefono.js --probar

cat <<'FIN'

Listo. Para dejarlo corriendo:

    bash ~/catalogo-falabella/scripts/termux/iniciar.sh

FIN
