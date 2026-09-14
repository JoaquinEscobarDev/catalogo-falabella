/**
 * Stress test para el sistema de encuestas.
 * Uso: node scripts/stress-test-encuestas.js [concurrencia] [total]
 * Ejemplo: node scripts/stress-test-encuestas.js 50 500
 */

const http = require('http');
const https = require('https');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const CONCURRENCY = parseInt(process.argv[2]) || 50;
const TOTAL       = parseInt(process.argv[3]) || 200;

const TIENDAS = ['los-dominicos', 'parque-arauco', 'costanera', 'plaza-egana'];
const P1_OPTS = ['precio-o-promocion','asesoria-especializada','conocer-y-probar-productos','variedad-marcas-productos','experiencia-rapida-facil','garantia-servicio-postventa'];
const P2_OPTS = ['si','no'];
const P3_OPTS = ['conocimiento-profundo','recomendar-necesidades','comparar-alternativas','explicar-simple','mejor-decision'];
const P4_OPTS = ['cual-producto-adaptarse','demasiadas-alternativas','entender-diferencias','informacion-insuficiente','precio-promociones','sin-dificultades'];
const P5_OPTS = ['siempre-consideraria','evaluaria-precio','solo-descuento','rara-vez','nunca'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randMultiple(arr, min = 1, max = 3) {
  const shuffled = [...arr].sort(() => Math.random() - .5);
  return shuffled.slice(0, min + Math.floor(Math.random() * (max - min + 1)));
}

function makeBody() {
  return JSON.stringify({
    tienda: rand(TIENDAS),
    p1:     rand(P1_OPTS),
    p2:     rand(P2_OPTS),
    p3:     randMultiple(P3_OPTS),
    p4:     rand(P4_OPTS),
    p5:     rand(P5_OPTS),
  });
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const lib    = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const opts   = {
      hostname: parsed.hostname,
      port:     parsed.port || (url.startsWith('https') ? 443 : 80),
      path:     parsed.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = lib.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

async function worker(id, queue, stats) {
  while (queue.length > 0) {
    const n = queue.pop();
    const body = makeBody();
    const t0   = Date.now();
    try {
      const res = await post(`${BASE_URL}/api/encuestas`, body);
      const ms  = Date.now() - t0;
      if (res.status === 201) {
        stats.ok++;
        stats.ms.push(ms);
      } else {
        stats.fail++;
        stats.errors.push({ n, status: res.status, body: res.body.slice(0, 200) });
      }
    } catch (e) {
      stats.fail++;
      stats.errors.push({ n, error: e.message });
    }
  }
}

function pct(arr, p) {
  const s = [...arr].sort((a,b) => a - b);
  return s[Math.floor(s.length * p / 100)] ?? 0;
}

async function main() {
  console.log(`\nStress test encuestas → ${BASE_URL}`);
  console.log(`Concurrencia: ${CONCURRENCY} | Total: ${TOTAL}\n`);

  const queue = Array.from({ length: TOTAL }, (_, i) => i + 1);
  const stats = { ok: 0, fail: 0, ms: [], errors: [] };
  const t0    = Date.now();

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i, queue, stats));
  await Promise.all(workers);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  const rps     = (stats.ok / parseFloat(elapsed)).toFixed(1);

  console.log('='.repeat(50));
  console.log(`Resultados:`);
  console.log(`  ✅ OK:       ${stats.ok}/${TOTAL}`);
  console.log(`  ❌ Errores:  ${stats.fail}`);
  console.log(`  ⏱  Tiempo:   ${elapsed}s`);
  console.log(`  🚀 RPS:      ${rps} req/s`);
  if (stats.ms.length > 0) {
    console.log(`  p50:         ${pct(stats.ms,50)}ms`);
    console.log(`  p95:         ${pct(stats.ms,95)}ms`);
    console.log(`  p99:         ${pct(stats.ms,99)}ms`);
    console.log(`  max:         ${Math.max(...stats.ms)}ms`);
  }
  console.log('='.repeat(50));

  if (stats.errors.length > 0) {
    console.log('\nPrimeros errores:');
    stats.errors.slice(0, 5).forEach(e => console.log(' ', JSON.stringify(e)));
  }

  // Verificar que llegaron a la BD
  if (stats.ok > 0) {
    console.log('\nVerificando BD...');
    try {
      const res  = await post(`${BASE_URL}/api/encuestas`, '');
      // GET en vez de POST para verificar
    } catch {}

    const lib    = BASE_URL.startsWith('https') ? https : http;
    const getRes = await new Promise((res, rej) => {
      const url = new URL(`${BASE_URL}/api/encuestas`);
      const req = (BASE_URL.startsWith('https') ? https : http).get({ hostname: url.hostname, port: url.port || (BASE_URL.startsWith('https') ? 443 : 80), path: url.pathname }, r => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d }));
      });
      req.on('error', rej);
    });

    if (getRes.status === 200) {
      const data = JSON.parse(getRes.body);
      const total = Array.isArray(data.encuestas) ? data.encuestas.length : '?';
      console.log(`  Total en BD: ${total} encuestas`);
      if (Array.isArray(data.resumen)) {
        data.resumen.forEach(r => console.log(`    ${r.tienda}: ${r.total}`));
      }
    } else {
      console.log(`  Error GET /api/encuestas: ${getRes.status}`);
    }
  }

  console.log('\n' + (stats.fail === 0 ? '✅ STRESS TEST PASADO' : `❌ ${stats.fail} ERRORES — revisar arriba`));
  process.exit(stats.fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
