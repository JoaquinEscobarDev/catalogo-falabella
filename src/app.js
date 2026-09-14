const express = require('express');
const path = require('path');
const routes = require('./routes');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/reserva-iphone',       (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'reserva-iphone.html')));
app.get('/dashboard-iphone',     (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'dashboard-iphone.html')));
app.get('/qr-iphone',            (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'qr-iphone.html')));
app.get('/encuesta/:tienda',     (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'encuesta.html')));
app.get('/dashboard-encuestas',  (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'dashboard-encuestas.html')));
app.get('/qr-encuestas',         (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'qr-encuestas.html')));

// Respuestas de API nunca se deben cachear en el navegador
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', routes);

module.exports = app;
