// Atiende las solicitudes del botón "Actualizar precios" de la web.
// El botón solo deja una fila en solicitudes_refresh (no puede tocar tu PC
// directamente) — este script, corrido cada 5 min por el Programador de
// tareas de Windows, las revisa y refresca esos SKUs desde tu IP residencial.
//
// Uso manual: node watch-refresh.js
// Uso programado: ver watch-refresh.bat (Programador de tareas de Windows)

require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const { actualizarSku, asegurarTablas } = require('./falabella-scraper');

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await asegurarTablas(db);

  const { rows: solicitudes } = await db.query(
    `SELECT id, categoria FROM solicitudes_refresh WHERE procesado = FALSE ORDER BY creado_en ASC`
  );

  if (!solicitudes.length) {
    await db.end();
    return; // nada que hacer, salir silencioso
  }

  for (const { id, categoria } of solicitudes) {
    console.log(`[${new Date().toLocaleString('es-CL')}] Procesando solicitud #${id} (${categoria})...`);
    // Marcar como procesada antes de empezar, para no reintentarla si este
    // script se corre de nuevo mientras todavía está trabajando en esta.
    await db.query('UPDATE solicitudes_refresh SET procesado = TRUE WHERE id = $1', [id]);

    const { rows: skus } = await db.query('SELECT sku FROM skus WHERE categoria = $1', [categoria]);
    let ok = 0, fail = 0;
    for (const { sku } of skus) {
      try {
        const r = await actualizarSku(db, sku);
        if (r.ok) ok++; else fail++;
      } catch { fail++; }
      await new Promise(res => setTimeout(res, 400));
    }
    console.log(`  Listo: ${ok} OK / ${fail} FAIL de ${skus.length}`);
  }

  await db.end();
}

main().catch(e => { console.error('Error fatal:', e.message); process.exit(1); });
