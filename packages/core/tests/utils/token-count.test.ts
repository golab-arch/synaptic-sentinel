import { describe, it, expect } from 'vitest';
import { proxyTokenCount } from '../../src/utils/token-count.js';

describe('proxyTokenCount', () => {
  it('retorna 0 para string vacio', () => {
    expect(proxyTokenCount('')).toBe(0);
  });

  it('retorna 1 para 1-4 chars (Math.ceil(n/4))', () => {
    expect(proxyTokenCount('a')).toBe(1);
    expect(proxyTokenCount('ab')).toBe(1);
    expect(proxyTokenCount('abc')).toBe(1);
    expect(proxyTokenCount('abcd')).toBe(1);
  });

  it('retorna 2 para 5-8 chars', () => {
    expect(proxyTokenCount('abcde')).toBe(2);
    expect(proxyTokenCount('abcdefgh')).toBe(2);
  });

  it('retorna 25 para 100 chars (heuristica chars/4)', () => {
    expect(proxyTokenCount('x'.repeat(100))).toBe(25);
  });

  it('retorna numero positivo para strings largos', () => {
    const text = 'lorem ipsum '.repeat(1000); // ~12000 chars
    const tokens = proxyTokenCount(text);
    expect(tokens).toBeGreaterThan(2000);
    expect(tokens).toBeLessThan(4000);
  });
});
