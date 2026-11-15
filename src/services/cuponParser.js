// Detecta cupones de descuento dentro del JSON de un producto de Falabella.
//
// Falabella no publica un esquema estable para esto: el cupón puede venir
// como un campo propio (coupon/cupon...) o solo como texto dentro de un
// badge/sticker/promoción ("Cupón TECNO10: 10% extra, tope $50.000"). Por eso
// en vez de leer una ruta fija se recorre el JSON buscando cualquiera de las
// dos formas y se interpreta el texto. Función pura, sin red ni base de datos.

const RE_CLAVE = /coupon|cup[oó]n/i;
const RE_TEXTO = /cup[oó]n/i;
const MAX_PROFUNDIDAD = 10;
const MAX_NODOS = 30000;
const MAX_LARGO_TEXTO = 400;

// Campos largos o ajenos al precio donde "cupón" aparece en letra chica
// genérica y no describe una promo de este producto.
const CLAVES_IGNORADAS = new Set([
  'description', 'longDescription', 'shortDescription', 'specifications', 'attributes',
  'medias', 'mediaUrls', 'reviews', 'breadCrumb', 'breadcrumbs', 'seo', 'metaTags',
  'legalTexts', 'termsAndConditions', 'relatedProducts', 'variants', 'sellerInfo',
]);

const PALABRAS_NO_CODIGO = new Set([
  'EXTRA', 'DCTO', 'DESCUENTO', 'DESCUENTOS', 'DE', 'DEL', 'HASTA', 'ADICIONAL', 'CMR',
  'EXCLUSIVO', 'ONLINE', 'DISPONIBLE', 'APLICADO', 'CUPON', 'CUPÓN', 'CODIGO', 'CÓDIGO',
  'CON', 'TU', 'USA', 'INGRESA', 'POR', 'PARA', 'EN', 'TODO', 'OFF', 'APP',
]);

function aNumero(str) {
  const n = parseInt(String(str).replace(/\./g, '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function esCodigoValido(token) {
  if (!token || token.length < 4 || token.length > 25) return false;
  if (PALABRAS_NO_CODIGO.has(token)) return false;
  return /[A-Z]/.test(token);
}

function extraerCodigo(texto) {
  const patrones = [
    /[Cc][OoÓó][Dd][Ii][Gg][Oo](?:\s+de\s+cup[oó]n)?[:\s]+["“'«]?([A-Z0-9][A-Z0-9_-]{3,24})(?![A-Za-z0-9])/,
    /[Cc][Uu][Pp][OoÓó][Nn](?:\s+de\s+descuento)?[:\s]+["“'«]?([A-Z0-9][A-Z0-9_-]{3,24})(?![A-Za-z0-9])/,
  ];
  // Un texto todo en mayúsculas ("CUPÓN EXTRA 10%") no deja distinguir un
  // código de una palabra normal: ahí solo se acepta si trae algún dígito.
  const todoMayusculas = texto === texto.toUpperCase();
  for (const re of patrones) {
    const m = texto.match(re);
    if (!m) continue;
    const token = m[1];
    if (!esCodigoValido(token)) continue;
    if (todoMayusculas && !/\d/.test(token)) continue;
    return token;
  }
  return null;
}

// Interpreta una frase tipo "Cupón TECNO10: 10% dcto extra pagando con CMR,
// tope $50.000, en compras sobre $199.990".
function parseTextoCupon(textoOriginal) {
  // NFKC: las letras "negritas" de Unicode (𝗖𝗬𝗕𝗘𝗥𝟭𝟬) pasan a letras comunes.
  const texto = String(textoOriginal || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!texto) return null;

  const mTope = texto.match(/tope[^$\d]{0,40}\$?\s?(\d[\d.]*)/i);
  const mMin  = texto.match(/(?:compras?\s+(?:sobre|desde|iguales\s+o\s+superiores\s+a|superiores\s+a|mayores\s+a|de\s+m[aá]s\s+de)|(?:monto|compra)\s+m[ií]nim[oa](?:\s+de)?|m[ií]nimo\s+de(?:\s+compra)?(?:\s+de)?)[^$\d]{0,20}\$?\s?(\d[\d.]*)/i);
  const tope   = mTope ? aNumero(mTope[1]) : null;
  const minimo = mMin ? aNumero(mMin[1]) : null;

  const mPct = texto.match(/(\d{1,2})\s?%/);
  let tipo = null, valor = null;
  if (mPct) {
    tipo = 'porcentaje';
    valor = parseInt(mPct[1], 10);
  } else {
    const montos = [...texto.matchAll(/\$\s?(\d{1,3}(?:\.\d{3})+|\d{3,})/g)]
      .map(m => aNumero(m[1]))
      .filter(n => n && n !== tope && n !== minimo);
    if (montos.length) { tipo = 'monto'; valor = montos[0]; }
  }
  if (tipo === 'porcentaje' && !(valor > 0 && valor < 100)) { tipo = null; valor = null; }

  return {
    codigo: extraerCodigo(texto),
    tipo, valor,
    tope: tipo === 'porcentaje' ? tope : null,
    minimo,
    soloCMR: /\bcmr\b/i.test(texto),
    texto: texto.slice(0, 240),
  };
}

function aplanar(valor, partes, estado, profundidad = 0) {
  if (valor == null || profundidad > 5 || estado.n++ > 500) return;
  if (typeof valor === 'string' || typeof valor === 'number') {
    const s = String(valor).trim();
    if (s && s.length <= MAX_LARGO_TEXTO && !/^(https?:)?\/\//.test(s)) partes.push(s);
  } else if (Array.isArray(valor)) {
    for (const v of valor) aplanar(v, partes, estado, profundidad + 1);
  } else if (typeof valor === 'object') {
    for (const v of Object.values(valor)) aplanar(v, partes, estado, profundidad + 1);
  }
}

function buscarCodigoEnObjeto(valor, profundidad = 0) {
  if (!valor || typeof valor !== 'object' || profundidad > 4) return null;
  for (const [k, v] of Object.entries(valor)) {
    if (typeof v === 'string' && /code|c[oó]digo/i.test(k) && /^[A-Za-z0-9_-]{4,25}$/.test(v.trim())) return v.trim().toUpperCase();
    const anidado = buscarCodigoEnObjeto(v, profundidad + 1);
    if (anidado) return anidado;
  }
  return null;
}

function recolectar(nodo, ruta, out, estado, profundidad = 0) {
  if (nodo == null || profundidad > MAX_PROFUNDIDAD || estado.n++ > MAX_NODOS) return;

  if (typeof nodo === 'string') {
    if (nodo.length <= MAX_LARGO_TEXTO && RE_TEXTO.test(nodo) && !/^(https?:)?\/\//.test(nodo)) {
      out.push({ ruta, texto: nodo, codigo: null });
    }
    return;
  }
  if (typeof nodo !== 'object') return;

  if (Array.isArray(nodo)) {
    nodo.forEach((v, i) => recolectar(v, `${ruta}[${i}]`, out, estado, profundidad + 1));
    return;
  }

  for (const [clave, valor] of Object.entries(nodo)) {
    if (CLAVES_IGNORADAS.has(clave)) continue;
    const subRuta = ruta ? `${ruta}.${clave}` : clave;
    if (RE_CLAVE.test(clave)) {
      // Campo dedicado a cupones: se toma entero como una unidad.
      if (valor == null || valor === false || valor === '' || (Array.isArray(valor) && !valor.length)) continue;
      const partes = [];
      aplanar(valor, partes, { n: 0 });
      if (partes.length) {
        const codigo = typeof valor === 'string' && /^[A-Za-z0-9_-]{4,25}$/.test(valor.trim())
          ? valor.trim().toUpperCase()
          : buscarCodigoEnObjeto(valor);
        out.push({ ruta: subRuta, texto: partes.join(' '), codigo, deClave: true });
      }
      continue;
    }
    recolectar(valor, subRuta, out, estado, profundidad + 1);
  }
}

// `fuentes` = objetos donde buscar (la variante elegida, el producto sin sus
// otras variantes, o un item de resultados de búsqueda). Devuelve el cupón
// más completo que encuentre, o null.
function detectarCupon(...fuentes) {
  const hallazgos = [];
  const estado = { n: 0 };
  for (const f of fuentes) recolectar(f, '', hallazgos, estado);
  if (!hallazgos.length) return null;

  const candidatos = hallazgos.map(h => {
    const c = parseTextoCupon(h.texto);
    if (!c) return null;
    if (h.codigo && !c.codigo) c.codigo = h.codigo;
    // Un campo "coupon" que no menciona la palabra cupón igual lo es.
    const puntaje = (c.tipo ? 4 : 0) + (c.codigo ? 2 : 0) + (h.deClave ? 1 : 0);
    return { ...c, ruta: h.ruta, puntaje };
  }).filter(Boolean);
  if (!candidatos.length) return null;

  candidatos.sort((a, b) => b.puntaje - a.puntaje);
  const mejor = candidatos[0];
  if (!mejor.codigo) mejor.codigo = candidatos.find(c => c.codigo)?.codigo || null;
  const { puntaje, ...cupon } = mejor;
  return cupon;
}

module.exports = { detectarCupon, parseTextoCupon };
