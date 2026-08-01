# 🛒 Catálogo de Precios Falabella

Herramienta web para hacer seguimiento diario de precios de productos en Falabella Chile. Agregás los SKUs una sola vez y cada mañana revisás todos los precios de un vistazo.

---

## ✨ Funcionalidades

- 📦 **Búsqueda por SKU** — ingresás el SKU y aparecen nombre, imagen y precio automáticamente
- 💰 **Precio normal y precio oferta** — muestra ambos cuando hay descuento
- 🔍 **Filtro en tiempo real** — buscá por nombre, SKU o alias
- 💾 **Base de datos persistente** — los SKUs se guardan y no hay que volver a ingresarlos
- 🔁 **Actualización masiva** — un botón refresca todos los precios a la vez
- 🏷️ **Alias personalizados** — poné un nombre propio a cada producto (ej: "TV Living")
- 🔗 **Link directo a Falabella** — con un click vas al producto en el sitio

---

## 🖼️ Vista previa

```
┌─────────────────────────────────────────┐
│  🛒 Catálogo Falabella   [↻ Actualizar] │
├─────────────────────────────────────────┤
│  SKU: [__________]  Alias: [_________]  │
│                              [Agregar]  │
├─────────────────────────────────────────┤
│  🔍 Filtrar por nombre, SKU o alias...  │
├──────────┬──────────┬───────────────────┤
│ [Imagen] │ [Imagen] │ [Imagen]          │
│ Nombre   │ Nombre   │ Nombre            │
│ SKU      │ SKU      │ SKU               │
│ $699.990 │ $49.990  │ $129.990          │
│ $569.990 │          │ $99.990 oferta    │
└──────────┴──────────┴───────────────────┘
```

---

## 🚀 Instalación local

### Requisitos
- [Node.js](https://nodejs.org) v18 o superior
- `curl` instalado en el sistema (viene por defecto en Windows 10+, macOS y Linux)
- Docker + Docker Compose (para levantar Postgres local fácilmente)

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/JoaquinEscobarDev/catalogo-falabella.git
cd catalogo-falabella

# 2. Instalar dependencias
npm install

# 3. Levantar Postgres local
echo "POSTGRES_PASSWORD=dev" > .env
docker compose up -d postgres

# 4. Configurar .env (ver .env.example) apuntando DATABASE_URL al Postgres local
#    DATABASE_URL=postgresql://catalogo:dev@localhost:5432/catalogo_falabella

# 5. Crear el esquema
npm run migrate

# 6. Iniciar el servidor
npm start
```

Luego abrí el navegador en **http://localhost:3000**

---

## 📖 Cómo usar

1. **Encontrá el SKU** del producto en Falabella — está en la URL del producto o en la ficha técnica
2. **Pegá el SKU** en el campo de la app y opcionalmente poné un alias
3. Click en **Agregar** — la app consulta Falabella y muestra el producto
4. **Cada mañana** abrí la app y click en **↻ Actualizar precios** para ver los precios del día

---

## 🛠️ Stack técnico

| Componente | Tecnología |
|---|---|
| Backend | Node.js + Express, arquitectura en capas (routes → controllers → services → repositories) |
| Base de datos | PostgreSQL propio (Docker, sobre un VPS de Hostinger) |
| Frontend | HTML + CSS + JavaScript vanilla |
| Scraping | curl + Playwright (respaldo) + parsing de `__NEXT_DATA__` |
| Refresh de precios | Corre desde una PC con IP residencial (Task Scheduler de Windows) contra el Postgres del VPS vía túnel SSH — ver [DEPLOY.md](DEPLOY.md) |

---

## 📁 Estructura del proyecto

```
catalogo-falabella/
├── server.js               # Bootstrap: conecta Postgres y levanta src/app.js
├── src/
│   ├── config/             # env.js, database.js (pool de pg)
│   ├── repositories/       # acceso a datos, una tabla por archivo
│   ├── services/           # lógica de negocio + scraperService (scraping puro)
│   ├── controllers/        # handlers HTTP, delegan a services
│   ├── routes/             # define /api/*
│   └── app.js              # ensambla express + rutas
├── migrations/              # esquema SQL versionado + runner
├── scripts/
│   ├── migrate-from-neon.js # migración de datos, una sola vez
│   ├── refresh-local.js     # refresh diario completo (PC)
│   └── watch-refresh.js     # atiende el botón "Actualizar precios" (PC)
├── docker-compose.yml       # app + postgres para el VPS (y desarrollo local)
├── DEPLOY.md                # proceso completo de deploy en Hostinger
└── public/                  # frontend (sin cambios de API)
```

---

## ⚙️ Variables de entorno

Ver [.env.example](.env.example) y [DEPLOY.md](DEPLOY.md) para el detalle completo
(`DATABASE_URL`, `PROXY_URL`, y las de uso puntual `OLD_DATABASE_URL`/`NEW_DATABASE_URL`
para la migración de datos).

---

## 🌐 Deploy en Hostinger

Ver [DEPLOY.md](DEPLOY.md) para el proceso completo: alta del VPS, Docker Compose
(app + Postgres), migración de datos desde el Postgres anterior, nginx + HTTPS,
y cómo conectar el refresh diario de la PC al Postgres del VPS por túnel SSH.

Redeploy de cambios nuevos: `ssh` al VPS → `git pull && docker compose up -d --build`.

---

## 📝 Notas

- Los datos se obtienen directamente de Falabella Chile (`falabella.com`)
- El scraping usa la página de búsqueda pública, no una API privada
- Los precios mostrados son en **pesos chilenos (CLP)**
