import { describe, it, expect } from 'vitest';
import type {
  ContextExplanation,
  ContextGroundTruth,
  GroundTruthEntry,
  RemediationGroundTruth,
  RemediationSuggestion,
  TriageGroundTruth,
  TriageVerdict,
} from '@synaptic-sentinel/core';
import {
  anonymizeFixturePath,
  buildSyntheticFinding,
  contextPass,
  remediationPass,
  triagePass,
} from '../../src/benchmark/scoring.js';

const TRIAGE_GT: TriageGroundTruth = {
  classification: 'true_positive',
  minConfidence: 0.8,
  requiredKeywords: ['eval', 'code injection'],
};

describe('triagePass', () => {
  it('PASS si classification + confidence + keywords coinciden', () => {
    const verdict: TriageVerdict = {
      classification: 'true_positive',
      confidence: 0.9,
      rationale: 'eval() on user input enables code injection',
    };
    const result = triagePass(verdict, TRIAGE_GT);
    expect(result.pass).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('FAIL si classification no coincide', () => {
    const verdict: TriageVerdict = {
      classification: 'false_positive',
      confidence: 0.9,
      rationale: 'eval() with code injection',
    };
    const result = triagePass(verdict, TRIAGE_GT);
    expect(result.pass).toBe(false);
    expect(result.reasons[0]).toMatch(/classification mismatch/);
  });

  it('FAIL si confidence por debajo del threshold', () => {
    const verdict: TriageVerdict = {
      classification: 'true_positive',
      confidence: 0.5,
      rationale: 'eval() with code injection',
    };
    const result = triagePass(verdict, TRIAGE_GT);
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/confidence/);
  });

  it('FAIL si rationale no contiene todos los keywords', () => {
    const verdict: TriageVerdict = {
      classification: 'true_positive',
      confidence: 0.9,
      rationale: 'unsafe call to eval', // falta "code injection"
    };
    const result = triagePass(verdict, TRIAGE_GT);
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/missing keywords/);
    expect(result.reasons.join(' ')).toMatch(/code injection/);
  });

  it('keywords son case-insensitive', () => {
    const verdict: TriageVerdict = {
      classification: 'true_positive',
      confidence: 0.9,
      rationale: 'EVAL() invocation enables CODE INJECTION',
    };
    expect(triagePass(verdict, TRIAGE_GT).pass).toBe(true);
  });
});

const CONTEXT_GT: ContextGroundTruth = {
  summaryKeywords: ['eval', 'user'],
  entryPointKeywords: ['userInput'],
  sinkKeywords: ['eval'],
  exposureKeywords: ['code execution'],
};

describe('contextPass', () => {
  it('PASS si los 4 fields contienen sus keywords', () => {
    const ctx: ContextExplanation = {
      summary: 'eval() called on user-provided string',
      entryPoint: 'userInput parameter from request',
      sink: 'eval(userInput)',
      exposure: 'arbitrary code execution in the host process',
    };
    expect(contextPass(ctx, CONTEXT_GT).pass).toBe(true);
  });

  it('FAIL si sink no contiene el keyword', () => {
    const ctx: ContextExplanation = {
      summary: 'eval() called on user input',
      entryPoint: 'userInput',
      sink: 'dynamic execution', // no menciona "eval"
      exposure: 'code execution',
    };
    const result = contextPass(ctx, CONTEXT_GT);
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/sink missing/);
  });
});

const REMEDIATION_GT: RemediationGroundTruth = {
  summaryKeywords: ['eval', 'replace'],
  recommendationKeywords: ['JSON.parse'],
  forbiddenInSnippet: ['eval(userInput)'],
};

describe('remediationPass', () => {
  it('PASS si keywords + snippet no contiene el sink', () => {
    const rem: RemediationSuggestion = {
      summary: 'Replace eval() with a safe parser',
      recommendation: 'Use JSON.parse to parse data',
      fixedSnippet: 'const data = JSON.parse(userInput);',
    };
    expect(remediationPass(rem, REMEDIATION_GT).pass).toBe(true);
  });

  it('FAIL si el snippet sugerido todavia contiene el sink original', () => {
    const rem: RemediationSuggestion = {
      summary: 'Replace eval with parser',
      recommendation: 'use JSON.parse',
      fixedSnippet: 'try { eval(userInput); } catch (e) {}', // sigue con eval
    };
    const result = remediationPass(rem, REMEDIATION_GT);
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/forbidden patterns/);
  });

  it('PASS sin snippet (remediation puede ser solo proceso/config)', () => {
    const rem: RemediationSuggestion = {
      summary: 'Replace eval with safer alternative',
      recommendation: 'Adopt JSON.parse in the codebase guidelines',
    };
    expect(remediationPass(rem, REMEDIATION_GT).pass).toBe(true);
  });
});

describe('buildSyntheticFinding', () => {
  const entry: GroundTruthEntry = {
    fixturePath: 'packages/scouts/tests/x/eval.js',
    line: 6,
    category: 'SAST',
    ruleId: 'sentinel-js-eval-usage',
    severity: 'high',
    description: 'eval() on user input',
    triage: { classification: 'true_positive', minConfidence: 0.8, requiredKeywords: ['eval'] },
    reviewedBy: 'ai-draft',
  };

  it('construye un Finding con los campos clave del ground truth', () => {
    const finding = buildSyntheticFinding(entry);
    expect(finding.ruleId).toBe('sentinel-js-eval-usage');
    expect(finding.category).toBe('SAST');
    expect(finding.severity).toBe('high');
    // DG-084 A path leak fix: el path se anonimiza para no delatar el contexto
    // de testing al LLM ("tests/...fixtures/vulnerable/" → "src/eval.js").
    expect(finding.location.path).toBe('src/eval.js');
    expect(finding.location.startLine).toBe(6);
    expect(finding.scoutId).toBe('opengrep'); // mapping SAST -> opengrep
  });

  it('agrega el snippet cuando se provee', () => {
    const finding = buildSyntheticFinding(entry, 'return eval(userInput);');
    expect(finding.location.snippet).toBe('return eval(userInput);');
  });

  it('mapea cada categoria a su scoutId canonico', () => {
    expect(buildSyntheticFinding({ ...entry, category: 'Secrets' }).scoutId).toBe('gitleaks');
    expect(buildSyntheticFinding({ ...entry, category: 'SCA' }).scoutId).toBe('trivy');
    expect(buildSyntheticFinding({ ...entry, category: 'IaC' }).scoutId).toBe('checkov');
    expect(buildSyntheticFinding({ ...entry, category: 'VibeCoded' }).scoutId).toBe('vibe-detect');
  });

  it('el fingerprint usa el path anonimizado (consistencia interna)', () => {
    const finding = buildSyntheticFinding(entry);
    expect(finding.fingerprint).toBe('src/eval.js:sentinel-js-eval-usage:6');
  });
});

describe('anonymizeFixturePath (DG-084 A path leak fix)', () => {
  it('preserva el lenguaje cuando el penultimo segmento es javascript/typescript/python', () => {
    expect(
      anonymizeFixturePath(
        'packages/scouts/tests/opengrep/fixtures/vulnerable/javascript/eval-injection.js',
      ),
    ).toBe('src/javascript/eval-injection.js');
    expect(
      anonymizeFixturePath(
        'packages/scouts/tests/opengrep/fixtures/vulnerable/typescript/dynamic-code.ts',
      ),
    ).toBe('src/typescript/dynamic-code.ts');
    expect(
      anonymizeFixturePath(
        'packages/scouts/tests/opengrep/fixtures/vulnerable/python/code-injection.py',
      ),
    ).toBe('src/python/code-injection.py');
  });

  it('descarta el penultimo segmento cuando no es un lenguaje (secrets, iac, vibe-coded)', () => {
    expect(anonymizeFixturePath('packages/scouts/tests/gitleaks/fixtures/secrets/leaked.js')).toBe(
      'src/leaked.js',
    );
    expect(anonymizeFixturePath('packages/scouts/tests/checkov/fixtures/iac/Dockerfile')).toBe(
      'src/Dockerfile',
    );
    expect(
      anonymizeFixturePath('packages/scouts/tests/vibe-detect/fixtures/vibe-coded/config.py'),
    ).toBe('src/config.py');
  });

  it('elimina las pistas tests/, fixtures/, vulnerable/ de cualquier path', () => {
    const out = anonymizeFixturePath(
      'packages/scouts/tests/opengrep/fixtures/vulnerable/javascript/xss.js',
    );
    expect(out).not.toContain('tests');
    expect(out).not.toContain('fixtures');
    expect(out).not.toContain('vulnerable');
  });

  it('maneja paths cortos sin crash', () => {
    expect(anonymizeFixturePath('eval.js')).toBe('src/eval.js');
    expect(anonymizeFixturePath('javascript/eval.js')).toBe('src/javascript/eval.js');
    expect(anonymizeFixturePath('')).toBe('src/unknown');
  });
});
