/**
 * Runtime guard for the bundled CLI (FI-001 / FI-008).
 *
 * The CLI is bundled inside the extension and spawned with the extension
 * host's own Node.js runtime (`process.execPath`, DG-055). It persists to
 * `colony.db` through `node:sqlite`, which Node.js exposes only from v22.5.0.
 * On an older host a scan would crash with a module-not-found error; this
 * guard lets `activate()` surface an actionable message instead.
 *
 * The check is pure (no `vscode` import) so it is unit-testable, and it is
 * exact: it reads the host runtime directly instead of guessing it from the
 * VS Code version.
 */

/** Minimum Node.js the bundled CLI needs — `node:sqlite` landed in 22.5.0. */
export const MIN_NODE_VERSION = '22.5.0';

/** Outcome of {@link checkExtensionHostRuntime}. */
export interface RuntimeCheckResult {
  /** `true` when the host Node.js runtime can run the bundled CLI. */
  readonly ok: boolean;
  /** Actionable message for the user; present only when `ok` is `false`. */
  readonly message?: string;
}

/** Parses a `major.minor.patch` string into a tuple, tolerating a leading `v`. */
function parseVersion(version: string): readonly [number, number, number] {
  const nums = version
    .trim()
    .replace(/^v/, '')
    .split('.')
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
}

/** Returns `true` when version `actual` is greater than or equal to `minimum`. */
function versionAtLeast(actual: string, minimum: string): boolean {
  const [aMajor, aMinor, aPatch] = parseVersion(actual);
  const [mMajor, mMinor, mPatch] = parseVersion(minimum);
  if (aMajor !== mMajor) return aMajor > mMajor;
  if (aMinor !== mMinor) return aMinor > mMinor;
  return aPatch >= mPatch;
}

/**
 * Checks whether the extension host's Node.js runtime can run the bundled CLI.
 *
 * @param nodeVersion the host runtime version (`process.versions.node`).
 */
export function checkExtensionHostRuntime(nodeVersion: string): RuntimeCheckResult {
  if (versionAtLeast(nodeVersion, MIN_NODE_VERSION)) return { ok: true };
  return {
    ok: false,
    message:
      `Synaptic Sentinel needs Node.js ${MIN_NODE_VERSION}+ in the VS Code ` +
      `extension host to run scans, but this host runs Node.js ${nodeVersion}. ` +
      `Update VS Code to a build with a newer runtime.`,
  };
}
