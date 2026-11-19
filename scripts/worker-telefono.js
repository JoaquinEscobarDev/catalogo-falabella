// Worker remoto: refresca precios, stock y cupones desde este aparato (un
// teléfono con Termux o una PC) en vez de hacerlo el servidor.
//
// Para qué: Falabella está detrás de Cloudflare, que bloquea las IP de
// datacenter (Railway, VPS). Un teléfono o una PC salen con una IP de hogar
// o de red móvil, que sí pasa. Este proceso lee Falabella desde acá y guarda
// los resultados directo en la base de datos de producción; la web no cambia.
//
// Mientras este proceso esté corriendo, el servidor le cede todo el trabajo:
//   - el refresh completo a las horas de REFRESH_HOURS
//   - el botón "Actualizar precios" de cada categoría
//   - el botón "Actualizar todo ahora" de la portada
//
// Necesita DATABASE_URL (en un archivo .env en la raíz del proyecto).
// Instalación en Termux: ver scripts/termux/instalar.sh y DEPLOY.md.
//
// Uso:
//   node scripts/worker-telefono.js            queda corriendo
//   node scripts/worker-telefono.js --probar       prueba unos productos y sale
//   node scripts/worker-telefono.js --diagnostico  muestra qué responde Falabella
//   node scripts/worker-telefono.js --cupones      busca cupones de campaña ahora y muestra cuáles encontró
//   node scripts/worker-telefono.js --cupon-producto SKU   muestra qué dice la ficha de ese producto sobre su cupón
//   node scripts/worker-telefono.js --plan-producto SKU    muestra qué dice la ficha de un equipo Connect sobre su plan
//   node scripts/worker-telefono.js --connect-coleccion    muestra cómo vienen los equipos de la colección Falabella Connect
//   node scripts/worker-telefono.js --connect-equipo SKU   muestra dónde publica la ficha de un equipo con plan los valores por compañía
//   node scripts/worker-telefono.js --connect-api SKU      busca en el JavaScript de la página el servicio que entrega los planes
//   node scripts/worker-telefono.js --connect-planes SKU   abre la página de planes del equipo y muestra cómo vienen
//   node scripts/worker-telefono.js --listar TV            lista los productos de una categoría (SKU, marca, nombre, UPC)
//   node scripts/worker-telefono.js --eliminar SKU SKU...  muestra qué se eliminaría; con --confirmar, los elimina
//   node scripts/worker-telefono.js --agregar TV SKU SKU... agrega SKUs a una categoría (los que ya están se saltan)
//   node scripts/worker-telefono.js --comparar TV scripts/tienda/tv.txt
//        compara la categoría con lo que hay en tienda; con --aplicar elimina
//        lo que no está en tienda y agrega lo que falta

process.env.WORKER_ORIGEN = 'remoto';

const os = require('os');
const db = require('../src/config/database');
const scraperService = require('../src/services/scraperService');
const productsRepository = require('../src/repositories/productsRepository');
const worker = require('../src/jobs/refreshWorker');

const hora = () => new Date().toLocaleTimeString('es-CL', { hour12: false });

async function probar() {
  console.log('1) Conectando a la base de datos...');
  const skus = await productsRepository.findAllSkus();
  console.log(`   OK — ${skus.length} productos cargados.`);
  if (!skus.length) return;

  // Se prueban algunos por si justo el primero ya no existe en Falabella.
  console.log('2) Leyendo Falabella desde este aparato...');
  const muestra = skus.filter((_, i) => i % Math.ceil(skus.length / 3) === 0).slice(0, 3);
  let alguno = false;
  for (const sku of muestra) {
    const { producto } = await scraperService.scrapeProducto(sku, scraperService.fetchDirectoConReintentos);
    if (producto) {
      alguno = true;
      const precio = producto.precioCMR || producto.precioOferta || producto.precio;
      console.log(`   OK   ${sku} — ${producto.nombre} — $${precio ? precio.toLocaleString('es-CL') : '?'}`);
    } else {
      console.log(`   FAIL ${sku} — sin respuesta`);
    }
  }
  console.log(alguno
    ? '\nFunciona: este aparato puede leer Falabella. Ya se puede dejar corriendo.'
    : '\nNo funcionó: Falabella no respondió desde este aparato.');
  if (!alguno) process.exitCode = 2;
}

// Muestra qué responde Falabella a cada variante de curl, usando el producto
// actualizado más recientemente (el que con más seguridad sigue existiendo).
// Busca los cupones de la página de cupones de Falabella, los guarda y muestra
// qué encontró, incluido lo que no supo interpretar (para poder mejorarlo).
async function cupones() {
  const cuponesAutoService = require('../src/services/cuponesAutoService');
  const fmt = n => `$${Number(n).toLocaleString('es-CL')}`;
  console.log('Buscando cupones en la página de cupones de Falabella...\n');
  const r = await cuponesAutoService.buscar({ log: () => {} });

  for (const p of r.resumen.paginas) {
    console.log(p.ok
      ? `Página leída (${p.kb} KB, ${p.nextData ? 'con' : 'sin'} datos internos): ${p.cupones} cupones con marca, ${p.sinMarca} sin marca`
      : `No se pudo leer ${p.url}: ${p.error}`);
  }
  if (r.cupones.length) {
    console.log('\nAplicados automáticamente:');
    for (const c of r.cupones) {
      const desc = c.tipo === 'porcentaje' ? `${c.valor}%` : fmt(c.valor);
      const extra = [c.tope && `tope ${fmt(c.tope)}`, c.minimo && `mínimo ${fmt(c.minimo)}`, c.soloCMR && 'solo CMR', c.vence && `hasta ${c.vence}`].filter(Boolean).join(', ');
      console.log(`  ${c.codigo} — ${desc}${extra ? ` (${extra})` : ''} — ${c.alcance === 'todos' ? (c.general ? 'todo el sitio (cupón general de campaña)' : 'todo el sitio') : `marca ${c.alcanceValor}`}`);
      if (c.texto) console.log(`     "${c.texto.slice(0, 200)}"`);
    }
  }
  if (r.sinAlcance.length) {
    console.log('\nEncontrados pero sin marca de tu catálogo (no se aplican):');
    for (const c of r.sinAlcance) console.log(`  ${c.codigo} — ${c.texto.slice(0, 110)}`);
  }
  if (r.sinMonto?.length) {
    console.log(`\nCódigos encontrados sin monto legible: ${r.sinMonto.join(', ')}`);
  }
  if (r.candidatos.length) {
    console.log('\nTextos con "cupón" que no se pudieron interpretar:');
    for (const t of r.candidatos.slice(0, 8)) console.log(`  · ${t.slice(0, 300)}`);
  }
  if (r.resumen.ok && !r.cupones.length && !r.sinAlcance.length && !r.candidatos.length) {
    console.log('\nLa página no menciona cupones en texto (pueden estar solo como imágenes).');
  }
}

async function diagnostico() {
  const { rows } = await db.query(
    'SELECT sku FROM products WHERE nombre IS NOT NULL ORDER BY price_updated_at DESC NULLS LAST LIMIT 1'
  );
  const sku = process.argv.find(a => /^\d{5,12}$/.test(a)) || rows[0]?.sku;
  if (!sku) { console.log('No hay productos con datos para probar.'); return; }
  console.log(`Diagnóstico con SKU ${sku}\n`);
  for (const linea of await scraperService.diagnosticoCurl(sku)) console.log(linea);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Falta DATABASE_URL. Creá el archivo .env en la raíz del proyecto (ver scripts/termux/instalar.sh).');
    process.exit(1);
  }
  const modo = ['--probar', '--diagnostico', '--cupones', '--cupon-producto', '--plan-producto', '--connect-coleccion', '--connect-equipo', '--connect-api', '--connect-planes', '--listar', '--eliminar', '--agregar', '--comparar'].find(m => process.argv.includes(m));
  if (modo) {
    const cuponProducto = async () => {
      const sku = process.argv.find(a => /^\d{5,12}$/.test(a));
      if (!sku) { console.log('Falta el SKU, por ejemplo: --cupon-producto 80659213'); return; }
      for (const l of await scraperService.contextoCupon(sku)) console.log(l);
    };
    const planProducto = async () => {
      const sku = process.argv.find(a => /^\d{5,12}$/.test(a));
      if (!sku) { console.log('Falta el SKU, por ejemplo: --plan-producto 17354672'); return; }
      for (const l of await scraperService.contextoPlan(sku)) console.log(l);
      // Y lo que la app entiende hoy de esa ficha:
      const { producto } = await scraperService.scrapeProducto(sku, scraperService.fetchDirectoConReintentos);
      console.log('', 'La app lee:', JSON.stringify(producto?.plan || null));
    };
    const coleccion = async () => {
      for (const l of await scraperService.diagnosticoColeccionConnect()) console.log(l);
      const r = await require('../src/services/connectColeccionService').buscar({ log: console.log });
      const fmt = n => `$${Number(n).toLocaleString('es-CL')}`;
      console.log('\nEquipos con plan guardados (primeros 8):');
      for (const o of r.ofertas.slice(0, 8)) console.log(`  ${o.nombre}: con plan ${fmt(o.precioConPlan)}${o.precioSinPlan ? ` · sin plan ${fmt(o.precioSinPlan)}` : ''} · ids ${o.ids.slice(0, 3).join(', ')}`);
    };
    const planesEquipo = async () => {
      const sku = process.argv.find(a => /^\d{5,12}$/.test(a)) || '17765908';
      for (const l of await scraperService.diagnosticoPlanesConnect(sku)) console.log(l);
    };
    const api = async () => {
      const sku = process.argv.find(a => /^\d{5,12}$/.test(a)) || '17765908';
      for (const l of await scraperService.diagnosticoApiConnect(sku)) console.log(l);
    };
    const equipo = async () => {
      const sku = process.argv.find(a => /^\d{5,12}$/.test(a)) || '17765908';
      for (const l of await scraperService.diagnosticoEquipoConnect(sku)) console.log(l);
    };
    // Lista compacta de una categoría, para comparar con lo que hay en tienda.
    const listar = async () => {
      const i = process.argv.indexOf('--listar');
      const categoria = process.argv.slice(i + 1).filter(a => !a.startsWith('--')).join(' ') || 'TV';
      const { rows } = await db.query(`
        SELECT p.sku, p.marca, p.nombre, p.alias, p.upc
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE lower(c.nombre) = lower($1)
        ORDER BY p.marca NULLS LAST, p.nombre NULLS LAST, p.sku
      `, [categoria]);
      console.log(`${categoria}: ${rows.length} productos\n`);
      rows.forEach((r, n) => {
        const nombre = (r.nombre || r.alias || '(sin nombre todavía)').replace(/\s+/g, ' ').slice(0, 70);
        console.log(`${String(n + 1).padStart(2)}. ${r.sku} · ${r.marca || '?'} · ${nombre}${r.upc ? ` · UPC ${r.upc}` : ''}`);
      });
    };

    // Eliminar SKUs: sin --confirmar solo muestra qué se eliminaría.
    const eliminar = async () => {
      const skus = [...new Set(process.argv.filter(a => /^\d{4,12}$/.test(a)))];
      if (!skus.length) { console.log('Indicá los SKU, por ejemplo: --eliminar 17461845 17461846'); return; }
      const { rows } = await db.query(`
        SELECT p.sku, p.nombre, c.nombre AS categoria
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.sku = ANY($1) ORDER BY p.nombre
      `, [skus]);
      const noEstan = skus.filter(s => !rows.some(r => r.sku === s));
      console.log(`${rows.length} producto(s) a eliminar:`);
      for (const r of rows) console.log(`  ${r.sku} · ${r.categoria} · ${(r.nombre || '').slice(0, 70)}`);
      if (noEstan.length) console.log(`No están en la página (se ignoran): ${noEstan.join(', ')}`);
      if (!process.argv.includes('--confirmar')) {
        console.log('\nNo se eliminó nada. Para eliminarlos, repetí el comando agregando --confirmar');
        return;
      }
      const r = await db.query('DELETE FROM products WHERE sku = ANY($1)', [rows.map(x => x.sku)]);
      console.log(`\nEliminados: ${r.rowCount}.`);
    };

    // Agregar SKUs a una categoría. Los precios se leen en la próxima actualización.
    const agregar = async () => {
      const i = process.argv.indexOf('--agregar');
      const args = process.argv.slice(i + 1).filter(a => !a.startsWith('--'));
      const categoria = args.filter(a => !/^\d{4,12}$/.test(a)).join(' ') || 'TV';
      const skus = [...new Set(args.filter(a => /^\d{4,12}$/.test(a)))];
      if (!skus.length) { console.log('Indicá la categoría y los SKU, por ejemplo: --agregar TV 80811105 80598126'); return; }
      const cat = await db.query('SELECT id, nombre FROM categories WHERE lower(nombre) = lower($1)', [categoria]);
      if (!cat.rows[0]) { console.log(`No existe la categoría "${categoria}".`); return; }
      const r = await db.query(
        'INSERT INTO products (sku, category_id) SELECT unnest($1::text[]), $2 ON CONFLICT (sku) DO NOTHING RETURNING sku',
        [skus, cat.rows[0].id]
      );
      const nuevos = r.rows.map(x => x.sku);
      console.log(`Agregados a ${cat.rows[0].nombre}: ${nuevos.length}${nuevos.length ? ` (${nuevos.join(', ')})` : ''}`);
      const ya = skus.filter(s => !nuevos.includes(s));
      if (ya.length) console.log(`Ya estaban en la página (no se tocaron): ${ya.join(', ')}`);
      if (nuevos.length) console.log('Sus precios aparecen en la próxima actualización de precios.');
    };

    // Comparar una categoría con la lista de tienda (archivo o SKUs sueltos).
    const comparar = async () => {
      const fs = require('fs');
      const i = process.argv.indexOf('--comparar');
      const args = process.argv.slice(i + 1).filter(a => !a.startsWith('--'));
      const archivos = args.filter(a => fs.existsSync(a));
      const categoria = args.filter(a => !archivos.includes(a) && !/^\d{4,12}$/.test(a)).join(' ') || 'TV';
      const tienda = new Map();  // sku -> referencia
      for (const a of archivos) {
        for (const linea of fs.readFileSync(a, 'utf8').split('\n')) {
          const m = linea.match(/^\s*(\d{4,12})\b\s*(.*)$/);
          if (m) tienda.set(m[1], m[2].trim());
        }
      }
      for (const a of args) if (/^\d{4,12}$/.test(a)) tienda.set(a, '');
      if (!tienda.size) { console.log('Indicá la lista de tienda, por ejemplo: --comparar TV scripts/tienda/tv.txt'); return; }

      const cat = await db.query('SELECT id, nombre FROM categories WHERE lower(nombre) = lower($1)', [categoria]);
      if (!cat.rows[0]) { console.log(`No existe la categoría "${categoria}".`); return; }
      const { rows } = await db.query(
        'SELECT sku, marca, nombre, alias FROM products WHERE category_id = $1 ORDER BY marca NULLS LAST, nombre NULLS LAST, sku',
        [cat.rows[0].id]
      );
      const enPagina = new Set(rows.map(r => r.sku));
      const nombre = r => `${r.marca || '?'} · ${(r.nombre || r.alias || '(sin nombre todavía)').replace(/\s+/g, ' ').slice(0, 60)}`;

      const quedan = rows.filter(r => tienda.has(r.sku));
      const sobran = rows.filter(r => !tienda.has(r.sku));
      const faltan = [...tienda.keys()].filter(s => !enPagina.has(s));
      // SKUs de tienda que existen pero en otra categoría: no se agregan, se avisan.
      const otra = faltan.length ? (await db.query(
        'SELECT p.sku, c.nombre AS categoria FROM products p JOIN categories c ON c.id = p.category_id WHERE p.sku = ANY($1)', [faltan]
      )).rows : [];
      const enOtra = new Map(otra.map(r => [r.sku, r.categoria]));
      const agregar = faltan.filter(s => !enOtra.has(s));

      console.log(`${cat.rows[0].nombre}: ${rows.length} en la página · ${tienda.size} en tienda\n`);
      console.log(`1) SE QUEDAN (en página y en tienda): ${quedan.length}`);
      quedan.forEach(r => console.log(`   ${r.sku} · ${nombre(r)}`));
      console.log(`\n2) SE ELIMINAN (en página, no en tienda): ${sobran.length}`);
      sobran.forEach(r => console.log(`   ${r.sku} · ${nombre(r)}`));
      console.log(`\n3) SE AGREGAN (en tienda, no en página): ${agregar.length}`);
      agregar.forEach(s => console.log(`   ${s} · ${tienda.get(s) || ''}`));
      if (enOtra.size) {
        console.log('\n   Están en otra categoría (no se tocan):');
        for (const [s, c] of enOtra) console.log(`   ${s} · ${tienda.get(s) || ''} → ${c}`);
      }

      if (!process.argv.includes('--aplicar')) {
        console.log('\nNo se cambió nada. Si la lista está bien, repetí el comando agregando --aplicar');
        return;
      }
      const del = sobran.length
        ? await db.query('DELETE FROM products WHERE sku = ANY($1) AND category_id = $2', [sobran.map(r => r.sku), cat.rows[0].id])
        : { rowCount: 0 };
      const ins = agregar.length
        ? await db.query('INSERT INTO products (sku, category_id) SELECT unnest($1::text[]), $2 ON CONFLICT (sku) DO NOTHING', [agregar, cat.rows[0].id])
        : { rowCount: 0 };
      console.log(`\nListo: ${del.rowCount} eliminados, ${ins.rowCount} agregados. Los nuevos muestran precio en la próxima actualización.`);
    };

    await ({ '--comparar': comparar, '--agregar': agregar, '--probar': probar, '--diagnostico': diagnostico, '--cupones': cupones, '--cupon-producto': cuponProducto, '--plan-producto': planProducto, '--connect-coleccion': coleccion, '--connect-equipo': equipo, '--connect-api': api, '--connect-planes': planesEquipo, '--listar': listar, '--eliminar': eliminar })[modo]();
    await db.end();
    return;
  }

  await db.query('SELECT 1'); // falla rápido si la base no responde
  console.log(`[${hora()}] Worker remoto iniciado en ${os.hostname()}. Dejar esta ventana abierta.`);
  await worker.iniciar({
    fetchFn: scraperService.fetchDirectoConReintentos,
    detalle: os.hostname(),
    // Con la hora adelante: sirve para ver el ritmo y cuándo se detuvo.
    log: msg => console.log(String(msg).replace(/^(\s*)(OK|FAIL|\.\.\.)/, `$1${hora()} $2`)),
  });
}

// Un corte de red no debe tumbar el proceso: se loguea y sigue.
process.on('unhandledRejection', e => console.error(`[${hora()}] ${e?.message || e}`));
process.on('uncaughtException',  e => console.error(`[${hora()}] ${e?.message || e}`));

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
