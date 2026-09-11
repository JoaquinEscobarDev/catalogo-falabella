const repo = require('../repositories/reservasIphoneRepository');

const MODELOS_VALIDOS = ['iPhone 18 Pro', 'iPhone 18 Pro Max', 'iPhone Duo'];

const ALMACENAMIENTO_POR_MODELO = {
  'iPhone 18 Pro':     ['128GB', '256GB', '512GB', '1TB'],
  'iPhone 18 Pro Max': ['256GB', '512GB', '1TB'],
  'iPhone Duo':        ['128GB', '256GB', '512GB'],
};

const COLORES_POR_MODELO = {
  'iPhone 18 Pro':     ['Negro Titanio', 'Blanco Titanio', 'Natural Titanio', 'Desierto Titanio'],
  'iPhone 18 Pro Max': ['Negro Titanio', 'Blanco Titanio', 'Natural Titanio', 'Desierto Titanio'],
  'iPhone Duo':        ['Negro', 'Blanco', 'Rosa', 'Azul', 'Verde', 'Ultramarino'],
};

function err(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

async function crearReserva({ nombre, apellido, telefono, modelo, almacenamiento, color }) {
  if (!nombre?.trim())    throw err('El nombre es requerido');
  if (!apellido?.trim())  throw err('El apellido es requerido');
  if (!telefono?.trim())  throw err('El teléfono es requerido');
  if (!MODELOS_VALIDOS.includes(modelo)) throw err('Modelo inválido');
  if (!ALMACENAMIENTO_POR_MODELO[modelo].includes(almacenamiento)) throw err('Almacenamiento inválido para el modelo');
  if (!COLORES_POR_MODELO[modelo].includes(color)) throw err('Color inválido para el modelo');

  return repo.create({
    nombre: nombre.trim(),
    apellido: apellido.trim(),
    telefono: telefono.trim(),
    modelo,
    almacenamiento,
    color,
  });
}

async function obtenerReservas() {
  return repo.findAll();
}

module.exports = {
  crearReserva,
  obtenerReservas,
  MODELOS_VALIDOS,
  ALMACENAMIENTO_POR_MODELO,
  COLORES_POR_MODELO,
};
