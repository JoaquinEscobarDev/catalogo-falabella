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

// Escapa texto que viene de afuera (Falabella, cupones) antes de meterlo en HTML.
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
const fmtPesos = n => `$${Number(n).toLocaleString('es-CL')}`;

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
  { nombre: 'Accesorios',         icono: '🔌' },
];

// ── Estado ──
let categoriaActiva = null;
let skusGuardados   = [];
let productosCache  = {};
let stockCache      = {};
let sizeSkuPending  = null;
let gridPrimeraVez  = false; // true solo al entrar a una categoría → activa animación stagger

// El ToDo vive en el servidor (tabla todo_items), no en localStorage, para
// que todos los dispositivos vean siempre la misma lista.
let todoItems = [];

// ── Elementos ──
const viewCategorias   = document.getElementById('viewCategorias');
const viewProductos    = document.getElementById('viewProductos');
const categoriasGrid   = document.getElementById('categoriasGrid');
const grid             = document.getElementById('grid');
const filtroInput      = document.getElementById('filtro');
const filtroMarca      = document.getElementById('filtroMarca');
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
  cargarEstadoRefresh();
  await cargarTodo();
  // Refresca el ToDo cada 20s para que los cambios de otros dispositivos
  // (agregar, quitar, limpiar) se vean sin tener que recargar la página.
  setInterval(cargarTodo, 20000);
}

// ── Cambios de precio detectados por el refresh diario ──
const NOMBRES_CAMPO = { normal: 'Normal', oferta: 'Oferta', cmr: 'CMR' };

async function cargarTodo() {
  let items;
  try {
    const r = await fetch('/api/todo');
    items = await r.json();
  } catch { return; }

  const fmt = n => n != null ? `$${Number(n).toLocaleString('es-CL')}` : '—';
  todoItems = items.map(item => ({
    ...item,
    cambios: (item.cambios || []).map(c => ({
      id: c.id,
      campo: NOMBRES_CAMPO[c.campo] || c.campo,
      texto: `${NOMBRES_CAMPO[c.campo] || c.campo}: ${fmt(c.precio_anterior)} → ${fmt(c.precio_nuevo)}`,
      fecha: c.fecha,
    })),
  }));

  // Precargar en silencio los productos del ToDo que no están en caché
  // para que las imágenes se vean sin tener que entrar a cada categoría.
  const faltantes = todoItems.map(i => i.sku).filter(sku => productosCache[sku] === undefined);
  if (faltantes.length) {
    await Promise.all(faltantes.map(async sku => {
      try {
        const r = await fetch(`/api/producto/${sku}`);
        const data = await r.json();
        productosCache[sku] = r.ok ? data : { error: data.error };
      } catch {
        productosCache[sku] = { error: 'Error de red' };
      }
    }));
  }

  renderTodo();
  renderGrid();
}

// ══════════════════════════════════════════
// CATEGORÍAS
// ══════════════════════════════════════════

function renderCategorias() {
  categoriasGrid.innerHTML = CATEGORIAS.map((c, i) => {
    const count = skusGuardados.filter(s => s.categoria === c.nombre).length;
    return `
      <div class="categoria-card" data-cat="${c.nombre}" style="--i:${i}">
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
  viewProductos.classList.remove('view-enter');
  void viewProductos.offsetWidth;
  viewProductos.classList.add('view-enter');
  btnBack.style.display        = 'inline-block';
  headerActions.style.display  = 'flex';
  const cat = CATEGORIAS.find(c => c.nombre === nombre);
  headerTitle.textContent = `${cat.icono} ${nombre}`;
  filtroInput.value = '';
  filtroMarca.value = '';
  gridPrimeraVez = true;
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
  viewCategorias.classList.remove('view-enter');
  void viewCategorias.offsetWidth;
  viewCategorias.classList.add('view-enter');
  btnBack.style.display        = 'none';
  headerActions.style.display  = 'none';
  headerTitle.textContent      = '🛒 Catálogo Falabella';
  todoFab.style.display        = 'none';
  renderCategorias();
  cargarEstadoRefresh();
}

btnBack.addEventListener('click', () => history.back());

window.addEventListener('popstate', (e) => {
  if (e.state && e.state.categoria) mostrarVistaProductos(e.state.categoria);
  else mostrarVistaCategorias();
});

filtroInput.addEventListener('input', renderGrid);
filtroMarca.addEventListener('change', renderGrid);

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

// Vuelve a pedir precio + stock de toda la categoría en un solo request.
async function recargarCategoria(nombre) {
  let datos;
  try {
    const r = await fetch(`/api/categoria/${encodeURIComponent(nombre)}`);
    datos = await r.json();
  } catch { return; }
  if (!Array.isArray(datos)) return;
  for (const d of datos) {
    if (d.producto) productosCache[d.sku] = d.producto;
    if (d.stock) stockCache[d.sku] = d.stock;
  }
  renderGrid();
  renderTodo();
}

// El refresco lo hace el propio servidor en segundo plano (ya no depende de
// una PC prendida). El botón deja la solicitud y va mostrando el avance hasta
// que termina, y recién ahí recarga los precios.
btnRefreshAll.addEventListener('click', async () => {
  if (!categoriaActiva || btnRefreshAll.disabled) return;
  btnRefreshAll.disabled = true;
  btnRefreshAll.textContent = '↻ Solicitando…';
  const restaurar = ms => setTimeout(() => { btnRefreshAll.textContent = '↻ Actualizar precios'; btnRefreshAll.disabled = false; }, ms);

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
    restaurar(3000);
    return;
  }

  btnRefreshAll.textContent = '↻ Actualizando…';
  const categoriaAlSolicitar = categoriaActiva;

  // Hasta 30 min: una categoría grande con el browser de respaldo puede tardar.
  for (let intento = 0; intento < 450; intento++) {
    await new Promise(res => setTimeout(res, 4000));
    let estado = null;
    try {
      const r = await fetch(`/api/solicitar-refresh/${solicitudId}`);
      estado = await r.json();
    } catch { continue; /* probar de nuevo en el próximo intento */ }

    if (estado.procesado) {
      if (categoriaActiva === categoriaAlSolicitar) await recargarCategoria(categoriaAlSolicitar);
      const total = (estado.ok || 0) + (estado.fail || 0);
      if (total && !estado.ok) btnRefreshAll.textContent = '⚠️ Falabella no respondió';
      else if (estado.fail)    btnRefreshAll.textContent = `✓ Actualizados ${estado.ok} de ${total}`;
      else                     btnRefreshAll.textContent = '✓ Precios actualizados';
      restaurar(4000);
      return;
    }
    if (estado.avance)          btnRefreshAll.textContent = `↻ Actualizando ${estado.avance.hechos}/${estado.avance.total}…`;
    else if (estado.esperandoA) btnRefreshAll.textContent = '↻ En cola…';
  }
  btnRefreshAll.textContent = '⏱ Tardó más de lo esperado';
  restaurar(4000);
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

// El precio más bajo que realmente paga el cliente: CMR u oferta,
// lo que sea menor; si no hay ninguno, el precio normal.
function precioOrden(prod) {
  if (!prod) return Infinity;
  const conCupon = (prod.cupones || []).map(c => c.mejorPrecio);
  const candidatos = [prod.precioCMR, prod.precioOferta, prod.precio, ...conCupon].filter(p => p != null);
  return candidatos.length ? Math.min(...candidatos) : Infinity;
}

// Reconstruye las opciones del filtro de marca según lo que haya cargado
// de la categoría activa, conservando la selección si sigue existiendo.
function actualizarFiltroMarca(skusCat) {
  const marcas = [...new Set(skusCat.map(s => productosCache[s.sku]?.marca).filter(Boolean))].sort();
  const seleccionActual = filtroMarca.value;
  filtroMarca.innerHTML = '<option value="">Todas las marcas</option>'
    + marcas.map(m => `<option value="${m}">${m}</option>`).join('');
  if (marcas.includes(seleccionActual)) filtroMarca.value = seleccionActual;
}

function renderGrid() {
  if (!categoriaActiva) return;
  const palabras = normalizarTexto(filtroInput.value).trim().split(/\s+/).filter(Boolean);
  const skusCat  = skusGuardados.filter(s => s.categoria === categoriaActiva);
  actualizarFiltroMarca(skusCat);
  const marcaSeleccionada = filtroMarca.value;
  const lista    = skusCat.filter(s => {
    const prod = productosCache[s.sku];
    if (marcaSeleccionada && prod?.marca !== marcaSeleccionada) return false;
    if (!palabras.length) return true;
    const nombre  = prod?.nombre || '';
    const haystack = normalizarTexto(`${s.sku} ${s.alias || ''} ${nombre}`);
    return palabras.every(p => haystack.includes(p));
  }).sort((a, b) => precioOrden(productosCache[a.sku]) - precioOrden(productosCache[b.sku]));

  if (!lista.length) {
    grid.innerHTML = '<div class="empty-state">No hay productos en esta categoría.<br>Agregá un SKU arriba.</div>';
    return;
  }
  // Solo animar cuando ya hay datos reales (no skeletons de carga)
  const hayDatos = lista.some(s => productosCache[s.sku] !== undefined && productosCache[s.sku] !== null);
  const animar = gridPrimeraVez && hayDatos;
  if (animar) gridPrimeraVez = false;
  grid.innerHTML = lista.map((s, i) => tarjeta(s, animar ? i : -1)).join('');
  grid.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => eliminarSku(btn.dataset.sku));
  });
  grid.querySelectorAll('.btn-cambiar').forEach(btn => {
    btn.addEventListener('click', () => toggleTodo(btn.dataset.sku));
  });
  grid.querySelectorAll('.btn-upc').forEach(btn => {
    btn.addEventListener('click', () => editarUpc(btn.dataset.sku));
  });
  grid.querySelectorAll('.btn-cuotas').forEach(btn => {
    btn.addEventListener('click', () => abrirCuotasModal(btn.dataset.sku));
  });
  grid.querySelectorAll('.btn-simular').forEach(btn => {
    btn.addEventListener('click', () => simularDesdeProducto(btn.dataset.sku));
  });
}

function badgeStock(sku) {
  const info = stockCache[sku];
  if (info === undefined || info === null) return '<span class="stock-badge stock-loading">Stock…</span>';
  const n = info.stock;
  if (n === null || n === undefined) return '<span class="stock-badge stock-unknown">Sin info</span>';
  if (n <= 2) return `<span class="stock-badge stock-low">Revisar</span>`;
  return `<span class="stock-badge stock-ok">Stock: ${n}</span>`;
}

// Cupones que aplican al producto, con el precio final ya calculado por el
// servidor (ver src/services/couponService.js).
function bloqueCupones(prod) {
  const cupones = prod.cupones || [];
  if (!cupones.length) return '';
  const MAX = 2;

  const items = cupones.slice(0, MAX).map(c => {
    const condiciones = [];
    if (c.tope)    condiciones.push(`tope ${fmtPesos(c.tope)}`);
    if (c.minimo)  condiciones.push(`compra mínima ${fmtPesos(c.minimo)}`);
    if (c.soloCMR) condiciones.push('solo con CMR');
    if (c.vence) {
      const [, m, d] = c.vence.split('-');
      condiciones.push(`hasta ${d}/${m}`);
    }
    const titulo = `🎟️ ${c.codigo ? `Cupón <strong>${esc(c.codigo)}</strong>` : 'Cupón'}${c.etiqueta ? ` −${esc(c.etiqueta)}` : ''}`;

    let cuerpo;
    if (!c.tipo) {
      // Falabella anuncia un cupón pero no se pudo leer de cuánto es.
      cuerpo = `<div class="cupon-nota">${esc(c.texto || 'Cupón disponible')}</div>`;
    } else if (c.noAplica) {
      cuerpo = `<div class="cupon-nota">No alcanza la compra mínima de ${fmtPesos(c.minimo)}</div>`;
    } else {
      const filas = [];
      if (c.precioFinal != null) {
        filas.push(`<div class="precio-fila"><span class="precio-label">Con cupón</span><span class="precio-cupon">${fmtPesos(c.precioFinal)}</span></div>`);
      }
      if (c.precioFinalCMR != null) {
        filas.push(`<div class="precio-fila"><span class="precio-label">Con cupón + CMR</span><span class="precio-cupon${c.precioFinal != null ? ' precio-cupon-cmr' : ''}">${fmtPesos(c.precioFinalCMR)}</span></div>`);
      }
      cuerpo = filas.join('');
    }
    return `
      <div class="card-cupon${c.noAplica ? ' card-cupon-off' : ''}" title="${esc(c.texto || '')}">
        <div class="cupon-titulo">${titulo}</div>
        ${cuerpo}
        ${condiciones.length ? `<div class="cupon-cond">${condiciones.join(' · ')}</div>` : ''}
      </div>`;
  }).join('');

  const extra = cupones.length > MAX ? `<div class="cupon-cond">+${cupones.length - MAX} cupón(es) más</div>` : '';
  return items + extra;
}

function tarjeta({ sku, alias }, idx = -1) {
  const prod    = productosCache[sku];
  const enLista = todoItems.some(item => item.sku === sku);
  const animAttr = idx >= 0 ? ` animate-in" style="--i:${idx}` : '';

  if (prod === undefined || prod === null) {
    return `
      <div class="card loading${animAttr}">
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
      <div class="card error${animAttr}">
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

  const bloqueCuotas = prod.cuotasSinInteres
    ? `<div class="card-cuotas">💳 Hasta ${prod.cuotasSinInteres} cuotas sin interés (CMR)</div>`
    : '';

  const btnCuotas = `<button class="btn-cuotas" data-sku="${sku}">💳 Cuotas</button>`;

  const bloqueDespacho = prod.despacho24h
    ? `<div class="card-despacho">🚚 Despacho 24 horas</div>`
    : '';

  const bloqueCupon = bloqueCupones(prod);
  const bloqueConnect = bloquePlan(prod, sku);

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
    <div class="card${prod.cached ? ' cached' : ''}${animAttr}">
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
          <div class="card-upc-row">
            ${prod.upc
              ? `<span class="card-upc-val">UPC: ${prod.upc}</span>`
              : ''}
            <button class="btn-upc" data-sku="${sku}" title="${prod.upc ? 'Editar UPC' : 'Agregar UPC'}">
              ${prod.upc ? '✏' : '＋ UPC'}
            </button>
          </div>
          <div class="card-precios">${bloquePrecio}</div>
          ${bloqueCupon}
          ${bloqueConnect}
          ${bloqueDespacho}
          ${bloqueCuotas}
          ${bloqueGarantia}
          ${badgeStock(sku)}
          ${cacheBadge}
        </div>
        <div class="card-footer">
          ${prod.url ? `<a class="card-link" href="${prod.url}" target="_blank" rel="noopener">Ver →</a>` : '<span></span>'}
          <div style="display:flex;gap:6px;align-items:center">
            ${btnCuotas}
            <button class="${btnClass}" data-sku="${sku}">${btnLabel}</button>
          </div>
        </div>
      </div>
    </div>`;
}

async function editarUpc(sku) {
  const prod = productosCache[sku];
  const actual = prod?.upc || '';

  // Reemplazar la fila UPC por un input inline
  const row = document.querySelector(`.btn-upc[data-sku="${sku}"]`)?.closest('.card-upc-row');
  if (!row) return;

  row.innerHTML = `
    <input class="upc-input" type="text" value="${actual}" placeholder="Ej: 012345678901" maxlength="14" />
    <button class="upc-save" data-sku="${sku}">✓</button>
    <button class="upc-cancel">✕</button>`;

  const input  = row.querySelector('.upc-input');
  const btnSave   = row.querySelector('.upc-save');
  const btnCancel = row.querySelector('.upc-cancel');

  input.focus();
  input.select();

  const guardar = async () => {
    const val = input.value.trim();
    btnSave.disabled = true;
    await fetch(`/api/producto/${sku}/upc`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upc: val }),
    });
    if (productosCache[sku]) productosCache[sku].upc = val || null;
    renderGrid();
  };

  btnSave.addEventListener('click', guardar);
  btnCancel.addEventListener('click', () => renderGrid());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') guardar();
    if (e.key === 'Escape') renderGrid();
  });
}

async function eliminarSku(sku) {
  if (!confirm(`¿Eliminar el SKU ${sku}?`)) return;
  await fetch(`/api/skus/${sku}`, { method: 'DELETE' });
  await fetch(`/api/todo/${sku}`, { method: 'DELETE' });
  delete productosCache[sku];
  delete stockCache[sku];
  skusGuardados = skusGuardados.filter(s => s.sku !== sku);
  todoItems = todoItems.filter(item => item.sku !== sku);
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

async function toggleTodo(sku) {
  const idx = todoItems.findIndex(item => item.sku === sku);
  if (idx !== -1) {
    todoItems.splice(idx, 1);
    renderTodo();
    renderGrid();
    await fetch(`/api/todo/${sku}`, { method: 'DELETE' });
  } else {
    abrirSizeModal(sku);
  }
}

async function limpiarTodo() {
  todoItems = [];
  renderTodo();
  renderGrid();
  await fetch('/api/todo/clear', { method: 'POST' });
}

function renderTodo() {
  const count = todoItems.length;

  todoBadge.textContent = count;
  todoBadge.classList.toggle('zero', count === 0);
  todoEmptyState.style.display = count === 0 ? 'block' : 'none';
  todoModalEmpty.style.display = count === 0 ? 'block' : 'none';
  todoClearModal.style.display = count === 0 ? 'none'  : 'block';

  actualizarFab();

  const grupos = {};
  for (const item of todoItems) {
    const categoria = skusGuardados.find(s => s.sku === item.sku)?.categoria || 'Sin categoría';
    (grupos[categoria] ||= []).push(item);
  }

  const itemHTML = ({ sku, size, quantity, cambios }) => {
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
  };

  const itemsHTML = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'es')).map(categoria =>
    `<li class="todo-categoria">${categoria}</li>${grupos[categoria].map(itemHTML).join('')}`
  ).join('');

  todoList.innerHTML      = itemsHTML;
  todoListModal.innerHTML = itemsHTML;

  document.querySelectorAll('.todo-remove').forEach(btn => {
    btn.addEventListener('click', () => toggleTodo(btn.dataset.sku));
  });
}

function actualizarFab() {
  todoFabCount.textContent = todoItems.length;
  if (categoriaActiva) todoFab.style.display = 'flex';
  todoFab.classList.toggle('has-items', todoItems.length > 0);
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

document.getElementById('sizeConfirm').addEventListener('click', async () => {
  const size     = document.getElementById('sizeStep2').dataset.size;
  const quantity = parseInt(document.getElementById('qtyInput').value) || 1;
  if (!size) return;
  const sku = sizeSkuPending;
  todoItems.push({ sku, size, quantity, cambios: [] });
  renderTodo();
  renderGrid();
  document.getElementById('sizeOverlay').classList.remove('open');
  await fetch('/api/todo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku, size, quantity }),
  });
});

document.getElementById('sizeClose').addEventListener('click', () => {
  document.getElementById('sizeOverlay').classList.remove('open');
});

document.getElementById('sizeOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('sizeOverlay'))
    document.getElementById('sizeOverlay').classList.remove('open');
});

// ══════════════════════════════════════════
// BÚSQUEDA GLOBAL
// ══════════════════════════════════════════

const btnSearchGlobal = document.getElementById('btnSearchGlobal');
const searchOverlay   = document.getElementById('searchOverlay');
const searchInput     = document.getElementById('searchInput');
const searchClose     = document.getElementById('searchClose');
const searchBody      = document.getElementById('searchBody');

// Si el HTML cacheado por el SW no tiene el modal (versión vieja), no inicializar
// para evitar TypeError que rompe el script completo.
const searchDisponible = btnSearchGlobal && searchOverlay && searchInput && searchClose && searchBody;

let searchDebounce = null;

if (searchDisponible) {

  btnSearchGlobal.addEventListener('click', () => {
    searchOverlay.classList.add('open');
    searchInput.value = '';
    searchBody.innerHTML = '<p class="search-hint">Escribí al menos 2 caracteres</p>';
    setTimeout(() => searchInput.focus(), 80);
  });

  searchClose.addEventListener('click', cerrarBusqueda);
  searchOverlay.addEventListener('click', e => { if (e.target === searchOverlay) cerrarBusqueda(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarBusqueda(); });

  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const q = searchInput.value.trim();
    if (q.length < 2) {
      searchBody.innerHTML = '<p class="search-hint">Escribí al menos 2 caracteres</p>';
      return;
    }
    searchBody.innerHTML = '<p class="search-loading">Buscando…</p>';
    searchDebounce = setTimeout(() => buscarProductos(q), 280);
  });

}

function cerrarBusqueda() {
  if (searchOverlay) searchOverlay.classList.remove('open');
}

async function buscarProductos(q) {
  let resultados;
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    resultados = await r.json();
  } catch {
    if (searchBody) searchBody.innerHTML = '<p class="search-empty">Error al buscar</p>';
    return;
  }

  if (!Array.isArray(resultados) || !resultados.length) {
    const esc = q.replace(/</g, '&lt;');
    searchBody.innerHTML = `<p class="search-empty">Sin resultados para "<strong>${esc}</strong>"</p>`;
    return;
  }

  // Inyectar en caché para que tarjeta() lea los datos correctamente
  for (const p of resultados) {
    productosCache[p.sku] = p;
    if (p.stock !== undefined) stockCache[p.sku] = { stock: p.stock };
  }

  searchBody.innerHTML = resultados.map(p => {
    // Reusar tarjeta() para mostrar exactamente la misma info que en el grid
    const cardHtml = tarjeta({ sku: p.sku, alias: p.alias });
    // Insertar badge de categoría antes del nombre
    return cardHtml.replace(
      '<span class="card-nombre"',
      `<span class="search-result-cat" style="margin-bottom:4px">${p.categoria || ''}</span><span class="card-nombre"`
    );
  }).join('');

  // Ocultar botón eliminar (no corresponde en el contexto de búsqueda)
  searchBody.querySelectorAll('.btn-delete').forEach(btn => btn.style.display = 'none');

  searchBody.querySelectorAll('.btn-cuotas').forEach(btn => {
    btn.addEventListener('click', () => abrirCuotasModal(btn.dataset.sku));
  });

  searchBody.querySelectorAll('.btn-simular').forEach(btn => {
    btn.addEventListener('click', () => { cerrarBusqueda(); simularDesdeProducto(btn.dataset.sku); });
  });

  // Botón cambiar funciona igual que en el grid
  searchBody.querySelectorAll('.btn-cambiar').forEach(btn => {
    btn.addEventListener('click', () => toggleTodo(btn.dataset.sku));
  });

  // Click en cualquier parte de la card (excepto botones/links) → ir a categoría
  searchBody.querySelectorAll('.card').forEach((el, i) => {
    const cat = resultados[i]?.categoria;
    el.style.cursor = 'pointer';
    el.addEventListener('click', e => {
      if (e.target.closest('.btn-cambiar') || e.target.closest('.card-link') || e.target.closest('.btn-cuotas') || e.target.closest('.btn-simular')) return;
      cerrarBusqueda();
      abrirCategoria(cat);
    });
  });
}

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

// ══════════════════════════════════════════
// CALCULADORA DE CUOTAS
// ══════════════════════════════════════════

// Cuotas sin interés estándar en Falabella Chile por banco/tarjeta.
// CMR se toma del dato scrapeado del producto (el más preciso).
// Las de otros bancos corresponden a la oferta base habitual y pueden
// variar según promociones vigentes — verificar en www.falabella.com.
// cuotas = cuotas sin interés estándar en Falabella (CMR viene del producto)
// cae    = CAE referencial del banco (% anual) — puede variar; editable en el modal
const BANCOS_CUOTAS = [
  { banco: 'Banco de Chile',  variante: 'Visa / Mastercard',        cuotas: 3,  cae: 29 },
  { banco: 'BCI',             variante: 'Crédito',                  cuotas: 6,  cae: 27 },
  { banco: 'Santander',       variante: 'Mastercard / Visa',        cuotas: 3,  cae: 32 },
  { banco: 'Banco Estado',    variante: 'Mastercard / CuentaRUT',   cuotas: 3,  cae: 24 },
  { banco: 'Scotiabank',      variante: 'Visa / Mastercard',        cuotas: 3,  cae: 31 },
  { banco: 'Itaú',            variante: 'Crédito',                  cuotas: 3,  cae: 30 },
  { banco: 'BICE',            variante: 'Visa',                     cuotas: 3,  cae: 26 },
  { banco: 'Security',        variante: 'Mastercard',               cuotas: 3,  cae: 28 },
  { banco: 'Coopeuch',        variante: 'Visa Crédito',             cuotas: 3,  cae: 22 },
];

// Fórmula de cuota con interés (amortización francesa)
function calcCuotaConInteres(precio, n, caeAnual) {
  if (caeAnual === 0) return { cuota: Math.ceil(precio / n), total: precio, interes: 0 };
  const r = Math.pow(1 + caeAnual / 100, 1 / 12) - 1;
  const cuota = Math.ceil(precio * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
  const total = cuota * n;
  return { cuota, total, interes: total - precio };
}

const cuotasOverlay = document.getElementById('cuotasOverlay');
const cuotasBody    = document.getElementById('cuotasBody');
const cuotasClose   = document.getElementById('cuotasClose');

let cuotasSkuActual = null;
let cuotasPrecioActual = 0;

function abrirCuotasModal(sku) {
  cuotasSkuActual = sku;
  const prod = productosCache[sku];
  if (!prod || prod.error) return;

  // Determinar precios disponibles
  const precios = [];
  if (prod.precioCMR)    precios.push({ label: 'CMR',    valor: prod.precioCMR,    tipo: 'cmr'    });
  if (prod.precioOferta) precios.push({ label: 'Oferta', valor: prod.precioOferta, tipo: 'oferta' });
  if (prod.precio)       precios.push({ label: 'Normal', valor: prod.precio,       tipo: 'normal' });
  if (!precios.length)   return;

  cuotasPrecioActual = precios[0].valor;
  renderCuotasBody(prod, precios, precios[0]);
  cuotasOverlay.classList.add('open');
}

// precioObj = { label, valor, tipo: 'cmr'|'oferta'|'normal' }
// modo: 'sin' | 'con'
function renderCuotasBody(prod, precios, precioObj, bancoSeleccionado = null, modo = 'sin') {
  const fmt   = n => `$${Number(Math.round(n)).toLocaleString('es-CL')}`;
  const fmtSI = (total, n) => fmt(Math.ceil(total / n));
  const precioBase = precioObj.valor;
  const esCMR      = precioObj.tipo === 'cmr';

  // Tabs de precio
  const tabsHTML = precios.map(p =>
    `<button class="cuotas-precio-tab${p.valor === precioBase ? ' active' : ''}" data-tipo="${p.tipo}" data-valor="${p.valor}">
      ${p.label}: ${fmt(p.valor)}
    </button>`
  ).join('');

  const cmrCuotas = prod.cuotasSinInteres;
  const bancoCMR  = { banco: 'CMR Falabella', variante: 'Tarjeta CMR', cuotas: cmrCuotas || 1, cae: 32, esCmr: true };
  const bancosOtros = BANCOS_CUOTAS.map(b => ({ ...b, esCmr: false }));

  // ── PRECIO CMR → solo muestra CMR ──
  if (esCMR) {
    const cuotas = cmrCuotas || '—';
    const cuotaHTML = cmrCuotas
      ? `<div class="cuotas-resultado-cifra">${fmtSI(precioBase, cmrCuotas)}<span class="cuotas-resultado-mes">/mes</span></div>
         <div class="cuotas-resultado-detalle">${cmrCuotas} cuotas sin interés · total ${fmt(precioBase)}</div>`
      : `<div class="cuotas-resultado-cifra" style="font-size:1.2rem;color:var(--texto-suave)">Sin info de cuotas CMR</div>`;

    cuotasBody.innerHTML = `
      <div class="cuotas-producto">
        <p class="cuotas-producto-nombre">${prod.nombre}</p>
        <div class="cuotas-precio-tabs">${tabsHTML}</div>
      </div>
      <div class="cuotas-resultado">
        <div class="cuotas-resultado-banco">CMR Falabella <span class="cuotas-resultado-variante">Tarjeta CMR</span></div>
        ${cuotaHTML}
      </div>
      <p class="cuotas-aviso" style="margin-top:8px">
        ✅ Este precio es exclusivo de la tarjeta CMR Falabella.
        ${cmrCuotas ? `Dato de cuotas sin interés obtenido directamente de falabella.com.` : 'Consultar cuotas en caja.'}
      </p>`;

    cuotasBody.querySelectorAll('.cuotas-precio-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const p = precios.find(x => x.tipo === tab.dataset.tipo);
        if (p) renderCuotasBody(prod, precios, p, null, 'sin');
      });
    });
    return;
  }

  // ── PRECIO OFERTA / NORMAL → todos los otros bancos ──
  if (!bancoSeleccionado) bancoSeleccionado = bancosOtros[0];

  const toggleHTML = `
    <div class="cuotas-modo-toggle">
      <button class="cuotas-modo-btn${modo === 'sin' ? ' active' : ''}" data-modo="sin">Sin interés</button>
      <button class="cuotas-modo-btn${modo === 'con' ? ' active' : ''}" data-modo="con">Con interés</button>
    </div>`;

  let contenidoHTML = '';

  if (modo === 'sin') {
    const resultadoHTML = `
      <div class="cuotas-resultado">
        <div class="cuotas-resultado-banco">${bancoSeleccionado.banco} <span class="cuotas-resultado-variante">${bancoSeleccionado.variante}</span></div>
        <div class="cuotas-resultado-cifra">${fmtSI(precioBase, bancoSeleccionado.cuotas)}<span class="cuotas-resultado-mes">/mes</span></div>
        <div class="cuotas-resultado-detalle">${bancoSeleccionado.cuotas} cuotas sin interés · total ${fmt(precioBase)}</div>
      </div>`;

    const filasHTML = bancosOtros.map(b => {
      const sel = b.banco === bancoSeleccionado.banco;
      return `
        <tr class="cuotas-fila${sel ? ' selected' : ''}" data-banco="${b.banco}" style="cursor:pointer">
          <td><span class="cuotas-banco-nombre">${b.banco}</span><span class="cuotas-banco-variante">${b.variante}</span></td>
          <td><span class="cuotas-badge">${b.cuotas} cuotas</span></td>
          <td><span class="cuotas-monto">${fmtSI(precioBase, b.cuotas)}</span><span class="cuotas-monto-sub">/mes</span></td>
        </tr>`;
    }).join('');

    contenidoHTML = `
      ${resultadoHTML}
      <div class="cuotas-tabla-wrap">
        <p class="cuotas-tabla-titulo">Seleccioná banco / tarjeta</p>
        <table class="cuotas-tabla">
          <thead><tr><th>Banco / Tarjeta</th><th>Cuotas CSI</th><th>Monto/mes</th></tr></thead>
          <tbody>${filasHTML}</tbody>
        </table>
      </div>
      <p class="cuotas-aviso">✅ Sin interés: el cliente paga exactamente el precio indicado. Cuotas base habituales — verificar promociones vigentes en caja.</p>`;

  } else {
    const calcResult = calcCuotaConInteres(precioBase, bancoSeleccionado.cuotas, bancoSeleccionado.cae);
    const opcionesBanco = bancosOtros.map(b =>
      `<option value="${b.banco}"${b.banco === bancoSeleccionado.banco ? ' selected' : ''}>${b.banco}</option>`
    ).join('');
    const opcionesCuotas = [2,3,6,9,12,18,24,36,48].map(n =>
      `<option value="${n}"${n === bancoSeleccionado.cuotas ? ' selected' : ''}>${n} cuotas</option>`
    ).join('');

    contenidoHTML = `
      <div class="cuotas-resultado">
        <div class="cuotas-resultado-banco">${bancoSeleccionado.banco} <span class="cuotas-resultado-variante">${bancoSeleccionado.variante}</span></div>
        <div class="cuotas-resultado-cifra">${fmt(calcResult.cuota)}<span class="cuotas-resultado-mes">/mes</span></div>
        <div class="cuotas-resultado-detalle">${bancoSeleccionado.cuotas} cuotas · total ${fmt(calcResult.total)} <span class="cuotas-interes-badge">+${fmt(calcResult.interes)} intereses</span></div>
      </div>
      <div class="cuotas-tabla-wrap">
        <p class="cuotas-tabla-titulo">Configurar cálculo</p>
        <div class="cuotas-con-form">
          <div class="cuotas-con-row"><label class="cuotas-con-label">Banco / Tarjeta</label><select class="cuotas-calc-select" id="cuotasConBanco">${opcionesBanco}</select></div>
          <div class="cuotas-con-row"><label class="cuotas-con-label">Cuotas</label><select class="cuotas-calc-select" id="cuotasConN">${opcionesCuotas}</select></div>
          <div class="cuotas-con-row"><label class="cuotas-con-label">CAE anual %</label><input class="cuotas-calc-select" id="cuotasConCae" type="number" min="0" max="200" step="0.5" value="${bancoSeleccionado.cae}" style="width:90px" /></div>
        </div>
        <table class="cuotas-tabla" style="margin-top:10px">
          <thead><tr><th>Detalle</th><th style="text-align:right">Valor</th></tr></thead>
          <tbody>
            <tr id="cuotasConTrCuota"><td>Cuota mensual</td><td style="text-align:right"><span class="cuotas-monto">${fmt(calcResult.cuota)}</span></td></tr>
            <tr id="cuotasConTrTotal"><td>Total a pagar</td><td style="text-align:right"><span class="cuotas-monto">${fmt(calcResult.total)}</span></td></tr>
            <tr id="cuotasConTrInteres"><td>Total intereses</td><td style="text-align:right"><span class="cuotas-monto" style="color:var(--rojo)">${fmt(calcResult.interes)}</span></td></tr>
            <tr id="cuotasConTrCae"><td>CAE aplicado</td><td style="text-align:right"><span class="cuotas-banco-variante">${bancoSeleccionado.cae}% anual</span></td></tr>
          </tbody>
        </table>
      </div>
      <p class="cuotas-aviso">⚠️ CAE referencial — verificar tasa exacta con el banco. Cálculo usa amortización francesa (cuota constante).</p>`;
  }

  cuotasBody.innerHTML = `
    <div class="cuotas-producto">
      <p class="cuotas-producto-nombre">${prod.nombre}</p>
      <div class="cuotas-precio-tabs">${tabsHTML}</div>
    </div>
    ${toggleHTML}
    ${contenidoHTML}`;

  // Tabs de precio
  cuotasBody.querySelectorAll('.cuotas-precio-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const p = precios.find(x => x.tipo === tab.dataset.tipo);
      if (p) renderCuotasBody(prod, precios, p, bancoSeleccionado, modo);
    });
  });

  // Toggle sin/con
  cuotasBody.querySelectorAll('.cuotas-modo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      renderCuotasBody(prod, precios, precioObj, bancoSeleccionado, btn.dataset.modo);
    });
  });

  if (modo === 'sin') {
    cuotasBody.querySelectorAll('.cuotas-fila').forEach(fila => {
      fila.addEventListener('click', () => {
        const banco = bancosOtros.find(b => b.banco === fila.dataset.banco);
        if (banco) renderCuotasBody(prod, precios, precioObj, banco, 'sin');
      });
    });
  } else {
    const actualizarConInteres = () => {
      const bancoBuscado = document.getElementById('cuotasConBanco').value;
      const nCuotas  = parseInt(document.getElementById('cuotasConN').value);
      const caeInput = parseFloat(document.getElementById('cuotasConCae').value) || 0;
      const bancoObj = bancosOtros.find(b => b.banco === bancoBuscado) || bancoSeleccionado;
      const r = calcCuotaConInteres(precioBase, nCuotas, caeInput);
      document.getElementById('cuotasConTrCuota').querySelector('.cuotas-monto').textContent  = fmt(r.cuota);
      document.getElementById('cuotasConTrTotal').querySelector('.cuotas-monto').textContent   = fmt(r.total);
      document.getElementById('cuotasConTrInteres').querySelector('.cuotas-monto').textContent = fmt(r.interes);
      document.getElementById('cuotasConTrCae').querySelector('.cuotas-banco-variante').textContent = caeInput + '% anual';
      cuotasBody.querySelector('.cuotas-resultado-banco').innerHTML =
        `${bancoObj.banco} <span class="cuotas-resultado-variante">${bancoObj.variante}</span>`;
      cuotasBody.querySelector('.cuotas-resultado-cifra').innerHTML =
        `${fmt(r.cuota)}<span class="cuotas-resultado-mes">/mes</span>`;
      cuotasBody.querySelector('.cuotas-resultado-detalle').innerHTML =
        `${nCuotas} cuotas · total ${fmt(r.total)} <span class="cuotas-interes-badge">+${fmt(r.interes)} intereses</span>`;
    };
    document.getElementById('cuotasConBanco').addEventListener('change', () => {
      const bancoObj = bancosOtros.find(b => b.banco === document.getElementById('cuotasConBanco').value);
      if (bancoObj) document.getElementById('cuotasConCae').value = bancoObj.cae;
      actualizarConInteres();
    });
    document.getElementById('cuotasConN').addEventListener('change', actualizarConInteres);
    document.getElementById('cuotasConCae').addEventListener('input', actualizarConInteres);
  }
}

cuotasClose.addEventListener('click', () => cuotasOverlay.classList.remove('open'));
cuotasOverlay.addEventListener('click', e => {
  if (e.target === cuotasOverlay) cuotasOverlay.classList.remove('open');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') cuotasOverlay.classList.remove('open');
});


// ══════════════════════════════════════════
// ESTADO DEL REFRESH AUTOMÁTICO (portada)
// ══════════════════════════════════════════

const estadoRefreshEl = document.getElementById('estadoRefresh');
let estadoRefreshTimer = null;

async function cargarEstadoRefresh() {
  if (!estadoRefreshEl) return;
  clearTimeout(estadoRefreshTimer);
  let e;
  try {
    const r = await fetch('/api/estado');
    if (!r.ok) throw new Error();
    e = await r.json();
  } catch {
    estadoRefreshTimer = setTimeout(cargarEstadoRefresh, 60000);
    return;
  }
  renderEstadoRefresh(e);
  // Mientras hay algo corriendo se consulta seguido para mostrar el avance.
  const corriendo = e.enCurso || e.totalEnCola;
  estadoRefreshTimer = setTimeout(cargarEstadoRefresh, corriendo ? 5000 : 60000);
}

function renderEstadoRefresh(e) {
  const hora = h => `${String(h).padStart(2, '0')}:00`;
  let clase = '', texto = '', boton = '';

  if (e.enCurso || e.totalEnCola) {
    const c = e.enCurso;
    clase = 'estado-corriendo';
    texto = c
      ? `⏳ Actualizando ${c.tipo === 'categoria' ? esc(c.detalle) : 'todos los productos'}: ${c.hechos} de ${c.total}…`
      : '⏳ Actualización completa en cola…';
  } else {
    const u = e.ultimoCompleto;
    if (!u) {
      texto = e.auto
        ? '🤖 Actualización automática activa. Todavía no corre la primera.'
        : 'ℹ️ La actualización automática está desactivada en el servidor.';
    } else {
      const cuando = formatRelativo(new Date(u.terminadoEn || u.iniciadoEn));
      if (u.estado === 'bloqueado') {
        clase = 'estado-alerta';
        const quien = u.origen === 'remoto' ? 'al teléfono' : 'al servidor';
        texto = `⚠️ ${cuando} Falabella bloqueó ${quien}${u.ok ? ` (alcanzó a leer ${u.ok} de ${u.total})` : ''}. Los precios mostrados son los últimos guardados.`
          + (e.proxy || e.remoto?.activo || u.origen === 'remoto' ? '' : ' Hace falta un proxy (PROXY_URL) o dejar corriendo el worker del teléfono.');
      } else if (u.estado === 'interrumpido' || u.estado === 'error') {
        clase = 'estado-alerta';
        texto = `⚠️ La última actualización (${cuando}) quedó a medias: ${u.ok} de ${u.total} productos.`;
      } else {
        clase = 'estado-ok';
        texto = `✅ Precios y stock actualizados ${cuando}: ${u.ok} de ${u.total} productos`
          + (u.cambios ? ` · ${u.cambios} con cambio de precio` : '') + '.';
      }
    }
    if (e.proximo) texto += ` Próxima automática: ${e.proximo.dia} ${hora(e.proximo.hora)}.`;
    // Quién está a cargo de leer Falabella.
    if (e.remoto?.activo) texto += ' 📱 Teléfono conectado.';
    else if (e.remoto?.ultimoLatido) texto += ` 📵 Teléfono desconectado (${formatRelativo(new Date(e.remoto.ultimoLatido))}).`;
    if (e.auto) boton = '<button class="btn-secondary estado-btn" id="btnRefreshTotal">↻ Actualizar todo ahora</button>';
  }

  estadoRefreshEl.className = `estado-refresh ${clase}`;
  estadoRefreshEl.innerHTML = `<span>${texto}</span>${boton}`;
  estadoRefreshEl.style.display = 'flex';

  const btn = document.getElementById('btnRefreshTotal');
  if (btn) btn.addEventListener('click', async () => {
    if (!confirm('¿Actualizar ahora los precios y el stock de todos los productos? Puede tardar varios minutos.')) return;
    btn.disabled = true;
    try {
      const r = await fetch('/api/refresh-total', { method: 'POST' });
      if (!r.ok) alert((await r.json()).error || 'No se pudo iniciar');
    } catch { alert('Error de red'); }
    cargarEstadoRefresh();
  });
}

// ══════════════════════════════════════════
// CUPONES DE DESCUENTO
// ══════════════════════════════════════════

const btnCupones      = document.getElementById('btnCupones');
const cuponesOverlay  = document.getElementById('cuponesOverlay');
const cuponesLista    = document.getElementById('cuponesLista');
const formCupon       = document.getElementById('formCupon');

// Mismo resguardo que la búsqueda: si el HTML cacheado es viejo, no inicializar.
if (btnCupones && cuponesOverlay && cuponesLista && formCupon) {
  const $ = id => document.getElementById(id);
  const msgCupon = $('msgCupon');

  $('cuponAlcanceCategoria').innerHTML = CATEGORIAS.map(c => `<option value="${c.nombre}">${c.icono} ${c.nombre}</option>`).join('');

  function actualizarCamposCupon() {
    const alcance = $('cuponAlcance').value;
    $('cuponAlcanceValorLabel').style.display = alcance === 'todos' ? 'none' : '';
    $('cuponAlcanceCategoria').style.display  = alcance === 'categoria' ? '' : 'none';
    $('cuponAlcanceTexto').style.display      = alcance === 'marca' || alcance === 'sku' ? '' : 'none';
    $('cuponAlcanceValorTitulo').textContent  = { categoria: 'Categoría', marca: 'Marca', sku: 'SKUs (separados por coma)' }[alcance] || '';
    $('cuponAlcanceTexto').placeholder        = alcance === 'marca' ? 'Ej: Samsung' : 'Ej: 17461845, 16957308';
    $('cuponTopeLabel').style.visibility      = $('cuponTipo').value === 'porcentaje' ? '' : 'hidden';
    $('cuponValor').placeholder               = $('cuponTipo').value === 'porcentaje' ? '10' : '20.000';
  }
  $('cuponAlcance').addEventListener('change', actualizarCamposCupon);
  $('cuponTipo').addEventListener('change', actualizarCamposCupon);

  function descripcionCupon(c) {
    const partes = [c.tipo === 'porcentaje' ? `${c.valor}% de descuento` : `${fmtPesos(c.valor)} de descuento`];
    if (c.tope)    partes.push(`tope ${fmtPesos(c.tope)}`);
    if (c.minimo)  partes.push(`compra mínima ${fmtPesos(c.minimo)}`);
    if (c.soloCMR) partes.push('solo con CMR');
    const alcance = { todos: 'Todos los productos', categoria: `Categoría ${c.alcanceValor}`, marca: `Marca ${c.alcanceValor}`, sku: `SKU ${c.alcanceValor}` }[c.alcance];
    let vence = '';
    if (c.vence) {
      const [a, m, d] = c.vence.split('-');
      vence = c.vencido ? ` · venció el ${d}/${m}/${a}` : ` · vence el ${d}/${m}/${a}`;
    }
    return `${esc(partes.join(' · '))}<br><span class="cupon-item-alcance">${esc(alcance)}${vence}</span>`;
  }

  // Resultado de la última búsqueda automática en la página de cupones.
  function textoBusqueda(b) {
    if (!b) return 'Los cupones de la página de cupones de Falabella se buscan solos en cada actualización completa de precios. Todavía no se ha hecho ninguna búsqueda.';
    const cuando = formatRelativo(new Date(b.en));
    if (!b.ok) return `⚠️ Última búsqueda automática (${cuando}): no se pudo leer la página de cupones de Falabella.`;
    if (!b.aplicados) return `🤖 Última búsqueda automática (${cuando}): no se encontraron cupones para las marcas de tu catálogo.`;
    return `🤖 Última búsqueda automática (${cuando}): ${b.aplicados} cupón(es) aplicados por marca.`;
  }

  const FUENTES = {
    pagina: '🤖 Página de cupones',
    ficha:  '🏷️ Ficha del producto',
    manual: '✍️ Agregado a mano',
  };

  function alcanceCupon(c, conteo) {
    const n = cant => (cant ? ` · ${cant} producto${cant === 1 ? '' : 's'}` : '');
    if (c.fuente === 'ficha') {
      const nombres = c.ejemplos.map(p => p.nombre || p.sku).join(', ');
      const resto = c.productos - c.ejemplos.length;
      return `${c.productos} producto${c.productos === 1 ? '' : 's'}: ${nombres}${resto > 0 ? ` y ${resto} más` : ''}`;
    }
    switch (c.alcance) {
      case 'todos':     return `Todos los productos${n(conteo?.total)}`;
      case 'marca':     return `Marca ${c.alcanceValor}${n(conteo?.porMarca?.[String(c.alcanceValor).toUpperCase()])}`;
      case 'categoria': return `Categoría ${c.alcanceValor}${n(conteo?.porCategoria?.[c.alcanceValor])}`;
      case 'sku':       return `SKU ${c.alcanceValor}`;
      default:          return '';
    }
  }

  function itemCupon(c, conteo) {
    const descuento = c.tipo
      ? descripcionCupon(c).split('<br>')[0]
      : esc(c.texto || 'Cupón disponible, sin monto informado');
    let vence = '';
    if (c.vence) {
      const [a, m, d] = c.vence.split('-');
      vence = ` · vence el ${d}/${m}/${a}`;
    }
    return `
      <li class="cupon-item">
        <div class="cupon-item-cuerpo">
          <div class="cupon-item-fila">
            <span class="cupon-item-codigo">${c.codigo ? esc(c.codigo) : 'Sin código'}</span>
            <span class="cupon-item-fuente cupon-fuente-${c.fuente}">${FUENTES[c.fuente]}</span>
          </div>
          <div class="cupon-item-desc">${descuento}</div>
          <div class="cupon-item-alcance">${esc(alcanceCupon(c, conteo))}${vence}</div>
          ${c.fuente === 'pagina' && c.texto ? `<div class="cupon-item-texto">“${esc(c.texto.slice(0, 160))}”</div>` : ''}
        </div>
        ${c.fuente === 'manual' ? `<button class="todo-clear cupon-item-borrar" data-id="${c.id}" title="Eliminar cupón">Eliminar</button>` : ''}
      </li>`;
  }

  async function cargarCupones() {
    let datos;
    try {
      const r = await fetch('/api/cupones');
      datos = await r.json();
    } catch {
      cuponesLista.innerHTML = '<li class="cupones-vacio">Error al cargar los cupones</li>';
      return;
    }
    // Compatibilidad: versiones anteriores del servidor devolvían solo la lista.
    const tabla  = Array.isArray(datos) ? datos : (datos?.cupones || []);
    const fichas = Array.isArray(datos) ? [] : (datos?.enFichas || []);
    const conteo = Array.isArray(datos) ? null : datos?.conteo;

    const todos = [
      ...tabla.map(c => ({ ...c, fuente: c.origen === 'automatico' ? 'pagina' : 'manual' })),
      ...fichas.map(c => ({ ...c, fuente: 'ficha' })),
    ].sort((x, y) => (y.tipo ? 1 : 0) - (x.tipo ? 1 : 0)); // primero los que traen descuento

    const estadoBusqueda = Array.isArray(datos) ? '' : `<li class="cupones-busqueda">${esc(textoBusqueda(datos?.busqueda))}</li>`;
    const titulo = `<li class="cupones-titulo">Cupones vigentes (${todos.length})</li>`;
    cuponesLista.innerHTML = titulo + estadoBusqueda + (todos.length
      ? todos.map(c => itemCupon(c, conteo)).join('')
      : '<li class="cupones-vacio">No hay cupones vigentes por ahora.</li>');

    cuponesLista.querySelectorAll('.cupon-item-borrar').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este cupón?')) return;
        await fetch(`/api/cupones/${btn.dataset.id}`, { method: 'DELETE' });
        await cargarCupones();
        refrescarPreciosConCupon();
      });
    });
  }

  // Los precios finales los calcula el servidor: tras cambiar un cupón hay
  // que volver a pedir lo que está en pantalla.
  function refrescarPreciosConCupon() {
    if (categoriaActiva) recargarCategoria(categoriaActiva);
  }

  formCupon.addEventListener('submit', async e => {
    e.preventDefault();
    const alcance = $('cuponAlcance').value;
    const body = {
      codigo: $('cuponCodigo').value,
      tipo: $('cuponTipo').value,
      valor: $('cuponValor').value,
      tope: $('cuponTope').value,
      minimo: $('cuponMinimo').value,
      soloCMR: $('cuponSoloCMR').checked,
      alcance,
      alcanceValor: alcance === 'categoria' ? $('cuponAlcanceCategoria').value : $('cuponAlcanceTexto').value,
      vence: $('cuponVence').value || null,
    };
    msgCupon.className = 'msg';
    msgCupon.textContent = 'Guardando…';
    try {
      const r = await fetch('/api/cupones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo guardar');
    } catch (err) {
      msgCupon.className = 'msg err';
      msgCupon.textContent = err.message;
      return;
    }
    msgCupon.className = 'msg ok';
    msgCupon.textContent = 'Cupón guardado ✓';
    setTimeout(() => { msgCupon.textContent = ''; }, 3000);
    formCupon.reset();
    actualizarCamposCupon();
    await cargarCupones();
    refrescarPreciosConCupon();
  });

  const cerrarCupones = () => cuponesOverlay.classList.remove('open');
  btnCupones.addEventListener('click', () => {
    actualizarCamposCupon();
    cuponesLista.innerHTML = '<li class="cupones-vacio">Cargando…</li>';
    cuponesOverlay.classList.add('open');
    cargarCupones();
  });
  $('cuponesClose').addEventListener('click', cerrarCupones);
  cuponesOverlay.addEventListener('click', e => { if (e.target === cuponesOverlay) cerrarCupones(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarCupones(); });
}


// ══════════════════════════════════════════
// PLANES CONNECT (portabilidad / línea nueva)
// ══════════════════════════════════════════

const TIPO_PLAN = { portabilidad: 'Portabilidad', linea_nueva: 'Línea nueva', ambos: 'Portabilidad o línea nueva' };
const COMPANIAS_CONNECT = ['Entel', 'Movistar', 'WOM', 'Claro'];

// Bloque de la tarjeta para un equipo vendido con plan.
function bloquePlan(prod, sku) {
  const p = prod.plan;
  if (!p || !p.compania) return '';
  const equipo = prod.precioOferta || prod.precio;
  const precios = [];
  if (equipo) precios.push(`Equipo ${fmtPesos(equipo)}`);
  if (p.mensual) precios.push(`plan ${fmtPesos(p.mensual)}/mes`);
  const detalle = [p.nombre, p.gigas && !String(p.nombre || '').includes(String(p.gigas)) ? `${p.gigas} GB` : null].filter(Boolean).join(' · ');
  return `
    <div class="card-plan">
      <div class="card-plan-titulo">📶 Connect ${esc(p.compania)}${p.tipo ? ` · ${TIPO_PLAN[p.tipo]}` : ''}</div>
      ${detalle ? `<div class="card-plan-nombre">${esc(detalle)}</div>` : ''}
      ${precios.length ? `<div class="card-plan-precio">${precios.join(' + ')}</div>` : ''}
      <button class="btn-simular" data-sku="${esc(sku)}">🧮 Simular</button>
    </div>`;
}

const connectOverlay = document.getElementById('connectOverlay');
const connectBody    = document.getElementById('connectBody');
const connectTabs    = document.getElementById('connectTabs');
const btnConnect     = document.getElementById('btnConnect');

let connectDatos = null;          // { manuales, detectados }
let connectTab   = 'planes';
let simEstado    = { equipo: '', sku: '', precio: '', planKey: '', mensual: '', compania: '', plan: '', meses: '12', cuotas: '1' };
let ventaPrefill = null;
let ventasMes    = null;

function leerVendedor() { try { return localStorage.getItem('connect-vendedor') || ''; } catch { return ''; } }
function guardarVendedor(v) { try { localStorage.setItem('connect-vendedor', v || ''); } catch { /* sin almacenamiento */ } }

// Todos los planes (detectados + manuales) en una sola lista para los selects.
function todosLosPlanes() {
  if (!connectDatos) return [];
  const det = connectDatos.detectados.map((p, i) => ({ ...p, key: `d${i}`, fuente: 'ficha' }));
  const man = connectDatos.manuales.map(p => ({ ...p, key: `m${p.id}`, fuente: 'manual' }));
  return [...det, ...man].filter(p => p.mensual);
}

function etiquetaPlan(p) {
  return [p.compania, p.nombre, p.mensual ? `${fmtPesos(p.mensual)}/mes` : null, p.tipo ? TIPO_PLAN[p.tipo] : null].filter(Boolean).join(' · ');
}

async function cargarPlanesConnect() {
  try {
    const r = await fetch('/api/connect/planes');
    connectDatos = await r.json();
  } catch {
    connectDatos = { manuales: [], detectados: [] };
  }
}

function abrirConnect(tab = 'planes') {
  if (!connectOverlay) return;
  connectTab = tab;
  connectOverlay.classList.add('open');
  renderConnect();
  cargarPlanesConnect().then(renderConnect);
}

function renderConnect() {
  connectTabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === connectTab));
  if (connectTab === 'planes') renderPlanesConnect();
  else if (connectTab === 'simulador') renderSimulador();
  else renderVentas();
}

// ── Pestaña Planes ──
function renderPlanesConnect() {
  if (!connectDatos) { connectBody.innerHTML = '<p class="cupones-vacio">Cargando…</p>'; return; }
  const det = connectDatos.detectados;
  const man = connectDatos.manuales;
  const item = (p, fuente, extra) => `
    <li class="cupon-item">
      <div class="cupon-item-cuerpo">
        <div class="cupon-item-fila">
          <span class="cupon-item-codigo">${esc(p.compania)}</span>
          <span class="cupon-item-fuente cupon-fuente-${fuente === 'ficha' ? 'ficha' : 'manual'}">${fuente === 'ficha' ? '🏷️ Ficha del equipo' : '✍️ Agregado a mano'}</span>
        </div>
        <div class="cupon-item-desc">${esc([p.nombre, p.mensual ? `${fmtPesos(p.mensual)}/mes` : 'Valor mensual no informado', p.gigas ? `${p.gigas} GB` : null, p.minutos].filter(Boolean).join(' · '))}</div>
        <div class="cupon-item-alcance">${esc(p.tipo ? TIPO_PLAN[p.tipo] : 'Tipo no informado')}${extra ? ` · ${esc(extra)}` : ''}</div>
      </div>
      <div class="connect-item-acciones">
        ${p.mensual ? `<button class="btn-secondary connect-btn-chico" data-simular="${p.key}">🧮 Simular</button>` : ''}
        ${fuente === 'manual' ? `<button class="todo-clear" data-borrar-plan="${p.id}">Eliminar</button>` : ''}
      </div>
    </li>`;

  const planes = todosLosPlanes();
  const porKey = Object.fromEntries(planes.map(p => [p.key, p]));
  const detItems = det.map((p, i) => {
    const nombres = p.equipos.slice(0, 2).map(e => e.nombre).join(', ');
    const resto = p.equipos.length - 2;
    return item({ ...p, key: `d${i}` }, 'ficha', `${p.equipos.length} equipo${p.equipos.length === 1 ? '' : 's'}: ${nombres}${resto > 0 ? ` y ${resto} más` : ''}`);
  });
  const manItems = man.map(p => item({ ...p, key: `m${p.id}` }, 'manual', p.notas));

  connectBody.innerHTML = `
    <p class="cupones-ayuda">Los planes se leen solos de la ficha de cada equipo Connect en cada actualización de precios. Si falta alguno, agregalo abajo.</p>
    <ul class="cupones-lista">
      <li class="cupones-titulo">Planes (${det.length + man.length})</li>
      ${det.length + man.length ? detItems.join('') + manItems.join('') : '<li class="cupones-vacio">Todavía no hay planes. Aparecen solos cuando se actualizan los precios de los equipos Connect, o podés agregarlos a mano.</li>'}
    </ul>
    <form id="formPlan" class="cupon-form" autocomplete="off">
      <h3>Agregar plan</h3>
      <div class="cupon-form-fila">
        <label>Compañía
          <select id="planCompania">${COMPANIAS_CONNECT.map(c => `<option>${c}</option>`).join('')}</select>
        </label>
        <label>Valor mensual
          <input type="text" id="planMensual" inputmode="numeric" placeholder="$ 24.990" required />
        </label>
      </div>
      <div class="cupon-form-fila">
        <label>Nombre (opcional)
          <input type="text" id="planNombre" placeholder="Plan Libre 300GB" maxlength="60" />
        </label>
        <label>Tipo
          <select id="planTipo">
            <option value="ambos">Portabilidad o línea nueva</option>
            <option value="portabilidad">Solo portabilidad</option>
            <option value="linea_nueva">Solo línea nueva</option>
          </select>
        </label>
      </div>
      <div class="cupon-form-fila">
        <label>Gigas (opcional)
          <input type="text" id="planGigas" inputmode="numeric" placeholder="300" />
        </label>
        <label>Minutos (opcional)
          <input type="text" id="planMinutos" placeholder="Ilimitados" maxlength="40" />
        </label>
      </div>
      <button type="submit" class="btn-primary">Guardar plan</button>
      <p id="msgPlan" class="msg"></p>
    </form>`;

  connectBody.querySelectorAll('[data-simular]').forEach(btn => btn.addEventListener('click', () => {
    const p = porKey[btn.dataset.simular];
    if (!p) return;
    const equipo = p.equipos?.[0];
    simEstado = {
      ...simEstado, planKey: p.key, mensual: String(p.mensual || ''), compania: p.compania, plan: p.nombre || '',
      ...(equipo ? { equipo: equipo.nombre, sku: equipo.sku, precio: String(equipo.precio || '') } : {}),
    };
    connectTab = 'simulador';
    renderConnect();
  }));
  connectBody.querySelectorAll('[data-borrar-plan]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('¿Eliminar este plan?')) return;
    await fetch(`/api/connect/planes/${btn.dataset.borrarPlan}`, { method: 'DELETE' });
    await cargarPlanesConnect();
    renderConnect();
  }));
  document.getElementById('formPlan').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = document.getElementById('msgPlan');
    const body = {
      compania: document.getElementById('planCompania').value,
      mensual: document.getElementById('planMensual').value,
      nombre: document.getElementById('planNombre').value,
      tipo: document.getElementById('planTipo').value,
      gigas: document.getElementById('planGigas').value,
      minutos: document.getElementById('planMinutos').value,
    };
    try {
      const r = await fetch('/api/connect/planes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No se pudo guardar');
    } catch (err) {
      msg.className = 'msg err'; msg.textContent = err.message; return;
    }
    await cargarPlanesConnect();
    renderConnect();
  });
}

// ── Pestaña Simulador ──
function renderSimulador() {
  const planes = todosLosPlanes();
  const opciones = planes.map(p => `<option value="${p.key}"${simEstado.planKey === p.key ? ' selected' : ''}>${esc(etiquetaPlan(p))}</option>`).join('');
  connectBody.innerHTML = `
    <p class="cupones-ayuda">Cuánto paga el cliente en total por el equipo más el plan.</p>
    <form id="formSim" class="cupon-form" autocomplete="off">
      <label>Equipo (opcional)
        <input type="text" id="simEquipo" value="${esc(simEstado.equipo)}" placeholder="Samsung Galaxy A17 128GB" />
      </label>
      <div class="cupon-form-fila">
        <label>Precio del equipo
          <input type="text" id="simPrecio" inputmode="numeric" value="${esc(simEstado.precio)}" placeholder="$ 149.990" />
        </label>
        <label>Cuotas del equipo
          <select id="simCuotas">
            ${['1', '3', '6', '12', '24'].map(n => `<option value="${n}"${simEstado.cuotas === n ? ' selected' : ''}>${n === '1' ? 'Al contado' : `${n} cuotas sin interés`}</option>`).join('')}
          </select>
        </label>
      </div>
      <label>Plan
        <select id="simPlan">
          <option value="">Otro valor (escribirlo abajo)</option>
          ${opciones}
        </select>
      </label>
      <div class="cupon-form-fila">
        <label>Valor mensual del plan
          <input type="text" id="simMensual" inputmode="numeric" value="${esc(simEstado.mensual)}" placeholder="$ 24.990" />
        </label>
        <label>Meses a calcular
          <select id="simMeses">
            ${['6', '12', '18', '24'].map(n => `<option value="${n}"${simEstado.meses === n ? ' selected' : ''}>${n} meses</option>`).join('')}
          </select>
        </label>
      </div>
    </form>
    <div class="connect-resultado" id="simResultado"></div>
    <button class="btn-primary connect-btn-ancho" id="simVender">📝 Registrar venta con estos datos</button>`;

  const $ = id => document.getElementById(id);
  const num = v => parseInt(String(v || '').replace(/\D/g, ''), 10) || 0;
  const porKey = Object.fromEntries(planes.map(p => [p.key, p]));

  function calcular() {
    simEstado = {
      ...simEstado,
      equipo: $('simEquipo').value, precio: $('simPrecio').value, mensual: $('simMensual').value,
      meses: $('simMeses').value, cuotas: $('simCuotas').value, planKey: $('simPlan').value,
    };
    const precio = num(simEstado.precio);
    const mensual = num(simEstado.mensual);
    const meses = num(simEstado.meses);
    const cuotas = num(simEstado.cuotas);
    const res = $('simResultado');
    if (!precio && !mensual) { res.innerHTML = '<p class="cupones-vacio">Ingresá el precio del equipo y el valor del plan.</p>'; return; }

    const cuotaEquipo = cuotas > 1 ? Math.ceil(precio / cuotas) : 0;
    const total = precio + mensual * meses;
    const filas = [];
    if (cuotas > 1) {
      filas.push(['Pago mensual', `${fmtPesos(mensual + cuotaEquipo)}`, `plan ${fmtPesos(mensual)} + cuota del equipo ${fmtPesos(cuotaEquipo)} (${cuotas} cuotas)`]);
      if (cuotas < meses) filas.push(['Después de la cuota ' + cuotas, fmtPesos(mensual), 'solo el plan']);
      if (cuotas > meses) filas.push(['Ojo', '', `las cuotas del equipo siguen después del mes ${meses}`]);
    } else {
      filas.push(['Pago hoy', fmtPesos(precio), 'equipo al contado']);
      filas.push(['Pago mensual', fmtPesos(mensual), 'solo el plan']);
    }
    filas.push([`Total en ${meses} meses`, fmtPesos(total), `equipo ${fmtPesos(precio)} + plan ${fmtPesos(mensual)} × ${meses}`]);
    if (meses) filas.push(['Promedio mensual', fmtPesos(Math.round(total / meses)), '']);
    res.innerHTML = filas.map(([t, v, d]) => `
      <div class="connect-fila"><span class="connect-fila-titulo">${esc(t)}</span><span class="connect-fila-valor">${esc(v)}</span></div>
      ${d ? `<div class="connect-fila-detalle">${esc(d)}</div>` : ''}`).join('');
  }

  $('simPlan').addEventListener('change', () => {
    const p = porKey[$('simPlan').value];
    if (p) { $('simMensual').value = p.mensual || ''; simEstado.compania = p.compania; simEstado.plan = p.nombre || ''; }
    calcular();
  });
  ['simEquipo', 'simPrecio', 'simMensual', 'simMeses', 'simCuotas'].forEach(id => $(id).addEventListener('input', calcular));
  $('simVender').addEventListener('click', () => {
    calcular();
    const p = porKey[simEstado.planKey];
    ventaPrefill = {
      compania: p?.compania || simEstado.compania || '',
      plan: p ? (p.nombre || '') : simEstado.plan,
      mensual: simEstado.mensual, equipo: simEstado.equipo, sku: simEstado.sku, precioEquipo: simEstado.precio,
      tipo: p?.tipo === 'linea_nueva' ? 'linea_nueva' : (p?.tipo === 'portabilidad' ? 'portabilidad' : ''),
    };
    connectTab = 'ventas';
    renderConnect();
  });
  calcular();
}

// Abre el simulador con los datos de un producto de la grilla o la búsqueda.
function simularDesdeProducto(sku) {
  const prod = productosCache[sku];
  if (!prod) return;
  const p = prod.plan || {};
  simEstado = {
    ...simEstado,
    equipo: prod.nombre || '', sku, precio: String(prod.precioOferta || prod.precio || ''),
    mensual: String(p.mensual || ''), compania: p.compania || '', plan: p.nombre || '', planKey: '',
  };
  abrirConnect('simulador');
}

// ── Pestaña Ventas ──
async function renderVentas() {
  const pre = ventaPrefill || {};
  const planes = todosLosPlanes();
  const porKey = Object.fromEntries(planes.map(p => [p.key, p]));
  connectBody.innerHTML = `
    <form id="formVenta" class="cupon-form connect-form-venta" autocomplete="off">
      <h3>Registrar venta</h3>
      <div class="connect-tipo" role="radiogroup">
        <label><input type="radio" name="ventaTipo" value="portabilidad"${pre.tipo === 'portabilidad' ? ' checked' : ''} required /> Portabilidad</label>
        <label><input type="radio" name="ventaTipo" value="linea_nueva"${pre.tipo === 'linea_nueva' ? ' checked' : ''} /> Línea nueva</label>
      </div>
      <div class="cupon-form-fila">
        <label>Compañía
          <select id="ventaCompania">${COMPANIAS_CONNECT.map(c => `<option${pre.compania === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
        </label>
        <label>Plan
          <select id="ventaPlanSel">
            <option value="">Escribirlo</option>
            ${planes.map(p => `<option value="${p.key}">${esc(etiquetaPlan(p))}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="cupon-form-fila">
        <label>Nombre del plan
          <input type="text" id="ventaPlan" value="${esc(pre.plan || '')}" maxlength="80" />
        </label>
        <label>Valor mensual
          <input type="text" id="ventaMensual" inputmode="numeric" value="${esc(pre.mensual || '')}" placeholder="$ 24.990" />
        </label>
      </div>
      <div class="cupon-form-fila">
        <label>Equipo (opcional)
          <input type="text" id="ventaEquipo" value="${esc(pre.equipo || '')}" maxlength="120" />
        </label>
        <label>Precio del equipo
          <input type="text" id="ventaPrecio" inputmode="numeric" value="${esc(pre.precioEquipo || '')}" />
        </label>
      </div>
      <div class="cupon-form-fila">
        <label>Cliente (opcional)
          <input type="text" id="ventaCliente" maxlength="80" />
        </label>
        <label>Teléfono (opcional)
          <input type="text" id="ventaTelefono" inputmode="tel" maxlength="20" />
        </label>
      </div>
      <div class="cupon-form-fila">
        <label>Vendedor
          <input type="text" id="ventaVendedor" value="${esc(leerVendedor())}" maxlength="60" />
        </label>
        <label>Notas (opcional)
          <input type="text" id="ventaNotas" maxlength="200" />
        </label>
      </div>
      <input type="hidden" id="ventaSku" value="${esc(pre.sku || '')}" />
      <button type="submit" class="btn-primary">Registrar venta</button>
      <p id="msgVenta" class="msg"></p>
    </form>
    <div class="connect-ventas-cabecera">
      <input type="month" id="ventasMes" value="${esc(ventasMes || '')}" />
      <a class="btn-secondary connect-btn-chico" id="ventasCsv" href="#">⬇️ Exportar</a>
    </div>
    <div id="ventasResumen" class="connect-resumen"></div>
    <ul class="cupones-lista" id="ventasLista"><li class="cupones-vacio">Cargando…</li></ul>`;
  ventaPrefill = null;

  const $ = id => document.getElementById(id);
  $('ventaPlanSel').addEventListener('change', () => {
    const p = porKey[$('ventaPlanSel').value];
    if (!p) return;
    $('ventaCompania').value = p.compania;
    $('ventaPlan').value = p.nombre || '';
    $('ventaMensual').value = p.mensual || '';
  });
  $('formVenta').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('msgVenta');
    const tipo = connectBody.querySelector('input[name="ventaTipo"]:checked')?.value;
    guardarVendedor($('ventaVendedor').value);
    const body = {
      tipo, compania: $('ventaCompania').value, plan: $('ventaPlan').value, mensual: $('ventaMensual').value,
      equipo: $('ventaEquipo').value, sku: $('ventaSku').value, precioEquipo: $('ventaPrecio').value,
      cliente: $('ventaCliente').value, telefono: $('ventaTelefono').value,
      vendedor: $('ventaVendedor').value, notas: $('ventaNotas').value,
    };
    try {
      const r = await fetch('/api/connect/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'No se pudo registrar');
    } catch (err) {
      msg.className = 'msg err'; msg.textContent = err.message; return;
    }
    renderVentas();
  });
  $('ventasMes').addEventListener('change', () => { ventasMes = $('ventasMes').value; cargarVentas(); });
  cargarVentas();
}

async function cargarVentas() {
  const lista = document.getElementById('ventasLista');
  if (!lista) return;
  let d;
  try {
    const r = await fetch(`/api/connect/ventas${ventasMes ? `?mes=${encodeURIComponent(ventasMes)}` : ''}`);
    d = await r.json();
  } catch {
    lista.innerHTML = '<li class="cupones-vacio">Error al cargar las ventas</li>';
    return;
  }
  ventasMes = d.mes;
  document.getElementById('ventasMes').value = d.mes;
  document.getElementById('ventasCsv').href = `/api/connect/ventas.csv?mes=${encodeURIComponent(d.mes)}`;
  const r = d.resumen;
  const chips = [
    `<span class="connect-chip connect-chip-total">${r.total} venta${r.total === 1 ? '' : 's'}</span>`,
    ...Object.entries(r.porTipo).map(([t, n]) => `<span class="connect-chip">${esc(TIPO_PLAN[t] || t)}: ${n}</span>`),
    ...Object.entries(r.porCompania).map(([c, n]) => `<span class="connect-chip">${esc(c)}: ${n}</span>`),
  ];
  document.getElementById('ventasResumen').innerHTML = chips.join('');

  if (!d.ventas.length) { lista.innerHTML = '<li class="cupones-vacio">Sin ventas registradas en este mes.</li>'; return; }
  lista.innerHTML = d.ventas.map(v => {
    const f = new Date(v.fecha);
    const fecha = `${f.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })} ${f.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
    const plan = [v.plan, v.mensual ? `${fmtPesos(v.mensual)}/mes` : null].filter(Boolean).join(' · ');
    const quien = [v.cliente, v.telefono, v.vendedor ? `vendió ${v.vendedor}` : null].filter(Boolean).join(' · ');
    return `
      <li class="cupon-item">
        <div class="cupon-item-cuerpo">
          <div class="cupon-item-fila">
            <span class="cupon-item-codigo">${esc(v.compania)}</span>
            <span class="cupon-item-fuente ${v.tipo === 'portabilidad' ? 'cupon-fuente-pagina' : 'cupon-fuente-manual'}">${TIPO_PLAN[v.tipo]}</span>
            <span class="cupon-item-alcance connect-fecha">${esc(fecha)}</span>
          </div>
          ${plan ? `<div class="cupon-item-desc">${esc(plan)}</div>` : ''}
          ${v.equipo ? `<div class="cupon-item-alcance">${esc(v.equipo)}${v.precioEquipo ? ` · ${fmtPesos(v.precioEquipo)}` : ''}</div>` : ''}
          ${quien ? `<div class="cupon-item-alcance">${esc(quien)}</div>` : ''}
          ${v.notas ? `<div class="cupon-item-texto">${esc(v.notas)}</div>` : ''}
        </div>
        <button class="todo-clear" data-borrar-venta="${v.id}">Eliminar</button>
      </li>`;
  }).join('');
  lista.querySelectorAll('[data-borrar-venta]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta venta del registro?')) return;
    await fetch(`/api/connect/ventas/${btn.dataset.borrarVenta}`, { method: 'DELETE' });
    cargarVentas();
  }));
}

if (connectOverlay && connectBody && connectTabs && btnConnect) {
  btnConnect.addEventListener('click', () => abrirConnect(connectTab));
  connectTabs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { connectTab = b.dataset.tab; renderConnect(); }));
  document.getElementById('connectClose').addEventListener('click', () => connectOverlay.classList.remove('open'));
  connectOverlay.addEventListener('click', e => { if (e.target === connectOverlay) connectOverlay.classList.remove('open'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') connectOverlay.classList.remove('open'); });
}
