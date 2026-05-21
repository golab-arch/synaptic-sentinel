// Fixture deliberadamente vulnerable - NO es codigo de produccion.
// Dispara la regla sentinel-js-eval-usage del ruleset baseline de OpenGrep.
function run(userInput) {
  return eval(userInput);
}

module.exports = { run };
