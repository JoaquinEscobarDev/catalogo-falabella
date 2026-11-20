-- Subcategorías dentro de una categoría (ej. Computación → Tablets / Impresoras,
-- TV → Sonido). NULL = la subcategoría por defecto de la categoría, o la que
-- se deduzca del nombre del producto (ver SUBCATEGORIAS en public/app.js).
ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategoria TEXT;

-- Computadores, Tablets e Impresoras pasan a ser una sola categoría
-- "Computación", con Tablets e Impresoras como subcategorías.
DO $$
DECLARE comp INTEGER;
BEGIN
  SELECT id INTO comp FROM categories WHERE nombre = 'Computación';
  IF comp IS NULL THEN
    UPDATE categories SET nombre = 'Computación' WHERE nombre = 'Computadores' RETURNING id INTO comp;
  END IF;
  IF comp IS NULL THEN
    INSERT INTO categories (nombre) VALUES ('Computación') RETURNING id INTO comp;
  END IF;

  -- Si quedó una "Computadores" aparte (ya existía Computación), también se une.
  UPDATE products p SET category_id = comp
  FROM categories c WHERE p.category_id = c.id AND c.nombre = 'Computadores';

  UPDATE products p SET subcategoria = c.nombre, category_id = comp
  FROM categories c WHERE p.category_id = c.id AND c.nombre IN ('Tablets', 'Impresoras');

  UPDATE refresh_requests r SET category_id = comp
  FROM categories c WHERE r.category_id = c.id AND c.nombre IN ('Computadores', 'Tablets', 'Impresoras');

  -- Cupones por categoría que apuntaban a las categorías viejas.
  UPDATE coupons SET alcance_valor = 'Computación'
  WHERE alcance = 'categoria' AND alcance_valor IN ('Computadores', 'Tablets', 'Impresoras');

  DELETE FROM categories c
  WHERE c.nombre IN ('Computadores', 'Tablets', 'Impresoras')
    AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM refresh_requests r WHERE r.category_id = c.id);
END $$;
