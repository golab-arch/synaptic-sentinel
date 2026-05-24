/**
 * Token-count proxy (DG-076 B → DG-078 B).
 *
 * El contrato `LlmClient.complete()` retorna solo `string` (no `usage`),
 * decisión deliberada de DG-073 B para mantener el contrato simple y
 * provider-agnostic. Por eso el cost visibility (DG-078) y el benchmark
 * (DG-076) estiman tokens con una heurística aproximada en vez de leer el
 * `usage` real del provider.
 *
 * **Heurística**: ~4 chars/token en inglés (regla pulgar de OpenAI
 * tokenizer). Error típico ±15-20% según el modelo y el contenido (más
 * exacto en inglés; menos en código denso o lenguajes con tokens largos).
 *
 * **Caveat anti-optimismo ilusorio**: este proxy NO sustituye a una
 * tokenizer real (tiktoken, claude-tokenizer). Si el usuario necesita
 * cost exacto para facturación interna, debe usar el `usage` del provider
 * (sub-DG futuro que extienda el contrato `LlmClient`).
 */

/**
 * Estima la cantidad de tokens equivalentes para un string usando la
 * heurística `Math.ceil(text.length / 4)`. Determinista, sin red, sin deps.
 *
 * Retorna 0 para strings vacíos. Nunca negativo.
 */
export function proxyTokenCount(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}
