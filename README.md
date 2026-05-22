# Synaptic Sentinel

> Toolkit OSS de auditoría agéntica de seguridad + capa premium de inteligencia LLM, diseñado nativamente para la era del _vibe-coding_.

**Synaptic Sentinel** audita la seguridad de un proyecto **dentro del perímetro del cliente** — el código nunca sale del entorno del cliente — y produce hallazgos inline para el desarrollador y un _tomo_ de auditoría (evidence package) para compliance.

Tercer producto de la familia Synaptic, sibling de Synaptic Expert.

## Estado

🚧 **En desarrollo activo (pre-1.0).** Operativos: la capa Scout (5 escáneres), el Coordinator, los reporters (tomo JSON/HTML), la CLI y la extensión VSCode; la capa Cerebro (Pro) con 3 agentes. Monorepo privado hasta el MVP; el núcleo OSS (Apache-2.0) y la capa Pro se lanzan simultáneamente.

## Cómo funciona

- **Capa Scout (OSS, determinista)** — 5 escáneres que corren como procesos locales y normalizan sus hallazgos: OpenGrep (SAST), Gitleaks (secrets), Trivy (SCA), Checkov (IaC) y Vibe-Detect (anti-patrones de código generado por IA).
- **Coordinator** — orquesta los scouts, deduplica los hallazgos y los persiste en `colony.db`.
- **Capa Cerebro (Pro, LLM)** — agentes que trían, contextualizan y proponen remediación de los hallazgos, con **BYOK** (la API key del cliente va directo a Anthropic).
- **Superficies** — una CLI y una extensión VSCode (la superficie primaria).

## Estructura del monorepo

| Paquete                     | Licencia   | Descripción                                              |
| --------------------------- | ---------- | -------------------------------------------------------- |
| `packages/shared`           | Apache-2.0 | Utilidades comunes                                       |
| `packages/core`             | Apache-2.0 | Coordinator, `colony.db`, tipos (zod)                    |
| `packages/scouts`           | Apache-2.0 | Contrato `ScoutAgent` + los 5 scouts                     |
| `packages/reporters`        | Apache-2.0 | Modelo del tomo + export JSON/HTML                       |
| `packages/cli`              | Apache-2.0 | CLI `synaptic-sentinel`                                  |
| `packages/vscode-extension` | Apache-2.0 | Extensión VSCode (shell delgado, arquitectura spawn-CLI) |
| `packages/agents`           | Pro (EULA) | Capa Cerebro — agentes LLM                               |

## Requisitos

- Node.js ≥ 20
- pnpm ≥ 10

## Quickstart

```bash
pnpm install              # instala dependencias y enlaza los workspaces
pnpm scanners:install     # descarga los binarios de los escáneres OSS
pnpm build                # compila los paquetes + bundle de la extensión
node packages/cli/dist/index.js scan --path /ruta/a/tu/proyecto
```

**Guía completa de instalación y uso: [ONBOARDING.md](ONBOARDING.md).**

## Desarrollo

```bash
pnpm build       # tsc -b (project references) + bundle de la extensión
pnpm test        # suite Vitest completa (unit + integración)
pnpm test:unit   # solo tests unitarios (rápidos)
pnpm lint        # ESLint (flat config + typescript-eslint)
pnpm typecheck   # chequeo de tipos
pnpm format      # Prettier
pnpm verify      # gate por ciclo: format:check + lint + build + test:unit
```

## Documentación

- [ONBOARDING.md](ONBOARDING.md) — instalación, uso de la CLI y la extensión
- [docs/colony-db.md](docs/colony-db.md) — la base de datos de feromonas
- [.synaptic/DESIGN_DOC.md](.synaptic/DESIGN_DOC.md) — diseño y decisiones
- `context/Synaptic_Sentinel_v0.4.md` — documento maestro de diseño

## Licencia

Núcleo OSS bajo **Apache 2.0** ([LICENSE](LICENSE)). Componentes Pro (el paquete `agents`) bajo EULA comercial ([LICENSE-PRO](LICENSE-PRO)).

© 2026 GoLab SpA.
