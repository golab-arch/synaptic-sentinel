// Synaptic Sentinel — DELIBERATELY VULNERABLE fixture for the taint-mode rules
// (FI-003 etapa 1, DG-061). Each function demonstrates an intentional taint
// flow source -> sink. Do NOT use in production.
//
// 1. listFiles / deleteFileSync : req -> child_process.exec / execSync
//    (CWE-78, sentinel-js-taint-command-injection)
// 2. renderName                 : req -> $EL.innerHTML
//    (CWE-79, sentinel-js-taint-xss)
// 3. lookupUser                 : req -> db.query (string concat)
//    (CWE-89, sentinel-js-taint-sql-injection)
'use strict';

const { exec, execSync } = require('child_process');

// CWE-78: req.query.dir -> exec
function listFiles(req, res) {
  const dir = req.query.dir;
  exec('ls ' + dir, (err, stdout) => {
    res.send(stdout);
  });
}

// CWE-78: req.body.target -> execSync
function deleteFileSync(req) {
  const target = req.body.target;
  execSync('rm -rf ' + target);
}

// CWE-79: req.query.name -> innerHTML (no sanitization)
function renderName(req) {
  const username = req.query.name;
  const el = document.getElementById('hello');
  el.innerHTML = '<h1>Hi ' + username + '</h1>';
}

// CWE-89: req.params.id concatenated into a SQL string
function lookupUser(req, db) {
  const id = req.params.id;
  return db.query('SELECT * FROM users WHERE id = ' + id);
}

module.exports = { listFiles, deleteFileSync, renderName, lookupUser };
