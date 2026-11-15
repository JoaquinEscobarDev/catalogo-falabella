// Cupones de descuento y cálculo del precio final.
//
// Dos orígenes:
//   - 'falabella': detectado solo al scrapear la página del producto
//     (products.cupon, ver cuponParser.js).
//   - 'manual': cupones de campaña cargados desde la app (tabla coupons), que
//     aplican a todo, una categoría, una marca o SKUs puntuales.

const couponsRepository = require('../repositories/couponsRepository');
const cuponesAutoService = require('./cuponesAutoService');
const productsRepository = require('../repositories/productsRepository');

function badRequest(msg) {
  const err = new Error(msg);
  err.status = 400;
  return err;
}

function enteroPositivo(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).replace(/\./g, '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizar(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

// Lista para la ventana de cupones: los automáticos (detectados en la página
// de cupones de Falabella) y los cargados a mano, más el resultado de la
// última búsqueda automática.
async function listAll() {
  // Lo que ya no está vigente se borra antes de listar.
  await couponsRepository.eliminarNoVigentes().catch(() => {});
  const [cupones, fichas, conteo, busqueda] = await Promise.all([
    couponsRepository.findAll(),
    productsRepository.findCuponesEnFichas(),
    productsRepository.contarProductos(),
    cuponesAutoService.ultimoResumen(),
  ]);
  return { cupones, enFichas: agruparCuponesDeFichas(fichas), conteo, busqueda };
}

// Un mismo cupón suele aparecer en la ficha de varios productos: se agrupa
// (por código, o por su texto si no trae código) para listarlo una vez.
function agruparCuponesDeFichas(filas) {
  const grupos = new Map();
  for (const f of filas) {
    const c = f.cupon || {};
    const clave = c.codigo || `${c.tipo || ''}|${c.valor || ''}|${normalizar(c.texto)}`;
    if (!grupos.has(clave)) grupos.set(clave, { cupon: c, productos: [], marcas: new Set() });
    const g = grupos.get(clave);
    g.productos.push({ sku: f.sku, nombre: f.nombre, categoria: f.categoria });
    if (f.marca) g.marcas.add(f.marca);
  }
  return [...grupos.values()].map(({ cupon: c, productos, marcas }) => {
    const listaMarcas = [...marcas];
    return {
      codigo: c.codigo || null, tipo: c.tipo || null, valor: c.valor || null,
      tope: c.tope || null, minimo: c.minimo || null, soloCMR: !!c.soloCMR,
      texto: textoLegible(c.texto, listaMarcas.length === 1 ? listaMarcas[0] : null),
      marcas: listaMarcas,
      productos: productos.length,
      ejemplos: productos.slice(0, 3),
    };
  }).sort((a, b) => b.productos - a.productos);
}

async function create(body) {
  const codigo = String(body.codigo || '').trim().toUpperCase();
  if (!codigo) throw badRequest('Falta el código del cupón');
  if (codigo.length > 40) throw badRequest('Código demasiado largo');

  const tipo = body.tipo;
  if (tipo !== 'porcentaje' && tipo !== 'monto') throw badRequest('Tipo inválido (porcentaje o monto)');
  const valor = enteroPositivo(body.valor);
  if (!valor) throw badRequest('Falta el valor del descuento');
  if (tipo === 'porcentaje' && valor >= 100) throw badRequest('El porcentaje debe ser menor a 100');

  const alcance = body.alcance || 'todos';
  if (!['todos', 'categoria', 'marca', 'sku'].includes(alcance)) throw badRequest('Alcance inválido');
  const alcanceValor = alcance === 'todos' ? null : String(body.alcanceValor || '').trim();
  if (alcance !== 'todos' && !alcanceValor) throw badRequest('Falta indicar a qué aplica el cupón');

  let vence = null;
  if (body.vence) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.vence)) throw badRequest('Fecha de vencimiento inválida');
    vence = body.vence;
  }

  const id = await couponsRepository.insert({
    codigo, tipo, valor,
    tope: tipo === 'porcentaje' ? enteroPositivo(body.tope) : null,
    minimo: enteroPositivo(body.minimo),
    soloCMR: body.soloCMR === true,
    alcance, alcanceValor, vence,
  });
  return id;
}

async function remove(id) {
  await couponsRepository.remove(id);
}

// ── Cálculo ──

function aplicaA(cupon, producto, sku, categoria) {
  switch (cupon.alcance) {
    case 'todos':     return true;
    case 'categoria': return normalizar(cupon.alcanceValor) === normalizar(categoria);
    case 'marca':     return !!producto.marca && normalizar(cupon.alcanceValor) === normalizar(producto.marca);
    case 'sku':       return String(cupon.alcanceValor || '').split(/[\s,;]+/).includes(String(sku));
    default:          return false;
  }
}

function descontar(base, cupon) {
  if (!base) return null;
  if (cupon.minimo && base < cupon.minimo) return null;
  let descuento = cupon.tipo === 'porcentaje' ? Math.round(base * cupon.valor / 100) : cupon.valor;
  if (cupon.tipo === 'porcentaje' && cupon.tope) descuento = Math.min(descuento, cupon.tope);
  descuento = Math.min(descuento, base);
  return { base, descuento, final: base - descuento };
}

// Un cupón se aplica sobre el precio que el cliente paga:
//   - con cualquier medio de pago → precio oferta (o normal si no hay oferta)
//   - pagando con CMR             → precio CMR (o el anterior si no hay precio CMR)
// Si el cupón es exclusivo CMR solo existe el segundo cálculo.
function calcular(cupon, producto) {
  const baseGeneral = producto.precioOferta || producto.precio || null;
  const baseCMR     = producto.precioCMR || baseGeneral;

  const general = cupon.soloCMR ? null : descontar(baseGeneral, cupon);
  // Sin precio CMR propio y con cupón para todo medio de pago, el cálculo
  // CMR sería idéntico al general: no se repite.
  const cmr = (cupon.soloCMR || producto.precioCMR) ? descontar(baseCMR, cupon) : null;

  const finales = [general?.final, cmr?.final].filter(n => n != null);
  return {
    precioFinal: general ? general.final : null,
    descuento: general ? general.descuento : null,
    precioFinalCMR: cmr ? cmr.final : null,
    descuentoCMR: cmr ? cmr.descuento : null,
    mejorPrecio: finales.length ? Math.min(...finales) : null,
  };
}

function etiqueta(cupon) {
  if (cupon.tipo === 'porcentaje') return `${cupon.valor}%`;
  if (cupon.tipo === 'monto') return `$${Number(cupon.valor).toLocaleString('es-CL')}`;
  return null;
}

// Devuelve los cupones que aplican a un producto con su precio final ya
// calculado, del más conveniente al menos.
// Falabella marca en la ficha los productos que participan de una campaña de
// cupón con un identificador interno, p. ej. "F14-CP-CUPON-PHILIPS-1P", sin el
// monto ni el código. En vez de mostrar ese identificador, se dice qué es.
const RE_ID_INTERNO = /^[A-Z0-9]+(?:[-_][A-Z0-9]+){2,}$/;

function textoLegible(texto, marca) {
  const t = String(texto || '').trim();
  if (!t) return 'Cupón disponible';
  if (!RE_ID_INTERNO.test(t)) return t;
  const m = t.match(/CUPON[-_]([A-Z0-9]+)/);
  const nombre = (m && m[1].length > 2 ? m[1] : marca) || '';
  const lindo = nombre ? nombre.charAt(0) + nombre.slice(1).toLowerCase() : '';
  return `Participa de una campaña de cupón${lindo ? ` ${lindo}` : ''}. La ficha no dice el monto ni el código: revisalos en la página de cupones de Falabella.`;
}

function cuponesDe(producto, sku, categoria, cuponesManuales) {
  const lista = [];

  const auto = producto.cuponDetectado;
  if (auto) {
    lista.push({
      origen: 'falabella', codigo: auto.codigo || null, tipo: auto.tipo || null, valor: auto.valor || null,
      tope: auto.tope || null, minimo: auto.minimo || null, soloCMR: !!auto.soloCMR,
      texto: textoLegible(auto.texto, producto.marca), vence: null, aviso: !auto.tipo,
    });
  }
  // Primero los automáticos y después los manuales: ante un mismo código,
  // el último en entrar reemplaza al anterior, así manda el cargado a mano
  // (el usuario lo puso con las condiciones exactas), después el de la página
  // de cupones y al final el que se vio en la ficha del producto.
  const ordenados = [...cuponesManuales].sort((a, b) => (a.origen === 'automatico' ? 0 : 1) - (b.origen === 'automatico' ? 0 : 1));
  for (const c of ordenados) {
    if (!aplicaA(c, producto, sku, categoria)) continue;
    const repetido = lista.findIndex(x => x.codigo && x.codigo === c.codigo);
    if (repetido >= 0) lista.splice(repetido, 1);
    lista.push({
      origen: c.origen === 'automatico' ? 'falabella' : 'manual',
      id: c.id, codigo: c.codigo, tipo: c.tipo, valor: c.valor,
      tope: c.tope, minimo: c.minimo, soloCMR: c.soloCMR, texto: c.texto || null, vence: c.vence,
    });
  }

  // Un aviso de la ficha sin monto ("este producto participa de una campaña de
  // cupón") sobra si ya hay un cupón concreto, con su descuento, que aplica.
  const hayConcreto = lista.some(c => c.tipo);
  const finales = hayConcreto ? lista.filter(c => c.tipo) : lista;

  return finales.map(c => {
    const calc = c.tipo ? calcular(c, producto) : { precioFinal: null, descuento: null, precioFinalCMR: null, descuentoCMR: null, mejorPrecio: null };
    // noAplica: el cupón existe pero el precio no alcanza la compra mínima.
    const noAplica = !!c.tipo && calc.mejorPrecio == null;
    return { ...c, etiqueta: etiqueta(c), ...calc, noAplica };
  }).sort((a, b) => (a.mejorPrecio ?? Infinity) - (b.mejorPrecio ?? Infinity));
}

// Agrega `cupones` a un producto (o lista) ya mapeado desde la base.
function decorar(producto, sku, categoria, cuponesManuales) {
  if (!producto) return producto;
  const { cuponDetectado, ...resto } = producto;
  return { ...resto, cupones: cuponesDe(producto, sku, categoria, cuponesManuales) };
}

async function vigentes() {
  return couponsRepository.findVigentes();
}

module.exports = { listAll, create, remove, vigentes, decorar, cuponesDe, calcular };
