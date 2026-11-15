-- Permite que el refresh lo haga otro aparato (un teléfono con Termux, una
-- PC) en vez del servidor, cuando Falabella bloquea la IP del servidor.

-- Quién hizo cada corrida: 'servidor' o 'remoto'.
ALTER TABLE refresh_runs ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'servidor';

-- Estado compartido entre el servidor y el worker remoto:
--   latido:remoto  → última señal de vida del worker remoto
--   total_pedido   → alguien apretó "Actualizar todo ahora"
CREATE TABLE IF NOT EXISTS worker_state (
  clave          TEXT PRIMARY KEY,
  valor          TEXT,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
