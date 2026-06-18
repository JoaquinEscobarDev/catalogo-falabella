// ── Categorías ──
const CATEGORIAS = [
  { nombre: 'Computadores',       icono: '💻' },
  { nombre: 'Tablets',            icono: '📱' },
  { nombre: 'Impresoras',         icono: '🖨️' },
  { nombre: 'Connect',            icono: '📡' },
  { nombre: 'Isla',               icono: '🏝️' },
  { nombre: 'TV',                 icono: '📺' },
  { nombre: 'Consolas',           icono: '🎮' },
  { nombre: 'Línea Blanca',       icono: '🫧' },
  { nombre: 'Electrodomésticos',  icono: '⚡' },
  { nombre: 'Relojes',            icono: '⌚' },
];

// ── Estado ──
let categoriaActiva = null;
let skusGuardados   = [];
let productosCache  = {};

// ── Elementos ──
const viewCategorias  = document.getElementById('viewCategorias');
const viewProductos   = document.getElementById('viewProductos');
const categoriasGrid  = document.getElementById('categoriasGrid');
const grid            = document.getElementById('grid');
const filtroInput     = document.getElementById('filtro');
const formAgregar     = document.getElementById('formAgregar');
const inputSku        = document.getElementById('inputSku');
const inputAlias      = document.getElementById('inputAlias');
const msgAgregar      = document.getElementById('msgAgregar');
const btnBack         = document.getElementById('btnBack');
const btnRefreshAll   = document.getElementById('btnRefreshAll');
const headerTitle     = document.getElementById('headerTitle');
const headerActions   = document.getElementById('headerActions');

// ── Arranque ──
init();

async function init() {
  const r = await fetch('/api/skus');
  skusGuardados = await r.json();
  renderCategorias();
}

// ── Render de la pantalla de categorías ──
function renderCategorias() {
  categoriasGrid.innerHTML = CATEGORIAS.map(c => {
    const count = skusGuardados.filter(s => s.categoria === c.nombre).length;
    return `
      <div class="categoria-card" data-cat="${c.nombre}">
        <span class="categoria-count ${count === 0 ? 'empty' : ''}">${count}</span>
        <span class="categoria-icon">${c.icono}</span>
        <span class="categoria-nombre">${c.nombre}</span>
      </div>`;
  }).join('');

  categoriasGrid.querySelectorAll('.categoria-card').forEach(card => {
    card.addEventListener('click', () => abrirCategoria(card.dataset.cat));
  });
}

// ── Abrir una categoría ──
async function abrirCategoria(nombre) {
  categoriaActiva = nombre;

  // Cambiar vistas
  viewCategorias.style.display = 'none';
  viewProductos.style.display  = 'flex';
  btnBack.style.display        = 'inline-block';
  headerActions.style.display  = 'flex';

  const cat = CATEGORIAS.find(c => c.nombre === nombre);
  headerTitle.textContent = `${cat.icono} ${nombre}`;
  filtroInput.value = '';

  renderGrid();
  // Cargar productos de esta categoría que no estén en caché
  const skusCat = skusGuardados.filter(s => s.categoria === nombre);
  await Promise.all(skusCat.map(s => cargarProducto(s.sku)));
}

// ── Volver a categorías ──
btnBack.addEventListener('click', () => {
  categoriaActiva = null;
  viewProductos.style.display  = 'none';
  viewCategorias.style.display = 'block';
  btnBack.style.display        = 'none';
  headerActions.style.display  = 'none';
  headerTitle.textContent      = '🛒 Catálogo Falabella';
  renderCategorias();
});

// ── Refresh ──
btnRefreshAll.addEventListener('click', async () => {
  if (!categoriaActiva) return;
  const skusCat = skusGuardados.filter(s => s.categoria === categoriaActiva);
  skusCat.forEach(s => delete productosCache[s.sku]);
  btnRefreshAll.innerHTML = '<span class="spinning">↻</span> Actualizando…';
  btnRefreshAll.disabled = true;
  renderGrid();
  await Promise.all(skusCat.map(s => cargarProducto(s.sku)));
  btnRefreshAll.innerHTML = '↻ Actualizar precios';
  btnRefreshAll.disabled = false;
});

// ── Filtro ──
filtroInput.addEventListener('input', renderGrid);

// ── Formulario agregar ──
formAgregar.addEventListener('submit', async (e) => {
  e.preventDefault();
  const sku   = inputSku.value.trim();
  const alias = inputAlias.value.trim();
  if (!sku || !categoriaActiva) return;

  mostrarMsg('Agregando…', '');
  const r = await fetch('/api/skus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku, alias, categoria: categoriaActiva }),
  });
  const data = await r.json();

  if (!r.ok) { mostrarMsg(data.error || 'Error al agregar', 'err'); return; }

  mostrarMsg('SKU agregado ✓', 'ok');
  inputSku.value = '';
  inputAlias.value = '';

  skusGuardados.unshift({ sku, alias: alias || null, categoria: categoriaActiva });
  renderGrid();
  await cargarProducto(sku);
});

// ── Cargar producto desde API ──
async function cargarProducto(sku) {
  if (productosCache[sku] !== undefined) return;
  productosCache[sku] = null;
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

// ── Render del grid ──
function renderGrid() {
  if (!categoriaActiva) return;

  const filtro   = filtroInput.value.toLowerCase();
  const skusCat  = skusGuardados.filter(s => s.categoria === categoriaActiva);

  const lista = skusCat.filter(s => {
    if (!filtro) return true;
    const prod = productosCache[s.sku];
    const nombre = prod?.nombre || '';
    return s.sku.includes(filtro)
      || (s.alias || '').toLowerCase().includes(filtro)
      || nombre.toLowerCase().includes(filtro);
  });

  if (!lista.length) {
    grid.innerHTML = '<div class="empty-state">No hay productos en esta categoría.<br>Agregá un SKU arriba.</div>';
    return;
  }

  grid.innerHTML = lista.map(s => tarjeta(s)).join('');
  grid.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => eliminarSku(btn.dataset.sku));
  });
}

// ── Tarjeta producto ──
function tarjeta({ sku, alias }) {
  const prod = productosCache[sku];

  if (prod === undefined || prod === null) {
    return `
      <div class="card loading">
        <div class="card-img-placeholder">⏳</div>
        <div class="card-body">
          ${alias ? `<span class="card-alias">${alias}</span>` : ''}
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
          ${alias ? `<span class="card-alias">${alias}</span>` : ''}
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

  const fmt = n => n ? `$${Number(n).toLocaleString('es-CL')}` : null;

  let bloquePrecio = '';
  if (prod.precioOferta) {
    bloquePrecio = `
      <div class="precio-label">Precio normal</div>
      <div class="precio-tachado">${fmt(prod.precio) || '—'}</div>
      <div class="precio-label">Precio oferta</div>
      <div class="precio-oferta">${fmt(prod.precioOferta)}</div>`;
  } else if (prod.precio) {
    bloquePrecio = `
      <div class="precio-label">Precio</div>
      <div class="precio-normal">${fmt(prod.precio)}</div>`;
  } else {
    bloquePrecio = `<div class="precio-normal" style="color:#999">Sin precio</div>`;
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
        <div class="card-precios">${bloquePrecio}</div>
        ${linkFalabella}
      </div>
      <button class="btn-delete card-delete" data-sku="${sku}" title="Eliminar">✕</button>
    </div>`;
}

// ── Eliminar SKU ──
async function eliminarSku(sku) {
  if (!confirm(`¿Eliminar el SKU ${sku}?`)) return;
  await fetch(`/api/skus/${sku}`, { method: 'DELETE' });
  delete productosCache[sku];
  skusGuardados = skusGuardados.filter(s => s.sku !== sku);
  renderGrid();
  renderCategorias(); // actualizar contadores
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
