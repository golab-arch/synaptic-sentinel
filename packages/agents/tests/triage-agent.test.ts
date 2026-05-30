import { describe, it, expect } from 'vitest';
import { runAgent } from '../src/brain-agent.js';
import type { LlmClient } from '../src/llm-client.js';
import {
  FABRICATED_DISMISSAL_PATTERNS,
  TRIAGE_CLASSIFICATIONS,
  TriageAgent,
  guardAgainstFabricatedDismissals,
} from '../src/triage-agent.js';
import type { TriageVerdict } from '../src/triage-agent.js';

/** Fecha fija para los tests del buildPrompt (DG-111 Step 2 — determinism). */
const FIXED_DATE = '2026-05-29';

/** Construye un Finding valido para alimentar al Triage Agent. */
function makeFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    scanId: 'scan-1',
    scoutId: 'opengrep',
    severity: 'high',
    category: 'SAST',
    ruleId: 'test-rule',
    title: 'sentinel-js-eval-usage',
    message: 'Uso de eval() con entrada no confiable.',
    location: { path: 'src/x.ts', startLine: 3, snippet: 'eval(userInput)' },
    complianceRefs: ['CWE-95'],
    fingerprint: 'src/x.ts:test-rule:3',
    lifecycleState: 'new',
    createdAt: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('TriageAgent.buildPrompt', () => {
  it('incluye los datos del hallazgo y pide una respuesta JSON', () => {
    const prompt = new TriageAgent({ currentDate: FIXED_DATE }).buildPrompt(makeFinding() as never);
    expect(prompt.system).toContain('JSON');
    expect(prompt.user).toContain('test-rule');
    expect(prompt.user).toContain('src/x.ts:3');
    expect(prompt.user).toContain('eval(userInput)'); // snippet
  });

  it('usa "(no disponible)" cuando el hallazgo no trae snippet', () => {
    const prompt = new TriageAgent({ currentDate: FIXED_DATE }).buildPrompt(
      makeFinding({ location: { path: 'a.js', startLine: 1 } }) as never,
    );
    expect(prompt.user).toContain('(not available)');
  });

  it('system prompt modela explicitamente SCA (DG-111 Step 2 — §4 #1)', () => {
    const prompt = new TriageAgent({ currentDate: FIXED_DATE }).buildPrompt(makeFinding() as never);
    expect(prompt.system).toMatch(/\bSCA\b/);
    expect(prompt.system).toMatch(/Software Composition Analysis/);
  });

  it('system prompt fija scanner metadata como GROUND TRUTH (DG-111 Step 2)', () => {
    const prompt = new TriageAgent({ currentDate: FIXED_DATE }).buildPrompt(makeFinding() as never);
    expect(prompt.system).toMatch(/GROUND TRUTH/);
    expect(prompt.system).toMatch(/CVE.*authoritative|authoritative.*CVE/is);
    expect(prompt.system).toMatch(/training cutoff is NOT/i);
  });

  it('system prompt prohibe FP por "CVE no existe" / fabricated (DG-111 Step 2)', () => {
    const prompt = new TriageAgent({ currentDate: FIXED_DATE }).buildPrompt(makeFinding() as never);
    // `Do NOT classify ... false_positive` puede tener un line-break interno
    // por wrapping del prompt; matcheamos cross-line con [\s\S].
    expect(prompt.system).toMatch(/Do NOT classify[\s\S]*?false_positive/);
    expect(prompt.system).toMatch(/fabricated/);
    expect(prompt.system).toMatch(/future-dated/);
  });

  it('user prompt incluye la current date inyectada (DG-111 Step 2)', () => {
    const prompt = new TriageAgent({ currentDate: '2026-05-29' }).buildPrompt(
      makeFinding() as never,
    );
    expect(prompt.user).toContain('Current date (real-world authoritative): 2026-05-29');
  });

  it('user prompt usa hoy como default cuando NO se inyecta currentDate (DG-111 Step 2)', () => {
    const prompt = new TriageAgent().buildPrompt(makeFinding() as never);
    // Hoy en formato YYYY-MM-DD (UTC). El test es deterministico al
    // dia: ambas llamadas a new Date() ocurren en la misma milesima.
    const today = new Date().toISOString().slice(0, 10);
    expect(prompt.user).toContain(`Current date (real-world authoritative): ${today}`);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('system prompt declara rationale ANTES de classification en el JSON shape (DG-111.1 A — Step 2 hotfix CoT)', () => {
    const prompt = new TriageAgent({ currentDate: FIXED_DATE }).buildPrompt(makeFinding() as never);
    const rationaleIdx = prompt.system.indexOf('"rationale"');
    const classificationIdx = prompt.system.indexOf('"classification"');
    const confidenceIdx = prompt.system.indexOf('"confidence"');
    expect(rationaleIdx).toBeGreaterThan(-1);
    expect(classificationIdx).toBeGreaterThan(-1);
    expect(confidenceIdx).toBeGreaterThan(-1);
    // Orden CoT: rationale → classification → confidence.
    expect(rationaleIdx).toBeLessThan(classificationIdx);
    expect(classificationIdx).toBeLessThan(confidenceIdx);
  });

  it('system prompt instruye explicitamente "write the rationale FIRST" (DG-111.1 A)', () => {
    const prompt = new TriageAgent({ currentDate: FIXED_DATE }).buildPrompt(makeFinding() as never);
    expect(prompt.system).toMatch(/write the rationale FIRST/);
    expect(prompt.system).toMatch(/THEN derive[\s\S]*?classification/);
    expect(prompt.system).toMatch(/order matters/);
    expect(prompt.system).toMatch(/contradict their own rationale/);
  });
});

describe('TriageAgent.parseResponse', () => {
  const agent = new TriageAgent();

  it('parsea un veredicto JSON valido', () => {
    const verdict = agent.parseResponse(
      '{"classification":"false_positive","confidence":0.9,"rationale":"patron sin riesgo"}',
    );
    expect(verdict.classification).toBe('false_positive');
    expect(verdict.confidence).toBe(0.9);
    expect(verdict.rationale).toBe('patron sin riesgo');
  });

  it('tolera el veredicto envuelto en un bloque markdown', () => {
    const verdict = agent.parseResponse(
      '```json\n{"classification":"true_positive","confidence":0.7,"rationale":"riesgo real"}\n```',
    );
    expect(verdict.classification).toBe('true_positive');
  });

  it('rechaza una clasificacion invalida', () => {
    expect(() =>
      agent.parseResponse('{"classification":"quizas","confidence":0.5,"rationale":"x"}'),
    ).toThrow();
  });

  it('rechaza una confianza fuera del rango 0..1', () => {
    expect(() =>
      agent.parseResponse('{"classification":"inconclusive","confidence":1.8,"rationale":"x"}'),
    ).toThrow();
  });

  it('rechaza una respuesta sin JSON', () => {
    expect(() => agent.parseResponse('no puedo decidir')).toThrow();
  });

  it('parsea un veredicto con el NUEVO orden CoT rationale→classification→confidence (DG-111.1 A)', () => {
    const verdict = agent.parseResponse(
      '{"rationale":"scanner confirma el CVE; reachability clara","classification":"true_positive","confidence":0.85}',
    );
    expect(verdict.classification).toBe('true_positive');
    expect(verdict.confidence).toBe(0.85);
    expect(verdict.rationale).toBe('scanner confirma el CVE; reachability clara');
  });

  it('parsea un veredicto con el ORDEN VIEJO classification→confidence→rationale (backward compat — Zod field-order-independent)', () => {
    const verdict = agent.parseResponse(
      '{"classification":"false_positive","confidence":0.9,"rationale":"patron sin riesgo"}',
    );
    expect(verdict.classification).toBe('false_positive');
    expect(verdict.confidence).toBe(0.9);
    expect(verdict.rationale).toBe('patron sin riesgo');
  });
});

describe('runAgent con TriageAgent', () => {
  it('tria un hallazgo de punta a punta con un LLM falso', async () => {
    const llm: LlmClient = {
      complete: () =>
        Promise.resolve(
          '{"classification":"true_positive","confidence":0.85,"rationale":"eval con entrada del usuario"}',
        ),
    };
    const verdict = await runAgent(
      new TriageAgent({ currentDate: FIXED_DATE }),
      makeFinding() as never,
      llm,
    );
    expect(TRIAGE_CLASSIFICATIONS).toContain(verdict.classification);
    expect(verdict.classification).toBe('true_positive');
    expect(verdict.confidence).toBe(0.85);
  });

  it('end-to-end: un FP "fabricated" del LLM en un finding SCA es overridden a inconclusive por el guard (DG-111 Step 2 + DG-111.2 A)', async () => {
    const llm: LlmClient = {
      complete: () =>
        Promise.resolve(
          '{"classification":"false_positive","confidence":0.85,"rationale":"CVE-2026-33896 appears fabricated; no such CVE exists in NVD."}',
        ),
    };
    // DG-111.2 A: el guard solo aplica a SCA. Para validar el happy path
    // post-fix, el finding debe ser SCA (la categoria de los CVE-related).
    const verdict = await runAgent(
      new TriageAgent({ currentDate: FIXED_DATE }),
      makeFinding({ category: 'SCA' }) as never,
      llm,
    );
    expect(verdict.classification).toBe('inconclusive');
    expect(verdict.rationale).toContain('Brain Layer guard (DG-111 Step 2)');
    expect(verdict.rationale).toContain('CVE-2026-33896 appears fabricated');
  });

  it('end-to-end: un FP de Secrets con rationale tipo-dismissal NO es overridden (DG-111.2 A precision hotfix)', async () => {
    // Caso documentado en Entry #129: generic-api-key en
    // src/tests/sai-checks.test.ts pasaba de FP 0.9 a INC 0.5 porque el
    // guard interpretaba 'not a real production secret' del rationale del
    // fixture como dismissal de CVE fabricado. El finding es Secrets, sin
    // CVE — el guard NO debe activarse.
    const llm: LlmClient = {
      complete: () =>
        Promise.resolve(
          '{"classification":"false_positive","confidence":0.9,"rationale":"test file fixture; the credential string is redacted by Gitleaks --redact and serves as a placeholder, not a real production secret."}',
        ),
    };
    const verdict = await runAgent(
      new TriageAgent({ currentDate: FIXED_DATE }),
      makeFinding({ category: 'Secrets', ruleId: 'generic-api-key' }) as never,
      llm,
    );
    expect(verdict.classification).toBe('false_positive');
    expect(verdict.confidence).toBe(0.9);
    expect(verdict.rationale).toContain('not a real production secret');
    expect(verdict.rationale).not.toContain('Brain Layer guard');
  });
});

describe('guardAgainstFabricatedDismissals — DG-111 Step 2 / §4 #1 + DG-111.2 A precision hotfix', () => {
  /** Helper: construye un TriageVerdict bien-formado para el guard. */
  function makeVerdict(overrides: Partial<TriageVerdict> = {}): TriageVerdict {
    return {
      classification: 'false_positive',
      confidence: 0.85,
      rationale: 'pattern matched but no real risk in this context',
      ...overrides,
    } as TriageVerdict;
  }

  it('override FP a inconclusive cuando el rationale dice "fabricated" (SCA)', () => {
    const v = guardAgainstFabricatedDismissals(
      makeVerdict({ rationale: 'CVE-2026-33896 appears fabricated.' }),
      'SCA',
    );
    expect(v.classification).toBe('inconclusive');
    expect(v.confidence).toBe(0.5);
  });

  it('override FP a inconclusive cuando el rationale dice "fictional" (SCA)', () => {
    const v = guardAgainstFabricatedDismissals(
      makeVerdict({ rationale: 'The version 11.1.0 of uuid is fictional.' }),
      'SCA',
    );
    expect(v.classification).toBe('inconclusive');
  });

  it('override FP a inconclusive cuando el rationale dice "spurious" (SCA)', () => {
    const v = guardAgainstFabricatedDismissals(
      makeVerdict({ rationale: 'Further indicating this CVE is spurious.' }),
      'SCA',
    );
    expect(v.classification).toBe('inconclusive');
  });

  it('override FP a inconclusive cuando el rationale dice "non-existent" (SCA)', () => {
    const v = guardAgainstFabricatedDismissals(
      makeVerdict({ rationale: 'This CVE is non-existent in NVD.' }),
      'SCA',
    );
    expect(v.classification).toBe('inconclusive');
  });

  it('override FP a inconclusive cuando el rationale dice "nonexistent" sin guion (SCA)', () => {
    const v = guardAgainstFabricatedDismissals(
      makeVerdict({ rationale: 'CVE id is nonexistent.' }),
      'SCA',
    );
    expect(v.classification).toBe('inconclusive');
  });

  it('override FP a inconclusive cuando el rationale dice "not a real release" (SCA)', () => {
    const v = guardAgainstFabricatedDismissals(
      makeVerdict({ rationale: 'uuid 11.1.0 is not a real release history entry.' }),
      'SCA',
    );
    expect(v.classification).toBe('inconclusive');
  });

  it('override FP a inconclusive cuando el rationale dice "future-dated" (SCA)', () => {
    const v = guardAgainstFabricatedDismissals(
      makeVerdict({ rationale: 'This is a future-dated CVE that cannot exist yet.' }),
      'SCA',
    );
    expect(v.classification).toBe('inconclusive');
  });

  it('override FP a inconclusive cuando el rationale dice "future CVE" / "future release" (SCA)', () => {
    expect(
      guardAgainstFabricatedDismissals(
        makeVerdict({ rationale: 'Reference to a future CVE we cannot validate.' }),
        'SCA',
      ).classification,
    ).toBe('inconclusive');
    expect(
      guardAgainstFabricatedDismissals(
        makeVerdict({ rationale: 'Looks like a future release of the package.' }),
        'SCA',
      ).classification,
    ).toBe('inconclusive');
    expect(
      guardAgainstFabricatedDismissals(
        makeVerdict({ rationale: 'Future advisory beyond training cutoff.' }),
        'SCA',
      ).classification,
    ).toBe('inconclusive');
  });

  it('NO override de TP aunque el rationale tenga keywords de dismissal (proteccion narrow al FP)', () => {
    const verdict = makeVerdict({
      classification: 'true_positive',
      rationale: 'Even though some users call this fabricated, the pattern is exploitable.',
    });
    const v = guardAgainstFabricatedDismissals(verdict, 'SCA');
    expect(v.classification).toBe('true_positive');
    expect(v.rationale).toBe(verdict.rationale);
  });

  it('NO override de INC aunque el rationale tenga keywords de dismissal', () => {
    const verdict = makeVerdict({
      classification: 'inconclusive',
      rationale: 'Hard to tell if the CVE is fictional or real without more context.',
    });
    const v = guardAgainstFabricatedDismissals(verdict, 'SCA');
    expect(v.classification).toBe('inconclusive');
    expect(v.rationale).toBe(verdict.rationale); // preservado intacto
  });

  it('NO override de FP cuando el rationale es legitimo (sin dismissal keywords)', () => {
    const verdict = makeVerdict({
      classification: 'false_positive',
      rationale: 'Test fixture file with intentional vulnerable code; not production.',
    });
    const v = guardAgainstFabricatedDismissals(verdict, 'SCA');
    expect(v.classification).toBe('false_positive');
    expect(v.rationale).toBe(verdict.rationale);
    expect(v.confidence).toBe(verdict.confidence);
  });

  it('preserva el rationale original (truncado a 200 chars) en el verdict overridden', () => {
    const longRationale =
      'CVE-2026-33896 is fabricated. '.repeat(20) +
      'plus extra noise that should be truncated past 200 chars.';
    const v = guardAgainstFabricatedDismissals(makeVerdict({ rationale: longRationale }), 'SCA');
    expect(v.classification).toBe('inconclusive');
    expect(v.rationale).toContain('Original rationale:');
    expect(v.rationale).toContain('...'); // truncation marker
    // No debe contener la noise del final (corroborates truncation).
    expect(v.rationale).not.toContain('plus extra noise that should be truncated');
  });

  it('preserva el rationale completo (sin truncacion) cuando es < 200 chars', () => {
    const shortRationale = 'CVE-2026-33896 appears fabricated.';
    const v = guardAgainstFabricatedDismissals(makeVerdict({ rationale: shortRationale }), 'SCA');
    expect(v.rationale).toContain(shortRationale);
    expect(v.rationale).not.toContain('...'); // no truncation
  });

  it('FABRICATED_DISMISSAL_PATTERNS exporta los regex (anti-drift)', () => {
    expect(FABRICATED_DISMISSAL_PATTERNS.length).toBeGreaterThanOrEqual(7);
    for (const p of FABRICATED_DISMISSAL_PATTERNS) expect(p).toBeInstanceOf(RegExp);
  });

  // ────────────────────────────────────────────────────────────────────
  // DG-111.2 A precision hotfix: category gate — el guard SOLO aplica a SCA.
  // ────────────────────────────────────────────────────────────────────

  it('NO override de FP en finding Secrets aunque el rationale tenga keywords de dismissal (DG-111.2 A)', () => {
    // Caso documentado en Entry #129: generic-api-key en
    // src/tests/sai-checks.test.ts paso de FP 0.9 a INC 0.5 porque el
    // guard misfirea con 'not a real production secret' del fixture.
    const verdict = makeVerdict({
      classification: 'false_positive',
      rationale:
        'test file fixture; the credential is redacted and serves as a placeholder, not a real production secret.',
    });
    const v = guardAgainstFabricatedDismissals(verdict, 'Secrets');
    expect(v.classification).toBe('false_positive');
    expect(v.rationale).toBe(verdict.rationale); // preservado intacto
    expect(v.confidence).toBe(verdict.confidence);
  });

  it('NO override de FP en finding SAST aunque el rationale mencione "fabricated" en otro contexto (DG-111.2 A)', () => {
    const verdict = makeVerdict({
      classification: 'false_positive',
      rationale:
        'eval() in a test fixture with hardcoded input; the threat is fabricated for testing.',
    });
    const v = guardAgainstFabricatedDismissals(verdict, 'SAST');
    expect(v.classification).toBe('false_positive');
    expect(v.rationale).toBe(verdict.rationale);
  });

  it('NO override de FP en finding IaC / VibeCoded / BusinessLogic (DG-111.2 A — solo SCA)', () => {
    const dismissalRationale = 'This vulnerability appears fabricated based on the config.';
    for (const cat of ['IaC', 'VibeCoded', 'BusinessLogic']) {
      const v = guardAgainstFabricatedDismissals(
        makeVerdict({ rationale: dismissalRationale }),
        cat,
      );
      expect(v.classification).toBe('false_positive'); // preservado
      expect(v.rationale).toBe(dismissalRationale);
    }
  });

  it('NO override de FP cuando category es string vacio (default antes de buildPrompt — DG-111.2 A)', () => {
    const v = guardAgainstFabricatedDismissals(
      makeVerdict({ rationale: 'CVE-2026-33896 appears fabricated.' }),
      '',
    );
    expect(v.classification).toBe('false_positive');
  });
});
