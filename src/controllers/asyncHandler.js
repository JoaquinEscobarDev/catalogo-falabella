// Envuelve un handler async: captura el error y responde {error} en vez de
// colgar la request. `e.status` (si el service lo puso) fija el código HTTP.
module.exports = fn => (req, res) => {
  fn(req, res).catch(e => {
    res.status(e.status || 500).json({ error: e.message });
  });
};
