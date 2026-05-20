# Synaptic Sentinel — Kickoff Prompt para Claude Code

> **Cómo usar este archivo:** copia el bloque de abajo (todo lo que está entre las líneas `═══`) y pégalo como tu primer mensaje a Claude Code en VSC, con el documento maestro `Synaptic_Sentinel_v0.4.md` presente en la carpeta del proyecto (`D:\GoLAB\PROYECTOS\SENTINEL`). Ajusta lo que esté entre `[corchetes]` si hace falta.

═══════════════════════════════════════════════════════════════════

Hola Claude. Vamos a iniciar el desarrollo de **Synaptic Sentinel**, un toolkit OSS de auditoría agéntica de seguridad + capa premium LLM, diseñado para auditar código en la era del vibe-coding. Es el tercer producto de la familia Synaptic (sibling de Synaptic Expert).

**Antes de escribir una sola línea de código, hay un protocolo de arranque que quiero que sigas en este orden:**

**PASO 1 — Contexto.**
Lee completo el documento maestro `Synaptic_Sentinel_v0.4.md` que está en la raíz del proyecto (`D:\GoLAB\PROYECTOS\SENTINEL`). Es el resultado de una sesión de planning estratégico y contiene 31 decisiones lockeadas, la arquitectura híbrida completa, el diseño del enjambre, el sistema de reportes, el roadmap a 12 semanas y el go-to-market. NO re-cuestiones las decisiones marcadas como LOCKED 🔒 — están cerradas. Si algo te parece subóptimo, anótalo al final como "observación para Pedro", pero no cambies el rumbo unilateralmente.

**PASO 2 — Discovery técnico.**
Antes de scaffolding, necesito que valides el entorno y me hagas las preguntas técnicas abiertas. Específicamente:

- Verifica versión de Node instalada (necesitamos 20+). Comando: `node --version`
- Verifica si hay pnpm / npm / yarn disponibles y cuál prefiero usar
- Confirma versión de Git y si el repo ya está inicializado
- Pregúntame qué binarios de scanners OSS tengo o quiero instalar localmente para desarrollo (OpenGrep, Gitleaks, Trivy, Checkov) — o si prefieres que los manejemos vía Docker o descarga on-demand
- Decide conmigo la **estructura de monorepo**: el v0.4 sugiere pnpm workspaces como probable preferencia, pero el producto tiene un split OSS público (`synaptic-sentinel`) + Pro privado (`synaptic-sentinel-pro`). Propóname cómo organizar esto físicamente en `D:\GoLAB\PROYECTOS\SENTINEL` (monorepo único con workspaces marcados OSS/Pro, o dos carpetas separadas desde el inicio) y explícame el trade-off antes de decidir.
- Pregúntame si quiero reutilizar componentes concretos de `@synaptic-sre/enforcement` (de Synaptic Expert) y dónde está ese código accesible.

**PASO 3 — Propuesta de scaffolding.**
Una vez resuelto el discovery, NO generes todo el árbol de golpe. Primero muéstrame:

- El árbol de directorios propuesto (puedo cotejarlo con el archivo `Synaptic_Sentinel_Estructura_Repo.md` que también está en la carpeta)
- El `package.json` raíz + configuración de workspaces
- El `tsconfig.json` base
- La configuración de Vitest
- El `.gitignore` (importante: debe incluir `.synaptic-sentinel/colony.db` por defecto, pero documentar que es opcional versionarlo)
- Un esqueleto del schema de `colony.db` (las tablas pheromones, scans, learning_records del v0.4 §3.5)

Espera mi OK antes de proceder a generar el código de los módulos.

**PASO 4 — Primer hito implementable.**
Según el Gantt del v0.4 (§8.2), el primer trabajo es Foundations + el wrapper de OpenGrep. Cuando lleguemos ahí, empezaremos por:
1. El scaffolding aprobado en paso 3
2. La interfaz `ScoutAgent` (v0.4 §3.2) y la primera implementación concreta: el wrapper de OpenGrep
3. Tests con fixtures de vulnerabilidades conocidas en JS/TS y Python

**Invariantes que NO se violan nunca (del v0.4 §9):**
- El código del cliente NUNCA cruza su perímetro. Nada de subir código a un backend externo.
- Wrappear OpenGrep, NO Semgrep.
- Agentes cerebro = prompts especializados invocados por el Coordinator, NO microservicios.
- BYOK desde el día uno vía `vscode.SecretStorage`.
- El producto debe cumplir OWASP Top 10 for Agentic Applications 2026 (eat your own dogfood): Least Agency, anti Memory Poisoning, sandboxing de scout agents, kill-switch para Rogue Agents.

**Estilo de trabajo que espero de ti:**
- TypeScript estricto, tipado fuerte, `zod` para validación de schemas en runtime
- Tests desde el inicio (Vitest), no como afterthought
- Commits atómicos con mensajes claros
- Cuando enfrentes una decisión técnica no cubierta por el v0.4, pregúntame en vez de asumir
- Prioriza los "must-have" del MVP (§8.1) antes que cualquier "should-have"

Empieza por el PASO 1 y el PASO 2. No avances al scaffolding hasta que hayamos cerrado el discovery juntos.

═══════════════════════════════════════════════════════════════════

---

## Notas sobre este prompt (para Pedro, no para pegar)

- **Por qué fuerza el discovery antes del scaffolding:** Claude Code tiende a generar estructura agresivamente. Este prompt lo frena para que valide tu entorno real (Node, package manager, binarios de scanners) antes de asumir. Te ahorra rehacer scaffolding mal calibrado.

- **Por qué deja la estructura de monorepo abierta:** es la única decisión técnica de arquitectura física que el v0.4 dejó explícitamente para discovery. El split OSS/Pro tiene implicaciones reales (cómo publicas el core sin filtrar el Pro) que conviene resolver con el código delante, no en abstracto.

- **El archivo de estructura de repo** (`Synaptic_Sentinel_Estructura_Repo.md`) es un andamio, no un mandato. Si Claude Code propone algo mejor calibrado a tu setup real durante el discovery, deja que gane la propuesta informada.

- **Ajuste sugerido si reutilizas mucho de Synaptic Expert:** si `@synaptic-sre/enforcement` es sustancial y accesible, considera mencionarle a Claude Code la ruta local de ese código en el PASO 2 para que lo lea directamente en vez de describirlo.

- **Sobre los binarios de scanners en Windows:** OpenGrep, Gitleaks y Trivy tienen builds para Windows; Checkov es Python (requiere Python en el PATH). En el discovery, Claude Code debería ayudarte a decidir entre instalación nativa, WSL2, o Docker. Para desarrollo en `D:\GoLAB\PROYECTOS\SENTINEL`, WSL2 o Docker suelen dar menos fricción que binarios nativos sueltos, pero depende de tu setup.
