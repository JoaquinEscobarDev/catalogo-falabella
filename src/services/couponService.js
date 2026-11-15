// Cupones de descuento y cálculo del precio final.
//
// Dos orígenes:
//   - 'falabella': detectado solo al scrapear la página del producto
//     (products.cupon, ver cuponParser.js).
//   - 'manual': cupones de campaña cargados desde la app (tabla coupons), que
//     aplican a todo, una categoría, una marca o SKUs puntuales.

const couponsRepository = require('../repositories/couponsRepository');

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

async function listAll() {
  return couponsRepository.findAll();
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
function cuponesDe(producto, sku, categoria, cuponesManuales) {
  const lista = [];

  const auto = producto.cuponDetectado;
  if (auto) {
    lista.push({
      origen: 'falabella', codigo: auto.codigo || null, tipo: auto.tipo || null, valor: auto.valor || null,
      tope: auto.tope || null, minimo: auto.minimo || null, soloCMR: !!auto.soloCMR,
      texto: auto.texto || null, vence: null,
    });
  }
  for (const c of cuponesManuales) {
    if (!aplicaA(c, producto, sku, categoria)) continue;
    // Si el mismo código ya vino detectado desde Falabella, manda el manual
    // (es el que el usuario cargó con las condiciones exactas).
    const repetido = lista.findIndex(x => x.codigo && x.codigo === c.codigo);
    if (repetido >= 0) lista.splice(repetido, 1);
    lista.push({
      origen: 'manual', id: c.id, codigo: c.codigo, tipo: c.tipo, valor: c.valor,
      tope: c.tope, minimo: c.minimo, soloCMR: c.soloCMR, texto: null, vence: c.vence,
    });
  }

  return lista.map(c => {
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
