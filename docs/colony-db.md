# Colony DB — la memoria de feromonas

`colony.db` es la memoria compartida del enjambre de Synaptic Sentinel: una base
de datos **SQLite local** que vive en el proyecto **del cliente**, en
`.synaptic-sentinel/colony.db`. **No** forma parte de este repositorio — aquí
solo está el schema que la crea
([packages/core/src/colony/schema.sql](../packages/core/src/colony/schema.sql)).

## Tablas

| Tabla | Propósito |
|---|---|
| `meta` | Versión del schema (habilita migraciones) |
| `scans` | Una fila por escaneo ejecutado |
| `pheromones` | Feromonas digitales: `finding`, `context`, `hypothesis`, `exploration_marker`, `fp_known` |
| `learning_records` | Patrones confirmados entre escaneos (cross-tomo learning) |

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
