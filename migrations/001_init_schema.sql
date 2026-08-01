-- Esquema normalizado para Postgres propio (Hostinger).
-- Reemplaza skus + producto_cache (2 tablas 1:1) por una sola tabla products,
-- y normaliza categoria (texto libre) en su propia tabla categories.

CREATE TABLE IF NOT EXISTS categories (
  id     SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE
);

INSERT INTO categories (nombre) VALUES ('Sin categoría') ON CONFLICT (nombre) DO NOTHING;

CREATE TABLE IF NOT EXISTS products (
  sku                 TEXT PRIMARY KEY,
  alias               TEXT,
  category_id         INTEGER NOT NULL REFERENCES categories(id),
  nombre              TEXT,
  marca               TEXT,
  precio_normal       INTEGER,
  precio_oferta       INTEGER,
  precio_cmr          INTEGER,
  imagen              TEXT,
  url                 TEXT,
  garantia_1a         INTEGER,
  garantia_2a         INTEGER,
  garantia_3a         INTEGER,
  capacidad           TEXT,
  color               TEXT,
  cuotas_sin_interes  INTEGER,
  despacho_24h        BOOLEAN,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  price_updated_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

CREATE TABLE IF NOT EXISTS price_history (
  id              SERIAL PRIMARY KEY,
  sku             TEXT NOT NULL REFERENCES products(sku) ON DELETE CASCADE,
  campo           TEXT NOT NULL,
  precio_anterior INTEGER,
  precio_nuevo    INTEGER,
  fecha           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  visto           BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_price_history_sku ON price_history(sku);
CREATE INDEX IF NOT EXISTS idx_price_history_visto ON price_history(visto) WHERE visto = FALSE;

CREATE TABLE IF NOT EXISTS stock_cache (
  sku        TEXT PRIMARY KEY REFERENCES products(sku) ON DELETE CASCADE,
  stock      INTEGER,
  store_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS todo_items (
  sku        TEXT PRIMARY KEY REFERENCES products(sku) ON DELETE CASCADE,
  size       TEXT NOT NULL DEFAULT 'Mediano',
  quantity   INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_requests (
  id          SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  procesado   BOOLEAN NOT NULL DEFAULT FALSE
);
