// Planes Connect: catálogo de planes (detectados en las fichas + cargados a
// mano) y registro de ventas de portabilidad / línea nueva.

const connectRepository = require('../repositories/connectRepository');

const COMPANIAS = ['Entel', 'Movistar', 'WOM', 'Claro'];
const TIPOS_PLAN = ['portabilidad', 'linea_nueva', 'ambos'];
const TIPOS_VENTA = ['portabilidad', 'linea_nueva'];

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

function textoCorto(v, max = 120) {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
}

function compania(v) {
  const c = COMPANIAS.find(x => x.toLowerCase() === String(v || '').trim().toLowerCase());
  if (!c) throw badRequest(`Compañía inválida (${COMPANIAS.join(', ')})`);
  return c;
}

// ── Planes ──

// Agrupa los equipos con plan detectado por plan (compañía + nombre +
// mensual + tipo), con la lista de equipos que lo ofrecen.
function agruparDetectados(filas) {
  const grupos = new Map();
  for (const f of filas) {
    const p = f.plan || {};
    if (!p.compania) continue;
    const clave = [p.compania, p.nombre || '', p.mensual || '', p.tipo || ''].join('|');
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        compania: p.compania, nombre: p.nombre || null, mensual: p.mensual || null,
        tipo: p.tipo || null, gigas: p.gigas || null, equipos: [],
      });
    }
    grupos.get(clave).equipos.push({
      sku: f.sku, nombre: f.nombre, marca: f.marca,
      precio: f.precio_oferta || f.precio_normal || null, precioCMR: f.precio_cmr || null,
    });
  }
  return [...grupos.values()].sort((a, b) =>
    a.compania.localeCompare(b.compania) || (a.mensual || 0) - (b.mensual || 0));
}

async function listarPlanes() {
  const [manuales, equipos] = await Promise.all([
    connectRepository.planesManuales(),
    connectRepository.equiposConPlan(),
  ]);
  return { companias: COMPANIAS, manuales, detectados: agruparDetectados(equipos) };
}

async function crearPlan(body) {
  const mensual = enteroPositivo(body.mensual);
  if (!mensual) throw badRequest('Falta el valor mensual del plan');
  const tipo = TIPOS_PLAN.includes(body.tipo) ? body.tipo : 'ambos';
  return connectRepository.insertPlan({
    compania: compania(body.compania),
    nombre: textoCorto(body.nombre, 60),
    tipo, mensual,
    gigas: enteroPositivo(body.gigas),
    minutos: textoCorto(body.minutos, 40),
    notas: textoCorto(body.notas, 200),
  });
}

async function eliminarPlan(id) {
  await connectRepository.removePlan(id);
}

// ── Ventas ──

function mesActual() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}`;
}

function validarMes(mes) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(mes || '') ? mes : mesActual();
}

async function listarVentas(mesPedido) {
  const mes = validarMes(mesPedido);
  const ventas = await connectRepository.ventasDelMes(mes);
  const contar = campo => ventas.reduce((acc, v) => ({ ...acc, [v[campo]]: (acc[v[campo]] || 0) + 1 }), {});
  return {
    mes,
    ventas,
    resumen: { total: ventas.length, porCompania: contar('compania'), porTipo: contar('tipo') },
  };
}

async function crearVenta(body) {
  if (!TIPOS_VENTA.includes(body.tipo)) throw badRequest('Indicá si es portabilidad o línea nueva');
  return connectRepository.insertVenta({
    tipo: body.tipo,
    compania: compania(body.compania),
    plan: textoCorto(body.plan, 80),
    mensual: enteroPositivo(body.mensual),
    sku: /^\d{5,12}$/.test(String(body.sku || '').trim()) ? String(body.sku).trim() : null,
    equipo: textoCorto(body.equipo, 120),
    precioEquipo: enteroPositivo(body.precioEquipo),
    cliente: textoCorto(body.cliente, 80),
    telefono: textoCorto(body.telefono, 20),
    vendedor: textoCorto(body.vendedor, 60),
    notas: textoCorto(body.notas, 200),
  });
}

async function eliminarVenta(id) {
  await connectRepository.removeVenta(id);
}

function csvVentas({ ventas }) {
  const celda = v => {
    const t = v == null ? '' : String(v);
    return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const fecha = d => new Date(d).toLocaleString('es-CL', { timeZone: 'America/Santiago' });
  const filas = [
    ['Fecha', 'Tipo', 'Compañía', 'Plan', 'Mensual', 'SKU', 'Equipo', 'Precio equipo', 'Cliente', 'Teléfono', 'Vendedor', 'Notas'],
    ...ventas.map(v => [fecha(v.fecha), v.tipo === 'portabilidad' ? 'Portabilidad' : 'Línea nueva', v.compania, v.plan, v.mensual,
      v.sku, v.equipo, v.precioEquipo, v.cliente, v.telefono, v.vendedor, v.notas]),
  ];
  // BOM para que Excel abra bien los acentos; ";" porque Excel en español lo usa de separador.
  return '﻿' + filas.map(f => f.map(celda).join(';')).join('\r\n');
}

module.exports = {
  COMPANIAS, listarPlanes, crearPlan, eliminarPlan,
  listarVentas, crearVenta, eliminarVenta, csvVentas,
};
