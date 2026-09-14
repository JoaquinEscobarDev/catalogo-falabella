CREATE TABLE IF NOT EXISTS encuestas_electronica (
  id         SERIAL PRIMARY KEY,
  tienda     TEXT NOT NULL,
  p1         TEXT NOT NULL,
  p2         TEXT NOT NULL,
  p3         TEXT NOT NULL,
  p4         TEXT NOT NULL,
  p5         TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_encuestas_tienda  ON encuestas_electronica(tienda);
CREATE INDEX IF NOT EXISTS idx_encuestas_created ON encuestas_electronica(created_at DESC);
