// Formato ordenado para la salida en Termux: grupos por marca, ordenados por
// pulgadas, columnas alineadas, nombres acortados al ancho de la pantalla y
// colores (se apagan con NO_COLOR=1 o si la salida no es una terminal).

// FORCE_COLOR=1: colores aunque la salida pase por tee (lo pone iniciar.sh).
const color = (process.stdout.isTTY || process.env.FORCE_COLOR === '1') && !process.env.NO_COLOR;
const c = (cod) => (t) => (color ? `\x1b[${cod}m${t}\x1b[0m` : String(t));
const estilo = {
  negrita: c('1'), tenue: c('2'),
  verde: c('32'), rojo: c('31'), cian: c('36'), amarillo: c('33'),
};

const ancho = () => Math.max(40, Math.min(process.stdout.columns || parseInt(process.env.COLUMNS, 10) || 60, 100));

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
      const visible = extra.replace(/\x1b\[[0-9;]*m/g, '').length;
      const espacio = w - 4 - 10 - visible;
      if (visible && espacio < 24) {
        // No cabe en una línea: el nombre completo arriba y el dato abajo.
        console.log(`    ${estilo.amarillo(String(it.sku).padEnd(10))}${recortar(it.corto, w - 14)}`);
        console.log(`    ${' '.repeat(10)}${estilo.tenue(extra.trim())}`);
      } else {
        console.log(`    ${estilo.amarillo(String(it.sku).padEnd(10))}${recortar(it.corto, Math.max(12, espacio))}${estilo.tenue(extra)}`);
      }
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

const pesos = n => (n == null ? '?' : `$${Number(n).toLocaleString('es-CL')}`);

// Reporte final de una actualización de precios, ordenado por categoría y
// marca. info: { sku -> { categoria, marca, nombre } } para los que fallaron
// (no traen nombre) y para ordenar por categoría.
function reporteActualizacion({ titulo: t, total, r }, info = {}) {
  const det = r.detalle || [];
  const cat = d => info[d.sku]?.categoria || 'Sin categoría';
  const conInfo = d => ({ ...d, marca: d.marca || info[d.sku]?.marca, nombre: d.nombre || info[d.sku]?.nombre || '(sin nombre)' });

  console.log('');
  titulo(`${t} · ${new Date().toLocaleString('es-CL')}`);

  const porCategoria = (lista, encabezado, pintar, extra) => {
    if (!lista.length) return;
    const cats = [...new Set(lista.map(cat))].sort((a, b) => a.localeCompare(b));
    console.log('');
    console.log(pintar(estilo.negrita(`${encabezado} (${lista.length})`)));
    for (const c of cats) {
      grupo(`  ${c}`, estilo.negrita, lista.filter(d => cat(d) === c).map(d => ({ ...conInfo(d), extra: extra(d) })));
    }
  };

  const cambios = det.filter(d => d.ok && d.cambio);
  const fallos = det.filter(d => !d.ok);
  porCategoria(cambios, '💲 CAMBIOS DE PRECIO', estilo.amarillo, d => {
    const flecha = d.antes != null && d.ahora != null ? (d.ahora < d.antes ? estilo.verde('▼') : estilo.rojo('▲')) : '';
    return `${pesos(d.antes)} → ${pesos(d.ahora)} ${flecha}`;
  });
  porCategoria(fallos, '✖ SIN RESPUESTA', estilo.rojo, () => '');
  if (!cambios.length && !fallos.length) console.log(estilo.verde('\n  Sin cambios de precio y sin fallos.'));

  // Totales por categoría.
  const cats = [...new Set(det.map(cat))].sort((a, b) => a.localeCompare(b));
  if (cats.length > 1) {
    console.log('');
    console.log(estilo.negrita('POR CATEGORÍA'));
    console.log(estilo.tenue(`  ${'Categoría'.padEnd(22)}${'OK'.padStart(5)}${'Cambios'.padStart(9)}${'Fallos'.padStart(8)}`));
    for (const c of cats) {
      const d = det.filter(x => cat(x) === c);
      const ok = d.filter(x => x.ok).length, cam = d.filter(x => x.cambio).length, f = d.length - ok;
      console.log(`  ${recortar(c, 21).padEnd(22)}${String(ok).padStart(5)}${(cam ? estilo.amarillo : estilo.tenue)(String(cam).padStart(9))}${(f ? estilo.rojo : estilo.tenue)(String(f).padStart(8))}`);
    }
  }

  resumen([
    ['Productos', total],
    ['Leídos bien', r.ok, estilo.verde],
    ['Cambios de precio', r.cambios, estilo.amarillo],
    ['Sin respuesta', r.fail, r.fail ? estilo.rojo : estilo.tenue],
  ]);
  if (r.bloqueado) console.log(estilo.rojo('  ✖ Cortado: Falabella no respondió (posible bloqueo). Se reintenta en la próxima vuelta.'));
  else console.log(estilo.verde('  ✔ Actualización terminada.'));
  console.log('');
}

module.exports = { estilo, titulo, grupo, resumen, nombreCorto, reporteActualizacion };
