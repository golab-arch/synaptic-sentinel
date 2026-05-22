// Fixture deliberadamente vulnerable - NO es codigo de produccion.
// Valida la deteccion de XSS (CWE-79) e inyeccion de codigo (CWE-95)
// del OpenGrepScout.

function render(userInput) {
  // document.write() con datos no confiables: XSS reflejado.
  document.write(userInput);
}

function updatePanel(el, userInput) {
  // Asignacion a innerHTML con un valor dinamico: XSS.
  el.innerHTML = userInput;
}

function scheduleFromString() {
  // Un string como primer argumento de setTimeout: eval implicito.
  setTimeout('doWork()', 1000);
}

module.exports = { render, updatePanel, scheduleFromString };
