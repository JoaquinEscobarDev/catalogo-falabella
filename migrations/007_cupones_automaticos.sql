-- Cupones de campaña detectados solos en la página de cupones de Falabella
-- (falabella-cl/page/cupones-descuento), además de los cargados a mano.

-- 'manual' (cargado desde la app) | 'automatico' (detectado por el worker)
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'manual';
-- Texto original del cupón en la página, para mostrarlo y poder revisarlo.
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS texto TEXT;
-- Última vez que se vio en la página. Un cupón automático que deja de
-- aparecer se deja de aplicar a los 3 días aunque no traiga vencimiento.
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS detectado_en TIMESTAMPTZ;
