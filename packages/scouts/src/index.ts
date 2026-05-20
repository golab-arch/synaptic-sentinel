/**
 * @synaptic-sentinel/scouts
 *
 * Capa Scout (determinista, sin LLM): la interfaz ScoutAgent comun y los
 * wrappers de scanners OSS -OpenGrep, Gitleaks, Trivy, Checkov- ejecutados
 * como child processes dentro del perimetro del cliente.
 * Implementacion en PASO 4 del roadmap (primero el wrapper OpenGrep).
 *
 * Licencia: Apache-2.0 (OSS).
 */

export const PACKAGE_NAME = '@synaptic-sentinel/scouts';
