import { spawn } from 'node:child_process';

/** Resultado crudo de ejecutar un proceso. */
export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

/**
 * Ejecuta un proceso, recolecta stdout/stderr y respeta la senal de aborto.
 * Helper comun de la capa Scout: los wrappers corren sus scanners OSS como
 * child processes dentro del perimetro del cliente.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, ...(signal ? { signal } : {}) });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });
}
