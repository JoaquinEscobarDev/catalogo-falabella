# Deploy en Hostinger (VPS)

Reemplaza el deploy en Railway. La app y Postgres corren en contenedores
Docker dentro del VPS; el redeploy es `git pull` + `docker compose up`.

**Todo corre en el VPS, sin ninguna PC prendida:** el mismo contenedor `app`
sirve la web y refresca precios, stock y cupones solo (una vez al día y cada
vez que alguien aprieta "Actualizar precios"). Ver el paso 8.

## 1. Alta del VPS

1. Contratá un plan **VPS** de Hostinger (no hosting compartido/Business —
   ese solo trae MySQL, y acá se necesita Postgres propio). Ubuntu 22.04+ recomendado.
2. Apuntá tu dominio (registro A) a la IP del VPS.
3. Conectate por SSH y actualizá el sistema:
   ```bash
   ssh root@TU_IP_VPS
   apt update && apt upgrade -y
   ```

## 2. Instalar Docker, Compose, nginx y certbot

```bash
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin nginx certbot python3-certbot-nginx git
```

## 3. Clonar el repo y configurar variables

```bash
mkdir -p /var/www && cd /var/www
git clone https://github.com/JoaquinEscobarDev/catalogo-falabella.git
cd catalogo-falabella
```

Creá el `.env` que usa `docker-compose.yml` (ver `.env.example` para todas
las opciones):

```bash
cat > .env <<'EOF'
POSTGRES_PASSWORD=elegí-una-contraseña-larga-acá
REFRESH_HOURS=7
PROXY_URL=
EOF
```

## 4. Levantar los contenedores y migrar el esquema

```bash
docker compose up -d --build
```

El contenedor `app` aplica solo las migraciones pendientes cada vez que
arranca (crea `categories`, `products`, `price_history`, `stock_cache`,
`todo_items`, `refresh_requests`, `coupons`, `refresh_runs`...).

## 5. Migrar los datos desde Neon (una sola vez)

Sacá la connection string de Neon desde el dashboard de Railway
(Variables → `DATABASE_URL`) y corré la migración *desde dentro* del
contenedor `app` (para que `NEW_DATABASE_URL` apunte al Postgres interno del
compose, `postgres:5432`, no al `127.0.0.1:5432` que ve el host):

```bash
docker compose exec \
  -e OLD_DATABASE_URL="postgresql://usuario:pass@ep-xxx.neon.tech/neondb?sslmode=require" \
  -e NEW_DATABASE_URL="postgresql://catalogo:LA_MISMA_PASSWORD_DEL_.ENV@postgres:5432/catalogo_falabella" \
  app node scripts/migrate-from-neon.js
```

Al final imprime cuántas categorías/productos/cambios de precio/stock/todo
copió. Es idempotente — se puede correr de nuevo sin duplicar filas.

## 6. nginx + HTTPS

```bash
cat > /etc/nginx/sites-available/catalogo-falabella <<'EOF'
server {
    listen 80;
    server_name tu-dominio.cl;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF
ln -s /etc/nginx/sites-available/catalogo-falabella /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d tu-dominio.cl
```

## 7. Redeploy (cada vez que hay cambios en GitHub)

```bash
ssh root@TU_IP_VPS
cd /var/www/catalogo-falabella
git pull
docker compose up -d --build
```

Las migraciones nuevas de `migrations/*.sql` se aplican solas al arrancar.

## 8. Refresh automático (sin PC)

El servidor refresca solo. No hay nada que instalar ni programar aparte:

| Qué | Cuándo |
|---|---|
| Refresh completo de precios + stock + cupones de todos los SKUs | A las horas de `REFRESH_HOURS` (hora de Chile; por defecto 07:00). Si el server estaba caído a esa hora, lo hace apenas vuelve. |
| Refresh de una categoría | Al apretar **↻ Actualizar precios** dentro de la categoría (empieza al instante y muestra el avance). |
| Refresh completo a pedido | Botón **↻ Actualizar todo ahora** en la portada. |

La portada de la app muestra cuándo fue la última actualización, cuántos
productos se leyeron y cuándo es la próxima. Para ver el detalle:

```bash
docker compose logs -f app
```

**Si venías usando la PC:** desactivá las dos tareas del Programador de tareas
de Windows (`refresh-diario.bat` y `watch-refresh.bat`). Ya no hacen falta, y
el túnel SSH tampoco.

### Si Falabella bloquea al servidor

Falabella está detrás de Cloudflare, que a veces bloquea las IP de datacenter.
El servidor primero prueba con `curl` y, si lo bloquean, con un Chromium real
(Playwright stealth). Si aun así no pasa, la portada muestra el aviso
**"Falabella bloqueó al servidor"** y se siguen viendo los últimos precios
guardados (un refresh bloqueado nunca borra datos).

La solución es salir por un proxy residencial: contratá uno (con rotación de
IP y, si se puede, salida en Chile), poné la URL en `PROXY_URL` del `.env` y
reiniciá:

```bash
docker compose up -d
```

### Alternativa gratis al proxy: refrescar desde el teléfono (Termux)

Un teléfono Android sale a internet con una IP de hogar o de red móvil, que
Falabella sí deja pasar. `scripts/worker-telefono.js` lee Falabella desde el
teléfono y guarda precios, stock y cupones directo en la base de producción.
Mientras esté corriendo, el servidor le cede todo el trabajo: el refresh
programado, el botón **Actualizar precios** y **Actualizar todo ahora**. Si el
teléfono se desconecta más de 3 minutos, el servidor vuelve a intentarlo solo.

1. Instalar **Termux** (desde F-Droid o GitHub; la versión de Play Store suele
   estar desactualizada).
2. Tener a mano la dirección **pública** de la base de datos: en Railway, la
   variable `DATABASE_PUBLIC_URL` del servicio Postgres (o `DATABASE_URL` si
   apunta a un host externo como Neon). La que termina en `railway.internal`
   no sirve desde afuera.
3. En Termux:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/JoaquinEscobarDev/catalogo-falabella/main/scripts/termux/instalar.sh -o instalar.sh
   bash instalar.sh
   ```
   Instala Node, descarga el proyecto, pide la dirección de la base y hace una
   prueba leyendo tres productos.
4. Dejarlo corriendo:
   ```bash
   bash ~/catalogo-falabella/scripts/termux/iniciar.sh
   ```
5. En los ajustes de Android, sacarle a Termux la restricción de batería
   ("Sin restricciones"), o Android lo cierra con la pantalla apagada.

La portada de la app muestra **📱 Teléfono conectado** cuando el worker está
vivo. Para actualizar el código del teléfono, volver a correr `bash instalar.sh`.

### Plan B: refrescar desde una PC

`scripts/refresh-local.js` y `scripts/watch-refresh.js` siguen funcionando
desde cualquier máquina con IP residencial, por si alguna vez hace falta
forzar una corrida a mano. El Postgres solo escucha en `127.0.0.1` del VPS,
así que se llega por túnel SSH (`open-tunnel.bat` lo abre:
`ssh -N -L 5433:127.0.0.1:5432 catalogo-vps`) con este `.env` local:

```
DATABASE_URL=postgresql://catalogo:LA_MISMA_PASSWORD_DEL_.ENV@127.0.0.1:5433/catalogo_falabella
```

## Alternativa: Railway

La app también corre tal cual en Railway (es donde está hoy en producción):

- **Origen:** servicio conectado a este repo, rama `main`, con *Auto deploys*
  activado. Cada push a `main` se despliega solo; Railway detecta el
  `Dockerfile`, que aplica las migraciones y levanta el server.
- **Variables:** `DATABASE_URL` (obligatoria) y, opcionales, `REFRESH_HOURS`,
  `AUTO_REFRESH` y `PROXY_URL` (ver la tabla de abajo).
- **Serverless apagado:** el refresh automático corre dentro del server, así
  que el servicio tiene que quedar siempre encendido (*Settings → Serverless*
  desactivado).
- **Comprobar que quedó la versión nueva:** abrir `/api/estado` en el dominio
  del servicio. Si responde un JSON con `"auto": true`, el refresh automático
  está andando; `Cannot GET /api/estado` significa que sigue la versión vieja.

## Variables de entorno — resumen

| Variable | Dónde | Descripción |
|---|---|---|
| `POSTGRES_PASSWORD` | `.env` del VPS | Contraseña del Postgres en Docker Compose |
| `DATABASE_URL` | Contenedor `app` (armada por Compose) | Connection string de Postgres |
| `REFRESH_HOURS` | `.env` del VPS (opcional, default `7`) | Horas (0-23, hora de Chile) del refresh completo automático. Varias con coma: `7,15` |
| `AUTO_REFRESH` | `.env` del VPS (opcional, default `1`) | `0` apaga el refresh automático del servidor |
| `PROXY_URL` | `.env` del VPS (opcional) | Proxy residencial, si el VPS termina bloqueado por Cloudflare |
| `PORT` | Contenedor `app` (fija en Compose: `3000`) | Puerto interno del server Express |
| `OLD_DATABASE_URL` / `NEW_DATABASE_URL` | Solo al correr `scripts/migrate-from-neon.js` | Origen (Neon) y destino (VPS) de la migración de datos, una sola vez |
