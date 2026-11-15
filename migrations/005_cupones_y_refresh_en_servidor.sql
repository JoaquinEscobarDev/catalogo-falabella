-- Cupones de descuento + refresh de precios corriendo en el servidor (ya no
-- depende de la PC).

-- Cupón detectado automáticamente en la página del producto de Falabella.
-- Forma: { codigo, tipo ('porcentaje'|'monto'|null), valor, tope, minimo, soloCMR, texto }
ALTER TABLE products ADD COLUMN IF NOT EXISTS cupon JSONB;

-- Cupones de campaña cargados a mano (falabella.com/falabella-cl/page/cupones-descuento):
-- un código que aplica a todo, a una categoría, a una marca o a SKUs puntuales.
CREATE TABLE IF NOT EXISTS coupons (
  id            SERIAL PRIMARY KEY,
  codigo        TEXT NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('porcentaje', 'monto')),
  valor         INTEGER NOT NULL CHECK (valor > 0),
  tope          INTEGER,              -- descuento máximo en pesos (solo porcentaje)
  minimo        INTEGER,              -- compra mínima en pesos
  solo_cmr      BOOLEAN NOT NULL DEFAULT FALSE,
  alcance       TEXT NOT NULL DEFAULT 'todos' CHECK (alcance IN ('todos', 'categoria', 'marca', 'sku')),
  alcance_valor TEXT,                 -- nombre de categoría, marca, o SKUs separados por coma
  vence         DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bitácora de cada corrida de refresh, para ver desde el celular si el
-- servidor está logrando scrapear o si Falabella lo está bloqueando.
CREATE TABLE IF NOT EXISTS refresh_runs (
  id           SERIAL PRIMARY KEY,
  tipo         TEXT NOT NULL,         -- 'diario' | 'manual' | 'categoria'
  detalle      TEXT,
  iniciado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminado_en TIMESTAMPTZ,
  total        INTEGER NOT NULL DEFAULT 0,
  ok           INTEGER NOT NULL DEFAULT 0,
  fail         INTEGER NOT NULL DEFAULT 0,
  cambios      INTEGER NOT NULL DEFAULT 0,
  estado       TEXT NOT NULL DEFAULT 'en_curso'  -- 'en_curso' | 'ok' | 'bloqueado' | 'error' | 'interrumpido'
);
CREATE INDEX IF NOT EXISTS idx_refresh_runs_iniciado ON refresh_runs(iniciado_en DESC);

-- "procesado" pasa a significar "ya la tomó el worker"; terminado_en marca
-- cuándo terminó de verdad, que es lo que espera el botón de la web.
ALTER TABLE refresh_requests ADD COLUMN IF NOT EXISTS terminado_en TIMESTAMPTZ;
ALTER TABLE refresh_requests ADD COLUMN IF NOT EXISTS ok INTEGER;
ALTER TABLE refresh_requests ADD COLUMN IF NOT EXISTS fail INTEGER;
UPDATE refresh_requests SET terminado_en = creado_en WHERE procesado = TRUE AND terminado_en IS NULL;
