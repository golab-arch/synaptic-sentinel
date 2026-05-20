import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('@synaptic-sentinel/core', () => {
  it('expone el identificador del paquete', () => {
    expect(PACKAGE_NAME).toBe('@synaptic-sentinel/core');
  });
});
