# Catálogo Falabella

Herramienta interna para vendedores de tienda. Permite consultar precios en tiempo real de falabella.com, simular cuotas con distintos bancos, registrar cambios de precio pendientes y gestionar el catálogo por categorías.

Desplegada como PWA instalable en Railway con PostgreSQL.

---

## Funcionalidades

### Catálogo por categorías
- Organización de productos en categorías personalizadas (ej: Zona A, Zona B, Electro)
- Vista de grilla con tarjeta por producto mostrando imagen, nombre, precios y variaciones
- Filtro en tiempo real por nombre, SKU, alias o marca
- Filtro adicional por marca dentro de una categoría

### Precios en tiempo real
- Scraping de falabella.com al abrir un producto (curl + Playwright stealth como respaldo ante bloqueos de Cloudflare)
- Muestra precio CMR, precio oferta y precio normal en la misma tarjeta
- Historial de precios guardado en base de datos para detectar variaciones
- Indicador visual de cambio de precio (subida / bajada) respecto al registro anterior

### Código UPC por producto
- Campo UPC editable inline en cada tarjeta
- Guardado inmediato en base de datos al confirmar
- Útil para escaneo rápido en caja

### Simulador de cuotas (`💳`)
- Botón en cada tarjeta que abre un modal de simulación
- **Precio CMR**: muestra únicamente las cuotas sin interés de la tarjeta CMR Falabella, obtenidas directamente del scraping de la página del producto
- **Precio Oferta / Normal**: muestra todos los demás bancos
  - **Sin interés**: tabla con 9 bancos (Banco de Chile, BCI, Santander, Banco Estado, Scotiabank, Itaú, BICE, Security, Coopeuch), cada uno con sus cuotas sin interés base. Selección de fila para ver el detalle en el encabezado
  - **Con interés**: calculadora con banco, número de cuotas y CAE editable. Cálculo con amortización francesa (cuota constante). Muestra cuota mensual, total a pagar y total en intereses
- CAE por banco preconfigurado y editable por el usuario

### Lista de cambios de precio (ToDo)
- Botón "Cambiar" en cada tarjeta para agregar un producto a la lista de pendientes
- Panel lateral en escritorio y modal flotante en móvil
- Contador de items pendientes visible en todo momento (FAB en móvil)
- Persistencia en base de datos (sobrevive cierres de pestaña)

### Búsqueda global
- Ícono de búsqueda en el header que abre un modal con campo de texto
- Búsqueda en tiempo real sobre todos los productos de todas las categorías
- Muestra la tarjeta completa del producto con imagen, precios y botón de cuotas

### Gestión de SKUs
- Formulario para agregar SKU con alias y categoría
- Eliminación de SKU con confirmación
- Actualización de precios manual por producto o refresh masivo de toda la categoría

### PWA instalable
- Manifest y service worker incluidos (`catalogo-v7`)
- Instalable en iOS (Safari) y Android (Chrome) como app de pantalla de inicio
- Caché de assets estáticos para funcionamiento offline básico; datos de API siempre desde la red

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Backend | Node.js + Express |
| Base de datos | PostgreSQL (Railway) |
| Scraping | curl (headers reales) + Playwright stealth (fallback) |
| Frontend | HTML/CSS/JS vanilla (sin frameworks) |
| Deploy | Railway (auto-deploy desde `main`) |
| PWA | Service Worker + Web App Manifest |

---

## API REST

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/skus` | Lista todos los SKUs |
| `POST` | `/api/skus` | Agrega un SKU |
| `DELETE` | `/api/skus/:sku` | Elimina un SKU |
| `GET` | `/api/search?q=...` | Búsqueda global de productos |
| `GET` | `/api/categoria/:nombre` | Productos de una categoría |
| `GET` | `/api/producto/:sku` | Datos de un producto (caché + scraping) |
| `PATCH` | `/api/producto/:sku/upc` | Actualiza el UPC de un producto |
| `GET` | `/api/stock/:sku` | Stock disponible de un producto |
| `GET` | `/api/todo` | Lista de cambios pendientes |
| `POST` | `/api/todo` | Agrega/actualiza un item pendiente |
| `DELETE` | `/api/todo/:sku` | Elimina un item pendiente |
| `POST` | `/api/todo/clear` | Limpia toda la lista |
| `POST` | `/api/solicitar-refresh` | Solicita refresh de precios en segundo plano |
| `GET` | `/api/solicitar-refresh/:id` | Consulta el estado de un refresh |

---

## Scripts

```bash
npm start                # Inicia el servidor en producción
npm run dev              # Inicia con nodemon (desarrollo)
npm run migrate          # Ejecuta las migraciones de base de datos
npm run refresh          # Refresh masivo de precios desde IP local
npm run watch-refresh    # Refresh continuo (modo watch)
```

---

## Variables de entorno

```env
DATABASE_URL=postgresql://...   # URL de conexión a PostgreSQL
PROXY_URL=                      # Proxy opcional para scraping en datacenter
CACHE_TTL_MS=300000             # TTL de caché de precios (default: 5 min)
PORT=3000
```

---

## Estructura del proyecto

```
├── public/              # Frontend (HTML, CSS, JS, PWA)
│   ├── index.html
│   ├── app.js           # Lógica principal del cliente
│   ├── style.css
│   ├── sw.js            # Service Worker
│   └── manifest.json
├── src/
│   ├── config/          # Configuración de BD y entorno
│   ├── controllers/     # Handlers HTTP
│   ├── repositories/    # Acceso a base de datos
│   ├── routes/          # Definición de rutas
│   └── services/        # Lógica de negocio y scraping
├── migrations/          # Migraciones de esquema
├── scripts/             # Utilidades de mantenimiento
└── server.js            # Entry point
```
