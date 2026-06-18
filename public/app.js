const grid = document.getElementById('grid');
const filtroInput = document.getElementById('filtro');
const formAgregar = document.getElementById('formAgregar');
const inputSku = document.getElementById('inputSku');
const inputAlias = document.getElementById('inputAlias');
const msgAgregar = document.getElementById('msgAgregar');
const btnRefreshAll = document.getElementById('btnRefreshAll');

let skusGuardados = [];
let productosCache = {};

// ── Arranque ──
cargarTodo();

// ── Formulario: agregar SKU ──
formAgregar.addEventListener('submit', async (e) => {
  e.preventDefault();
  const sku = inputSku.value.trim();
  const alias = inputAlias.value.trim();
  if (!sku) return;

  mostrarMsg('Agregando…', '');
  const r = await fetch('/api/skus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku, alias }),
  });
  const data = await r.json();

  if (!r.ok) {
    mostrarMsg(data.error || 'Error al agregar', 'err');
    return;
  }

  mostrarMsg('SKU agregado ✓', 'ok');
  inputSku.value = '';
  inputAlias.value = '';
  await cargarTodo();
});

// ── Filtro ──
filtroInput.addEventListener('input', renderGrid);

// ── Refresh all ──
btnRefreshAll.addEventListener('click', async () => {
  productosCache = {};
  btnRefreshAll.innerHTML = '<span class="spinning">↻</span> Actualizando…';
  btnRefreshAll.disabled = true;
  await cargarTodo();
  btnRefreshAll.innerHTML = '↻ Actualizar precios';
  btnRefreshAll.disabled = false;
});

// ── Funciones principales ──
async function cargarTodo() {
  const r = await fetch('/api/skus');
  skusGuardados = await r.json();
  renderGrid();
  // Cargar productos en paralelo
  await Promise.all(skusGuardados.map(s => cargarProducto(s.sku)));
}

async function cargarProducto(sku) {
  if (productosCache[sku] !== undefined) return;
  productosCache[sku] = null; // marcamos como cargando
  renderGrid();

  try {
    const r = await fetch(`/api/producto/${sku}`);
    const data = await r.json();
    productosCache[sku] = r.ok ? data : { error: data.error };
  } catch {
    productosCache[sku] = { error: 'Error de red' };
  }
  renderGrid();
}

function renderGrid() {
  const filtro = filtroInput.value.toLowerCase();

  const lista = skusGuardados.filter(s => {
    if (!filtro) return true;
    const prod = productosCache[s.sku];
    const nombre = prod?.nombre || '';
    return (
      s.sku.includes(filtro) ||
      (s.alias || '').toLowerCase().includes(filtro) ||
      nombre.toLowerCase().includes(filtro)
    );
  });

  if (!lista.length) {
    grid.innerHTML = '<div class="empty-state">No hay productos. Agregá un SKU arriba.</div>';
    return;
  }

  grid.innerHTML = lista.map(s => tarjeta(s)).join('');

  // Eventos de eliminar
  grid.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => eliminarSku(btn.dataset.sku));
  });
}

function tarjeta({ sku, alias }) {
  const prod = productosCache[sku];

  if (prod === undefined || prod === null) {
    return `
      <div class="card loading">
        <div class="card-img-placeholder">⏳</div>
        <div class="card-body">
          <span class="card-alias">${alias || ''}</span>
          <span class="card-sku">SKU: ${sku}</span>
          <p style="color:#6b7280;font-size:.85rem;margin-top:8px">Cargando…</p>
        </div>
        <button class="btn-delete card-delete" data-sku="${sku}" title="Eliminar">✕</button>
      </div>`;
  }

  if (prod.error) {
    return `
      <div class="card error">
        <div class="card-img-placeholder">❌</div>
        <div class="card-body">
          <span class="card-alias">${alias || ''}</span>
          <span class="card-sku">SKU: ${sku}</span>
          <p class="card-error-msg">${prod.error}</p>
          <button onclick="reintentarSku('${sku}')" class="btn-primary" style="margin-top:8px;font-size:.82rem;padding:6px 12px">Reintentar</button>
        </div>
        <button class="btn-delete card-delete" data-sku="${sku}" title="Eliminar">✕</button>
      </div>`;
  }

  const img = prod.imagen
    ? `<img class="card-img" src="${prod.imagen}" alt="${prod.nombre}" loading="lazy" />`
    : `<div class="card-img-placeholder">📦</div>`;

  const precioFmt = (n) => n ? `$${Number(n).toLocaleString('es-CL')}` : null;

  let bloquePrecio = '';
  if (prod.precioOferta) {
    bloquePrecio = `
      <div class="precio-label">Precio normal</div>
      <div class="precio-normal" style="text-decoration:line-through;color:#999;font-size:.95rem">${precioFmt(prod.precio) || '—'}</div>
      <div class="precio-label">Precio oferta</div>
      <div class="precio-oferta">${precioFmt(prod.precioOferta)}</div>`;
  } else if (prod.precio) {
    bloquePrecio = `
      <div class="precio-label">Precio</div>
      <div class="precio-normal">${precioFmt(prod.precio)}</div>`;
  } else {
    bloquePrecio = `<div class="precio-normal" style="color:#999">Precio no disponible</div>`;
  }

  const linkFalabella = prod.url
    ? `<a class="card-link" href="${prod.url}" target="_blank" rel="noopener">Ver en Falabella →</a>`
    : '';

  return `
    <div class="card">
      ${img}
      <div class="card-body">
        ${alias ? `<span class="card-alias">${alias}</span>` : ''}
        <span class="card-nombre" title="${prod.nombre}">${prod.nombre}</span>
        <span class="card-sku">SKU: ${sku}</span>
        <div class="card-precios">
          ${bloquePrecio}
        </div>
        ${linkFalabella}
      </div>
      <button class="btn-delete card-delete" data-sku="${sku}" title="Eliminar">✕</button>
    </div>`;
}

async function eliminarSku(sku) {
  if (!confirm(`¿Eliminar el SKU ${sku}?`)) return;
  await fetch(`/api/skus/${sku}`, { method: 'DELETE' });
  delete productosCache[sku];
  skusGuardados = skusGuardados.filter(s => s.sku !== sku);
  renderGrid();
}

function reintentarSku(sku) {
  delete productosCache[sku];
  cargarProducto(sku);
}

function mostrarMsg(msg, tipo) {
  msgAgregar.textContent = msg;
  msgAgregar.className = 'msg ' + tipo;
  if (tipo === 'ok') setTimeout(() => { msgAgregar.textContent = ''; }, 3000);
}
