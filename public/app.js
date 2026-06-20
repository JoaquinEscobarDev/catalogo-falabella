// ── Formato relativo de fecha ("hace 3h", "hace 2d") ──
function formatRelativo(fecha) {
  const ms = Date.now() - fecha.getTime();
  const min = Math.round(ms / 60000);
  if (min < 1)  return 'recién';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `hace ${horas}h`;
  const dias = Math.round(horas / 24);
  return `hace ${dias}d`;
}

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
  { nombre: 'Audífonos',          icono: '🎧' },
  { nombre: 'Audífonos Cascos',   icono: '🎵' },
  { nombre: 'Parlantes',          icono: '🔊' },
  { nombre: 'Cuidado Personal',   icono: '✨' },
  { nombre: 'Clima',              icono: '❄️' },
];

// ── Estado ──
let categoriaActiva = null;
let skusGuardados   = [];
let productosCache  = {};
let stockCache      = {};
let sizeSkuPending  = null;

// Migración: formato antiguo era array de strings, nuevo es array de objetos {sku, size, quantity}
const rawTodo = JSON.parse(localStorage.getItem('todoList') || '[]');
let todoItems = rawTodo.map(item =>
  typeof item === 'string' ? { sku: item, size: 'Mediano', quantity: 1 } : item
);

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
const headerActions    = document.getElementById('headerActions');
const headerTitle      = document.getElementById('headerTitle');
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
  await revisarCambiosPrecio();
}

// ── Cambios de precio detectados por el refresh diario ──
const NOMBRES_CAMPO = { normal: 'Normal', oferta: 'Oferta', cmr: 'CMR' };

async function revisarCambiosPrecio() {
  let cambios;
  try {
    const r = await fetch('/api/cambios-precio');
    cambios = await r.json();
  } catch { return; }
  if (!cambios?.length) return;

  const fmt = n => n != null ? `$${Number(n).toLocaleString('es-CL')}` : '—';
  for (const c of cambios) {
    let item = todoItems.find(i => i.sku === c.sku);
    if (!item) {
      item = { sku: c.sku, size: 'Mediano', quantity: 1, cambios: [] };
      todoItems.push(item);
    }
    if (!item.cambios) item.cambios = [];
    item.cambios.push({
      campo: NOMBRES_CAMPO[c.campo] || c.campo,
      texto: `${NOMBRES_CAMPO[c.campo] || c.campo}: ${fmt(c.precio_anterior)} → ${fmt(c.precio_nuevo)}`,
      fecha: c.fecha,
    });
  }
  guardarTodo();
  renderTodo();

  try {
    await fetch('/api/cambios-precio/marcar-vistos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: cambios.map(c => c.id) }),
    });
  } catch { /* si falla, se vuelven a mostrar mañana, no pasa nada */ }
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

// El botón "← Categorías" y el botón atrás del navegador hacen lo mismo:
// retroceder en el historial. Quien efectivamente cambia la vista es el
// listener de popstate, así ambos caminos quedan sincronizados y el botón
// atrás del navegador ya no saca de la página, solo vuelve a categorías.
function abrirCategoria(nombre) {
  history.pushState({ categoria: nombre }, '');
  mostrarVistaProductos(nombre);
}

async function mostrarVistaProductos(nombre) {
  categoriaActiva = nombre;
  viewCategorias.style.display = 'none';
  viewProductos.style.display  = 'flex';
  btnBack.style.display        = 'inline-block';
  headerActions.style.display  = 'flex';
  const cat = CATEGORIAS.find(c => c.nombre === nombre);
  headerTitle.textContent = `${cat.icono} ${nombre}`;
  filtroInput.value = '';
  actualizarFab();
  renderGrid();

  const skusCat = skusGuardados.filter(s => s.categoria === nombre);

  // Un solo request trae precio + stock cacheados de toda la categoría,
  // en vez de 2 por producto. Lo que no tenga caché todavía (poco común)
  // se carga individual como antes.
  let datos = [];
  try {
    const r = await fetch(`/api/categoria/${encodeURIComponent(nombre)}`);
    datos = await r.json();
  } catch { /* sigue con la carga individual de fallback */ }

  const sinCache = [];
  for (const d of datos) {
    if (d.producto) productosCache[d.sku] = d.producto;
    else sinCache.push(d.sku);
    if (d.stock) stockCache[d.sku] = d.stock;
  }
  renderGrid();
  renderTodo();

  const faltantes = skusCat.filter(s => productosCache[s.sku] === undefined || stockCache[s.sku] === undefined);
  await Promise.all(faltantes.map(s => Promise.all([cargarProducto(s.sku), cargarStock(s.sku)])));
}

function mostrarVistaCategorias() {
  categoriaActiva = null;
  viewProductos.style.display  = 'none';
  viewCategorias.style.display = 'block';
  btnBack.style.display        = 'none';
  headerActions.style.display  = 'none';
  headerTitle.textContent      = '🛒 Catálogo Falabella';
  todoFab.style.display        = 'none';
  renderCategorias();
}

btnBack.addEventListener('click', () => history.back());

window.addEventListener('popstate', (e) => {
  if (e.state && e.state.categoria) mostrarVistaProductos(e.state.categoria);
  else mostrarVistaCategorias();
});

filtroInput.addEventListener('input', renderGrid);

async function agregarSku(sku, alias) {
  if (!sku || !categoriaActiva) return false;
  mostrarMsg('Agregando…', '');
  const r = await fetch('/api/skus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku, alias, categoria: categoriaActiva }),
  });
  const data = await r.json();
  if (!r.ok) { mostrarMsg(data.error || 'Error al agregar', 'err'); return false; }
  mostrarMsg('SKU agregado ✓', 'ok');
  skusGuardados.unshift({ sku, alias: alias || null, categoria: categoriaActiva });
  renderGrid();
  await Promise.all([cargarProducto(sku), cargarStock(sku)]);
  return true;
}

formAgregar.addEventListener('submit', async (e) => {
  e.preventDefault();
  const sku   = inputSku.value.trim();
  const alias = inputAlias.value.trim();
  if (await agregarSku(sku, alias)) {
    inputSku.value   = '';
    inputAlias.value = '';
  }
});

// ══════════════════════════════════════════
// AGREGAR POR FOTO (OCR + búsqueda)
// ══════════════════════════════════════════

const btnFoto        = document.getElementById('btnFoto');
const inputFoto      = document.getElementById('inputFoto');
const fotoOverlay    = document.getElementById('fotoOverlay');
const fotoModalBody  = document.getElementById('fotoModalBody');
const fotoModalClose = document.getElementById('fotoModalClose');

btnFoto.addEventListener('click', () => inputFoto.click());

inputFoto.addEventListener('change', async () => {
  const file = inputFoto.files[0];
  inputFoto.value = '';
  if (!file) return;

  fotoOverlay.classList.add('show');
  fotoModalBody.innerHTML = '<p class="foto-msg">🔍 Leyendo la foto y buscando el producto…</p>';

  const formData = new FormData();
  formData.append('foto', file);

  try {
    const r = await fetch('/api/buscar-foto', { method: 'POST', body: formData });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error al procesar la foto');
    renderCandidatosFoto(data);
  } catch (e) {
    fotoModalBody.innerHTML = `<p class="foto-msg foto-error">❌ ${e.message}</p>`;
  }
});

function renderCandidatosFoto({ candidatos, texto }) {
  if (!candidatos?.length) {
    fotoModalBody.innerHTML = `
      <p class="foto-msg foto-error">No identificamos el producto automáticamente.</p>
      <p class="foto-msg-sub">Texto leído: "${(texto || '').replace(/\n/g, ' ').trim().slice(0, 200)}"</p>
      <p class="foto-msg-sub">Probá con una foto donde se lea mejor el modelo, o agregalo a mano arriba.</p>`;
    return;
  }
  fotoModalBody.innerHTML = `
    <p class="foto-msg">Elegí el producto correcto:</p>
    <div class="foto-candidatos">
      ${candidatos.map(c => `
        <div class="foto-candidato" data-sku="${c.sku}">
          ${c.imagen ? `<img src="${c.imagen}" alt="" />` : '<div class="foto-candidato-sin-img">📦</div>'}
          <div class="foto-candidato-info">
            <span class="foto-candidato-nombre">${c.nombre}</span>
            <span class="foto-candidato-precio">${c.precio ? '$' + Number(c.precio).toLocaleString('es-CL') : ''}</span>
          </div>
        </div>`).join('')}
    </div>`;
  fotoModalBody.querySelectorAll('.foto-candidato').forEach(el => {
    el.addEventListener('click', async () => {
      const sku = el.dataset.sku;
      if (skusGuardados.some(s => s.sku === sku)) {
        fotoModalBody.innerHTML = '<p class="foto-msg foto-error">Ese producto ya está agregado.</p>';
        return;
      }
      fotoModalBody.innerHTML = '<p class="foto-msg">Agregando…</p>';
      await agregarSku(sku, '');
      cerrarModalFoto();
    });
  });
}

function cerrarModalFoto() {
  fotoOverlay.classList.remove('show');
  fotoModalBody.innerHTML = '<p class="foto-msg">Sacá una foto donde se lea el modelo o nombre del producto.</p>';
}

fotoModalClose.addEventListener('click', cerrarModalFoto);
fotoOverlay.addEventListener('click', (e) => { if (e.target === fotoOverlay) cerrarModalFoto(); });

// ══════════════════════════════════════════
// PRODUCTOS
// ══════════════════════════════════════════

async function cargarProducto(sku, force = false) {
  if (!force && productosCache[sku] !== undefined) return;
  productosCache[sku] = null;
  renderGrid();
  try {
    const url  = force ? `/api/producto/${sku}?force=1` : `/api/producto/${sku}`;
    const r    = await fetch(url);
    const data = await r.json();
    productosCache[sku] = r.ok ? data : { error: data.error };
  } catch {
    productosCache[sku] = { error: 'Error de red' };
  }
  renderGrid();
  renderTodo();
}

// El refresco real lo hace tu PC (ver watch-refresh.js) cada ~5 min — Railway
// no puede scrapear Falabella de forma confiable. El botón solo deja la
// solicitud y espera a que se procese para volver a cargar los precios.
btnRefreshAll.addEventListener('click', async () => {
  if (!categoriaActiva || btnRefreshAll.disabled) return;
  btnRefreshAll.disabled = true;
  btnRefreshAll.textContent = '↻ Solicitando…';

  let solicitudId;
  try {
    const r = await fetch('/api/solicitar-refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoria: categoriaActiva }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Error al solicitar');
    solicitudId = data.id;
  } catch (e) {
    btnRefreshAll.textContent = '❌ ' + e.message;
    setTimeout(() => { btnRefreshAll.textContent = '↻ Actualizar precios'; btnRefreshAll.disabled = false; }, 3000);
    return;
  }

  btnRefreshAll.textContent = '↻ Esperando tu PC…';
  const categoriaAlSolicitar = categoriaActiva;

  // Tu PC revisa solicitudes pendientes cada ~5 min — esperamos hasta 12 min en total.
  for (let intento = 0; intento < 24; intento++) {
    await new Promise(res => setTimeout(res, 30000));
    let procesado = false;
    try {
      const r = await fetch(`/api/solicitar-refresh/${solicitudId}`);
      procesado = (await r.json()).procesado;
    } catch { /* probar de nuevo en el próximo intento */ }
    if (procesado) {
      if (categoriaActiva === categoriaAlSolicitar) {
        const skusCat = skusGuardados.filter(s => s.categoria === categoriaAlSolicitar);
        skusCat.forEach(s => { delete productosCache[s.sku]; delete stockCache[s.sku]; });
        renderGrid();
        await Promise.all(skusCat.map(s => Promise.all([cargarProducto(s.sku), cargarStock(s.sku)])));
      }
      btnRefreshAll.textContent = '✓ Precios actualizados';
      setTimeout(() => { btnRefreshAll.textContent = '↻ Actualizar precios'; btnRefreshAll.disabled = false; }, 3000);
      return;
    }
  }
  btnRefreshAll.textContent = '⏱ Tardó más de lo esperado';
  setTimeout(() => { btnRefreshAll.textContent = '↻ Actualizar precios'; btnRefreshAll.disabled = false; }, 4000);
});

async function cargarStock(sku) {
  if (stockCache[sku] !== undefined) return;
  stockCache[sku] = null;
  try {
    const r    = await fetch(`/api/stock/${sku}`);
    const data = await r.json();
    stockCache[sku] = r.ok ? data : { stock: null };
  } catch {
    stockCache[sku] = { stock: null };
  }
  renderGrid();
}

// Normaliza (sin acentos, minúsculas) para que "camara" encuentre "Cámara".
function normalizarTexto(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function renderGrid() {
  if (!categoriaActiva) return;
  const palabras = normalizarTexto(filtroInput.value).trim().split(/\s+/).filter(Boolean);
  const skusCat  = skusGuardados.filter(s => s.categoria === categoriaActiva);
  const lista    = skusCat.filter(s => {
    if (!palabras.length) return true;
    const prod    = productosCache[s.sku];
    const nombre  = prod?.nombre || '';
    const haystack = normalizarTexto(`${s.sku} ${s.alias || ''} ${nombre}`);
    return palabras.every(p => haystack.includes(p));
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

function badgeStock(sku) {
  const info = stockCache[sku];
  if (info === undefined || info === null) return '<span class="stock-badge stock-loading">Stock…</span>';
  const n = info.stock;
  if (n === null || n === undefined) return '<span class="stock-badge stock-unknown">Sin info</span>';
  if (n === 0) return `<span class="stock-badge stock-zero">Stock: 0</span>`;
  if (n === 1) return `<span class="stock-badge stock-low">Stock: 1</span>`;
  return `<span class="stock-badge stock-ok">Stock: ${n}</span>`;
}

function tarjeta({ sku, alias }) {
  const prod    = productosCache[sku];
  const enLista = todoItems.some(item => item.sku === sku);

  if (prod === undefined || prod === null) {
    return `
      <div class="card loading">
        <div class="card-top-actions">
          <button class="btn-delete" data-sku="${sku}" title="Eliminar">✕</button>
        </div>
        <div class="card-img-placeholder">⏳</div>
        <div class="card-content">
          <div class="card-body">
            ${alias ? `<span class="card-alias">${alias}</span>` : ''}
            <span class="card-sku">SKU: ${sku}</span>
            <p class="card-loading-msg">Cargando…</p>
          </div>
        </div>
      </div>`;
  }

  if (prod.error) {
    return `
      <div class="card error">
        <div class="card-top-actions">
          <button class="btn-delete" data-sku="${sku}" title="Eliminar">✕</button>
        </div>
        <div class="card-img-placeholder">❌</div>
        <div class="card-content">
          <div class="card-body">
            ${alias ? `<span class="card-alias">${alias}</span>` : ''}
            <span class="card-sku">SKU: ${sku}</span>
            <p class="card-error-msg">${prod.error}</p>
          </div>
        </div>
      </div>`;
  }

  const img = prod.imagen
    ? `<img class="card-img" src="${prod.imagen}" alt="${prod.nombre}" loading="lazy" />`
    : `<div class="card-img-placeholder">📦</div>`;

  const fmt = n => n ? `$${Number(n).toLocaleString('es-CL')}` : null;

  const cmrRow = prod.precioCMR
    ? `<div class="precio-fila"><span class="precio-label">CMR</span><span class="precio-cmr">${fmt(prod.precioCMR)}</span></div>`
    : '';

  let bloquePrecio = '';
  if (prod.precioOferta) {
    bloquePrecio = `
      <div class="precio-fila"><span class="precio-label">Normal</span><span class="precio-tachado">${fmt(prod.precio) || '—'}</span></div>
      <div class="precio-fila"><span class="precio-label">Oferta</span><span class="precio-oferta">${fmt(prod.precioOferta)}</span></div>
      ${cmrRow}`;
  } else if (prod.precio) {
    bloquePrecio = `
      <div class="precio-fila"><span class="precio-label">Precio</span><span class="precio-normal">${fmt(prod.precio)}</span></div>
      ${cmrRow}`;
  } else {
    bloquePrecio = `<div class="precio-fila"><span class="precio-normal" style="color:#999">Sin precio</span></div>${cmrRow}`;
  }

  let bloqueGarantia = '';
  if (prod.garantia1a || prod.garantia2a || prod.garantia3a) {
    const filas = [
      prod.garantia1a ? `<span class="garantia-item">1a: ${fmt(prod.garantia1a)}</span>` : '',
      prod.garantia2a ? `<span class="garantia-item">2a: ${fmt(prod.garantia2a)}</span>` : '',
      prod.garantia3a ? `<span class="garantia-item">3a: ${fmt(prod.garantia3a)}</span>` : '',
    ].filter(Boolean).join('');
    bloqueGarantia = `<div class="card-garantia"><span class="garantia-label">🛡️ Garantía ext.</span>${filas}</div>`;
  }

  const btnLabel = enLista ? '✓ En lista' : '🔖 Cambiar';
  const btnClass = enLista ? 'btn-cambiar en-lista' : 'btn-cambiar';

  let cacheBadge = '';
  if (prod.cached && prod.updatedAt) {
    const d       = new Date(prod.updatedAt);
    const fecha   = d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
    const hora    = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    const relativo = formatRelativo(d);
    const vieja   = (Date.now() - d.getTime()) > 36 * 3600 * 1000; // más de 36h sin actualizar
    cacheBadge  = `<span class="cache-badge${vieja ? ' cache-badge-vieja' : ''}" title="Precio guardado el ${fecha} a las ${hora}">🕐 ${relativo}</span>`;
  }

  return `
    <div class="card${prod.cached ? ' cached' : ''}">
      <div class="card-top-actions">
        <button class="btn-delete" data-sku="${sku}" title="Eliminar">✕</button>
      </div>
      ${img}
      <div class="card-content">
        <div class="card-body">
          ${alias ? `<span class="card-alias">${alias}</span>` : ''}
          ${prod.capacidad ? `<span class="card-capacidad">${prod.capacidad}${prod.color ? ` · ${prod.color}` : ''}</span>` : ''}
          <span class="card-nombre" title="${prod.nombre}">${prod.nombre}</span>
          <span class="card-sku">SKU: ${sku}</span>
          <div class="card-precios">${bloquePrecio}</div>
          ${bloqueGarantia}
          ${badgeStock(sku)}
          ${cacheBadge}
        </div>
        <div class="card-footer">
          ${prod.url ? `<a class="card-link" href="${prod.url}" target="_blank" rel="noopener">Ver →</a>` : '<span></span>'}
          <button class="${btnClass}" data-sku="${sku}">${btnLabel}</button>
        </div>
      </div>
    </div>`;
}

async function eliminarSku(sku) {
  if (!confirm(`¿Eliminar el SKU ${sku}?`)) return;
  await fetch(`/api/skus/${sku}`, { method: 'DELETE' });
  delete productosCache[sku];
  delete stockCache[sku];
  skusGuardados = skusGuardados.filter(s => s.sku !== sku);
  todoItems     = todoItems.filter(item => item.sku !== sku);
  guardarTodo();
  renderGrid();
  renderTodo();
  renderCategorias();
}

function mostrarMsg(msg, tipo) {
  msgAgregar.textContent = msg;
  msgAgregar.className   = 'msg ' + tipo;
  if (tipo === 'ok') setTimeout(() => { msgAgregar.textContent = ''; }, 3000);
}

// ══════════════════════════════════════════
// TODO
// ══════════════════════════════════════════

function guardarTodo() {
  localStorage.setItem('todoList', JSON.stringify(todoItems));
}

function toggleTodo(sku) {
  const idx = todoItems.findIndex(item => item.sku === sku);
  if (idx !== -1) {
    todoItems.splice(idx, 1);
    guardarTodo();
    renderTodo();
    renderGrid();
  } else {
    abrirSizeModal(sku);
  }
}

function limpiarTodo() {
  todoItems = [];
  guardarTodo();
  renderTodo();
  renderGrid();
}

function renderTodo() {
  const count = todoItems.length;

  todoBadge.textContent = count;
  todoBadge.classList.toggle('zero', count === 0);
  todoEmptyState.style.display = count === 0 ? 'block' : 'none';
  todoModalEmpty.style.display = count === 0 ? 'block' : 'none';
  todoClearModal.style.display = count === 0 ? 'none'  : 'block';

  actualizarFab();

  const itemsHTML = todoItems.map(({ sku, size, quantity, cambios }) => {
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

    const fechaCambio = cambios?.length ? new Date(cambios[cambios.length - 1].fecha) : null;
    const cambiosHTML = cambios?.length
      ? `<div class="todo-cambios">
          ${cambios.map(c => `<span class="todo-cambio-linea">${c.texto}</span>`).join('')}
          ${fechaCambio ? `<span class="todo-cambio-fecha">${fechaCambio.toLocaleDateString('es-CL')}</span>` : ''}
        </div>`
      : '';

    return `
      <li class="todo-item">
        ${thumb}
        <div class="todo-info">
          <span class="todo-nombre" title="${nombre}">${nombre}</span>
          <span class="todo-sku">SKU: ${sku}</span>
          <span class="todo-precio">${precio}</span>
          <span class="todo-size">${size} × ${quantity}</span>
          ${cambiosHTML}
        </div>
        <button class="todo-remove" data-sku="${sku}" title="Quitar">✕</button>
      </li>`;
  }).join('');

  todoList.innerHTML      = itemsHTML;
  todoListModal.innerHTML = itemsHTML;

  document.querySelectorAll('.todo-remove').forEach(btn => {
    btn.addEventListener('click', () => toggleTodo(btn.dataset.sku));
  });
}

function actualizarFab() {
  todoFabCount.textContent = todoItems.length;
  if (categoriaActiva) todoFab.style.display = 'flex';
}

// ══════════════════════════════════════════
// MODAL TAMAÑO / CANTIDAD
// ══════════════════════════════════════════

function abrirSizeModal(sku) {
  sizeSkuPending = sku;
  const prod  = productosCache[sku];
  const datos = skusGuardados.find(s => s.sku === sku);
  const nombre = prod?.nombre || datos?.alias || `SKU ${sku}`;
  document.getElementById('sizeTitulo').textContent =
    nombre.length > 40 ? nombre.slice(0, 40) + '…' : nombre;
  document.getElementById('sizeStep1').style.display = 'block';
  document.getElementById('sizeStep2').style.display = 'none';
  document.getElementById('sizeStep2').dataset.size  = '';
  document.getElementById('qtyInput').value          = 1;
  document.getElementById('sizeOverlay').classList.add('open');
}

document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('sizeStep2').dataset.size        = btn.dataset.size;
    document.getElementById('sizeSelectedLabel').textContent = btn.dataset.size;
    document.getElementById('sizeStep1').style.display       = 'none';
    document.getElementById('sizeStep2').style.display       = 'block';
  });
});

document.getElementById('qtyMinus').addEventListener('click', () => {
  const input = document.getElementById('qtyInput');
  if (parseInt(input.value) > 1) input.value = parseInt(input.value) - 1;
});

document.getElementById('qtyPlus').addEventListener('click', () => {
  const input = document.getElementById('qtyInput');
  input.value = parseInt(input.value) + 1;
});

document.getElementById('sizeConfirm').addEventListener('click', () => {
  const size     = document.getElementById('sizeStep2').dataset.size;
  const quantity = parseInt(document.getElementById('qtyInput').value) || 1;
  if (!size) return;
  todoItems.push({ sku: sizeSkuPending, size, quantity });
  guardarTodo();
  renderTodo();
  renderGrid();
  document.getElementById('sizeOverlay').classList.remove('open');
});

document.getElementById('sizeClose').addEventListener('click', () => {
  document.getElementById('sizeOverlay').classList.remove('open');
});

document.getElementById('sizeOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('sizeOverlay'))
    document.getElementById('sizeOverlay').classList.remove('open');
});

// ── Modal ToDo ──
todoFab.addEventListener('click', () => todoOverlay.classList.add('open'));
todoModalClose.addEventListener('click', () => todoOverlay.classList.remove('open'));
todoOverlay.addEventListener('click', e => {
  if (e.target === todoOverlay) todoOverlay.classList.remove('open');
});

todoClear.addEventListener('click', () => {
  if (todoItems.length === 0) return;
  if (confirm('¿Limpiar toda la lista?')) limpiarTodo();
});
todoClearModal.addEventListener('click', () => {
  if (confirm('¿Limpiar toda la lista?')) {
    limpiarTodo();
    todoOverlay.classList.remove('open');
  }
});
