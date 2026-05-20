# Synaptic Sentinel — Estructura de Repositorio Propuesta

> **Naturaleza de este documento:** andamio mental, NO mandato. Es un punto de partida para que Claude Code lo coteje durante el discovery técnico. Si durante el discovery surge una organización mejor calibrada a tu setup real, esa propuesta informada gana. La decisión final de estructura de monorepo se cierra en el PASO 2 del kickoff.
>
> **Ubicación local:** `D:\GoLAB\PROYECTOS\SENTINEL`
> **Package manager asumido:** pnpm workspaces (validar en discovery)
> **Lenguaje:** TypeScript estricto

---

## Decisión previa: ¿un monorepo o dos repos?

El producto tiene un split OSS público + Pro privado. Hay dos formas de organizarlo físicamente, cada una con trade-offs reales:

### Opción 1 — Monorepo único con workspaces marcados (recomendado para desarrollo)

Todo vive en `D:\GoLAB\PROYECTOS\SENTINEL` durante el desarrollo. Los paquetes OSS y Pro conviven en `packages/`, claramente etiquetados. Al momento de open-sourcing, un proceso de publicación extrae solo los paquetes OSS al repo público `synaptic-sentinel`, dejando los Pro en el privado.

**A favor:** desarrollo fluido para solo founder, refactors cross-package triviales, un solo `pnpm install`, tests integrados. **En contra:** requiere disciplina para no filtrar código Pro al publicar; el proceso de publicación OSS necesita diseñarse con cuidado.

### Opción 2 — Dos repos desde el inicio

`synaptic-sentinel` (público) y `synaptic-sentinel-pro` (privado) como carpetas/repos separados. El Pro consume el core como dependencia (`@synaptic-sentinel/core`).

**A favor:** separación física limpia, cero riesgo de filtración. **En contra:** fricción de desarrollo (publicar el core localmente o usar `pnpm link` para iterar), refactors cross-repo dolorosos, doble setup.

**Recomendación:** Opción 1 para desarrollo (velocidad de solo founder), con un script de publicación OSS bien diseñado. El árbol de abajo refleja esta opción. Confirmar en discovery.

---

## Árbol de directorios propuesto (Opción 1 — monorepo)

```
D:\GoLAB\PROYECTOS\SENTINEL\
│
├── README.md                          # Visión, quickstart, links
├── LICENSE                            # Apache 2.0 (core)
├── LICENSE-PRO                        # EULA comercial (Ley 17.336) para paquetes Pro
├── CONTRIBUTING.md                    # DCO, guía de contribución
├── CODE_OF_CONDUCT.md
├── SECURITY.md                        # Política de disclosure (irónicamente crítica aquí)
├── .gitignore                         # incluye .synaptic-sentinel/colony.db por defecto
├── package.json                       # raíz del workspace
├── pnpm-workspace.yaml                # definición de workspaces
├── tsconfig.base.json                 # config TS compartida
├── vitest.config.ts                   # config de tests raíz
├── turbo.json                         # SI se decide Turborepo (opcional)
│
├── Synaptic_Sentinel_v0.4.md          # documento maestro (referencia viva)
│
├── docs\                              # documentación del producto
│   ├── architecture\                  # diagramas, decisiones (ADRs)
│   │   └── decisions\                 # Architecture Decision Records
│   ├── getting-started.md
│   ├── byok-setup.md                  # cómo configurar la API key
│   ├── compliance-frameworks.md       # qué frameworks se mapean
│   └── scanners.md                    # qué scanner cubre qué
│
├── packages\                          # ───── los workspaces ─────
│   │
│   ├── core\                          # [OSS] @synaptic-sentinel/core
│   │   ├── package.json
│   │   ├── src\
│   │   │   ├── coordinator\           # el orquestador del enjambre
│   │   │   │   ├── pipeline.ts        # stages, paralelismo intra-stage
│   │   │   │   ├── error-handling.ts  # scan degraded vs failed
│   │   │   │   └── scan-modes.ts      # on-save / on-commit / full / continuous
│   │   │   ├── colony\                # la memoria compartida
│   │   │   │   ├── db.ts              # better-sqlite3, WAL mode
│   │   │   │   ├── schema.sql         # pheromones, scans, learning_records
│   │   │   │   ├── pheromones.ts      # CRUD + tipos de feromona
│   │   │   │   └── learning.ts        # learning_records, contradiction detector
│   │   │   ├── types\                 # tipos compartidos + schemas zod
│   │   │   │   ├── finding.ts
│   │   │   │   ├── pheromone.ts
│   │   │   │   └── scan.ts
│   │   │   └── index.ts
│   │   └── tests\
│   │
│   ├── scouts\                        # [OSS] @synaptic-sentinel/scouts
│   │   ├── package.json
│   │   ├── src\
│   │   │   ├── scout-agent.ts         # interfaz ScoutAgent común
│   │   │   ├── normalizer.ts          # output → schema SARIF-like interno
│   │   │   ├── opengrep\              # wrapper OpenGrep (SAST)
│   │   │   │   ├── opengrep-scout.ts
│   │   │   │   └── rules\             # reglas custom adicionales
│   │   │   ├── gitleaks\              # wrapper Gitleaks (secrets)
│   │   │   ├── trivy\                 # wrapper Trivy (SCA + IaC + containers)
│   │   │   └── checkov\               # wrapper Checkov (IaC)
│   │   └── tests\
│   │       └── fixtures\              # vulns conocidas JS/TS + Python
│   │           ├── javascript\
│   │           ├── typescript\
│   │           └── python\
│   │
│   ├── cli\                           # [OSS] @synaptic-sentinel/cli
│   │   ├── package.json
│   │   ├── src\
│   │   │   ├── commands\
│   │   │   │   ├── scan.ts            # synaptic-sentinel scan
│   │   │   │   ├── publish.ts         # synaptic-sentinel publish (tomo)
│   │   │   │   └── init.ts            # synaptic-sentinel init
│   │   │   └── index.ts
│   │   └── tests\
│   │
│   ├── vscode-extension\              # [OSS shell + Pro features] la extensión
│   │   ├── package.json               # manifest de la extensión
│   │   ├── src\
│   │   │   ├── extension.ts           # activate / deactivate
│   │   │   ├── byok\                  # SecretStorage para la API key
│   │   │   ├── ui\
│   │   │   │   ├── diagnostics.ts     # DiagnosticCollection
│   │   │   │   ├── hover-provider.ts  # hover cards
│   │   │   │   ├── code-actions.ts    # apply fix / mark FP / accept risk
│   │   │   │   ├── decorations.ts     # gutter icons por severidad
│   │   │   │   ├── status-bar.ts      # contador + costo LLM
│   │   │   │   └── tomo-tree-view.ts  # explorer del tomo
│   │   │   └── webview\               # panel lateral del tomo vivo
│   │   └── tests\
│   │
│   ├── reporters\                     # [OSS json/sarif + Pro html/pdf]
│   │   ├── package.json
│   │   ├── src\
│   │   │   ├── tomo-model.ts          # modelo de datos único del tomo
│   │   │   ├── json-reporter.ts       # [OSS]
│   │   │   ├── sarif-reporter.ts      # [OSS]
│   │   │   ├── html-reporter.ts       # [Pro] elaborado
│   │   │   ├── pdf-reporter.ts        # [Pro]
│   │   │   └── signing.ts             # SHA-256 (OSS) + ed25519/X.509 (Pro)
│   │   └── tests\
│   │
│   ├── agents\                        # [PRO] @synaptic-sentinel/agents
│   │   ├── package.json               # LICENSE-PRO
│   │   ├── src\
│   │   │   ├── brain-agent.ts         # interfaz BrainAgent<TInput,TOutput>
│   │   │   ├── llm-client.ts          # SDK Anthropic + BYOK + rate limiting
│   │   │   ├── triage\                # Triage Agent
│   │   │   │   ├── triage-agent.ts
│   │   │   │   └── prompts\           # prompts JS/TS + Python
│   │   │   ├── context\               # Context Agent
│   │   │   ├── cross-flow\            # Cross-flow Agent
│   │   │   ├── vibe-detect\           # Vibe-Detect Agent
│   │   │   │   ├── vibe-agent.ts
│   │   │   │   └── patterns\          # ~15-20 patrones AI-generated
│   │   │   ├── remediation\           # Remediation Agent
│   │   │   ├── compliance\            # Compliance Mapper
│   │   │   │   └── mappings\          # OWASP, NIST, ISO, Ley 21.663, ASI 2026
│   │   │   └── synthesis\             # Synthesis Agent (tomo narrativo)
│   │   └── tests\
│   │
│   └── shared\                        # [OSS] utilidades comunes
│       ├── package.json
│       └── src\
│           ├── git.ts                 # simple-git wrappers
│           ├── paths.ts               # normalización cross-platform
│           └── logging.ts
│
├── apps\                              # ───── aplicaciones desplegables ─────
│   └── dashboard\                     # [PRO, FASE 2] dashboard web
│       ├── package.json               # Next.js + Supabase (candidato)
│       └── ... (fase 2, no MVP)
│
├── scripts\                           # tooling de desarrollo y release
│   ├── publish-oss.ts                 # extrae paquetes OSS al repo público
│   ├── install-scanners.ts            # instala/verifica binarios de scanners
│   └── benchmark-fp.ts                # mide FP-reduction vs baseline OpenGrep
│
└── .github\                           # (o equivalente) CI/CD
    └── workflows\
        ├── ci.yml                     # lint + test + typecheck
        └── release.yml                # build + publish
```

---

## Mapa de qué es OSS y qué es Pro

| Paquete | Licencia | Notas |
|---------|----------|-------|
| `core` | Apache 2.0 | Coordinator, colony.db, tipos |
| `scouts` | Apache 2.0 | Wrappers de scanners OSS |
| `cli` | Apache 2.0 | Comandos básicos |
| `shared` | Apache 2.0 | Utilidades |
| `reporters` | **Mixto** | json/sarif OSS · html/pdf/signing Pro |
| `vscode-extension` | **Mixto** | Shell OSS · features avanzadas Pro vía feature-flags |
| `agents` | **Pro (EULA)** | Todo el brain layer |
| `apps/dashboard` | **Pro (EULA)** | Fase 2 |

**Nota sobre paquetes mixtos:** `reporters` y `vscode-extension` tienen partes OSS y Pro. El patrón recomendado es separar las features Pro detrás de feature-flags y/o módulos que solo se incluyen en el build privado. Diseñar esto con cuidado en discovery — es el punto donde más fácil se filtra IP al publicar.

---

## Convenciones que el árbol asume

1. **Workspaces internos se referencian con `workspace:*`** en pnpm. Ejemplo: `agents` depende de `core` vía `"@synaptic-sentinel/core": "workspace:*"`.

2. **Cada paquete tiene su propio `tsconfig.json`** que extiende `tsconfig.base.json` de la raíz.

3. **Tests viven junto a su paquete** (`packages/<pkg>/tests/`), no en un directorio de tests global. Vitest los descubre vía el config raíz.

4. **Las fixtures de vulnerabilidades** (`scouts/tests/fixtures/`) son entregable explícito del MVP — código deliberadamente vulnerable en JS/TS y Python para validar detección y medir FP-reduction. Tratar como ciudadanos de primera clase, no como afterthought.

5. **`colony.db` vive en el proyecto DEL CLIENTE**, no en este repo. Aquí solo está el `schema.sql` que la crea. En `.gitignore` por defecto, con documentación de cómo versionarla opcionalmente.

6. **`.synaptic-sentinel/`** es el directorio que la extensión crea en el proyecto del cliente (config + colony.db + tomos publicados). NO confundir con la estructura de ESTE repo.

---

## Lo que NO está en el árbol (a propósito)

- **Detalles de implementación de cada `.ts`** — eso lo construye Claude Code durante implementación, no es decisión de estructura.
- **`node_modules`, `dist`, `.turbo`** — artefactos de build, van en `.gitignore`.
- **Configuración de scanners individuales** — se resuelve cuando se implemente cada wrapper.
- **El árbol del repo Pro separado** — solo aplica si en discovery se elige la Opción 2 (dos repos).

---

## Primer comando de arranque sugerido (tras aprobar estructura)

En `D:\GoLAB\PROYECTOS\SENTINEL`, una vez Claude Code y tú cierren el discovery:

```powershell
# desde D:\GoLAB\PROYECTOS\SENTINEL
git init
pnpm init
# ... Claude Code genera package.json raíz, pnpm-workspace.yaml, tsconfig.base.json
pnpm install
# primer paquete a implementar: scouts/opengrep + sus fixtures
```

(Comandos exactos los confirma Claude Code según el package manager y estructura que cierren en el discovery.)
