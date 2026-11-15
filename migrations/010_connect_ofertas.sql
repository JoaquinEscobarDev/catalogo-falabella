-- Precio del equipo con plan, leído de la colección "Falabella Connect" de
-- falabella.com (campo lowestPlan de cada producto). Una fila por id de
-- Falabella con que el equipo puede coincidir con un SKU del catálogo
-- (producto, SKU, variantes de color).
CREATE TABLE IF NOT EXISTS connect_ofertas (
  id_falabella    TEXT PRIMARY KEY,
  nombre          TEXT,
  marca           TEXT,
  precio_con_plan INTEGER NOT NULL,
  tipo_precio     TEXT,
  precio_sin_plan INTEGER,
  url             TEXT,
  plan            JSONB,
  detectado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
