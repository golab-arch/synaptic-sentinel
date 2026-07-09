# Guía de capturas + video + MyPublicInbox para el artículo de Chema Alonso

> Complemento al `docs/CHEMA_ALONSO_ARTICLE.md`. Este documento describe exactamente qué capturas hacer, en qué orden, con qué contexto, y qué caption sugerido para cada una. Además, guía la producción de un vídeo corto opcional y la creación del perfil MyPublicInbox requerido por Chema.

---

## Bloque 1 — Capturas obligatorias (mínimo 8, ideal 10)

Todas en resolución alta (mínimo 1600px de ancho para que se lea bien en el blog). Usa el workspace **SYNAPTIC_SAAS** que ya tienes con Baseline-16 procesado — así los datos que aparecen son reales, no _mockups_.

### Captura 1 — Sidebar overview del workspace SYNAPTIC_SAAS post-triaje

**Qué**: el sidebar completo con los 44 findings agrupados por _triage state_ (33 TP, 10 INC, 1 FP).

**Cómo**: abre VS Code en `d:/GoLAB/PROYECTOS/SYNAPTIC_SAAS`, activa el panel _SYNAPTIC Sentinel_ del sidebar izquierdo, scroll hasta que se vea el bloque superior "SYNAPTIC Sentinel · 44 findings · 33 TP · 10 INC · 1 FP" + la línea `Scan diff vs previous triage: 1 new · 9 re-classified (0 class, 9 confidence, 0 provider) · 34 unchanged` + parte del bloque _Brain Layer cost_ y el inicio de las _SCA grouped remediations_.

**Caption sugerido**: _"Sidebar de SYNAPTIC Sentinel tras un scan de SYNAPTIC_SAAS (44 findings) + re-triaje. La línea `Scan diff vs previous triage` es nueva en v0.3.22 y desglosa las reclasificaciones por razón (class / confidence / provider) — atacaba el gap empírico observado en Baseline-15, donde 5 findings con delta de confianza contaban como 'unchanged' pese al banner de aviso."_

### Captura 2 — Badge GROUPED REP en un finding SCA representante

**Qué**: la _card_ de un finding SCA que es representante de un grupo (ej. `protobufjs: Arbitrary code execution... — package-lock.json:1` con confianza 75%). El badge morado **GROUPED REP** debe ser visible junto al badge de severidad.

**Cómo**: en el sidebar, encuentra un finding en `package-lock.json:1` cuya versión de _packages/web/package-lock.json_ también aparece con badge GROUPED (miembro del mismo grupo). Screenshot de la _card_ del representante con el tooltip visible ("Group representative — made the LLM call; verdict propagated to members.").

**Caption sugerido**: _"Representante de grupo. Este finding hizo la llamada real al LLM. El veredicto se propaga a los miembros del grupo con una rebaja de confianza del 0.9× — honestidad epistémica: alta confianza en el grupo, media en cada miembro individualmente."_

### Captura 3 — Badge GROUPED en un miembro con rationale suffix visible

**Qué**: la _card_ del miembro correspondiente al representante de la captura 2 (mismo CVE en el otro lockfile). Badge morado más claro **GROUPED**, y en la línea del racional se ve el sufijo `[group SCA:protobufjs@7.5.4:CVE-2026-41242, member 2 of 2]`. Confianza 68% (= 75% × 0.9 redondeado).

**Cómo**: screenshot del miembro. Asegúrate de que se vea el _tooltip_ del badge ("Group member — verdict propagated from representative, confidence downgraded.") o al menos el racional con el sufijo `[group ..., member 2 of 2]`.

**Caption sugerido**: _"Miembro de grupo. El veredicto viene propagado desde el representante, con la confianza rebajada de 75% a 68% (× 0.9). El sufijo `[group SCA:pkg@ver:CVE, member N of M]` en el racional deja auditable la propagación."_

### Captura 4 — Banner "⚠ Verdict changed since last scan"

**Qué**: la _card_ de un finding cuyo veredicto ha cambiado entre scans, mostrando el banner naranja con la razón heurística.

**Cómo**: idealmente el finding **fast-xml-parser CVE-2026-41650** en `package-lock.json:1`, que en Baseline-16 muestra el banner `⚠ Verdict changed since last scan: inconclusive 90% → inconclusive 30%` con razón `Confidence changed significantly (Δ 0.60)`. Si no lo encuentras, sirve cualquier finding con banner activo — hay al menos 5 en la Baseline-15 y otros en la 16.

**Caption sugerido**: _"El banner ⚠ Verdict changed since last scan aparece automáticamente cuando el veredicto actual difiere del anterior. La razón heurística sigue la precedencia provider > class > confidence (threshold configurable, por defecto 0.15). Este es el hallazgo clave de FASE III: la varianza cross-provider deja de ser invisible."_

### Captura 5 — Sección "Previously (N prior verdicts)" expandida

**Qué**: la sección colapsable "Previously" de un finding, EXPANDIDA, mostrando el historial completo (idealmente 4 o más entradas con distintos providerLabels y timestamps).

**Cómo**: mismo finding que la captura 4 (ej. fast-xml-parser CVE-2026-41650) o cualquier otro con muchas entradas históricas. En el sidebar, click en la etiqueta "▶ Previously (4 prior verdicts)" para expandirla. Screenshot mostrando timestamps + provider labels + racionales.

**Caption sugerido**: _"La sección Previously guarda todo el historial de triaje del finding en la tabla `verdict_history` de `colony.db`. Es append-only por diseño: el comando de re-triage NO la borra. Cambias de proveedor, vuelves una semana después, la trayectoria completa está a un click de distancia."_

### Captura 6 — Terminal con la línea de breakdown post-triage

**Qué**: el output del terminal integrado tras ejecutar "Re-triage all", mostrando la línea nueva de v0.3.22:

```text
Scan diff vs previous triage: 1 new, 9 re-classified (0 class, 9 confidence, 0 provider), 34 unchanged.
```

Con al menos 3-4 líneas del detalle `· re-classified <fp> [reason]: Δ delta (from → to)` debajo.

**Cómo**: dispara un "Re-triage all" desde el sidebar en SYNAPTIC_SAAS. Screenshot del terminal integrado con la línea de breakdown + el detalle per-reclassified.

**Caption sugerido**: _"La misma línea de breakdown aparece en el terminal y en el sidebar. Nótese que las 9 reclasificaciones se cuentan como confidence-delta (no como unchanged), cerrando el gap empírico de Baseline-15 donde el summary no reflejaba lo que el banner sí detectaba."_

### Captura 7 — Salida de `synaptic-sentinel diff --json`

**Qué**: la salida en JSON estructurado del nuevo comando CLI.

**Cómo**: en el terminal integrado ejecuta:

```bash
node "$USERPROFILE/.vscode/extensions/realgolab.synaptic-sentinel-0.3.22/dist/cli.mjs" diff --path .
```

(estás en el _workspace_ SYNAPTIC_SAAS). Screenshot mostrando el bloque `summary` + `reclassifiedByReason` + al menos una entrada de `reclassified[]` con todos los campos (reason, from, to, confidenceDelta, fromConfidence, toConfidence, fromProvider, toProvider).

**Caption sugerido**: _"El comando `synaptic-sentinel diff --json` devuelve JSON estructurado listo para pipelines de CI/CD. Se puede alimentar a dashboards, filtrar en shell, o gatear PRs con `jq`. Cada reclasificación incluye la razón y los deltas exactos."_

### Captura 8 — Bloque de cost visibility al final del triaje

**Qué**: el bloque de _Brain Layer cost_ que aparece al final de una sesión de triaje, mostrando proveedor/modelo, agente, llamadas, tokens input/output, coste USD estimado y latencia media.

**Cómo**: se ve en el sidebar (bloque "Brain Layer cost · last session") y también al final de la salida del terminal. Elige la del sidebar (más compacta) o la del terminal (más completa).

**Caption sugerido**: _"Cost visibility por sesión: proveedor por proveedor y agente por agente. Sabes exactamente lo que te ha costado un scan antes de que llegue la factura del proveedor. En el ejemplo, DeepSeek v4-pro consumió $0.0046 en 8 llamadas de triaje — 4× más que v4-flash sobre la misma carga en Baseline-15."_

### Captura 9 — `agents.yaml` de ejemplo con configuración BYOK

**Qué**: el archivo `.sentinel/agents.yaml` abierto en el editor, mostrando una configuración mínima válida.

**Cómo**: en el mismo VS Code, abre `d:/GoLAB/PROYECTOS/SYNAPTIC_SAAS/.sentinel/agents.yaml`. Screenshot del contenido — pero **anonimiza cualquier API key o baseUrl con datos sensibles antes de la captura** (los strings de proveedor y modelo se pueden dejar).

**Caption sugerido**: _"El archivo `.sentinel/agents.yaml` define un proveedor por agente. La API key nunca aparece aquí — se lee desde `SENTINEL_<PROVIDER>_API_KEY` en el entorno. Mix-and-match: DeepSeek para triage (barato), Anthropic para context (calidad), Ollama para remediation (local, gratis, privado)."_

### Captura 10 — Panel de _Problems_ con findings inline diagnostics

**Qué**: el panel _Problems_ de VS Code mostrando los findings de Sentinel como diagnósticos inline, con al menos uno con el _quick fix_ "Mark as false positive" desplegado.

**Cómo**: abre el panel _Problems_ (Ctrl+Shift+M). Encuentra un finding SAST (ej. sentinel-js-taint-sql-injection en `src/api/routes/agent.ts:62`) y click en la bombilla del _quick fix_.

**Caption sugerido**: _"Los findings aparecen también como diagnósticos inline y en el panel \_Problems_. El _quick fix_ 'Mark as false positive' añade el finding a `fp_known` en `colony.db` — no se vuelve a mostrar en scans posteriores, sin que la información se pierda del historial."\_

---

## Bloque 2 — Capturas opcionales (bonus si tienes tiempo)

Estas dan más textura al artículo pero no son imprescindibles:

- **Captura 11**: el _Settings view_ de la extensión mostrando la UI para configurar proveedores BYOK (Command Palette → "SYNAPTIC Sentinel: Configure Brain Layer Providers").
- **Captura 12**: el `changelog.md` v0.3.22 abierto en el editor mostrando la sección _Known Issues / Honest tradeoffs (anti-optimism active)_. Refuerza el tono editorial honest del artículo.
- **Captura 13**: la página del [GitHub Release v0.3.22](https://github.com/golab-arch/synaptic-sentinel/releases/tag/v0.3.22) con el asset `synaptic-sentinel-0.3.22-step-132-1.vsix` visible.

---

## Bloque 3 — Vídeo opcional (30-60 segundos)

Chema dice literalmente _"algún vídeo si quieres"_ — es opcional. Pero un vídeo corto puede aumentar la reproducción del artículo significativamente.

### Guion sugerido (60 segundos aproximados)

**0-5 s** — Título en pantalla: _"SYNAPTIC Sentinel v0.3.22 — trust cross-session en 60 segundos"_. Fondo: sidebar del workspace SYNAPTIC_SAAS con 44 findings.

**5-15 s** — Voice over: _"Este es un finding de SQL injection en un endpoint Fastify. Lo triageé con DeepSeek v4-flash y me dijo 'falso positivo, confianza 95%'"._ Zoom in a la card del finding.

**15-25 s** — Voice over: _"Cambié a DeepSeek v4-pro, hice re-triage, y aparece este banner"._ En pantalla: la card del mismo finding con banner ⚠ Verdict changed.

**25-40 s** — Voice over: _"El banner explica la razón. La sección Previously guarda todo el historial cross-provider. Ninguna herramienta que yo conozca hacía esto antes"._ En pantalla: expandir Previously section, mostrar 4 entries con distintos providers.

**40-50 s** — Voice over: _"Y para CI/CD: `synaptic-sentinel diff --json` devuelve estructurado, `--fail-on-new-tp-critical 0` es un gate por severidad"._ En pantalla: terminal con la salida JSON.

**50-60 s** — Voice over: _"Apache-2.0 sin gating, BYOK cualquier proveedor. Enlace al Marketplace en la descripción"._ En pantalla: la página del Marketplace.

### Herramientas de captura sugeridas

- **Windows**: OBS Studio (gratis, open source) + micrófono cualquiera. Grabar en 1080p 30fps.
- **Edición mínima**: DaVinci Resolve (gratis) o incluso el editor integrado de OBS. Cortes secos, sin transiciones fancy — Chema y su audiencia aprecian rigor técnico, no producción de marketing.
- **Voz**: opcional. Si no quieres tu voz, deja el vídeo mudo con captions superpuestos (Chema respeta ambas opciones).
- **Hosting**: YouTube _unlisted_ o Vimeo. Compártele el link a Chema para que lo embeba en el post.

---

## Bloque 4 — Configuración del perfil MyPublicInbox

Chema exige explícitamente:

> _"hazte perfil público de MyPublicInbox, que todos los que publican en mi blog tienen que estar contactables en MyPublicInbox"_

### Pasos exactos

1. Abre [https://www.mypublicinbox.com](https://www.mypublicinbox.com) en el navegador.
2. Click en **Sign up** (esquina superior derecha) o el equivalente en la home.
3. Registrar cuenta con:
   - Email personal / profesional (el que quieras que se asocie públicamente).
   - Nombre real (Chema y su audiencia respetan el uso del nombre real; los pseudónimos generan fricción salvo casos justificados).
   - Contraseña robusta.
4. Verificar email vía enlace enviado por MyPublicInbox.
5. **Configurar perfil público**:
   - Foto / avatar. Puede ser una foto tuya o el logo de GoLab.
   - Bio corta (~200 caracteres). Sugerencia: _"Autor de SYNAPTIC Sentinel, herramienta open-source Apache-2.0 de auditoría de seguridad para vibe-coding. Fundador/Ingeniero de GoLab."_ (ajusta según rol real).
   - Enlaces: GitHub personal, Twitter/X si lo tienes, LinkedIn, sitio de GoLab.
   - **Marca el perfil como público** (checkbox o toggle específico en la configuración de privacidad).
   - Opcional: define un precio simbólico por mensaje (algunos autores lo hacen para filtrar spam; otros lo dejan gratis).
6. Copia la URL de tu perfil público (formato típico: `https://www.mypublicinbox.com/tu-nombre` o similar).
7. Cuando respondas a Saulo o directamente a Chema, incluye esa URL en el email, junto con el artículo, las capturas y el enlace al vídeo si lo grabaste.

---

## Bloque 5 — Email de entrega sugerido (respuesta a Chema vía Saulo)

Plantilla base para adaptar al tono personal:

---

> **Asunto**: Artículo sobre SYNAPTIC Sentinel para el blog — v0.3.22
>
> Hola Chema,
>
> Gracias por la oportunidad. Adjunto el material que me pediste para el post:
>
> - **Artículo**: `SYNAPTIC_Sentinel_Chema_Alonso.md` (aprox. 2800 palabras, 5-6 páginas). Escrito pensando en tu audiencia — hispanohablantes técnicos que aprecian _empirical evidence_ y _honest tradeoffs_. Siéntete libre de editar tono, estructura o extensión.
> - **Capturas**: 10 imágenes en alta resolución (`.png` a 1600px de ancho), numeradas y con el caption sugerido en el archivo `capturas_captions.md` que las acompaña.
> - **Vídeo opcional** (60 s): [YouTube unlisted link] — demostración rápida del banner de "verdict changed" cross-provider. Si prefieres publicar solo el texto, sin problema.
>
> Mi perfil público de MyPublicInbox está aquí: [URL DEL PERFIL].
>
> Un abrazo, y muchas gracias por el interés en el proyecto,
>
> [Tu nombre]
> [Tu rol / GoLab]
> [https://github.com/golab-arch/synaptic-sentinel](https://github.com/golab-arch/synaptic-sentinel)

---

## Bloque 6 — Anti-optimismo activo pre-entrega

Un checklist mental antes de dar botón _Enviar_:

1. **He verificado que todas las URLs del artículo funcionan**? (Marketplace, GitHub Release, código fuente.)
2. **He anonimizado cualquier API key** en la captura del `agents.yaml`? Doble check.
3. **He probado el artículo en un renderizador de Markdown** (VS Code preview o similar) para asegurar que tablas y bloques de código se ven bien? El blog de Chema usa un renderizado propio; un fallo básico de Markdown le da trabajo extra.
4. **He decidido si el video va o no** antes de enviar? Si no lo grabo, quito la mención en el email para no dejar promesa suelta.
5. **He guardado copia local** de todo el material entregado? Si Chema pide cambios, no tengo que reconstruir.
6. **El tono del email** es cordial y agradecido pero no servil. Chema aprecia respeto profesional, no _fanboy-ismo_.
7. **He revisado si Chema puede leer mi mensaje directamente en MyPublicInbox** (perfil accesible, mensaje directo activado) — así facilito futuras iteraciones.

---

## Cierre — Timing y expectativas realistas

Chema dice _"voy un poco mal de tiempo"_ pero también _"te lo saco en mi blog"_. Traducción probable: la publicación puede tardar entre unos días y varias semanas. No es rechazo — es su ritmo real de trabajo. Envía el material completo la primera vez para minimizar iteraciones, y espera con paciencia. Si en 3-4 semanas no ha aparecido, un follow-up breve vía MyPublicInbox (nunca por otra vía) es aceptable.

**Nota final**: este material se ha construido pensando en la audiencia de "El lado del mal". Si Chema decide editorializarlo, incluso reducirlo a la mitad o cambiarle el enfoque, es su prerrogativa. La visibilidad que aporta su blog vale la deferencia editorial.
