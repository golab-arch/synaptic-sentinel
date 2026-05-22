#!/usr/bin/env node
/**
 * @synaptic-sentinel/cli — punto de entrada de la CLI.
 *
 * Licencia: Apache-2.0 (OSS).
 */
import { parseArgs } from 'node:util';
import { SEVERITIES, type Severity } from '@synaptic-sentinel/core';
import { runScanCommand } from './commands/scan.js';
import { runMarkFpCommand } from './commands/mark-fp.js';
import { runTriageCommand } from './commands/triage.js';
import { runScannersInstallCommand } from './commands/scanners-install.js';

const USAGE = `Synaptic Sentinel — CLI

Usage:
  synaptic-sentinel scan [--path <dir>] [--opengrep-bin <path>]
                         [--gitleaks-bin <path>] [--trivy-bin <path>]
                         [--checkov-bin <path>] [--no-color]
                         [--export <file>] [--export-html <file>]
                         [--export-sarif <file>] [--fail-on <severity>]
  synaptic-sentinel mark-fp --fingerprint <fp> [--path <dir>] [--reason <text>]
  synaptic-sentinel triage [--path <dir>] [--limit <n>]
  synaptic-sentinel scanners install [--global]

Commands:
  scan               Scan a project and persist the findings to colony.db
  mark-fp            Mark a finding as a false positive (suppressed in future scans)
  triage             Triage the latest scan's findings with the Brain Layer (BYOK)
  scanners install   Download and verify the OSS scanner binaries pinned in
                     the manifest. Without --global installs to <cwd>/.scanners
                     (dev cache); with --global installs to the per-user cache
                     ~/.synaptic-sentinel/scanners (what an installed .vsix uses)

Options:
  --path <dir>           Project directory (default: the current directory)
  --opengrep-bin <path>  Explicit path to the OpenGrep binary
  --gitleaks-bin <path>  Explicit path to the Gitleaks binary
  --trivy-bin <path>     Explicit path to the Trivy binary
  --checkov-bin <path>   Explicit path to the Checkov binary
  --no-color             Disable ANSI color in the scan output
  --export <file>        Export the scan tome as JSON to the given file
  --export-html <file>   Export the scan tome as HTML to the given file
  --export-sarif <file>  Export the scan tome as SARIF 2.1.0 (CI / GitHub)
  --fail-on <severity>   Fail the scan (exit code 2) if there are findings at
                         severity >= the given one (critical|high|medium|low|info)
  --fingerprint <fp>     Fingerprint of the finding to mark (mark-fp command)
  --reason <text>        Reason for the dismissal (mark-fp command)
  --limit <n>            Cap of findings to triage (triage command; default 25)
  --global               Install scanners to the per-user global cache
                         (scanners install command)
  -h, --help             Show this help

The triage command requires the ANTHROPIC_API_KEY environment variable (BYOK).
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
      'no-color': { type: 'boolean' },
      export: { type: 'string' },
      'export-html': { type: 'string' },
      'export-sarif': { type: 'string' },
      'fail-on': { type: 'string' },
      fingerprint: { type: 'string' },
      reason: { type: 'string' },
      limit: { type: 'string' },
      global: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const command = positionals[0];
  if (values.help === true || command === undefined) {
    console.log(USAGE);
    return;
  }

  if (command === 'scan') {
    let failOn: Severity | undefined;
    const failOnRaw = values['fail-on'];
    if (failOnRaw !== undefined) {
      if (!(SEVERITIES as readonly string[]).includes(failOnRaw)) {
        console.error(`--fail-on must be one of: ${SEVERITIES.join(', ')}.\n`);
        process.exitCode = 1;
        return;
      }
      failOn = failOnRaw as Severity;
    }
    process.exitCode = await runScanCommand({
      path: values.path ?? process.cwd(),
      ...(values['opengrep-bin'] !== undefined ? { opengrepBin: values['opengrep-bin'] } : {}),
      ...(values['gitleaks-bin'] !== undefined ? { gitleaksBin: values['gitleaks-bin'] } : {}),
      ...(values['trivy-bin'] !== undefined ? { trivyBin: values['trivy-bin'] } : {}),
      ...(values['checkov-bin'] !== undefined ? { checkovBin: values['checkov-bin'] } : {}),
      ...(values['no-color'] === true ? { noColor: true } : {}),
      ...(values.export !== undefined ? { exportPath: values.export } : {}),
      ...(values['export-html'] !== undefined ? { exportHtmlPath: values['export-html'] } : {}),
      ...(values['export-sarif'] !== undefined ? { exportSarifPath: values['export-sarif'] } : {}),
      ...(failOn !== undefined ? { failOn } : {}),
    });
    return;
  }

  if (command === 'mark-fp') {
    const fingerprint = values.fingerprint;
    if (fingerprint === undefined || fingerprint === '') {
      console.error('mark-fp requires --fingerprint <fp>.\n');
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
        console.error('--limit must be a non-negative integer.\n');
        process.exitCode = 1;
        return;
      }
    }
    process.exitCode = await runTriageCommand({
      path: values.path ?? process.cwd(),
      ...(limit !== undefined ? { limit } : {}),
      ...(values['no-color'] === true ? { noColor: true } : {}),
    });
    return;
  }

  if (command === 'scanners') {
    const subcommand = positionals[1];
    if (subcommand !== 'install') {
      console.error(`Unknown scanners subcommand: ${subcommand ?? '(none)'}.\n`);
      console.log(USAGE);
      process.exitCode = 1;
      return;
    }
    process.exitCode = await runScannersInstallCommand({
      global: values.global === true,
    });
    return;
  }

  console.error(`Unknown command: ${command}\n`);
  console.log(USAGE);
  process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
