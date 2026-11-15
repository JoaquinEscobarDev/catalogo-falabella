// Búsqueda automática de cupones de campaña en la página de cupones de
// Falabella. Corre al principio de cada refresh completo (y a pedido con
// `node scripts/worker-telefono.js --cupones`). Los cupones encontrados
// reemplazan a los automáticos anteriores; los cargados a mano no se tocan.

const env = require('../config/env');
const scraperService = require('./scraperService');
const { extraerCuponesDePagina } = require('./cuponesPaginaParser');
const couponsRepository = require('../repositories/couponsRepository');
const productsRepository = require('../repositories/productsRepository');
const workerStateRepository = require('../repositories/workerStateRepository');

const CLAVE_RESUMEN = 'cupones:busqueda';

// Páginas donde Falabella publica sus cupones. CUPONES_PATHS (separadas por
// coma) permite agregar otras sin tocar el código.
function urls() {
  const paths = (process.env.CUPONES_PATHS || '/falabella-cl/page/cupones-descuento')
    .split(',').map(p => p.trim()).filter(Boolean);
  return paths.map(p => (p.startsWith('http') ? p : `${env.falabellaBaseUrl}${p.startsWith('/') ? '' : '/'}${p}`));
}

function pareceBloqueo(http, html) {
  return http === 403 || http === 429 || /<title>\s*(Cloudflare|Just a moment|Un momento)/i.test(html);
}

async function buscar({ log = () => {} } = {}) {
  const marcas = await productsRepository.findMarcas();
  const resumen = { en: new Date().toISOString(), ok: false, aplicados: 0, sinMarca: 0, paginas: [] };
  const cupones = [];
  const sinAlcance = [];
  const sinMonto = [];
  const candidatos = [];

  for (const url of urls()) {
    try {
      const { http, html } = await scraperService.fetchPagina(url, { useProxy: env.workerOrigen === 'servidor' });
      if (pareceBloqueo(http, html)) throw new Error(`bloqueada por Falabella (HTTP ${http})`);
      if (http !== 200) throw new Error(`HTTP ${http}`);
      const r = extraerCuponesDePagina(html, marcas);
      resumen.paginas.push({ url, ok: true, kb: Math.round(html.length / 1024), nextData: r.tieneNextData, cupones: r.cupones.length, sinMarca: r.sinAlcance.length });
      cupones.push(...r.cupones);
      sinAlcance.push(...r.sinAlcance);
      sinMonto.push(...(r.sinMonto || []));
      candidatos.push(...r.candidatos);
    } catch (e) {
      resumen.paginas.push({ url, ok: false, error: e.message });
    }
  }

  // Un mismo cupón publicado en dos páginas cuenta una vez.
  const unicos = [...new Map(cupones.map(c => [`${c.codigo}|${c.alcance}|${c.alcanceValor}`, c])).values()];

  resumen.ok = resumen.paginas.some(p => p.ok);
  resumen.aplicados = unicos.length;
  resumen.sinMarca = sinAlcance.length;
  // Solo se reemplaza si se encontró algo: si la página cambió de formato y no
  // se entiende, se conservan los anteriores (dejan de aplicarse solos a los 3 días).
  if (unicos.length) await couponsRepository.reemplazarAutomaticos(unicos);
  await workerStateRepository.guardar(CLAVE_RESUMEN, JSON.stringify(resumen)).catch(() => {});

  if (!resumen.ok) {
    log(`Cupones automáticos: no se pudo leer la página de cupones (${resumen.paginas.map(p => p.error).join('; ')}).`);
  } else {
    log(`Cupones automáticos: ${unicos.length} aplicados${sinAlcance.length ? `, ${sinAlcance.length} sin marca reconocible` : ''}.`);
  }
  return { resumen, cupones: unicos, sinAlcance, sinMonto, candidatos };
}

async function ultimoResumen() {
  try {
    return JSON.parse(await workerStateRepository.leer(CLAVE_RESUMEN));
  } catch {
    return null;
  }
}

module.exports = { buscar, ultimoResumen };
