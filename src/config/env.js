require('dotenv').config({ quiet: true });

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  proxyUrl: process.env.PROXY_URL || null,
  cacheTtlMs: (parseInt(process.env.CACHE_TTL_HOURS, 10) || 30) * 60 * 60 * 1000,
  stockTtlMs: (parseInt(process.env.STOCK_TTL_HOURS, 10) || 2) * 60 * 60 * 1000,
};
