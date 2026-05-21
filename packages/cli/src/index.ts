#!/usr/bin/env node
/**
 * @synaptic-sentinel/cli — punto de entrada de la CLI.
 *
 * Licencia: Apache-2.0 (OSS).
 */
import { parseArgs } from 'node:util';
import { runScanCommand } from './commands/scan.js';

const USAGE = `Synaptic Sentinel — CLI

Uso:
  synaptic-sentinel scan [--path <dir>] [--opengrep-bin <ruta>] [--export <archivo>]

Comandos:
  scan    Escanea un proyecto y persiste los hallazgos en colony.db

Opciones:
  --path <dir>           Directorio a escanear (por defecto: el directorio actual)
  --opengrep-bin <ruta>  Ruta explicita al binario de OpenGrep
  --export <archivo>     Exporta el tomo del scan en JSON al archivo indicado
  -h, --help             Muestra esta ayuda
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      path: { type: 'string' },
      'opengrep-bin': { type: 'string' },
      export: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const command = positionals[0];
  if (values.help === true || command === undefined) {
    console.log(USAGE);
    return;
  }

  if (command === 'scan') {
    process.exitCode = await runScanCommand({
      path: values.path ?? process.cwd(),
      ...(values['opengrep-bin'] !== undefined ? { opengrepBin: values['opengrep-bin'] } : {}),
      ...(values.export !== undefined ? { exportPath: values.export } : {}),
    });
    return;
  }

  console.error(`Comando desconocido: ${command}\n`);
  console.log(USAGE);
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
