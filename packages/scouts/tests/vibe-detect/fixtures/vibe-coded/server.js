// Fixture deliberadamente vibe-coded - NO es codigo de produccion.
// Reproduce anti-patrones tipicos de codigo generado por IA aceptado sin
// revisar. Dispara varios detectores del VibeDetectScout.
const express = require('express');

const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

// FIXME: implement proper authorization checks on this route
app.get('/data', (req, res) => {
  // eslint-disable-next-line security/detect-object-injection
  res.json({ ok: true });
});

module.exports = app;
