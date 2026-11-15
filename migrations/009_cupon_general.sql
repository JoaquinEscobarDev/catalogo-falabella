-- Cupón general de una campaña (Cyber, Black...) que aplica a todo el sitio
-- según la página de cupones, pero que puede tener exclusiones que la página
-- no detalla: la app lo aplica a todos los productos y lo avisa.
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS general BOOLEAN NOT NULL DEFAULT FALSE;
