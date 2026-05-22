import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildFpKnownPheromone, ColonyDb } from '@synaptic-sentinel/core';

/** Opciones del comando `mark-fp`. */
export interface MarkFpCommandOptions {
  /** Directorio del proyecto cuyo `colony.db` se actualiza. */
  readonly path: string;
  /** Huella estable del hallazgo a marcar como falso positivo. */
  readonly fingerprint: string;
  /** Motivo del descarte, opcional. */
  readonly reason?: string;
}

/**
 * Ejecuta el comando `mark-fp`: registra una feromona `fp_known` para el
 * `fingerprint` indicado, de modo que el `Coordinator` (stage 2) lo suprima
 * en los scans siguientes. Devuelve el codigo de salida del proceso.
 *
 * Valida que exista un hallazgo con ese fingerprint en `colony.db` antes de
 * marcarlo, y es idempotente: marcar dos veces no duplica la feromona.
 */
export function runMarkFpCommand(options: MarkFpCommandOptions): number {
  const projectRoot = resolve(options.path);
  const dbPath = join(projectRoot, '.synaptic-sentinel', 'colony.db');
  if (!existsSync(dbPath)) {
    console.error(`No colony.db in ${projectRoot}. Run "synaptic-sentinel scan" first.`);
    return 1;
  }

  const db = ColonyDb.open(dbPath);
  try {
    const existing = db.getPheromonesByFingerprint(options.fingerprint);
    const finding = existing.find((pheromone) => pheromone.type === 'finding');
    if (finding === undefined) {
      console.error(`No finding found with fingerprint "${options.fingerprint}".`);
      return 1;
    }
    if (existing.some((pheromone) => pheromone.type === 'fp_known')) {
      console.log('The finding was already marked as a false positive.');
      return 0;
    }

    db.insertPheromone(
      buildFpKnownPheromone({
        scanId: finding.scanId,
        agentId: 'cli-mark-fp',
        fingerprint: options.fingerprint,
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
      }),
    );
    console.log('Finding marked as a false positive. The next scan will skip it.');
    return 0;
  } finally {
    db.close();
  }
}
