import { describe, it, expect } from 'vitest';
import { checkExtensionHostRuntime, MIN_NODE_VERSION } from '../src/runtime-check.js';

describe('checkExtensionHostRuntime', () => {
  it('acepta exactamente la version minima', () => {
    expect(checkExtensionHostRuntime(MIN_NODE_VERSION).ok).toBe(true);
  });

  it('acepta una version mayor por minor', () => {
    expect(checkExtensionHostRuntime('22.14.0').ok).toBe(true);
  });

  it('acepta una version mayor por major', () => {
    expect(checkExtensionHostRuntime('24.11.1').ok).toBe(true);
  });

  it('tolera el prefijo "v"', () => {
    expect(checkExtensionHostRuntime('v22.5.0').ok).toBe(true);
  });

  it('rechaza una version anterior por minor y da un mensaje accionable', () => {
    const result = checkExtensionHostRuntime('22.4.0');
    expect(result.ok).toBe(false);
    expect(result.message).toContain(MIN_NODE_VERSION);
    expect(result.message).toContain('22.4.0');
  });

  it('rechaza una version anterior por major', () => {
    expect(checkExtensionHostRuntime('20.18.0').ok).toBe(false);
  });

  it('rechaza el patch inmediatamente anterior a la version minima', () => {
    expect(checkExtensionHostRuntime('22.4.99').ok).toBe(false);
  });
});
