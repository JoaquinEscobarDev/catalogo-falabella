// Atiende las solicitudes del botón "Actualizar precios" de la web.
// El botón solo deja una fila en refresh_requests (no puede tocar tu PC
// directamente) — este script, corrido cada 5 min por el Programador de
// tareas de Windows, las revisa y refresca esos SKUs contra el Postgres del
// VPS a través del túnel SSH (ver DEPLOY.md).
//
// Uso manual: node scripts/watch-refresh.js
// Uso programado: ver watch-refresh.bat (Programador de tareas de Windows)

const db = require('../src/config/database');
const productService = require('../src/services/productService');
const refreshRequestsRepository = require('../src/repositories/refreshRequestsRepository');

async function main() {
  const solicitudes = await refreshRequestsRepository.findPending();

  if (!solicitudes.length) {
    await db.end();
    return; // nada que hacer, salir silencioso
  }

  for (const { id, categoria } of solicitudes) {
    console.log(`[${new Date().toLocaleString('es-CL')}] Procesando solicitud #${id} (${categoria})...`);
    // Marcar como procesada antes de empezar, para no reintentarla si este
    // script se corre de nuevo mientras todavía está trabajando en esta.
    await refreshRequestsRepository.markProcessed(id);

    const { rows: skus } = await db.query(`
      SELECT p.sku FROM products p JOIN categories c ON c.id = p.category_id WHERE c.nombre = $1
    `, [categoria]);

    let ok = 0, fail = 0;
    for (const { sku } of skus) {
      try {
        const r = await productService.refreshSku(sku);
        if (r.ok) ok++; else fail++;
      } catch { fail++; }
      await new Promise(res => setTimeout(res, 400));
    }
    console.log(`  Listo: ${ok} OK / ${fail} FAIL de ${skus.length}`);
  }

  await db.end();
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
