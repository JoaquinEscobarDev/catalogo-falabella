// Lee los planes de un equipo desde su página de planes de Falabella
// (/falabella-cl/plans/{productId}/{slug}/{variantId}).
//
// Estructura vista en la página real (16-11-2026): pageProps.connectData.plans
// es una lista de planes con, entre otros:
//   operator: "WOM", planDisplayName: "PLAN RETAIL 500 GIGAS", monthlyCost: 24990,
//   contractPeriod: 18, saleTypes: ["SUSCRIPCION","PORTABILIDAD","MIGRACION"],
//   internet: "512000" (MB), minutes: 99999 (ilimitados), sms, ...
// El valor del equipo con cada plan no alcanzó a verse en el diagnóstico: se
// busca en los campos con nombre de precio (pieDe). Función pura.

const COMPANIAS = { WOM: 'WOM', ENTEL: 'Entel', MOVISTAR: 'Movistar', CLARO: 'Claro' };

function aNumero(v) {
  const n = parseInt(String(Array.isArray(v) ? v[0] : v ?? '').replace(/\./g, '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function compania(op) {
  const t = String(op?.name ?? op ?? '').toUpperCase();
  const k = Object.keys(COMPANIAS).find(c => t.includes(c));
  return k ? COMPANIAS[k] : null;
}

// Precio más bajo dentro de un valor con forma de precio de Falabella:
// número, "189.990", [{ type, price: ['189.990'] }], { value }, { prices: [...] }.
function precioDe(v, prof = 0) {
  if (v == null || prof > 3) return null;
  if (typeof v === 'number' || typeof v === 'string') return aNumero(v);
  if (Array.isArray(v)) {
    const ns = v.map(x => precioDe(x?.rawPrice ?? x?.price ?? x?.value ?? x?.amount ?? x, prof + 1)).filter(Boolean);
    return ns.length ? Math.min(...ns) : null;
  }
  if (typeof v === 'object') {
    for (const k of ['rawPrice', 'price', 'prices', 'value', 'amount', 'cmrPrice', 'internetPrice', 'normalPrice']) {
      if (v[k] != null) { const n = precioDe(v[k], prof + 1); if (n) return n; }
    }
  }
  return null;
}

// Valor del equipo con este plan: el menor entre los campos con nombre de
// precio del equipo. Se descartan los del plan (mensual, minutos, velocidad).
// Formato visto en la página real (16-11-2026): cada plan trae
//   prices: [{ priceType: 'internet', priceGroup: 'default', value: 22999000, ... }]
// con el valor del equipo en centavos (22999000 → $229.990).
function pieDePrecios(prices) {
  if (!Array.isArray(prices)) return null;
  const vals = prices
    .filter(p => p && typeof p === 'object' && p.priceType != null && p.value != null)
    .map(p => Math.round(Number(p.value) / 100))
    .filter(n => Number.isFinite(n) && n > 0);
  return vals.length ? Math.min(...vals) : null;
}

function pieDe(plan) {
  const enCentavos = pieDePrecios(plan?.prices);
  if (enCentavos) return enCentavos;
  const candidatos = [];
  for (const [k, v] of Object.entries(plan || {})) {
    if (!/price|precio|equipo|device|pie|downpayment|terminal|cuota.?inicial/i.test(k)) continue;
    // "lowestPrepaidPrice" es el precio del equipo SIN plan (prepago): no es el pie.
    if (/monthly|mensual|minute|speed|sms|mms|internet|prepaid|prepago/i.test(k)) continue;
    const n = precioDe(v);
    // Un equipo con plan puede costar desde $1 hasta varios millones.
    if (n && n < 5000000) candidatos.push(n);
  }
  return candidatos.length ? Math.min(...candidatos) : null;
}

function gigasDe(internet) {
  const mb = aNumero(internet);
  if (!mb) return null;
  if (mb >= 999999) return 'Libres';
  return Math.round(mb / 1024);
}

function tiposDe(saleTypes) {
  const t = (saleTypes || []).map(x => String(x).toUpperCase());
  const out = [];
  if (t.includes('PORTABILIDAD')) out.push('portabilidad');
  if (t.includes('SUSCRIPCION') || t.includes('ALTA')) out.push('linea_nueva');
  if (t.includes('MIGRACION')) out.push('migracion');
  return out;
}

function planesDeLista(lista) {
  return (lista || []).map(p => {
    const comp = compania(p.operator);
    if (!comp) return null;
    const minutos = aNumero(p.minutes);
    return {
      compania: comp,
      nombre: (p.planDisplayName || p.name || '').trim() || null,
      mensual: aNumero(p.monthlyCost),
      pie: pieDe(p),
      meses: aNumero(p.contractPeriod),
      gigas: gigasDe(p.internet),
      minutos: minutos ? (minutos >= 99999 ? 'Ilimitados' : minutos) : null,
      tipos: tiposDe(p.saleTypes),
      id: p.planId || p.connectItemId || null,
    };
  }).filter(p => p && p.mensual);
}

// HTML de la página de planes → { planes, porCompania }. porCompania guarda,
// para cada compañía, su plan más barato y la lista completa ordenada.
function extraerPlanesConnect(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return { hayDatos: false, planes: [], porCompania: null };
  let pp;
  try { pp = JSON.parse(m[1])?.props?.pageProps || {}; } catch { return { hayDatos: false, planes: [], porCompania: null }; }
  const cd = pp.connectData || {};
  const planes = planesDeLista(cd.plans || cd.planes || []);

  // (No se usa ningún precio de connectData como pie: ahí viene
  // lowestPrepaidPrice, que es el equipo sin plan.)
  const sinPlan = precioDe(cd.lowestPrepaidPrice);

  const porCompania = {};
  for (const p of planes) {
    (porCompania[p.compania] ||= []).push(p);
  }
  for (const c of Object.keys(porCompania)) {
    // "Más barato" = menor costo total del contrato (equipo + mensual × meses):
    // el plan de mensual más bajo a veces trae el equipo bastante más caro.
    const total = p => (p.pie != null ? p.pie + p.mensual * (p.meses || 12) : Infinity);
    const lista = porCompania[c].sort((a, b) => total(a) - total(b) || a.mensual - b.mensual);
    const masBarato = lista[0];
    porCompania[c] = {
      pie: masBarato.pie, mensual: masBarato.mensual, plan: masBarato.nombre,
      gigas: masBarato.gigas, minutos: masBarato.minutos, meses: masBarato.meses, tipos: masBarato.tipos,
      planes: lista.slice(0, 8),
    };
  }
  return {
    hayDatos: true,
    planes,
    porCompania: Object.keys(porCompania).length ? porCompania : null,
    camposConnectData: Object.keys(cd),
    camposPlan: Object.keys((cd.plans || [])[0] || {}),
    sinPlan,
  };
}

// Página de planes a partir de la URL del producto del listado:
// /falabella-cl/product/{productId}/{slug}/{skuId} → /falabella-cl/plans/...
function urlPlanes(urlProducto, base, productId, skuId) {
  if (urlProducto && urlProducto.includes('/product/')) return urlProducto.replace('/product/', '/plans/');
  if (productId && skuId) return `${base}/falabella-cl/plans/${productId}/x/${skuId}`;
  return null;
}

module.exports = { extraerPlanesConnect, urlPlanes, pieDe, precioDe };
