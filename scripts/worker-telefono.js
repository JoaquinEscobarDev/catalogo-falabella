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
  if (process.argv.includes('--probar') || process.argv.includes('--diagnostico')) {
    await (process.argv.includes('--probar') ? probar() : diagnostico());
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
