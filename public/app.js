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
let todoItems       = JSON.parse(localStorage.getItem('todoList') || '[]');

// ── Elementos ──
const viewCategorias   = document.getElementById('viewCategorias');
const viewProductos    = document.getElementById('viewProductos');
const categoriasGrid   = document.getElementById('categoriasGrid');
const grid             = document.getElementById('grid');
const filtroInput      = document.getElementById('filtro');
const formAgregar      = document.getElementById('formAgregar');
const inputSku         = document.getElementById('inputSku');
const inputAlias       = document.getElementById('inputAlias');
const msgAgregar       = document.getElementById('msgAgregar');
const btnBack          = document.getElementById('btnBack');
const btnRefreshAll    = document.getElementById('btnRefreshAll');
const headerTitle      = document.getElementById('headerTitle');
const headerActions    = document.getElementById('headerActions');
// ToDo
const todoBadge        = document.getElementById('todoBadge');
const todoEmptyState   = document.getElementById('todoEmptyState');
const todoList         = document.getElementById('todoList');
const todoClear        = document.getElementById('todoClear');
const todoFab          = document.getElementById('todoFab');
const todoFabCount     = document.getElementById('todoFabCount');
const todoOverlay      = document.getElementById('todoOverlay');
const todoListModal    = document.getElementById('todoListModal');
const todoModalClose   = document.getElementById('todoModalClose');
const todoClearModal   = document.getElementById('todoClearModal');
const todoModalEmpty   = document.getElementById('todoModalEmpty');

// ── Arranque ──
init();

async function init() {
  const r = await fetch('/api/skus');
  skusGuardados = await r.json();
  renderCategorias();
  renderTodo();
}

// ══════════════════════════════════════════
// CATEGORÍAS
// ══════════════════════════════════════════

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

async function abrirCategoria(nombre) {
  categoriaActiva = nombre;
  viewCategorias.style.display  = 'none';
  viewProductos.style.display   = 'flex';
  btnBack.style.display         = 'inline-block';
  headerActions.style.display   = 'flex';
  const cat = CATEGORIAS.find(c => c.nombre === nombre);
  headerTitle.textContent = `${cat.icono} ${nombre}`;
  filtroInput.value = '';
  actualizarFab();
  renderGrid();
  const skusCat = skusGuardados.filter(s => s.categoria === nombre);
  await Promise.all(skusCat.map(s => cargarProducto(s.sku)));
}

btnBack.addEventListener('click', () => {
  categoriaActiva = null;
  viewProductos.style.display  = 'none';
  viewCategorias.style.display = 'block';
  btnBack.style.display        = 'none';
  headerActions.style.display  = 'none';
  headerTitle.textContent      = '🛒 Catálogo Falabella';
  todoFab.style.display        = 'none';
  renderCategorias();
});

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

filtroInput.addEventListener('input', renderGrid);

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

// ══════════════════════════════════════════
// PRODUCTOS
// ══════════════════════════════════════════

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
  renderTodo(); // actualizar precios en el todo si el producto estaba ahí
}

function renderGrid() {
  if (!categoriaActiva) return;
  const filtro  = filtroInput.value.toLowerCase();
  const skusCat = skusGuardados.filter(s => s.categoria === categoriaActiva);
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
  grid.querySelectorAll('.btn-cambiar').forEach(btn => {
    btn.addEventListener('click', () => toggleTodo(btn.dataset.sku));
  });
}

function tarjeta({ sku, alias }) {
  const prod    = productosCache[sku];
  const enLista = todoItems.includes(sku);

  if (prod === undefined || prod === null) {
    return `
      <div class="card loading">
        <div class="card-img-placeholder">⏳</div>
        <div class="card-body">
          ${alias ? `<span class="card-alias">${alias}</span>` : ''}
          <span class="card-sku">SKU: ${sku}</span>
          <p style="color:#6b7280;font-size:.83rem;margin-top:6px">Cargando…</p>
        </div>
        <div class="card-top-actions">
          <button class="btn-delete" data-sku="${sku}" title="Eliminar">✕</button>
        </div>
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
        </div>
        <div class="card-top-actions">
          <button class="btn-delete" data-sku="${sku}" title="Eliminar">✕</button>
        </div>
      </div>`;
  }

  const img = prod.imagen
    ? `<img class="card-img" src="${prod.imagen}" alt="${prod.nombre}" loading="lazy" />`
    : `<div class="card-img-placeholder">📦</div>`;

  const fmt = n => n ? `$${Number(n).toLocaleString('es-CL')}` : null;

  let bloquePrecio = '';
  if (prod.precioOferta) {
    bloquePrecio = `
      <div class="precio-label">Normal</div>
      <div class="precio-tachado">${fmt(prod.precio) || '—'}</div>
      <div class="precio-label">Oferta</div>
      <div class="precio-oferta">${fmt(prod.precioOferta)}</div>`;
  } else if (prod.precio) {
    bloquePrecio = `
      <div class="precio-label">Precio</div>
      <div class="precio-normal">${fmt(prod.precio)}</div>`;
  } else {
    bloquePrecio = `<div class="precio-normal" style="color:#999">Sin precio</div>`;
  }

  const btnLabel = enLista ? '✓ En lista' : '🔖 Cambiar';
  const btnClass = enLista ? 'btn-cambiar en-lista' : 'btn-cambiar';

  return `
    <div class="card">
      <div class="card-top-actions">
        <button class="btn-delete" data-sku="${sku}" title="Eliminar">✕</button>
      </div>
      ${img}
      <div class="card-body">
        ${alias ? `<span class="card-alias">${alias}</span>` : ''}
        <span class="card-nombre" title="${prod.nombre}">${prod.nombre}</span>
        <span class="card-sku">SKU: ${sku}</span>
        <div class="card-precios">${bloquePrecio}</div>
      </div>
      <div class="card-footer">
        ${prod.url ? `<a class="card-link" href="${prod.url}" target="_blank" rel="noopener">Ver →</a>` : '<span></span>'}
        <button class="${btnClass}" data-sku="${sku}">${btnLabel}</button>
      </div>
    </div>`;
}

async function eliminarSku(sku) {
  if (!confirm(`¿Eliminar el SKU ${sku}?`)) return;
  await fetch(`/api/skus/${sku}`, { method: 'DELETE' });
  delete productosCache[sku];
  skusGuardados = skusGuardados.filter(s => s.sku !== sku);
  // Quitar del todo también
  todoItems = todoItems.filter(s => s !== sku);
  guardarTodo();
  renderGrid();
  renderTodo();
  renderCategorias();
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

// ══════════════════════════════════════════
// TODO
// ══════════════════════════════════════════

function guardarTodo() {
  localStorage.setItem('todoList', JSON.stringify(todoItems));
}

function toggleTodo(sku) {
  if (todoItems.includes(sku)) {
    todoItems = todoItems.filter(s => s !== sku);
  } else {
    todoItems.push(sku);
  }
  guardarTodo();
  renderTodo();
  renderGrid();
}

function limpiarTodo() {
  todoItems = [];
  guardarTodo();
  renderTodo();
  renderGrid();
}

function renderTodo() {
  const count = todoItems.length;

  // Badge y estado vacío
  todoBadge.textContent = count;
  todoBadge.classList.toggle('zero', count === 0);
  todoEmptyState.style.display  = count === 0 ? 'block' : 'none';
  todoModalEmpty.style.display  = count === 0 ? 'block' : 'none';
  todoClearModal.style.display  = count === 0 ? 'none'  : 'block';

  // FAB
  actualizarFab();

  // Construir items
  const itemsHTML = todoItems.map(sku => {
    const prod  = productosCache[sku];
    const datos = skusGuardados.find(s => s.sku === sku);
    const alias = datos?.alias || '';

    const thumb = prod?.imagen
      ? `<img class="todo-thumb" src="${prod.imagen}" alt="" />`
      : `<div class="todo-thumb-placeholder">📦</div>`;

    const nombre = prod?.nombre || alias || sku;
    const fmt    = n => n ? `$${Number(n).toLocaleString('es-CL')}` : null;
    const precio = prod?.precioOferta
      ? fmt(prod.precioOferta)
      : (prod?.precio ? fmt(prod.precio) : '—');

    return `
      <li class="todo-item">
        ${thumb}
        <div class="todo-info">
          <span class="todo-nombre" title="${nombre}">${nombre}</span>
          <span class="todo-sku">SKU: ${sku}</span>
          <span class="todo-precio">${precio}</span>
        </div>
        <button class="todo-remove" data-sku="${sku}" title="Quitar">✕</button>
      </li>`;
  }).join('');

  todoList.innerHTML      = itemsHTML;
  todoListModal.innerHTML = itemsHTML;

  // Eventos de quitar
  document.querySelectorAll('.todo-remove').forEach(btn => {
    btn.addEventListener('click', () => toggleTodo(btn.dataset.sku));
  });
}

function actualizarFab() {
  const count = todoItems.length;
  todoFabCount.textContent = count;
  if (categoriaActiva) {
    todoFab.style.display = 'flex';
  }
}

// Abrir/cerrar modal móvil
todoFab.addEventListener('click', () => {
  todoOverlay.classList.add('open');
});
todoModalClose.addEventListener('click', () => {
  todoOverlay.classList.remove('open');
});
todoOverlay.addEventListener('click', (e) => {
  if (e.target === todoOverlay) todoOverlay.classList.remove('open');
});

// Limpiar
todoClear.addEventListener('click', () => {
  if (todoList.length === 0) return;
  if (confirm('¿Limpiar toda la lista?')) limpiarTodo();
});
todoClearModal.addEventListener('click', () => {
  if (confirm('¿Limpiar toda la lista?')) {
    limpiarTodo();
    todoOverlay.classList.remove('open');
  }
});
