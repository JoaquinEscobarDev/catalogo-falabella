// Formato ordenado para la salida en Termux: grupos por marca, ordenados por
// pulgadas, columnas alineadas, nombres acortados al ancho de la pantalla y
// colores (se apagan con NO_COLOR=1 o si la salida no es una terminal).

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (cod) => (t) => (color ? `\x1b[${cod}m${t}\x1b[0m` : String(t));
const estilo = {
  negrita: c('1'), tenue: c('2'),
  verde: c('32'), rojo: c('31'), cian: c('36'), amarillo: c('33'),
};

const ancho = () => Math.max(40, Math.min(process.stdout.columns || 60, 100));

const MARCAS = ['samsung', 'hisense', 'xiaomi', 'philips', 'lg', 'tcl', 'jbl', 'sony'];

// "Smart Tv 50\" QLED 4K UHD 50Q6QV Hisense" → "50\" QLED 4K UHD 50Q6QV"
function nombreCorto(nombre, marca) {
  let t = String(nombre || '').replace(/\s+/g, ' ').trim();
  const quitar = [marca, ...MARCAS].filter(Boolean).map(m => m.toLowerCase());
  for (const m of new Set(quitar)) {
    t = t.replace(new RegExp(`(^|\\s)${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'ig'), ' ');
  }
  t = t.replace(/\b(smart\s*tv|televisor|tv)\b/ig, ' ').replace(/\s+/g, ' ').trim();
  return t || String(nombre || '').trim();
}

function pulgadas(texto) {
  // Primer número de 2 o 3 cifras entre 24 y 100: 50", "50 Nano", OLED55C6, QN55S90F...
  for (const m of String(texto || '').matchAll(/(?<!\d)(\d{2,3})(?!\d)/g)) {
    const n = Number(m[1]);
    if (n >= 24 && n <= 100) return n;
  }
  return 999;
}

function recortar(t, max) {
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function titulo(texto) {
  const w = ancho();
  console.log(estilo.negrita('═'.repeat(w)));
  console.log(estilo.negrita(` ${texto}`));
  console.log(estilo.negrita('═'.repeat(w)));
}

// items: [{ sku, marca, nombre, extra? }]
function grupo(encabezado, pintar, items, { vacio = 'ninguno' } = {}) {
  const w = ancho();
  console.log('');
  console.log(pintar(estilo.negrita(`${encabezado} (${items.length})`)));
  console.log(pintar('─'.repeat(Math.min(w, encabezado.length + 8))));
  if (!items.length) { console.log(estilo.tenue(`   ${vacio}`)); return; }

  const porMarca = new Map();
  for (const it of items) {
    const m = (it.marca || '?').toUpperCase();
    if (!porMarca.has(m)) porMarca.set(m, []);
    porMarca.get(m).push(it);
  }
  const marcas = [...porMarca.keys()].sort((a, b) => (a === '?') - (b === '?') || a.localeCompare(b));
  for (const m of marcas) {
    const lista = porMarca.get(m).map(it => ({ ...it, corto: nombreCorto(it.nombre, it.marca) }))
      .sort((a, b) => pulgadas(a.corto) - pulgadas(b.corto) || a.corto.localeCompare(b.corto));
    console.log(`  ${estilo.negrita(m)} ${estilo.tenue(`· ${lista.length}`)}`);
    for (const it of lista) {
      const extra = it.extra ? `  ${it.extra}` : '';
      const espacio = w - 4 - 10 - 2 - extra.length;
      console.log(`    ${estilo.amarillo(String(it.sku).padEnd(10))}${recortar(it.corto, Math.max(12, espacio))}${estilo.tenue(extra)}`);
    }
  }
}

function resumen(filas) {
  const w = ancho();
  console.log('');
  console.log(estilo.negrita('─'.repeat(w)));
  for (const [etiqueta, valor, pintar = (x) => x] of filas) {
    console.log(`  ${etiqueta.padEnd(22)}${pintar(estilo.negrita(String(valor)))}`);
  }
  console.log(estilo.negrita('─'.repeat(w)));
}

module.exports = { estilo, titulo, grupo, resumen, nombreCorto };
