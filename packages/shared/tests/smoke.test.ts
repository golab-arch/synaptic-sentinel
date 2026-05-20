import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('@synaptic-sentinel/shared', () => {
  it('expone el identificador del paquete', () => {
    expect(PACKAGE_NAME).toBe('@synaptic-sentinel/shared');
  });
});
