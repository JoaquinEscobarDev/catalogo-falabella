-- Planes Connect: equipos vendidos con plan de una compañía (portabilidad o
-- línea nueva).

-- Plan detectado en la ficha del producto al scrapear.
-- Forma: { compania, mensual, tipo ('portabilidad'|'linea_nueva'|'ambos'|null), nombre, gigas, texto }
ALTER TABLE products ADD COLUMN IF NOT EXISTS plan JSONB;

-- Planes cargados a mano (los que no aparecen en ninguna ficha).
CREATE TABLE IF NOT EXISTS connect_planes (
  id         SERIAL PRIMARY KEY,
  compania   TEXT NOT NULL,
  nombre     TEXT,
  tipo       TEXT NOT NULL DEFAULT 'ambos' CHECK (tipo IN ('portabilidad', 'linea_nueva', 'ambos')),
  mensual    INTEGER NOT NULL CHECK (mensual > 0),
  gigas      INTEGER,
  minutos    TEXT,
  notas      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Registro de ventas Connect hechas en la tienda.
CREATE TABLE IF NOT EXISTS connect_ventas (
  id            SERIAL PRIMARY KEY,
  fecha         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tipo          TEXT NOT NULL CHECK (tipo IN ('portabilidad', 'linea_nueva')),
  compania      TEXT NOT NULL,
  plan          TEXT,
  mensual       INTEGER,
  sku           TEXT,
  equipo        TEXT,
  precio_equipo INTEGER,
  cliente       TEXT,
  telefono      TEXT,
  vendedor      TEXT,
  notas         TEXT
);
CREATE INDEX IF NOT EXISTS idx_connect_ventas_fecha ON connect_ventas(fecha DESC);
