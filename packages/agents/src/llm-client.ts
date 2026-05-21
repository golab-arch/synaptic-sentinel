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
 * Frontera con el LLM.
 *
 * La capa Cerebro depende de esta interfaz, no de un proveedor concreto: los
 * tests inyectan un cliente falso (deterministico, sin red) y la llamada de
 * red real queda aislada en las implementaciones (ej. `AnthropicLlmClient`).
 * Es el unico punto no-deterministico del Brain Layer.
 */
export interface LlmClient {
  /** Devuelve el texto de la respuesta del modelo. */
  complete(request: LlmCompletionRequest): Promise<string>;
}
