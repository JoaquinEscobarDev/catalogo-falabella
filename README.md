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

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/TU_USUARIO/catalogo-falabella.git
cd catalogo-falabella

# 2. Instalar dependencias
npm install

# 3. Iniciar el servidor
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
| Backend | Node.js + Express |
| Base de datos | JSON file (skus.json) |
| Frontend | HTML + CSS + JavaScript vanilla |
| Scraping | curl + parsing de __NEXT_DATA__ |

---

## 📁 Estructura del proyecto

```
catalogo-falabella/
├── server.js          # Servidor Express + scraping de Falabella
├── package.json       # Dependencias del proyecto
├── skus.json          # Base de datos local (se crea automáticamente)
└── public/
    ├── index.html     # Interfaz principal
    ├── style.css      # Estilos
    └── app.js         # Lógica del frontend
```

---

## ⚙️ Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto del servidor |

---

## 🌐 Deploy en Railway

1. Forkeá este repositorio
2. Entrá a [railway.app](https://railway.app) y creá un nuevo proyecto desde GitHub
3. Seleccioná este repositorio — Railway detecta Node.js automáticamente
4. ¡Listo! La app queda disponible en una URL pública

---

## 📝 Notas

- Los datos se obtienen directamente de Falabella Chile (`falabella.com`)
- El scraping usa la página de búsqueda pública, no una API privada
- Los precios mostrados son en **pesos chilenos (CLP)**
