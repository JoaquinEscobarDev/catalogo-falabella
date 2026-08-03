const express = require('express');
const path = require('path');
const routes = require('./routes');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Respuestas de API nunca se deben cachear en el navegador
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', routes);

module.exports = app;
