-- Cupones detectados automáticamente que el usuario marcó como "no sirve":
-- dejan de mostrarse en las tarjetas y en la lista aunque Falabella los siga
-- publicando. Se pueden volver a mostrar desde la ventana de cupones.
--   clave: el código del cupón (CYBER10), la clave de un cupón de ficha sin
--          código ('||texto'), o 'txt:<texto normalizado>'.
CREATE TABLE IF NOT EXISTS coupons_ocultos (
  clave      TEXT PRIMARY KEY,
  etiqueta   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "cupontel10" aparece en fichas de celulares pero no funciona (avisado por
-- el usuario el 15-11-2026). Se oculta por su texto y por si algún día se
-- detecta como código.
INSERT INTO coupons_ocultos (clave, etiqueta) VALUES
  ('txt:cupontel10', 'cupontel10'),
  ('CUPONTEL10', 'cupontel10')
ON CONFLICT (clave) DO NOTHING;
