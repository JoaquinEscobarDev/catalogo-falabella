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
  const [cupones, fichas, conteo, busqueda, filasOcultas] = await Promise.all([
    couponsRepository.findAll(),
    productsRepository.findCuponesEnFichas(),
    productsRepository.contarProductos(),
    cuponesAutoService.ultimoResumen(),
    couponsRepository.findOcultos(),
  ]);
  const ocultos = new Set(filasOcultas.map(o => o.clave));
  return {
    cupones: cupones.filter(c => c.origen !== 'automatico' || !estaOculto(ocultos, c)),
    enFichas: agruparCuponesDeFichas(fichas.filter(f => !estaOculto(ocultos, f.cupon))),
    ocultos: filasOcultas,
    conteo, busqueda,
  };
}

// Un mismo cupón suele aparecer en la ficha de varios productos: se agrupa
// (por código, o por su texto si no trae código) para listarlo una vez.
// Identifica un cupón visto en las fichas: por su código o, si no trae, por su texto.
function claveFicha(c) {
  return (c && c.codigo) || `${c?.tipo || ''}|${c?.valor || ''}|${normalizar(c?.texto)}`;
}

function agruparCuponesDeFichas(filas) {
  const grupos = new Map();
  for (const f of filas) {
    const c = f.cupon || {};
    const clave = claveFicha(c);
    if (!grupos.has(clave)) grupos.set(clave, { cupon: c, productos: [], marcas: new Set() });
    const g = grupos.get(clave);
    g.productos.push({ sku: f.sku, nombre: f.nombre, categoria: f.categoria });
    if (f.marca) g.marcas.add(f.marca);
  }
  return [...grupos.values()].map(({ cupon: c, productos, marcas }) => {
    const listaMarcas = [...marcas];
    return {
      clave: claveFicha(c),
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

  const ocultos = cuponesManuales.ocultos;
  const auto = producto.cuponDetectado;
  if (auto && !estaOculto(ocultos, auto)) {
    lista.push({
      origen: 'falabella', codigo: auto.codigo || null, tipo: auto.tipo || null, valor: auto.valor || null,
      tope: auto.tope || null, minimo: auto.minimo || null, soloCMR: !!auto.soloCMR,
      // En la tarjeta va el texto tal como viene en la ficha (corto); la
      // explicación larga queda para el detalle.
      texto: auto.texto || null, explicacion: textoLegible(auto.texto, producto.marca),
      vence: null, aviso: !auto.tipo, clave: claveFicha(auto),
    });
  }
  // Primero los automáticos y después los manuales: ante un mismo código,
  // el último en entrar reemplaza al anterior, así manda el cargado a mano
  // (el usuario lo puso con las condiciones exactas), después el de la página
  // de cupones y al final el que se vio en la ficha del producto.
  const ordenados = [...cuponesManuales].sort((a, b) => (a.origen === 'automatico' ? 0 : 1) - (b.origen === 'automatico' ? 0 : 1));
  for (const c of ordenados) {
    if (!aplicaA(c, producto, sku, categoria)) continue;
    if (c.origen === 'automatico' && estaOculto(ocultos, c)) continue;
    const repetido = lista.findIndex(x => x.codigo && x.codigo === c.codigo);
    if (repetido >= 0) lista.splice(repetido, 1);
    lista.push({
      origen: c.origen === 'automatico' ? 'falabella' : 'manual',
      id: c.id, codigo: c.codigo, tipo: c.tipo, valor: c.valor,
      tope: c.tope, minimo: c.minimo, soloCMR: c.soloCMR, texto: c.texto || null, vence: c.vence,
      general: !!c.general,
    });
  }

  // Se muestran todos: también los avisos de la ficha sin monto (campaña
  // Philips, cupontel10...), que son propios del producto aunque además
  // aplique un cupón general del sitio.
  return lista.map(c => {
    const calc = c.tipo ? calcular(c, producto) : { precioFinal: null, descuento: null, precioFinalCMR: null, descuentoCMR: null, mejorPrecio: null };
    // noAplica: el cupón existe pero el precio no alcanza la compra mínima.
    const noAplica = !!c.tipo && calc.mejorPrecio == null;
    return { ...c, etiqueta: etiqueta(c), ...calc, noAplica };
  // Orden: primero los cupones del producto con descuento, después los avisos
  // de la ficha sin monto y al final los generales del sitio (CYBER10...).
  }).sort((a, b) => rangoCupon(a) - rangoCupon(b) || (a.mejorPrecio ?? Infinity) - (b.mejorPrecio ?? Infinity));
}

function rangoCupon(c) {
  if (c.general) return 2;
  return c.tipo ? 0 : 1;
}

// Agrega `cupones` a un producto (o lista) ya mapeado desde la base.
function decorar(producto, sku, categoria, cuponesManuales) {
  if (!producto) return producto;
  const { cuponDetectado, ...resto } = producto;
  return { ...resto, cupones: cuponesDe(producto, sku, categoria, cuponesManuales) };
}

// ¿El usuario ocultó este cupón? Se compara por código, por la clave del
// cupón de ficha y por su texto (para avisos sin código como "cupontel10").
function estaOculto(ocultos, c) {
  if (!ocultos || !ocultos.size || !c) return false;
  return (c.codigo && ocultos.has(String(c.codigo).toUpperCase()))
    || ocultos.has(claveFicha(c))
    || (c.texto && ocultos.has(`txt:${normalizar(c.texto)}`));
}

async function vigentes() {
  const [cupones, filasOcultas] = await Promise.all([
    couponsRepository.findVigentes(),
    couponsRepository.findOcultos().catch(() => []),
  ]);
  // Las claves ocultas viajan junto a la lista hasta cuponesDe(), que es
  // donde se arma lo que muestra cada tarjeta.
  cupones.ocultos = new Set(filasOcultas.map(o => o.clave));
  return cupones;
}

// Productos a los que aplica un cupón, con sus precios y el precio final.
//   { id }    → cupón de la tabla (página de cupones o cargado a mano)
//   { clave } → cupón visto en las fichas de producto
async function productosDeCupon({ id, clave }) {
  const filas = await productsRepository.findParaCupones();
  let cupon = null;
  let lista = [];

  if (id) {
    cupon = (await couponsRepository.findVigentes()).find(c => c.id === Number(id));
    if (!cupon) {
      const err = new Error('El cupón ya no está vigente');
      err.status = 404;
      throw err;
    }
    lista = filas.filter(f => aplicaA(cupon, { marca: f.marca }, f.sku, f.categoria));
  } else if (clave) {
    lista = filas.filter(f => f.cupon && f.fresco && claveFicha(f.cupon) === clave);
    if (lista.length) {
      const c = lista[0].cupon;
      cupon = {
        codigo: c.codigo || null, tipo: c.tipo || null, valor: c.valor || null, tope: c.tope || null,
        minimo: c.minimo || null, soloCMR: !!c.soloCMR, texto: c.texto || null,
      };
    }
  }
  if (!cupon) {
    const err = new Error('No se encontró el cupón');
    err.status = 404;
    throw err;
  }

  const productos = lista.map(f => {
    const prod = { precio: f.precio_normal, precioOferta: f.precio_oferta, precioCMR: f.precio_cmr };
    const calc = cupon.tipo ? calcular(cupon, prod) : {};
    return {
      sku: f.sku, nombre: f.nombre, marca: f.marca, upc: f.upc || null, categoria: f.categoria,
      precio: f.precio_normal, precioOferta: f.precio_oferta, precioCMR: f.precio_cmr,
      precioFinal: calc.precioFinal ?? null, precioFinalCMR: calc.precioFinalCMR ?? null,
    };
  });
  return {
    cupon: { ...cupon, etiqueta: etiqueta(cupon), explicacion: cupon.tipo ? null : textoLegible(cupon.texto, null) },
    productos,
  };
}

async function ocultar(body) {
  const clave = String(body.clave || '').trim();
  if (!clave || clave.length > 300) throw badRequest('Falta el cupón a ocultar');
  const etiqueta = String(body.etiqueta || clave).trim().slice(0, 120);
  await couponsRepository.ocultar(clave, etiqueta);
  // Si es un aviso sin código, también por su texto: así se oculta aunque
  // cambie su tipo o monto detectado.
  if (clave.startsWith('|') || /^[^|]*\|[^|]*\|/.test(clave)) {
    const texto = clave.split('|').slice(2).join('|');
    if (texto) await couponsRepository.ocultar(`txt:${texto}`, etiqueta);
  }
}

async function mostrar(clave) {
  // Se quitan todas las claves que ocultaban ese mismo cupón.
  const filas = await couponsRepository.findOcultos();
  const etiqueta = filas.find(f => f.clave === clave)?.etiqueta;
  for (const f of filas) {
    if (f.clave === clave || (etiqueta && f.etiqueta === etiqueta)) await couponsRepository.mostrar(f.clave);
  }
}

module.exports = { listAll, create, remove, vigentes, decorar, cuponesDe, calcular, productosDeCupon, ocultar, mostrar };
