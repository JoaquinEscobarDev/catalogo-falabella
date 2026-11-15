require('dotenv').config({ quiet: true });

function lista(valor, porDefecto) {
  const horas = String(valor ?? porDefecto).split(',')
    .map(h => parseInt(h.trim(), 10))
    .filter(h => Number.isInteger(h) && h >= 0 && h <= 23);
  return horas.length ? [...new Set(horas)].sort((a, b) => a - b) : [];
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  proxyUrl: process.env.PROXY_URL || null,
  cacheTtlMs: (parseInt(process.env.CACHE_TTL_HOURS, 10) || 30) * 60 * 60 * 1000,
  stockTtlMs: (parseInt(process.env.STOCK_TTL_HOURS, 10) || 2) * 60 * 60 * 1000,

  // Refresh automático dentro del servidor (reemplaza a los .bat de la PC).
  // AUTO_REFRESH=0 lo apaga, por si se quiere seguir usando scripts/*.js.
  autoRefresh: process.env.AUTO_REFRESH !== '0',
  // Horas (0-23, hora de Chile) en que corre el refresh completo. Ej: "7" o "7,15".
  refreshHours: lista(process.env.REFRESH_HOURS, '7'),
  refreshTimezone: process.env.REFRESH_TZ || 'America/Santiago',

  // Solo para pruebas/entornos especiales.
  falabellaBaseUrl: (process.env.FALABELLA_BASE_URL || 'https://www.falabella.com').replace(/\/$/, ''),
  chromiumPath: process.env.CHROMIUM_PATH || null,
};
