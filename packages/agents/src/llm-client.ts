/** Peticion de completado dirigida a un LLM. */
export interface LlmCompletionRequest {
  /** Instruccion de sistema: define el rol y comportamiento del agente. */
  readonly system: string;
  /** Mensaje del usuario: la tarea concreta a resolver. */
  readonly user: string;
  /** Tope de tokens de la respuesta. */
  readonly maxTokens?: number;
}

/**
 * Tokens consumidos por una sola call al LLM, segun lo reporta el provider
 * (DG-085 A). Estos son numeros REALES extraidos del response del provider,
 * NO la proxy heuristica `chars/4` (esa proxy queda como fallback en el
 * decorator `TokenTrackingLlmClient` cuando el client no implementa
 * `completeWithUsage`).
 */
export interface TokenUsage {
  /** Tokens del prompt (system + user) segun el provider. */
  readonly inputTokens: number;
  /** Tokens generados por el modelo segun el provider. */
  readonly outputTokens: number;
}

/**
 * Resultado de una call al LLM con metadata de uso REAL del provider
 * (DG-085 A). El campo `usage` es `null` solo si el provider no expuso
 * los counts en el response (ej. respuesta corrupta o version antigua del
 * provider) — el llamante decide si usar la proxy `chars/4` como fallback.
 */
export interface LlmCompletionResult {
  /** Texto de la respuesta del modelo (igual que el retorno de `complete`). */
  readonly text: string;
  /** Tokens segun el provider, o `null` si el provider no los reporto. */
  readonly usage: TokenUsage | null;
}

/**
 * Frontera con el LLM.
 *
 * La capa Cerebro depende de esta interfaz, no de un proveedor concreto: los
 * tests inyectan un cliente falso (deterministico, sin red) y la llamada de
 * red real queda aislada en las implementaciones (ej. `AnthropicLlmClient`).
 * Es el unico punto no-deterministico del Brain Layer.
 *
 * **Anti-optimismo ilusorio**: `completeWithUsage` (DG-085 A) es OPCIONAL en
 * el contrato. Los adapters reales (Anthropic / OpenAI-compat / Ollama) lo
 * implementan extrayendo usage real del response del provider. Los fakes
 * deterministas de tests siguen implementando solo `complete` y siguen
 * funcionando sin cambios — el `TokenTrackingLlmClient` cae a la proxy
 * `chars/4` (con caveat explicito) cuando el inner client no lo expone.
 */
export interface LlmClient {
  /** Devuelve el texto de la respuesta del modelo. */
  complete(request: LlmCompletionRequest): Promise<string>;
  /**
   * Igual que `complete`, pero ademas devuelve el usage REAL del provider
   * cuando este lo expone en el response. Opcional en el contrato — los
   * adapters reales lo implementan; los fakes de tests no lo necesitan.
   */
  completeWithUsage?(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
