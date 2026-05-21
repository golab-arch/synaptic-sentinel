// Fixture deliberadamente vulnerable - NO es codigo de produccion.
// Se usa para validar la deteccion del OpenGrepScout (CWE-95).

export function buildHandler(source: string): () => unknown {
  // new Function() construye codigo desde un string: equivalente a eval().
  const handler = new Function(source);
  return () => handler();
}
