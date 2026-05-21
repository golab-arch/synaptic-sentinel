// Fixture deliberadamente vulnerable - NO es codigo de produccion.
// Se usa para validar la deteccion del OpenGrepScout (CWE-95).

function runUserCode(userInput) {
  // eval() sobre entrada no confiable: inyeccion de codigo.
  return eval(userInput);
}

module.exports = { runUserCode };
