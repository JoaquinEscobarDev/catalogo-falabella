CREATE TABLE IF NOT EXISTS reservas_iphone (
  id             SERIAL PRIMARY KEY,
  nombre         TEXT NOT NULL,
  apellido       TEXT NOT NULL,
  telefono       TEXT NOT NULL,
  modelo         TEXT NOT NULL,
  almacenamiento TEXT NOT NULL,
  color          TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservas_iphone_modelo ON reservas_iphone(modelo);
CREATE INDEX IF NOT EXISTS idx_reservas_iphone_created ON reservas_iphone(created_at DESC);
