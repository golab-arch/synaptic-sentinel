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
import { runCostHistoryCommand } from './commands/cost-history.js';
import { runShowCommand } from './commands/show.js';
import { runDiffCommand } from './commands/diff.js';
import { parseAgentProviderFlags } from './commands/agent-provider-flag.js';
import { runScannersInstallCommand } from './commands/scanners-install.js';

const USAGE = `SYNAPTIC Sentinel — CLI

Usage:
  synaptic-sentinel scan [--path <dir>] [--opengrep-bin <path>]
                         [--gitleaks-bin <path>] [--trivy-bin <path>]
                         [--checkov-bin <path>] [--no-color]
                         [--export <file>] [--export-html <file>]
                         [--export-sarif <file>] [--fail-on <severity>]
  synaptic-sentinel mark-fp --fingerprint <fp> [--path <dir>] [--reason <text>]
  synaptic-sentinel triage [--path <dir>] [--limit <n>] [--re-triage]
                          [--no-group]
                          [--fail-on-new-tp-critical <n>] [--fail-on-new-tp-high <n>]
                          [--fail-on-new-tp-medium <n>]
                          [--agent-provider <agent>=<provider>/<model>]...
  synaptic-sentinel cost-history [--path <dir>] [--limit <n>] [--json]
  synaptic-sentinel show [--path <dir>] [--export <file>]
  synaptic-sentinel diff [--path <dir>] [--confidence-delta-threshold <n>]
  synaptic-sentinel scanners install [--global]

Commands:
  scan               Scan a project and persist the findings to colony.db
  mark-fp            Mark a finding as a false positive (suppressed in future scans)
  triage             Triage the latest scan's findings with the Brain Layer (BYOK)
  cost-history       Show ~estimated cost USD + token usage of the last N
                     triage sessions (default 10), grouped by provider+agent
  show               Reconstruct the tome of the LATEST scan from colony.db
                     without running scanners or LLM (cost: 0). Used by the
                     VSCode extension to hydrate the sidebar on workspace
                     reopen — preserves the previous scan + triage state.
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
  --re-triage            Clear triage verdicts + context + remediation for the
                         latest scan BEFORE triaging (triage command). Use this
                         after changing the configured provider in
                         .sentinel/agents.yaml to re-evaluate the same findings.
  --no-group             DG-131 A Sub-A2: disable cross-finding correlation
                         grouping (R20). Each finding gets its own LLM call
                         instead of sharing a group representative. Escape
                         hatch for when you want per-finding autonomy over
                         cost savings.
  --fail-on-new-tp-critical <n>
  --fail-on-new-tp-high <n>
  --fail-on-new-tp-medium <n>
                         DG-132 A Sub-A2 CI/CD gates: exit code 1 if the
                         number of NEW true-positive findings (first-time
                         triaged with TP OR reclassified-to-TP class change)
                         at that severity exceeds the threshold. Use e.g.
                         --fail-on-new-tp-critical 0 --fail-on-new-tp-high 3
                         for zero-tolerance critical + tolerate up to 3 high
                         per PR. Undefined = skip check for that severity.
  --confidence-delta-threshold <n>
                         DG-132 A Sub-A2 (diff command): threshold [0..1] for
                         confidence delta to count as "reclassified.
                         confidence-delta" reason. Default 0.15 (matches
                         DG-130 A banner heuristic).
                         Preserves fp_known (manual FPs) and triage_token_usage
                         (cost history rollup).
  --agent-provider <a>=<p>/<m>
                         Override the LLM provider/model used by an agent in
                         the triage command (repeatable). Example:
                           --agent-provider triage=deepseek/deepseek-v3.2
                           --agent-provider remediation=ollama/mistral-nemo:12b
                         CLI > .sentinel/agents.yaml > ANTHROPIC_API_KEY fallback.
  --global               Install scanners to the per-user global cache
                         (scanners install command)
  -h, --help             Show this help

The triage command resolves each agent's LLM via (in order of precedence):
  1. --agent-provider CLI flag (per agent)
  2. .sentinel/agents.yaml in the project root
  3. ANTHROPIC_API_KEY env var fallback (retro-compat with v0.2.0 behavior)

API keys are read from SENTINEL_<PROVIDER>_API_KEY env vars (or
ANTHROPIC_API_KEY for the legacy Anthropic path). Keys never appear in
command-line arguments.
`;

/**
 * DG-132 A Sub-A2: parse a non-negative integer from a CLI flag value.
 * Exits with a helpful message if invalid (used by --fail-on-new-tp-* flags).
 */
function parseNonNegativeInt(raw: string, flagName: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(`--${flagName} must be a non-negative integer (got "${raw}").`);
    process.exit(1);
  }
  return parsed;
}

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
      'agent-provider': { type: 'string', multiple: true },
      global: { type: 'boolean' },
      json: { type: 'boolean' },
      're-triage': { type: 'boolean' },
      'no-group': { type: 'boolean' },
      'fail-on-new-tp-critical': { type: 'string' },
      'fail-on-new-tp-high': { type: 'string' },
      'fail-on-new-tp-medium': { type: 'string' },
      'confidence-delta-threshold': { type: 'string' },
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
    // Parseo del flag repeatable --agent-provider <agent>=<provider>/<model>.
    let agentProviderOverrides: ReturnType<typeof parseAgentProviderFlags> | undefined;
    if (values['agent-provider'] !== undefined && values['agent-provider'].length > 0) {
      try {
        agentProviderOverrides = parseAgentProviderFlags(values['agent-provider']);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
        return;
      }
    }
    process.exitCode = await runTriageCommand({
      path: values.path ?? process.cwd(),
      ...(limit !== undefined ? { limit } : {}),
      ...(agentProviderOverrides !== undefined ? { agentProviderOverrides } : {}),
      ...(values['no-color'] === true ? { noColor: true } : {}),
      ...(values['re-triage'] === true ? { reTriage: true } : {}),
      ...(values['no-group'] === true ? { noGroup: true } : {}),
      ...(values['fail-on-new-tp-critical'] !== undefined
        ? {
            failOnNewTpCritical: parseNonNegativeInt(
              values['fail-on-new-tp-critical'],
              'fail-on-new-tp-critical',
            ),
          }
        : {}),
      ...(values['fail-on-new-tp-high'] !== undefined
        ? {
            failOnNewTpHigh: parseNonNegativeInt(
              values['fail-on-new-tp-high'],
              'fail-on-new-tp-high',
            ),
          }
        : {}),
      ...(values['fail-on-new-tp-medium'] !== undefined
        ? {
            failOnNewTpMedium: parseNonNegativeInt(
              values['fail-on-new-tp-medium'],
              'fail-on-new-tp-medium',
            ),
          }
        : {}),
    });
    return;
  }

  if (command === 'show') {
    process.exitCode = runShowCommand({
      path: values.path ?? process.cwd(),
      ...(values.export !== undefined ? { exportPath: values.export } : {}),
    });
    return;
  }

  if (command === 'diff') {
    let confidenceDeltaThreshold: number | undefined;
    if (values['confidence-delta-threshold'] !== undefined) {
      confidenceDeltaThreshold = Number.parseFloat(values['confidence-delta-threshold']);
      if (
        !Number.isFinite(confidenceDeltaThreshold) ||
        confidenceDeltaThreshold < 0 ||
        confidenceDeltaThreshold > 1
      ) {
        console.error('--confidence-delta-threshold must be a number in [0, 1].\n');
        process.exitCode = 1;
        return;
      }
    }
    process.exitCode = runDiffCommand({
      path: values.path ?? process.cwd(),
      ...(confidenceDeltaThreshold !== undefined ? { confidenceDeltaThreshold } : {}),
    });
    return;
  }

  if (command === 'cost-history') {
    let limit: number | undefined;
    if (values.limit !== undefined) {
      limit = Number.parseInt(values.limit, 10);
      if (!Number.isInteger(limit) || limit < 1) {
        console.error('--limit must be a positive integer.\n');
        process.exitCode = 1;
        return;
      }
    }
    process.exitCode = runCostHistoryCommand({
      path: values.path ?? process.cwd(),
      ...(limit !== undefined ? { limit } : {}),
      ...(values.json === true ? { json: true } : {}),
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
