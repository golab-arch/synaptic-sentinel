# Publishing to the VSCode Marketplace

> **Phase 12 runbook — DG-080 B.** Step-by-step to publish `synaptic-sentinel-X.Y.Z.vsix` to [marketplace.visualstudio.com](https://marketplace.visualstudio.com/) under the `GoLab` publisher.

This runbook is **reproducible**: every step has an exact command, an expected output, and a verification step. The first time may take ~30 min because of the Azure DevOps PAT setup; subsequent releases (`v0.4.0`, `v0.5.0`, ...) take ~5 min.

## Prerequisites (one-time)

### 1. Azure DevOps account + Marketplace publisher

The VSCode marketplace publishes via `vsce` (Visual Studio Code Extensions CLI), which authenticates with an **Azure DevOps Personal Access Token** (PAT). You need an Azure DevOps account (free tier is fine) and a publisher entity under that account.

1. Sign in to [https://dev.azure.com](https://dev.azure.com) with a Microsoft account.
2. Create (or reuse) an Azure DevOps organization. Any name; this is **not** the same as the marketplace publisher.
3. Go to [https://marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) and create the publisher `GoLab` (the publisher id in `packages/vscode-extension/package.json`). The display name can be anything; the id **must** be `GoLab` to match the `publisher` field.

### 2. Personal Access Token (PAT) with Marketplace > Manage scope

The PAT is what authenticates `vsce publish`. **It is a secret — treat it like an API key.**

1. Go to [https://dev.azure.com/<your-org>/\_usersSettings/tokens](https://dev.azure.com/) (replace `<your-org>` with your Azure DevOps org name).
2. Click **+ New Token**.
3. Configure:
   - **Name**: `synaptic-sentinel-vsce-publish` (anything memorable).
   - **Organization**: **All accessible organizations** (this is critical — a per-org-scoped PAT won't work for marketplace).
   - **Expiration**: 1 year is the longest; pick that to avoid renewal during a release.
   - **Scopes**: click **Show all scopes** and check **Marketplace > Manage**. **Only that scope** — least privilege.
4. Click **Create**. Copy the token immediately — Azure DevOps shows it once and then hides it forever.
5. **Save the token in a secure location** (password manager, encrypted notes). You'll set it as the `VSCE_PAT` env var when publishing.

### 3. Local environment

Verify `vsce` is installed (it ships as a devDependency of `packages/vscode-extension`):

```sh
pnpm -F synaptic-sentinel exec vsce --version
```

Expected: `>= 3.0.0` (or whatever version the lockfile pins).

## Publish a release

Assuming you already have the `.vsix` produced (e.g. `synaptic-sentinel-0.3.2.vsix`). **Do not publish `v0.3.0` or `v0.3.1`** — both had extension-host activation bugs (`v0.3.0` had inlined-SDKs; `v0.3.1` had a residual `createRequire(import.meta.url)` issue in the CJS bundle of `colony-db.ts`). `v0.3.2` is the first version where `activate()` actually registers all commands inside VSCode. See `DG-079.1` (Entry #86) and `DG-079.2` (Entry #87) in `BITACORA.md` for context.

### Step 1: set the PAT in your shell

**PowerShell** (Windows):

```powershell
$env:VSCE_PAT = "<your-pat-here>"
```

**bash / zsh** (Linux / macOS):

```sh
export VSCE_PAT="<your-pat-here>"
```

The PAT lives in the env var only for this shell session — it is **not** persisted to disk by these commands, and `vsce` never logs it.

### Step 2: run `vsce publish`

From the repo root:

```sh
pnpm -F synaptic-sentinel exec vsce publish --packagePath packages/vscode-extension/synaptic-sentinel-0.3.2.vsix
```

Expected output:

```text
INFO  Publishing 'GoLab.synaptic-sentinel v0.3.2' from package...
INFO  Published GoLab.synaptic-sentinel v0.3.2.
```

The publish takes ~10-30 seconds. The listing becomes searchable on the marketplace within a few minutes (the marketplace runs an indexer pass).

### Step 3: verify the public listing

Open:

```text
https://marketplace.visualstudio.com/items?itemName=GoLab.synaptic-sentinel
```

Verify:

- ✅ The page loads (no 404).
- ✅ The version is `0.3.2` (or later — do **not** publish `0.3.0` or `0.3.1`, see `DG-079.1` and `DG-079.2` for context).
- ✅ The README rendered matches `packages/vscode-extension/README.md`.
- ✅ The icon is the official GoLab logo (`media/icon.png`).
- ✅ The CHANGELOG tab shows the `[0.3.2]` hotfix entry (and `[0.3.1]` + `[0.3.0]` as superseded) with the Multi-provider Brain Layer section + Known Issues.
- ✅ The categories and keywords match `package.json`.
- ✅ The Apache-2.0 license badge is detected.

You can also verify with `vsce`:

```sh
pnpm -F synaptic-sentinel exec vsce show GoLab.synaptic-sentinel
```

Expected: a JSON-like dump of the listing metadata (display name, version, install count, etc.).

### Step 4: announce (optional)

The release is now publicly installable as:

```sh
code --install-extension GoLab.synaptic-sentinel
```

or by clicking **Install** in the marketplace page.

Optionally announce via:

- GitHub Release notes for `v0.3.0` were created by `DG-079 A`; v0.3.0 and v0.3.1 are both superseded by `v0.3.2` — that hotfix Release is the one users should download.
- Show HN / X / LinkedIn (only after the Known Issues are resolved in future sub-DGs — see `CHANGELOG.md`).
- GitHub Discussions on `golab-arch/synaptic-sentinel` (categories `Announcements` / `Show & Tell`).

## Subsequent releases (`v0.4.0+`)

Once the publisher is set up and you have a valid PAT, the publish pipeline is:

1. Bump `packages/vscode-extension/package.json` version.
2. Cut a new CHANGELOG entry.
3. `pnpm verify` — must be green.
4. `pnpm -F synaptic-sentinel package` — produces the new `.vsix`.
5. `pnpm -F synaptic-sentinel exec vsce publish --packagePath <new-vsix>`.

The runbook is the same; only the version number changes.

## Failure modes and recovery

| Symptom                                                                 | Likely cause                                                              | Fix                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Personal Access Token verification has failed`                         | PAT expired, wrong scope, or env var not set.                             | Regenerate PAT with **Marketplace > Manage** scope on **All accessible organizations**. Re-`export VSCE_PAT=...`.              |
| `Publisher 'GoLab' not found`                                           | Publisher entity not created in marketplace yet.                          | Go to [https://marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) and create publisher `GoLab`. |
| `Version 0.X.Y already exists`                                          | You're trying to publish a version that's already published.              | Bump the version in `package.json`, repackage, retry. Marketplace versions are immutable.                                      |
| `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`                                      | `vsce` not installed as devDependency.                                    | `cd packages/vscode-extension && pnpm install`.                                                                                |
| `Manifest validation failed: ...`                                       | `package.json` shape issue (e.g. missing `categories`, malformed semver). | Read the error, fix `package.json`, retry. `vsce package` runs the same validation locally; you can validate before `publish`. |
| Norton / antivirus blocks `vsce` network call (`UNABLE_TO_VERIFY_...`). | TLS interception by AV.                                                   | `$env:NODE_OPTIONS = "--use-system-ca"` before `vsce publish` (project-wide pattern L-001).                                    |

## Unpublishing (emergency only)

If a release ships with a critical bug:

```sh
pnpm -F synaptic-sentinel exec vsce unpublish GoLab.synaptic-sentinel <version>
```

**Caveats**:

- Unpublishing is **partially irreversible**: users who already installed the bad version keep it locally; clones / forks on GitHub survive.
- Marketplace blocks re-publishing the same version after unpublish. You have to bump the version.
- Prefer a `v0.X.Y+1` patch release with the fix over unpublishing.

## Related

- `DG-080 B` — the DG that wrote this runbook (Phase 12 opener).
- `DG-069 B` — the analogous runbook for GitHub Releases (used in Phase 9 / `v0.2.0`).
- `CHANGELOG.md` — the source of truth for what's in each `v0.X.Y` release.
- [Visual Studio Code Marketplace Publisher docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).
