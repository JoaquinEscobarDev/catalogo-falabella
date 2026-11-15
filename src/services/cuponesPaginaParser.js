// Lee la página de cupones de Falabella (falabella-cl/page/cupones-descuento)
// y devuelve los cupones de campaña que publica: código, % o monto, tope,
// compra mínima, si es solo con CMR, vencimiento y a qué marca aplica.
//
// Es una página armada con un CMS: no hay un esquema fijo. Por eso, igual que
// cuponParser.js, no se lee una ruta fija del JSON sino que se buscan los
// "bloques" (objetos del JSON, o trozos del HTML visible) que mencionan un
// cupón, y se interpreta su texto. Función pura, sin red ni base de datos.

const { parseTextoCupon } = require('./cuponParser');

const MAX_TEXTO_BLOQUE = 2500;
const CLAVES_TECNICAS = /^(type|__typename|_?id|key|uid|slug|component|componentName|variant|theme|color|backgroundColor|textColor|className|layout|position|order|target|rel)$/i;
const MAX_NODOS = 200000;

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

const RE_TODO_EL_SITIO = /todo el sitio|toda la tienda|todos los productos|cualquier producto|todo falabella/;

function normalizar(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function limpiarTexto(str) {
  return String(str)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#36;/g, '$')
    .replace(/\s+/g, ' ')
    .trim();
}

// "hasta el 30/11", "válido hasta el 30 de noviembre de 2026", "vence el domingo 30 de noviembre"
function parseVence(texto, hoy = new Date()) {
  const t = normalizar(texto);
  const prefijo = '(?:hasta|vence|vencimiento|vigente hasta|valido hasta|vigencia hasta)\\s+(?:el\\s+)?(?:[a-z]+\\s+)?';
  let dia, mes, anio = null;
  let m = t.match(new RegExp(`${prefijo}(\\d{1,2})[/.-](\\d{1,2})(?:[/.-](\\d{2,4}))?`));
  if (m) {
    dia = +m[1]; mes = +m[2]; anio = m[3] ? +m[3] : null;
  } else {
    m = t.match(new RegExp(`${prefijo}(\\d{1,2})\\s+de\\s+(${Object.keys(MESES).join('|')})(?:\\s+(?:de|del)\\s+(\\d{4}))?`));
    if (!m) return null;
    dia = +m[1]; mes = MESES[m[2]]; anio = m[3] ? +m[3] : null;
  }
  if (anio !== null && anio < 100) anio += 2000;
  if (!(mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31)) return null;
  if (anio === null) {
    // Sin año: el de este año, salvo que esa fecha ya haya pasado hace rato
    // (un "hasta el 5 de enero" leído en diciembre es del año siguiente).
    anio = hoy.getFullYear();
    if (new Date(anio, mes - 1, dia) < new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 60)) anio++;
  }
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (f.getUTCMonth() !== mes - 1) return null; // 31/11 y similares
  return f.toISOString().slice(0, 10);
}

// Marcas de la lista que aparecen como palabra completa en el texto.
function marcasEnTexto(texto, marcas) {
  const t = ` ${normalizar(texto).replace(/[^a-z0-9]+/g, ' ')} `;
  return marcas.filter(m => {
    const n = normalizar(m).replace(/[^a-z0-9]+/g, ' ').trim();
    return n.length >= 2 && t.includes(` ${n} `);
  });
}

// Strings de un objeto (hasta cierta profundidad), sin URLs, para leerlo como texto.
function textoDeObjeto(nodo) {
  const partes = [];
  let largo = 0;
  (function juntar(v, prof) {
    if (v == null || prof > 4 || largo > MAX_TEXTO_BLOQUE) return;
    if (typeof v === 'string') {
      if (/^(https?:)?\/\//.test(v) || /^[\w./-]+\.(png|jpe?g|webp|svg|gif)$/i.test(v)) return;
      const limpio = limpiarTexto(v);
      if (limpio) { partes.push(limpio); largo += limpio.length + 3; }
    } else if (typeof v === 'number') {
      // Los números sueltos (ids, posiciones) solo meten ruido.
    } else if (Array.isArray(v)) {
      for (const x of v) juntar(x, prof + 1);
    } else if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        // Campos técnicos del CMS ("type": "couponCard", ids, colores): no son texto del cupón.
        if (CLAVES_TECNICAS.test(k)) continue;
        juntar(x, prof + 1);
      }
    }
  })(nodo, 0);
  return partes.join(' · ');
}

// Código en un campo dedicado ({ couponCode: "SAMSUNG10" }), solo con nombres
// de campo inequívocos: "currencyCode" o "zipCode" no son cupones.
function codigoEnCampo(nodo) {
  for (const [k, v] of Object.entries(nodo)) {
    if (typeof v !== 'string') continue;
    if (/^(coupon|cupon|promo|discount|descuento)?_?(code|codigo)$|coupon.?code|cupon.?codigo|promo.?code/i.test(k)) {
      const c = v.trim().toUpperCase();
      if (/^[A-Z0-9_-]{4,25}$/.test(c) && /[A-Z]/.test(c)) return c;
    }
  }
  return null;
}

// Bloques candidatos desde el JSON de la página.
function bloquesDesdeJson(raiz) {
  const bloques = [];
  let n = 0;
  (function visitar(nodo, prof) {
    if (!nodo || typeof nodo !== 'object' || prof > 30 || n++ > MAX_NODOS) return;
    if (!Array.isArray(nodo)) {
      const texto = textoDeObjeto(nodo);
      const codigoCampo = codigoEnCampo(nodo);
      // Es candidato si el texto habla de un cupón o si el objeto tiene un
      // campo de código propio ({ couponCode: ... }) aunque el texto no lo diga.
      if (texto && texto.length <= MAX_TEXTO_BLOQUE && (codigoCampo || /cup[oó]n|c[oó]digo|coupon/i.test(texto))) {
        bloques.push({ texto, codigoCampo });
      }
    }
    for (const v of Object.values(nodo)) visitar(v, prof + 1);
  })(raiz, 0);
  return bloques;
}

// Bloques candidatos desde el HTML visible. Se pasa a líneas y cada línea con
// un código de cupón es un "ancla": su bloque va desde un título "Cupón ..."
// pegado arriba (si lo hay) hasta justo antes del bloque siguiente. Así cada
// cupón queda con sus propias líneas, sin mezclarse con el de al lado.
function bloquesDesdeHtml(html) {
  const lineas = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/span|\/a|\/section|\/article|\/button)[^>]*>/gi, '\n')
    .split('\n')
    .map(limpiarTexto)
    .filter(Boolean);

  const anclas = [];
  lineas.forEach((l, i) => { if (parseTextoCupon(l)?.codigo) anclas.push(i); });

  const inicios = anclas.map((a, k) => {
    const limite = k > 0 ? anclas[k - 1] + 1 : 0;
    let inicio = a;
    for (let j = a - 1; j >= Math.max(limite, a - 2); j--) {
      if (/cup[oó]n/i.test(lineas[j])) inicio = j;
    }
    return inicio;
  });

  const bloques = [];
  anclas.forEach((a, k) => {
    const fin = Math.min(k + 1 < anclas.length ? inicios[k + 1] : lineas.length, a + 8);
    // Del más chico al más grande: la línea del código sola y con su contexto.
    for (const hasta of [a + 1, Math.min(fin, a + 3), fin]) {
      const texto = lineas.slice(inicios[k], hasta).join(' · ');
      if (texto.length <= MAX_TEXTO_BLOQUE) bloques.push({ texto, codigoCampo: null });
    }
  });

  // Menciones de cupón sin código: solo sirven para el diagnóstico.
  lineas.forEach(l => {
    if (/cup[oó]n/i.test(l) && !parseTextoCupon(l)?.codigo) bloques.push({ texto: l, codigoCampo: null });
  });
  return bloques;
}

function leerNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// html: la página completa. marcas: marcas de los productos del catálogo.
// Devuelve:
//   cupones:     los que se pudieron interpretar y se sabe a qué aplican
//                (una entrada por marca; o alcance 'todos' si dice "todo el sitio")
//   sinAlcance:  interpretados, pero sin marca reconocible (no se aplican)
//   candidatos:  textos que mencionan un cupón pero no se pudieron interpretar
function extraerCuponesDePagina(html, marcas = [], hoy = new Date()) {
  const nextData = leerNextData(html);
  let bloques = nextData ? bloquesDesdeJson(nextData) : [];
  // También el HTML visible: hay páginas que traen el contenido ya renderizado.
  bloques = bloques.concat(bloquesDesdeHtml(html));

  // Interpretar cada bloque; un bloque sirve si tiene código y descuento.
  const interpretados = [];
  const candidatos = new Set();
  for (const b of bloques) {
    const c = parseTextoCupon(b.texto);
    const codigo = b.codigoCampo || c?.codigo;
    if (c && codigo && c.tipo) interpretados.push({ ...c, codigo, textoBloque: b.texto });
    else if (/cup[oó]n/i.test(b.texto) && b.texto.length >= 20) candidatos.add(b.texto.slice(0, 200));
  }

  // Un mismo cupón aparece en varios bloques anidados: se agrupa por código y
  // se usa el bloque más chico (el más específico) para leer las condiciones.
  const porCodigo = new Map();
  for (const it of interpretados) {
    if (!porCodigo.has(it.codigo)) porCodigo.set(it.codigo, []);
    porCodigo.get(it.codigo).push(it);
  }
  const todosLosCodigos = [...porCodigo.keys()];

  const cupones = [];
  const sinAlcance = [];
  for (const [codigo, lista] of porCodigo) {
    lista.sort((a, b) => a.textoBloque.length - b.textoBloque.length);
    const base = lista[0];

    // Los bloques más grandes que contienen SOLO este cupón (si traen otro
    // código, se mezclarían condiciones y marcas de cupones distintos) sirven
    // para completar lo que el bloque más chico no dice: marca, tope, mínimo,
    // vencimiento, si es solo con CMR.
    const exclusivos = [];
    for (const it of lista) {
      if (todosLosCodigos.some(x => x !== codigo && it.textoBloque.includes(x))) break;
      exclusivos.push(it);
    }
    const primero = (fn) => { for (const it of exclusivos) { const v = fn(it); if (v != null) return v; } return null; };

    let marcasCupon = [];
    let textoAlcance = base.textoBloque;
    for (const it of exclusivos) {
      const encontradas = marcasEnTexto(it.textoBloque, marcas);
      if (encontradas.length) { marcasCupon = encontradas; textoAlcance = it.textoBloque; break; }
    }

    const datos = {
      codigo,
      tipo: base.tipo,
      valor: base.valor,
      tope: base.tipo === 'porcentaje' ? (base.tope ?? primero(it => it.tope)) : null,
      minimo: base.minimo ?? primero(it => it.minimo),
      soloCMR: base.soloCMR || exclusivos.some(it => it.soloCMR),
      vence: primero(it => parseVence(it.textoBloque, hoy)),
      texto: (exclusivos[exclusivos.length - 1] || base).textoBloque.slice(0, 300),
    };

    if (marcasCupon.length) {
      for (const marca of marcasCupon) cupones.push({ ...datos, alcance: 'marca', alcanceValor: marca });
    } else if (RE_TODO_EL_SITIO.test(normalizar(textoAlcance))) {
      cupones.push({ ...datos, alcance: 'todos', alcanceValor: null });
    } else {
      sinAlcance.push(datos);
    }
  }

  return {
    tieneNextData: !!nextData,
    cupones,
    sinAlcance,
    // Sin los que mencionan un cupón ya interpretado: esos no aportan nada.
    candidatos: [...candidatos]
      .filter(t => !todosLosCodigos.some(c => t.includes(c)))
      .sort((a, b) => a.length - b.length)
      .slice(0, 10),
  };
}

module.exports = { extraerCuponesDePagina, parseVence, marcasEnTexto };
