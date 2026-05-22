/**
 * Convierte los saltos de linea a CRLF.
 *
 * Un Pseudoterminal de VSCode interpreta `\n` solo como "bajar una linea"
 * (sin volver a la columna 0): sin esta conversion el texto aparece
 * "escalonado". La salida de la CLI usa LF; aqui se normaliza a CRLF.
 */
export function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}
