import { z } from 'zod';

/**
 * Identificador de paquete de Trivy (formato PURL + UID interno).
 * DG-115 A: el `UID` distingue copias multiples del mismo `Name@Version`
 * en lockfiles con dep nesting (e.g. `prismjs@1.27.0` nested bajo
 * `refractor` vs `prismjs@1.30.0` top-level → cada uno tiene UID
 * distinto). Match vuln↔Package usa este UID.
 */
const TrivyPkgIdentifierSchema = z.object({
  PURL: z.string().optional(),
  UID: z.string().optional(),
});

/** Una vulnerabilidad de dependencia reportada por Trivy. */
const TrivyVulnerabilitySchema = z.object({
  VulnerabilityID: z.string().min(1),
  PkgName: z.string().min(1),
  /**
   * Id compuesto `name@version` — DG-115 A. Trivy lo emite junto al
   * `PkgIdentifier.UID`; ambos opcionales por forward-compat.
   */
  PkgID: z.string().optional(),
  /** Identificador estructurado del package (DG-115 A). */
  PkgIdentifier: TrivyPkgIdentifierSchema.optional(),
  InstalledVersion: z.string().default(''),
  FixedVersion: z.string().optional(),
  Severity: z.string().default('UNKNOWN'),
  Title: z.string().optional(),
  Description: z.string().optional(),
  PrimaryURL: z.string().optional(),
  CweIDs: z.array(z.string()).optional(),
});

/** Location de un package dentro del lockfile (DG-115 A — opcional). */
const TrivyPackageLocationSchema = z.object({
  StartLine: z.number().int().optional(),
  EndLine: z.number().int().optional(),
});

/**
 * Package emitido por Trivy en `Result.Packages[]` (DG-115 A).
 *
 * Trivy parsea el lockfile y emite el grafo completo de deps. Cada
 * entry tiene `Relationship` (`direct` | `indirect` | `root`),
 * `DependsOn[]` (lista de IDs `name@version` de las deps directas de
 * ESTE package), y `Locations[]` (lineas en el lockfile).
 *
 * Match Vulnerability ↔ Package: via `PkgIdentifier.UID` (1:1) o
 * fallback a `PkgID` (puede no ser unico si hay duplicates en el
 * lockfile — el UID los distingue).
 *
 * Todos los fields opcionales por defensa (Trivy older puede no
 * emitirlos; Trivy futuras pueden agregar mas). Zod descarta keys
 * desconocidas defensivamente (defensa en profundidad v0.4 §9.6).
 */
const TrivyPackageSchema = z.object({
  ID: z.string().optional(),
  Name: z.string().optional(),
  Version: z.string().optional(),
  Identifier: TrivyPkgIdentifierSchema.optional(),
  Relationship: z.string().optional(),
  Indirect: z.boolean().optional(),
  DependsOn: z.array(z.string()).optional(),
  Locations: z.array(TrivyPackageLocationSchema).optional(),
});

/** Package emitido por Trivy (DG-115 A). */
export type TrivyPackage = z.infer<typeof TrivyPackageSchema>;

/** Un resultado de Trivy: un target (manifiesto de dependencias) escaneado. */
const TrivyResultSchema = z.object({
  Target: z.string().default(''),
  /**
   * Tipo del target — `npm` | `yarn` | `pnpm` | `composer` | etc. — segun
   * el parser de Trivy que lo procesó. Determina el formato del override
   * directive del DG-115 A (npm `overrides`, yarn `resolutions`, pnpm
   * `pnpm.overrides`). Opcional por defensa.
   */
  Type: z.string().optional(),
  /** Trivy emite `null` cuando un target no tiene vulnerabilidades. */
  Vulnerabilities: z.array(TrivyVulnerabilitySchema).nullable().optional(),
  /**
   * Grafo de packages emitido por Trivy (DG-115 A). Opcional — Trivy
   * versions older que ~v0.50 podrian no emitirlo; tambien puede faltar
   * en escaneos parciales.
   */
  Packages: z.array(TrivyPackageSchema).nullable().optional(),
});

/**
 * Schema de la salida JSON de Trivy (`trivy fs --format json`).
 *
 * Solo se modela lo que el normalizer consume; zod descarta el resto de
 * claves. Validar la salida del scanner es defensa en profundidad (v0.4 §9.6).
 */
export const TrivyOutputSchema = z.object({
  Results: z.array(TrivyResultSchema).nullable().optional(),
});

/** Una vulnerabilidad individual de Trivy. */
export type TrivyVulnerability = z.infer<typeof TrivyVulnerabilitySchema>;

/** Salida completa de Trivy. */
export type TrivyOutput = z.infer<typeof TrivyOutputSchema>;
