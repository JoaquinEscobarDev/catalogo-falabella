// Detecta si un producto de Falabella es un equipo "Connect" (vendido con
// plan de una compañía: portabilidad o línea nueva) y lee el plan desde los
// textos de su ficha: compañía, valor mensual, tipo y nombre del plan.
//
// Igual que cuponParser.js, no depende de una ruta fija del JSON (no se
// conoce): recorre los textos cortos del producto (nombre, badges, stickers,
// promociones) y los interpreta. Función pura, sin red ni base de datos.

const COMPANIAS = [
  ['Entel', /\bentel\b/i],
  ['Movistar', /\bmovistar\b/i],
  ['WOM', /\bwom\b/i],
  ['Claro', /\bclaro\b/i],
];

// Campos largos o ajenos donde una compañía puede aparecer sin que el
// producto venga con plan ("compatible con todas las compañías...").
const CLAVES_IGNORADAS = new Set([
  'description', 'longDescription', 'shortDescription', 'specifications', 'attributes',
  'medias', 'mediaUrls', 'reviews', 'breadCrumb', 'breadcrumbs', 'seo', 'metaTags',
  'legalTexts', 'termsAndConditions', 'relatedProducts', 'variants', 'sellerInfo',
  'warrantyOptions', 'installmentsWithoutInterest',
]);
const MAX_LARGO_TEXTO = 300;
// Campos técnicos ("type": "plan_badge", ids): no son texto del plan.
const CLAVES_TECNICAS = /^(type|__typename|_?id|key|uid|slug|variant|className)$/i;
// "+ Plan Entel ..." es el nombre del equipo, no del plan: lo que sigue
// (capacidad, color) no es el nombre ni los gigas del plan.
const RE_PLAN_COMPANIA = /plan\s+(entel|movistar|wom|claro)\b/i;

function aNumero(str) {
  const n = parseInt(String(str).replace(/\./g, '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function textosCortos(nodo, out = [], prof = 0, estado = { n: 0 }) {
  if (nodo == null || prof > 8 || estado.n++ > 20000) return out;
  if (typeof nodo === 'string') {
    const t = nodo.normalize('NFKC').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (t && t.length <= MAX_LARGO_TEXTO && !/^(https?:)?\/\//.test(t)) out.push(t);
    return out;
  }
  if (typeof nodo !== 'object') return out;
  if (Array.isArray(nodo)) {
    for (const v of nodo) textosCortos(v, out, prof + 1, estado);
    return out;
  }
  for (const [k, v] of Object.entries(nodo)) {
    if (CLAVES_IGNORADAS.has(k) || CLAVES_TECNICAS.test(k)) continue;
    textosCortos(v, out, prof + 1, estado);
  }
  return out;
}

// Valor mensual: "$24.990 mensual", "$24.990/mes", "$24.990 al mes",
// "plan ... $24.990", "cargo fijo $24.990".
function leerMensual(texto) {
  const patrones = [
    /\$\s?(\d{1,3}(?:\.\d{3})+|\d{4,6})\s*(?:\/\s*mes|mensual(?:es)?|al mes|x mes|por mes)/i,
    /(?:mensual(?:idad)?|cargo fijo|al mes|\/mes)[^$\d]{0,20}\$\s?(\d{1,3}(?:\.\d{3})+|\d{4,6})/i,
    /plan[^$]{0,40}\$\s?(\d{1,3}(?:\.\d{3})+|\d{4,6})/i,
  ];
  for (const re of patrones) {
    const m = texto.match(re);
    if (m) {
      const n = aNumero(m[1]);
      // Un plan móvil cuesta entre unos miles y ~100 mil al mes; un número
      // fuera de eso es el precio del equipo, no la mensualidad.
      if (n >= 3000 && n <= 150000) return n;
    }
  }
  return null;
}

function leerTipo(texto) {
  const porta = /portabilidad|portate|p[oó]rtate|cambiate|c[aá]mbiate/i.test(texto);
  const nueva = /l[ií]nea nueva|alta nueva|n[uú]mero nuevo|nueva l[ií]nea/i.test(texto);
  if (porta && nueva) return 'ambos';
  if (porta) return 'portabilidad';
  if (nueva) return 'linea_nueva';
  return null;
}

// "Plan Libre 300GB", "Plan 5G Ilimitado" → nombre corto del plan.
function leerNombrePlan(texto) {
  const m = texto.match(/plan\s+([^.,;·|()$]{2,40})/i);
  if (!m) return null;
  const nombre = m[1].replace(/\s+(entel|movistar|wom|claro)\b.*$/i, '').trim();
  return nombre ? `Plan ${nombre}` : null;
}

// Gigas del plan: solo si van pegados a la palabra plan o a "gigas"/"datos",
// para no confundirlos con el almacenamiento del equipo (128GB).
function leerGigas(texto) {
  const m = texto.match(/plan[^.]{0,30}?(\d{2,4})\s?(?:gb|gigas)\b/i) || texto.match(/(\d{2,4})\s?(?:gigas|gb de datos|gb datos)\b/i);
  return m ? parseInt(m[1], 10) : null;
}

// Falabella marca la compañía del equipo en attributes.connectOperator de la
// variante: "Liberado" para los equipos sin plan, o el nombre de la compañía
// para los que se venden con plan. (Visto en una ficha real el 15-11-2026.)
function operadorDeAtributos(fuentes) {
  for (const f of fuentes) {
    const op = f?.attributes?.connectOperator ?? f?.connectOperator;
    if (typeof op === 'string' && op.trim()) return op.trim();
  }
  return null;
}

// fuentes: la variante elegida y el producto sin sus otras variantes (o un
// item de resultados de búsqueda). Devuelve null si no parece un equipo con plan.
function detectarPlan(...fuentes) {
  const operador = operadorDeAtributos(fuentes);
  const companiaOperador = operador ? (COMPANIAS.find(([, re]) => re.test(operador)) || [null])[0] : null;
  // Equipo liberado: no viene con plan, aunque algún texto nombre compañías.
  if (operador && !companiaOperador && /liberado/i.test(operador)) return null;

  const textos = [];
  for (const f of fuentes) textosCortos(f, textos);
  if (!textos.length && !companiaOperador) return null;

  // Solo cuenta si algún texto menciona una compañía junto con "plan",
  // "portabilidad", "línea nueva" o un valor mensual: así un "Claro" suelto
  // (p. ej. un color) no convierte a un equipo cualquiera en Connect.
  const relevantes = textos.filter(t =>
    COMPANIAS.some(([, re]) => re.test(t)) && (/plan|portabilidad|l[ií]nea nueva|mensual|\/mes|al mes/i.test(t))
  );
  // El campo connectOperator con una compañía alcanza para saber que es Connect.
  if (!relevantes.length && !companiaOperador) return null;

  const compania = companiaOperador || (COMPANIAS.find(([, re]) => re.test(relevantes.join(' '))) || [null])[0];

  // Ya se sabe que es un equipo con plan: los datos del plan pueden venir en
  // otros textos que no repiten la compañía ("Plan Libre 300GB $24.990 mensual").
  const delPlan = [...new Set([...relevantes, ...textos.filter(t => /plan|portabilidad|l[ií]nea nueva|mensual|\/mes|al mes|gigas/i.test(t))])];
  const todo = delPlan.join(' · ');

  // Nombre y gigas solo de textos que describen el plan, no del nombre del
  // equipo ("Galaxy S24 128GB + Plan Entel 256GB Negro").
  const descriptivos = delPlan.filter(t => !RE_PLAN_COMPANIA.test(t));
  let nombre = null;
  for (const t of descriptivos) {
    nombre = leerNombrePlan(t);
    if (nombre) break;
  }
  const gigas = descriptivos.length ? leerGigas(descriptivos.join(' · ')) : null;

  return {
    compania,
    mensual: leerMensual(todo),
    tipo: leerTipo(todo),
    nombre,
    gigas,
    texto: (todo || `connectOperator: ${operador}`).slice(0, 240),
  };
}

module.exports = { detectarPlan, leerMensual, leerTipo };
