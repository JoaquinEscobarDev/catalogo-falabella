// Refresca los precios de todos los SKUs guardados.
// Pensado para correr en tu PC (IP residencial) vía el Programador de tareas
// de Windows, contra el Postgres del VPS a través del túnel SSH (ver
// DEPLOY.md) — el VPS tiene IP de datacenter y Cloudflare la bloquea, por eso
// esto no corre ahí.
//
// Uso manual: node scripts/refresh-local.js
// Uso programado: ver refresh-diario.bat (Programador de tareas de Windows)

const db = require('../src/config/database');
const productService = require('../src/services/productService');

async function main() {
  const { rows } = await db.query('SELECT sku FROM products ORDER BY sku');
  console.log(`[${new Date().toLocaleString('es-CL')}] Refrescando ${rows.length} SKUs...`);

  let ok = 0, fail = 0, viaDirecta = 0, cambios = 0;
  for (const { sku } of rows) {
    try {
      const r = await productService.refreshSku(sku);
      if (!r.ok) throw new Error('sin datos');
      if (r.viaDirecta) viaDirecta++;
      if (r.cambio) cambios++;
      ok++;
      console.log(`  OK   ${sku} - ${r.producto.nombre} - $${r.producto.precio || r.producto.precioOferta || '?'}${r.cambio ? ' (precio cambió)' : ''}`);
    } catch (e) {
      fail++;
      console.log(`  FAIL ${sku} - ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 400)); // ritmo prudente, no hay apuro
  }

  console.log(`\n[${new Date().toLocaleString('es-CL')}] Listo: ${ok} OK (${viaDirecta} vía página directa, ${cambios} con cambio de precio) / ${fail} FAIL de ${rows.length}`);
  await db.end();
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
