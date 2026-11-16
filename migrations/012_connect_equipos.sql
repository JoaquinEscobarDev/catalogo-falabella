-- Datos para mostrar cada equipo de la colección Falabella Connect:
-- imagen, características principales y, si Falabella los publica, los
-- valores por compañía ({ "WOM": { "pie": 189990, "mensual": 17990 }, ... }).
ALTER TABLE connect_ofertas ADD COLUMN IF NOT EXISTS imagen TEXT;
ALTER TABLE connect_ofertas ADD COLUMN IF NOT EXISTS specs JSONB;
ALTER TABLE connect_ofertas ADD COLUMN IF NOT EXISTS operadores JSONB;
