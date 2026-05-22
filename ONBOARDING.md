# Onboarding — Synaptic Sentinel

Guía para instalar, usar y desarrollar Synaptic Sentinel.

## 1. Qué es

Synaptic Sentinel es un toolkit de **auditoría agéntica de seguridad** pensado
para la era del código generado por IA (_vibe-coding_). Combina:

- una **capa Scout** determinista (OSS): wrappers de escáneres de seguridad que
  corren como procesos locales y normalizan sus hallazgos a un formato común;
- una **capa Cerebro** premium (Pro): agentes LLM que trían, contextualizan y
  proponen remediación de los hallazgos — **BYOK** (Bring Your Own Key).

Es **VSCode-primary**: la superficie principal es la extensión, respaldada por
una CLI.

**Invariante de privacidad:** el código del cliente nunca cruza su perímetro.
Los escáneres corren localmente; las únicas llamadas salientes son las del Brain
Layer, directas a la API de Anthropic con tu propia API key — sin backend de
Synaptic en el medio.

## 2. Requisitos

- **Node.js ≥ 20** (probado con v24).
- **pnpm ≥ 10** (`npm install -g pnpm`).
- **git**.
- Para el Brain Layer (opcional): una **API key de Anthropic** (BYOK).

## 3. Instalación

```bash
pnpm install              # dependencias del monorepo
pnpm scanners:install     # descarga los binarios de los escáneres OSS
pnpm build                # compila los 7 paquetes + bundle de la extensión
```

`pnpm scanners:install` descarga OpenGrep, Gitleaks, Trivy y Checkov a
`.scanners/`, verificando el checksum SHA-256 de cada binario. El quinto scout,
Vibe-Detect, es nativo (TypeScript) y no necesita binario.

> Si estás detrás de un proxy con inspección TLS o un antivirus que intercepta
> HTTPS, el script `scanners:install` ya corre con `--use-system-ca`. Ver §9.

## 4. La CLI

Tras `pnpm build`, la CLI vive en `packages/cli/dist/index.js`:

```bash
node packages/cli/dist/index.js --help
```

(El paquete declara también un bin `synaptic-sentinel`, para cuando se instale
o empaquete.)

### Escanear un proyecto

```bash
node packages/cli/dist/index.js scan --path /ruta/al/proyecto
```

Corre los 5 scouts, deduplica e imprime los hallazgos, y los persiste en
`.synaptic-sentinel/colony.db` dentro del proyecto escaneado.

Exportar el **tomo** (el informe de auditoría) en JSON y/o HTML:

```bash
node packages/cli/dist/index.js scan --path /ruta --export informe.json --export-html informe.html
```

### Marcar un falso positivo

```bash
node packages/cli/dist/index.js mark-fp --path /ruta --fingerprint "<fingerprint>" --reason "motivo"
```

El hallazgo marcado se suprime en escaneos futuros.

### Triage con el Brain Layer (BYOK)

```bash
export ANTHROPIC_API_KEY="sk-ant-..."     # PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."
node packages/cli/dist/index.js triage --path /ruta --limit 10
```

Corre el Brain Layer sobre los hallazgos del último escaneo: el Triage Agent
clasifica cada uno (verdadero positivo / falso positivo / inconcluso) y, sobre
los verdaderos positivos, el Context Agent explica la cadena de explotabilidad y
el Remediation Agent propone cómo corregirlos.

El `triage` hace una llamada LLM por hallazgo (clasificación) y, en los
verdaderos positivos, dos más (contexto y remediación). `--limit` acota cuántos
hallazgos se procesan — por defecto 25. Tras un `triage`, vuelve a correr
`scan --export-html` para que el tomo incluya el enriquecimiento del Brain Layer.

## 5. La extensión VSCode

Hoy se ejecuta en **modo desarrollo** (aún no se publica como `.vsix`):

1. Abre la carpeta del repo en VSCode.
2. `pnpm build` (genera el bundle de la extensión y la CLI).
3. Pulsa **F5** → se abre una segunda ventana, el _Extension Development Host_.
4. En esa ventana, abre el proyecto que quieras auditar.
5. Paleta de comandos (`Ctrl+Shift+P`):
   - **Synaptic Sentinel: Scan Workspace** — escanea y pinta los hallazgos inline.
   - **Synaptic Sentinel: Triage Findings (Brain Layer)** — corre el Brain Layer.
   - **Synaptic Sentinel: Set Anthropic API Key (BYOK)** — guarda la API key.

Sobre cada hallazgo:

- el **hover** muestra el detalle del Brain Layer (triage, contexto, remediación);
- las **Code Actions** (bombilla) ofrecen "marcar como falso positivo" y
  "copiar remediación sugerida".

La API key se guarda cifrada en el almacén de secretos del sistema operativo
(`vscode.SecretStorage`) — nunca en texto plano ni en la configuración.

## 6. El tomo

El **tomo** es el artefacto de auditoría: el resultado de un escaneo (más el
enriquecimiento del Brain Layer si se corrió `triage`), exportable en JSON y
HTML. Lleva una firma de integridad SHA-256 sobre su contenido canónico, como
evidencia de no-manipulación.

## 7. Arquitectura en breve

Monorepo pnpm con 7 paquetes:

| Paquete            | Rol                                     | Licencia |
| ------------------ | --------------------------------------- | -------- |
| `shared`           | utilidades comunes                      | OSS      |
| `core`             | tipos (zod), `Coordinator`, `colony.db` | OSS      |
| `scouts`           | los 5 scouts deterministas              | OSS      |
| `reporters`        | modelo del tomo + export JSON/HTML      | OSS      |
| `cli`              | la CLI `synaptic-sentinel`              | OSS      |
| `vscode-extension` | la extensión                            | OSS      |
| `agents`           | Brain Layer (agentes LLM)               | **Pro**  |

Flujo: los **scouts** producen `Finding[]` → el **Coordinator** los deduplica y
persiste en `colony.db` → los **reporters** arman el tomo → los **agents** (Pro)
enriquecen los hallazgos con triage / contexto / remediación.

Los 5 scouts: OpenGrep (SAST), Gitleaks (Secrets), Trivy (SCA), Checkov (IaC) y
Vibe-Detect (anti-patrones de código generado por IA — nativo, sin binario).

Más detalle en [.synaptic/DESIGN_DOC.md](.synaptic/DESIGN_DOC.md) y
[docs/colony-db.md](docs/colony-db.md).

## 8. Desarrollo

```bash
pnpm build              # compila todo (tsc -b + bundle de la extensión)
pnpm test               # suite Vitest completa (unit + integración)
pnpm test:unit          # solo tests unitarios (rápidos, sin binarios)
pnpm test:integration   # solo tests de integración (binarios reales)
pnpm lint               # ESLint
pnpm typecheck          # chequeo de tipos
pnpm format             # Prettier
pnpm verify             # gate por ciclo: format:check + lint + build + test:unit
```

La suite Vitest se divide en dos proyectos: **`unit`** (lógica pura, rápida) e
**`integration`** (ejecutan los binarios reales de los escáneres y la CLI
construida; lentos). El gate por ciclo (`pnpm verify`) corre solo `test:unit`;
`test:integration` se invoca explícitamente antes de un commit de feature y de
un release. Los tests de integración se identifican por el sufijo
`*integration.test.ts`. Los tests del Brain Layer contra la API real están
_gated_ por `ANTHROPIC_API_KEY` (se omiten si la variable no está presente).

## 9. Troubleshooting

- **`UNABLE_TO_VERIFY_LEAF_SIGNATURE` al instalar** — un proxy o antivirus
  intercepta TLS. `pnpm scanners:install` ya agrega `--use-system-ca`; para
  `pnpm install`, exporta `NODE_OPTIONS=--use-system-ca` antes de correrlo.
- **`triage` falla con "falta ANTHROPIC_API_KEY"** — exporta la variable de
  entorno con tu API key de Anthropic (BYOK).
- **La extensión no aparece al pulsar F5** — corre `pnpm build` primero: la
  extensión necesita su bundle (`dist/extension.cjs`) y la CLI compilada.
- **Un scanner no corre** — verifica que `pnpm scanners:install` haya terminado
  y que `.scanners/` contenga los binarios. Vibe-Detect corre siempre (es nativo).
