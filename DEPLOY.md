# Deploy en Hostinger (VPS)

Reemplaza el deploy en Railway. La app y Postgres corren en contenedores
Docker dentro del VPS; el redeploy es `git pull` + `docker compose up`.

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

Creá el `.env` que usa `docker-compose.yml` (contraseña de Postgres, y
opcionalmente un proxy si el VPS también termina bloqueado por Cloudflare):

```bash
cat > .env <<'EOF'
POSTGRES_PASSWORD=elegí-una-contraseña-larga-acá
PROXY_URL=
EOF
```

## 4. Levantar los contenedores y migrar el esquema

```bash
docker compose up -d --build
docker compose exec app node migrations/run.js
```

Esto crea `categories`, `products`, `price_history`, `stock_cache`,
`todo_items`, `refresh_requests` en el Postgres del contenedor.

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

Si algún `migrations/*.sql` nuevo se agregó, correr también
`docker compose exec app node migrations/run.js` (no rehace las que ya
se aplicaron).

## 8. Conectar la PC al Postgres del VPS (para el refresh diario)

El puerto de Postgres **no está expuesto a internet** — solo escucha en
`127.0.0.1` dentro del VPS (ver `docker-compose.yml`). La PC llega a través
de un túnel SSH.

1. Generá un par de llaves SSH si no tenés (`ssh-keygen`) y copiá la pública
   al VPS (`ssh-copy-id root@TU_IP_VPS`, o un usuario sin privilegios de root
   creado para esto).
2. Agregá un alias en `C:\Users\joaqu\.ssh\config`:
   ```
   Host catalogo-vps
       HostName TU_IP_VPS
       User root
       IdentityFile C:\Users\joaqu\.ssh\id_ed25519
   ```
3. En el `.env` local del proyecto (el que usan `scripts/refresh-local.js` y
   `scripts/watch-refresh.js`), apuntá `DATABASE_URL` al túnel:
   ```
   DATABASE_URL=postgresql://catalogo:LA_MISMA_PASSWORD_DEL_.ENV@127.0.0.1:5433/catalogo_falabella
   ```
4. `open-tunnel.bat` (en la raíz del proyecto) abre el túnel
   (`ssh -N -L 5433:127.0.0.1:5432 catalogo-vps`) si todavía no está abierto —
   `refresh-diario.bat` y `watch-refresh.bat` ya lo llaman antes de correr los
   scripts de Node, así el Programador de tareas de Windows sigue funcionando
   sin pasos manuales adicionales.

## Variables de entorno — resumen

| Variable | Dónde | Descripción |
|---|---|---|
| `POSTGRES_PASSWORD` | `.env` del VPS | Contraseña del Postgres en Docker Compose |
| `DATABASE_URL` | Contenedor `app` (armada por Compose) / `.env` local de la PC (vía túnel) | Connection string de Postgres |
| `PROXY_URL` | `.env` del VPS (opcional) | Proxy residencial, si el VPS también termina bloqueado por Cloudflare |
| `PORT` | Contenedor `app` (fija en Compose: `3000`) | Puerto interno del server Express |
| `OLD_DATABASE_URL` / `NEW_DATABASE_URL` | Solo al correr `scripts/migrate-from-neon.js` | Origen (Neon) y destino (VPS) de la migración de datos, una sola vez |
