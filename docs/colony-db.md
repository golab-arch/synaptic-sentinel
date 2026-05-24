# Colony DB — la memoria de feromonas

`colony.db` es la memoria compartida del enjambre de Synaptic Sentinel: una base
de datos **SQLite local** que vive en el proyecto **del cliente**, en
`.synaptic-sentinel/colony.db`. **No** forma parte de este repositorio — aquí
solo está el schema que la crea
([packages/core/src/colony/schema.sql](../packages/core/src/colony/schema.sql)).

## Tablas

| Tabla                     | Propósito                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `meta`                    | Versión del schema (habilita migraciones)                                                 |
| `scans`                   | Una fila por escaneo ejecutado                                                            |
| `pheromones`              | Feromonas digitales: `finding`, `context`, `hypothesis`, `exploration_marker`, `fp_known` |
| `learning_records`        | Patrones confirmados entre escaneos (cross-tomo learning)                                 |
| `triage_verdicts`         | Veredictos del Triage Agent (Brain Layer) — schema v2                                     |
| `context_explanations`    | Explicaciones de la cadena de explotabilidad del Context Agent — schema v3                |
| `remediation_suggestions` | Sugerencias de corrección del Remediation Agent — schema v4                               |
| `triage_token_usage`      | Tokens proxy + costo USD estimado por LLM call (cost visibility) — schema v5              |

El schema crece de forma **aditiva** (`CREATE TABLE IF NOT EXISTS`): cada versión
nueva agrega tablas sin reconstruir las existentes. La versión actual es **v5**.

## Cost visibility (`triage_token_usage`, DG-078 B)

Cada invocación del comando `triage` agrupa todas sus LLM calls bajo un
`triage_session_id` (UUID generado al inicio) y persiste **una fila por call**
en `triage_token_usage` con: provider+modelo, agente (`triage` /
`context` / `remediation`), tokens de input/output, costo USD estimado y
latencia. El comando `synaptic-sentinel cost-history [--limit N]` consulta
esta tabla y devuelve un rollup de las últimas N sesiones agrupado por
`(provider, agent)`.

**Caveat anti-optimismo ilusorio**: tokens son **proxies** (heurística
`chars/4`) porque el contrato `LlmClient.complete()` no expone `usage`
real del provider (DG-073 B mantuvo el contrato simple). El cost USD
puede divergir **±15-20%** del facturado real. El summary post-triage y el
sub-comando `cost-history` imprimen el caveat `~estimated` explícitamente.

## WAL mode

La DB usa `journal_mode = WAL` para permitir lecturas concurrentes mientras los
agentes escriben en paralelo.

## ¿Versionar `colony.db`?

Por defecto está en `.gitignore` — la colony DB es estado local de cada
desarrollador y puede crecer.

**Versionarla es opcional.** Casos para hacerlo:

- Equipos que quieren compartir `learning_records` (patrones FP confirmados)
  para reducir el costo LLM entre miembros.
- Auditorías que requieren reproducir el estado exacto de un escaneo.

Para versionarla, eliminá estas líneas de `.gitignore`:

```
.synaptic-sentinel/colony.db
.synaptic-sentinel/colony.db-wal
.synaptic-sentinel/colony.db-shm
```

⚠️ Si la versionás, hacelo con la DB cerrada (sin `-wal`/`-shm` pendientes) para
evitar corrupción. Considerá exportar solo `learning_records` en vez de la DB
completa.
