#!/usr/bin/env node
/**
 * @synaptic-sentinel/cli — punto de entrada de la CLI.
 *
 * Licencia: Apache-2.0 (OSS).
 */
import { parseArgs } from 'node:util';
import { runScanCommand } from './commands/scan.js';
import { runMarkFpCommand } from './commands/mark-fp.js';
import { runTriageCommand } from './commands/triage.js';

const USAGE = `Synaptic Sentinel — CLI

Uso:
  synaptic-sentinel scan [--path <dir>] [--opengrep-bin <ruta>]
                         [--gitleaks-bin <ruta>] [--trivy-bin <ruta>]
                         [--checkov-bin <ruta>]
                         [--export <archivo>] [--export-html <archivo>]
  synaptic-sentinel mark-fp --fingerprint <fp> [--path <dir>] [--reason <texto>]
  synaptic-sentinel triage [--path <dir>] [--limit <n>]

Comandos:
  scan       Escanea un proyecto y persiste los hallazgos en colony.db
  mark-fp    Marca un hallazgo como falso positivo (lo suprime en scans futuros)
  triage     Tria los hallazgos del ultimo scan con el Brain Layer (BYOK)

Opciones:
  --path <dir>           Directorio del proyecto (por defecto: el directorio actual)
  --opengrep-bin <ruta>  Ruta explicita al binario de OpenGrep
  --gitleaks-bin <ruta>  Ruta explicita al binario de Gitleaks
  --trivy-bin <ruta>     Ruta explicita al binario de Trivy
  --checkov-bin <ruta>   Ruta explicita al binario de Checkov
  --export <archivo>     Exporta el tomo del scan en JSON al archivo indicado
  --export-html <arch.>  Exporta el tomo del scan en HTML al archivo indicado
  --fingerprint <fp>     Huella del hallazgo a marcar (comando mark-fp)
  --reason <texto>       Motivo del descarte (comando mark-fp)
  --limit <n>            Tope de hallazgos a triar (comando triage; por defecto 25)
  -h, --help             Muestra esta ayuda

El comando triage requiere la variable de entorno ANTHROPIC_API_KEY (BYOK).
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      path: { type: 'string' },
      'opengrep-bin': { type: 'string' },
      'gitleaks-bin': { type: 'string' },
      'trivy-bin': { type: 'string' },
      'checkov-bin': { type: 'string' },
      export: { type: 'string' },
      'export-html': { type: 'string' },
      fingerprint: { type: 'string' },
      reason: { type: 'string' },
      limit: { type: 'string' },
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
      ...(values['gitleaks-bin'] !== undefined ? { gitleaksBin: values['gitleaks-bin'] } : {}),
      ...(values['trivy-bin'] !== undefined ? { trivyBin: values['trivy-bin'] } : {}),
      ...(values['checkov-bin'] !== undefined ? { checkovBin: values['checkov-bin'] } : {}),
      ...(values.export !== undefined ? { exportPath: values.export } : {}),
      ...(values['export-html'] !== undefined ? { exportHtmlPath: values['export-html'] } : {}),
    });
    return;
  }

  if (command === 'mark-fp') {
    const fingerprint = values.fingerprint;
    if (fingerprint === undefined || fingerprint === '') {
      console.error('mark-fp requiere --fingerprint <fp>.\n');
      console.log(USAGE);
      process.exitCode = 1;
      return;
    }
    process.exitCode = runMarkFpCommand({
      path: values.path ?? process.cwd(),
      fingerprint,
      ...(values.reason !== undefined ? { reason: values.reason } : {}),
    });
    return;
  }

  if (command === 'triage') {
    let limit: number | undefined;
    if (values.limit !== undefined) {
      limit = Number.parseInt(values.limit, 10);
      if (!Number.isInteger(limit) || limit < 0) {
        console.error('--limit debe ser un entero no negativo.\n');
        process.exitCode = 1;
        return;
      }
    }
    process.exitCode = await runTriageCommand({
      path: values.path ?? process.cwd(),
      ...(limit !== undefined ? { limit } : {}),
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
