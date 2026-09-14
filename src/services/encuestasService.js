const repo = require('../repositories/encuestasRepository');

const TIENDAS = ['los-dominicos', 'parque-arauco', 'costanera', 'plaza-egana'];
const TIENDAS_DISPLAY = {
  'los-dominicos': 'Los Dominicos',
  'parque-arauco': 'Parque Arauco',
  'costanera':     'Costanera',
  'plaza-egana':   'Plaza Egaña',
};

const P1_OPTS = ['precio-o-promocion','asesoria-especializada','conocer-y-probar-productos','variedad-marcas-productos','experiencia-rapida-facil','garantia-servicio-postventa'];
const P2_OPTS = ['si','no'];
const P3_OPTS = ['conocimiento-profundo','recomendar-necesidades','comparar-alternativas','explicar-simple','mejor-decision'];
const P4_OPTS = ['cual-producto-adaptarse','demasiadas-alternativas','entender-diferencias','informacion-insuficiente','precio-promociones','sin-dificultades'];
const P5_OPTS = ['siempre-consideraria','evaluaria-precio','solo-descuento','rara-vez','nunca'];

function err(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

async function crearEncuesta({ tienda, p1, p2, p3, p4, p5 }) {
  if (!TIENDAS.includes(tienda))      throw err('Tienda inválida');
  if (!P1_OPTS.includes(p1))          throw err('Respuesta P1 inválida');
  if (!P2_OPTS.includes(p2))          throw err('Respuesta P2 inválida');

  const p3arr = (Array.isArray(p3) ? p3 : [p3]).filter(Boolean);
  if (!p3arr.length || !p3arr.every(v => P3_OPTS.includes(v))) throw err('Respuesta P3 inválida');

  if (!P4_OPTS.includes(p4))          throw err('Respuesta P4 inválida');
  if (!P5_OPTS.includes(p5))          throw err('Respuesta P5 inválida');

  return repo.create({ tienda, p1, p2, p3: p3arr.join(','), p4, p5 });
}

async function obtenerEncuestas(tienda) {
  return repo.findAll(tienda || null);
}

async function resumenPorTienda() {
  return repo.countByTienda();
}

module.exports = { crearEncuesta, obtenerEncuestas, resumenPorTienda, TIENDAS, TIENDAS_DISPLAY, P1_OPTS, P2_OPTS, P3_OPTS, P4_OPTS, P5_OPTS };
