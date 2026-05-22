import { describe, it, expect } from 'vitest';
import { toCrlf } from '../src/terminal-format.js';

describe('toCrlf', () => {
  it('convierte LF en CRLF', () => {
    expect(toCrlf('a\nb\nc')).toBe('a\r\nb\r\nc');
  });

  it('no duplica un CRLF ya existente', () => {
    expect(toCrlf('a\r\nb')).toBe('a\r\nb');
  });

  it('deja intacto un texto sin saltos de linea', () => {
    expect(toCrlf('sin saltos')).toBe('sin saltos');
  });

  it('preserva un retorno de carro suelto (la animacion del spinner lo usa)', () => {
    expect(toCrlf('\r⠋ escaneando')).toBe('\r⠋ escaneando');
  });
});
