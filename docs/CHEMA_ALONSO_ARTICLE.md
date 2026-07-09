# SYNAPTIC Sentinel: haciendo visible la varianza cross-provider del triaje LLM en seguridad de código

> **Nota para el editor**: artículo escrito para el blog **"El lado del mal"** de Chema Alonso. Extensión: ~2800 palabras (aprox. 5-6 páginas). Estilo pensado para audiencia técnica hispana con apreciación por _empirical evidence_ y _honest tradeoffs_. Chema tiene la última palabra sobre estructura, tono y ediciones — este texto se entrega como borrador editorializable.

---

Hace unas semanas, mientras terminaba de auditar un proyecto Fastify que un compañero había desarrollado en gran parte con ayuda de un LLM, me pasó algo que no me había ocurrido antes: **el mismo hallazgo de seguridad me apareció como "verdadero positivo" un día, "inconcluyente" otro, y "falso positivo" al tercero — usando exactamente el mismo código y el mismo escáner**. Lo único que había cambiado era el proveedor LLM que estaba haciendo el triaje.

No es que uno de los proveedores estuviera "mal". Ninguno mentía. Simplemente veían el mismo problema desde ángulos ligeramente distintos, y esa diferencia se comía la confianza en el sistema. Empecé a preguntarme cuántas veces yo mismo había desestimado un finding real porque el LLM me había dado una respuesta rotunda un día — sin recordar que el día anterior, con otro proveedor, la respuesta había sido la contraria.

Este artículo va de **SYNAPTIC Sentinel**, una extensión open-source (Apache-2.0) que llevo publicando en el marketplace de VS Code, y que en su versión **v0.3.22** decidió hacer una cosa que muchas otras herramientas evitan: **mostrar esa varianza en lugar de esconderla**.

Sin embargo, antes de contar qué hace, prefiero dejar claros los defectos — porque si algo he aprendido en 20 años tocando esto es que la gente que respeta la seguridad respeta también a quien no le vende humo.

---

## El problema real: el ruido de los escáneres + la confianza rota del triaje LLM

Cualquiera que haya montado un pipeline de seguridad medianamente serio conoce la ecuación:

**Escáner determinista** (OpenGrep, Semgrep, Trivy, Checkov, Gitleaks) → 500 findings por scan → **triaje humano** → 480 falsos positivos y 20 hallazgos reales que nadie termina de mirar por fatiga.

En los últimos dos años, la industria decidió que la respuesta era meter un LLM entre el escáner y el humano: que el modelo pre-clasifique, marque lo obvio, y deje al analista solo lo interesante. Herramientas como Snyk, GitHub Advanced Security con Copilot Autofix, y varias startups han apostado por ese flujo.

Y funciona. Pero introduce un problema nuevo que casi nadie está afrontando de frente: **el triaje LLM no es reproducible cross-provider**.

Cambias de Anthropic Claude a DeepSeek. O de GPT-4 a Gemini. O de v4-flash a v4-pro dentro del mismo proveedor. Y el mismo finding — mismo código, mismo lockfile, misma línea — te da un veredicto distinto. A veces sutilmente (confianza 85% frente a 70%). A veces radicalmente (verdadero positivo frente a falso positivo).

Peor: si tu herramienta solo te muestra "el último veredicto", tú nunca ves que ha habido drift. Tu confianza en el sistema se erosiona sin que sepas exactamente por qué. Un día apruebas un PR porque el triaje dijo "FP", y semanas después alguien te enseña que ese mismo finding con otro proveedor sale "TP". La reacción humana natural es dejar de confiar en el triaje LLM y volver a mirarlo todo manualmente. Lo cual mata la propuesta de valor de la herramienta.

**SYNAPTIC Sentinel v0.3.22 se posiciona sobre este problema**: en lugar de esconder la varianza, la hace visible. Y como efecto secundario cambia lo que significa "confiar" en un triaje automático.

---

## Qué es SYNAPTIC Sentinel

Es una extensión de VS Code, licencia Apache-2.0 sin _gating_ premium, orientada a lo que yo (y otros) llamamos ya "vibe-coding": el código escrito con ayuda intensiva de un LLM, en flujos donde el desarrollador acepta bloques que el modelo genera, ajusta, y ship-ea sin revisar cada línea con lupa. Ese código tiene un perfil de vulnerabilidad distinto del código escrito 100% a mano — más patrones anti-idiomáticos, más `eval` cuando no toca, más SQL construido por concatenación, más secretos accidentalmente en el commit inicial porque el LLM sugirió una constante de ejemplo.

Sentinel tiene dos capas:

**Capa 1 — Scout Layer**: cinco escáneres deterministas corriendo en paralelo.

- **OpenGrep** (SAST) — 17 reglas curadas cubriendo CWE-22, 78, 79, 89, 95, 327, 502. Modo _taint_ que sigue `request.*` → sink peligroso en JS/TS y Python.
- **Gitleaks** (secretos) — credenciales checkeadas por accidente, redactadas por defecto.
- **Trivy** (SCA) — dependencias vulnerables, CVE database, con _fixed-in_.
- **Checkov** (IaC) — misconfiguraciones en Dockerfiles, Terraform, Kubernetes.
- **Vibe-Detect** (nativo) — seis detectores heurísticos para anti-patrones específicos de código generado por IA. Corre offline.

Los binarios se descargan bajo demanda desde las _releases_ oficiales de cada proyecto con verificación SHA-256. Nada de Docker. Nada de Python obligatorio en el cliente.

**Capa 2 — Brain Layer**: tres agentes LLM cableados sobre los findings.

- **Triage Agent** — decide TP / FP / inconcluyente con puntuación de confianza y racional.
- **Context Agent** — para los TP confirmados, explica la cadena de explotabilidad: `entry → propagación → sink → exposición`.
- **Remediation Agent** — propone un fix concreto con snippet de código.

Aquí viene el detalle que nos importa: **cada agente puede usar un proveedor distinto**. Puedes correr Triage en DeepSeek v4-flash (barato), Context en Anthropic Haiku (calidad), Remediation en Ollama local (gratis y privado). O uno solo para todo. Mix-and-match según coste / calidad / privacidad. **BYOK** puro — tu API key nunca sale de tu máquina y nunca aparece en argumentos de línea de comandos.

Todo bajo Apache-2.0. Sin _premium tier_. Sin _gating_ propietario. Si necesitas auditar el código, está en GitHub.

---

## La joya de v0.3.22: "trust cross-session"

Aquí es donde nos ponemos interesantes. Ese problema que abría el artículo — que el mismo finding cambia de veredicto según el proveedor — es exactamente lo que la FASE III del roadmap se propuso atacar. Tres _Decision Gates_ empíricamente validadas (DG-130 A, DG-131 A, DG-132 A) entregan cuatro _features_ que trabajan juntas:

### 1. Sección "Previously (N prior verdicts)"

Cada finding en el sidebar tiene ahora una sección colapsable con **todo el historial de triaje** para ese _fingerprint_. Fecha + hora, proveedor LLM que hizo el triaje ("colony-memory" si vino de caché de patrones aprendidos, o el label real del proveedor), y el racional completo.

Cambias de proveedor, re-triageas, vuelves una semana después: la trayectoria completa está a un click de distancia. Nada se sobrescribe. La tabla `verdict_history` en `colony.db` es _append-only_ por diseño, con un invariante crítico: el comando de re-triage NO la toca. Esto está verificado por un test dedicado y empíricamente en producción.

### 2. Banner "⚠ Verdict changed since last scan"

Cuando el veredicto actual difiere del anterior, la _card_ del finding muestra un banner con una **heurística de razón**:

- `Different provider (deepseek/v4-flash → anthropic/haiku-4-5) — cross-provider agreement is not guaranteed.`
- `Verdict reclassified — likely new context signals available.`
- `Confidence changed significantly (Δ 0.30).`

La precedencia de razón es _provider > class > confidence-delta_ (threshold configurable, por defecto 0.15). No es magia; es un heurístico honesto que le dice al usuario **por qué debe volver a mirar este finding**. Empíricamente validado en cinco casos reales en una única ronda de re-triage en nuestro workspace de test.

### 3. Agrupación cross-finding (R20) con propagación

Cuando N ≥ 2 findings comparten la misma regla + paquete + versión (típico en SCA: la misma CVE aparece dos veces si el paquete está en dos `package-lock.json` distintos, uno por proyecto en un monorepo), **solo el representante del grupo paga el coste de tokens LLM**. Los miembros heredan el veredicto con una rebaja del 0.9× en la confianza (honestidad epistémica: alta confianza en el grupo, media en cada miembro individualmente).

En el sidebar aparecen dos badges de color púrpura: **GROUPED REP** (representante) y **GROUPED** (miembro), con un sufijo en el racional del tipo `[group SCA:pkg@ver:CVE, member N of M]`.

**Impacto empírico real**: en nuestro workspace de test SYNAPTIC*SAAS (44 findings, muchos SCA duplicados entre `package-lock.json` raíz y `packages/web/package-lock.json`), la agrupación ahorró **12 llamadas LLM en un solo re-triage**. Los 44 findings se resolvieron con 8 llamadas LLM + 24 pre-clasificaciones de \_colony memory* + 12 propagaciones. Reducción del 20% en coste sobre esa carga concreta.

Escape hatch por si quieres autonomía por-finding: `synaptic-sentinel triage --no-group`.

### 4. Línea diff-aware con desglose por razón

Tanto la terminal como la _summary card_ del sidebar emiten ahora:

```text
Scan diff vs previous triage: 1 new · 9 re-classified (0 class, 9 confidence, 0 provider) · 34 unchanged
```

Cada reclasificado se cuenta en su bucket. El _gap_ empírico anterior (findings con delta de confianza ≥ threshold contando como "unchanged" a pesar del banner) queda cerrado.

Y para pipelines de CI/CD:

```bash
synaptic-sentinel diff --json
```

Devuelve JSON estructurado listo para alimentar dashboards, filtrar en shell, o gatear PRs. Y en el comando de _triage_:

```bash
synaptic-sentinel triage \
  --fail-on-new-tp-critical 0 \
  --fail-on-new-tp-high 3
```

Exit code 1 si el número de _nuevos_ verdaderos positivos (primera vez triageados con TP, o reclasificados _a_ TP desde otra clasificación) a esa severidad supera el _threshold_. Tolerancia cero para _critical_, hasta tres _high_ por PR. La granularidad la marcas tú.

---

## La evidencia empírica que hicimos pública

Prefiero enseñar antes de contar. Este es el ejemplo real de la trayectoria de un finding específico (`fast-xml-parser CVE-2026-41650`, DoS por XML injection en escapado de comentarios y CDATA) a lo largo de cinco scans y dos proveedores en nuestro workspace de test:

| Scan | Proveedor         | Veredicto     | Confianza             |
| ---- | ----------------- | ------------- | --------------------- |
| 1º   | deepseek/v4-flash | Inconcluyente | 0.50                  |
| 2º   | deepseek/v4-flash | Inconcluyente | 1.00                  |
| 3º   | deepseek/v4-flash | Inconcluyente | 0.90                  |
| 4º   | deepseek/v4-pro   | Inconcluyente | 1.00                  |
| 5º   | deepseek/v4-pro   | Inconcluyente | 0.00 (JsonParseError) |

Mismo código. Mismo lockfile. La confianza oscila entre 0.00 y 1.00 según el proveedor y el momento. Y ojo con el quinto scan: `JsonParseError` significa que el proveedor devolvió texto sin JSON válido (típicamente un _refusal_ por política de contenido — el LLM entra en modo "no puedo ayudar con esto"), y Sentinel lo degrada a INC 0.00 en lugar de dejar el finding sin veredicto. Comportamiento intencionado, documentado, no roto.

Antes de v0.3.22, esa oscilación quedaba invisible. El sidebar mostraba _el último veredicto_ y punto. Después de v0.3.22, la sección **Previously** enseña la trayectoria entera, el **banner** explica el porqué del cambio, y la **línea diff** cuenta correctamente cada reclasificación.

Puedes decir que esto no vende. Yo digo que es lo primero que le pediría a una herramienta de seguridad seria en 2026: **no me escondas la varianza, ayúdame a razonar sobre ella**.

---

## Demostración rápida (paso a paso)

Para el lector que quiera probar sin fricción:

1. **Instala la extensión** desde el [Marketplace](https://marketplace.visualstudio.com/items?itemName=RealGoLab.synaptic-sentinel) o descarga el `.vsix` de la [Release v0.3.22](https://github.com/golab-arch/synaptic-sentinel/releases/tag/v0.3.22).

2. **Command Palette → "SYNAPTIC Sentinel: Install Scanners"** — descarga y verifica los cinco binarios de escáneres al caché por-usuario (`~/.synaptic-sentinel/scanners`). Una vez.

3. **Configura al menos un proveedor LLM** con tu API key. Command Palette → "SYNAPTIC Sentinel: Configure Brain Layer Providers", o edita `.sentinel/agents.yaml` directamente. Ejemplo mínimo (usando DeepSeek v4-flash para todo):

   ```yaml
   agents:
     triage:
       provider: openai-compatible
       baseUrl: https://api.deepseek.com/v1
       model: deepseek-v4-flash
     context:
       provider: openai-compatible
       baseUrl: https://api.deepseek.com/v1
       model: deepseek-v4-flash
     remediation:
       provider: openai-compatible
       baseUrl: https://api.deepseek.com/v1
       model: deepseek-v4-flash
   ```

   La API key se lee desde `SENTINEL_DEEPSEEK_API_KEY` (o `SENTINEL_<PROVIDER>_API_KEY` para cualquier proveedor). Nunca en la línea de comandos.

4. **Command Palette → "SYNAPTIC Sentinel: Scan Workspace"**. Los findings aparecen como diagnósticos inline, en el panel _Problems_, y en el _living tome_ del sidebar.

5. **Command Palette → "SYNAPTIC Sentinel: Triage Findings (Brain Layer)"**. Los tres agentes procesan los findings. El sidebar refresca.

6. **Cambia de proveedor** en `agents.yaml` — a Anthropic Haiku, a Groq, a lo que quieras — y ejecuta **"Re-triage all"** desde el sidebar. Aquí es donde ves aparecer el banner ⚠ y la sección Previously con la trayectoria completa. Es probablemente el mejor demo de _por qué_ FASE III existe.

Al final de cada sesión de triaje verás también un bloque de _cost visibility_ que te dice, proveedor por proveedor y agente por agente, cuántas llamadas has hecho, tokens de entrada, tokens de salida, coste USD estimado y latencia media. Sabes exactamente qué te cuesta cada _scan_ antes de que llegue la factura del proveedor.

---

## Compromisos honestos (defectos que no te voy a esconder)

Si has llegado hasta aquí es porque probablemente prefieres saber dónde falla la herramienta antes de descubrirlo tú a las malas. Éstos son los _tradeoffs_ conscientes de v0.3.22 — están en las _release notes_ palabra por palabra, no los saco de la manga:

- **No hay filtro interactivo de _chips_ en el sidebar todavía**. Si tienes 40 findings y solo te importan los reclasificados, tienes que hacer scroll o usar `synaptic-sentinel diff --json` para filtrar programáticamente. Está diferido a Sub-A2 v2 (DG-132.0.1 reactivo). Lo empujaré cuando emerja fricción real.
- **El representante del grupo se elige por orden de aparición**. No por severidad más alta ni por _reachability_. Trade-off aceptable para v1.
- **La clave de agrupación usa el `ruleId` literal**. Dos CVEs distintas del mismo paquete NO se agrupan. Postura más cautelosa; aceptable v1.
- **Context + Remediation solo se ejecutan para el representante del grupo**. Los miembros heredan el _triage verdict_ pero no tienen _context_ ni _remediation_ propios. El badge GROUPED es la señal al usuario de que la semántica vive en el representante.
- **El factor de _downgrade_ 0.9× es opinionado**. Coincide con el objetivo de diseño: alta confianza en el grupo, media en cada miembro individualmente.
- **El coste varía significativamente entre proveedores**. En nuestro _workspace_ de test, DeepSeek v4-pro costó 4× más que v4-flash sobre la misma carga; v4-pro además produjo tres `JsonParseError` frente a cero para v4-flash. BYOK preserva tu elección.
- **La FASE III necesitó cinco actualizaciones de VSIX** (una funcional, dos hotfixes en cascada — uno de ellos placebo — y dos correctas). Fatiga de instalación real. La lección institucional que ya no olvidamos: **empirical inspection FIRST, speculative fix NEVER**.
- **N=1 empírico por _baseline_**. Cinco _baselines_ en un único _workspace_ es evidencia sólida, no concluyente.

---

## Roadmap y comunidad

FASE III cerró con las tres _Decision Gates_ validadas. FASE IV empieza con candidatos priorizados por ROI empírico:

1. Filtro interactivo de _chips_ en el sidebar (R25 — completa la promesa de Sub-A2 v2 diferida).
2. Mejores mensajes de validación de `agents.yaml` — porque el bug de configuración más frecuente que hemos visto es alguien poniendo `provider: Anthropic` con `model: deepseek-v4-flash`, y el resultado son 46 llamadas 404 silenciosas por _scan_.
3. Export SBOM SPDX/CycloneDX para _compliance_ (Executive Order 14028, EU CRA).

El código completo está en [github.com/golab-arch/synaptic-sentinel](https://github.com/golab-arch/synaptic-sentinel). Apache-2.0. Sin premium. Sin gating. Sin telemetría enviada a nosotros. Los _issues_, PRs, y comentarios se leen todos.

Si te interesa el problema del _trust cross-session_ en herramientas de seguridad — y creo que en 2026 nos va a interesar cada vez más — pruébala. Y si encuentras algo mal, abre un _issue_. Los que hemos vivido varias generaciones de herramientas de seguridad OSS sabemos que la comunidad es el diferenciador real.

Nos vemos en el próximo _scan_.

---

**Sobre el autor**: [BREVE BIO DEL AUTOR — a completar por el user con su nombre real / rol / experiencia + link MyPublicInbox una vez creado el perfil].

**Contacto**: MyPublicInbox — [pendiente URL una vez creado perfil público].

**Instalación de SYNAPTIC Sentinel v0.3.22**:

- Marketplace VS Code: [https://marketplace.visualstudio.com/items?itemName=RealGoLab.synaptic-sentinel](https://marketplace.visualstudio.com/items?itemName=RealGoLab.synaptic-sentinel)
- GitHub Release: [https://github.com/golab-arch/synaptic-sentinel/releases/tag/v0.3.22](https://github.com/golab-arch/synaptic-sentinel/releases/tag/v0.3.22)
- Código fuente: [https://github.com/golab-arch/synaptic-sentinel](https://github.com/golab-arch/synaptic-sentinel)
