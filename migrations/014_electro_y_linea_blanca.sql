-- "Electrodomésticos" y "Línea Blanca" pasan a ser una sola categoría,
-- "Electro y Línea Blanca". Los productos que eran de Línea Blanca quedan con
-- la subcategoría "Línea Blanca"; los de Electrodomésticos sin subcategoría
-- (se asigna al comparar con la lista de tienda).
DO $$
DECLARE dest INTEGER;
BEGIN
  SELECT id INTO dest FROM categories WHERE nombre = 'Electro y Línea Blanca';
  IF dest IS NULL THEN
    UPDATE categories SET nombre = 'Electro y Línea Blanca' WHERE nombre = 'Electrodomésticos' RETURNING id INTO dest;
  END IF;
  IF dest IS NULL THEN
    INSERT INTO categories (nombre) VALUES ('Electro y Línea Blanca') RETURNING id INTO dest;
  END IF;

  UPDATE products p SET category_id = dest
  FROM categories c WHERE p.category_id = c.id AND c.nombre = 'Electrodomésticos';

  UPDATE products p SET category_id = dest, subcategoria = 'Línea Blanca'
  FROM categories c WHERE p.category_id = c.id AND c.nombre = 'Línea Blanca';

  UPDATE refresh_requests r SET category_id = dest
  FROM categories c WHERE r.category_id = c.id AND c.nombre IN ('Electrodomésticos', 'Línea Blanca');

  UPDATE coupons SET alcance_valor = 'Electro y Línea Blanca'
  WHERE alcance = 'categoria' AND alcance_valor IN ('Electrodomésticos', 'Línea Blanca');

  DELETE FROM categories c
  WHERE c.nombre IN ('Electrodomésticos', 'Línea Blanca')
    AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM refresh_requests r WHERE r.category_id = c.id);
END $$;
