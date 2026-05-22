/**
 * CLI sub-command: `synaptic-sentinel scanners install [--global]`.
 *
 * Downloads and verifies the pinned OSS scanner binaries (FI-008 / DG-059).
 * The bundled extension surfaces this as a Command Palette entry; the dev
 * script `pnpm scanners:install` invokes it too.
 *
 * License: Apache-2.0 (OSS).
 */
import { runScannersInstall } from '../scanners/install.js';

/** Options for {@link runScannersInstallCommand}. */
export interface ScannersInstallCommandOptions {
  /** Install to the per-user global cache (otherwise `<cwd>/.scanners`). */
  readonly global: boolean;
}

/** Pretty-prints an Error including its `cause` (useful for fetch/TLS errors). */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  return cause instanceof Error ? `${err.message} (${cause.message})` : err.message;
}

/** Runs the install end-to-end and returns 0 on success, 1 on failure. */
export async function runScannersInstallCommand(
  options: ScannersInstallCommandOptions,
): Promise<number> {
  try {
    await runScannersInstall({ global: options.global });
    return 0;
  } catch (err) {
    const detail = describeError(err);
    console.error(`ERROR: ${detail}`);
    if (/certificate|UNABLE_TO_VERIFY/i.test(detail)) {
      console.error(
        'The environment has TLS inspection. Run "pnpm scanners:install" (it adds --use-system-ca).',
      );
    }
    return 1;
  }
}
