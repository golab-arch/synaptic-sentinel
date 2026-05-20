# Synaptic Sentinel

> Toolkit OSS de auditoría agéntica de seguridad + capa premium de inteligencia LLM, diseñado nativamente para la era del *vibe-coding*.

**Synaptic Sentinel** corre como un enjambre de agentes coordinados **dentro del perímetro del cliente** — el código nunca sale del entorno del cliente — y produce en paralelo findings inline para el desarrollador y un *evidence package* audit-grade para compliance.

Tercer producto de la familia Synaptic, sibling de Synaptic Expert.

## Estado

🚧 **En desarrollo — Foundations.** Monorepo privado hasta el MVP; el núcleo OSS (Apache 2.0) y la capa Pro se lanzan simultáneamente.

## Estructura del monorepo

| Paquete | Licencia | Descripción |
|---|---|---|
| `packages/shared` | Apache-2.0 | Utilidades comunes (paths, logging, git) |
| `packages/core` | Apache-2.0 | Coordinator del enjambre, colony DB, tipos |
| `packages/scouts` | Apache-2.0 | Interfaz `ScoutAgent` + wrappers de scanners OSS |
| `packages/cli` | Apache-2.0 | CLI (`synaptic-sentinel`) |
| `packages/reporters` | Mixto | JSON/SARIF (OSS) · HTML/PDF (Pro) |
| `packages/vscode-extension` | Mixto | Extensión VSCode (shell OSS · features Pro) |
| `packages/agents` | Pro (EULA) | Capa Cerebro — agentes LLM |

## Requisitos

- Node.js ≥ 20
- pnpm ≥ 10

## Quickstart (desarrollo)

```bash
pnpm install     # instala dependencias y enlaza los workspaces
pnpm build       # compila todos los paquetes (tsc -b, project references)
pnpm test        # corre la suite Vitest
pnpm lint        # ESLint (flat config + typescript-eslint)
pnpm format      # Prettier
```

## Documentación

- [docs/colony-db.md](docs/colony-db.md) — la base de datos de feromonas
- `context/Synaptic_Sentinel_v0.4.md` — documento maestro de diseño

## Licencia

Núcleo OSS bajo **Apache 2.0** ([LICENSE](LICENSE)). Componentes Pro bajo EULA comercial ([LICENSE-PRO](LICENSE-PRO)).

© 2026 GoLab SpA.
