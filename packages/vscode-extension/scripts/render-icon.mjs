import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Generador del icono de la extension (DG-065 A).
 *
 * Renderiza media/icon.png (128x128 RGBA) desde primitivas (rectangulos,
 * circulos, lineas) que reproducen el SVG en media/icon.svg, alineado con la
 * familia SYNAPTIC (fondo #1a1a2e, glifo de neurona) + el escudo de Sentinel.
 * Pure Node (zlib + Buffer): cero dependencias. Ejecutar con
 * `node scripts/render-icon.mjs` solo cuando se cambien los datos del diseño.
 *
 * Por que un encoder PNG hecho a mano: no hay magick / inkscape / rsvg-convert
 * disponibles en el entorno, y agregar `sharp` o `@resvg/resvg-js` reintroduce
 * el riesgo de ABI nativa que esta sesion ya cerro (FI-001).
 */

const W = 128;
const H = 128;

/** Paleta — espeja media/icon.svg. */
const BG = [0x1a, 0x1a, 0x2e, 0xff];
const SHIELD = [0x6c, 0x7f, 0xbd, 0xff];
const NEURON = [0xa8, 0xc5, 0xff, 0xff];

/** Plano RGBA: H filas * W columnas * 4 canales. */
const pixels = Buffer.alloc(W * H * 4);

function setPixel(x, y, color) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  pixels[i] = color[0];
  pixels[i + 1] = color[1];
  pixels[i + 2] = color[2];
  pixels[i + 3] = color[3];
}

function fillRect(x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPixel(x, y, color);
}

/** Circulo relleno via test de distancia. */
function fillCircle(cx, cy, r, color) {
  const r2 = r * r;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) setPixel(x, y, color);
    }
  }
}

/** Linea gruesa (Bresenham + "brocha" cuadrada para grosor entero). */
function drawLine(x0, y0, x1, y1, color, width) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  const half = Math.floor(width / 2);
  for (;;) {
    fillRect(x - half, y - half, x + half, y + half, color);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Pinta el icono. */
function paint() {
  // Fondo navy.
  fillRect(0, 0, W - 1, H - 1, BG);

  // Marco tipo escudo (mismo trazado que el SVG: M 24 28 L 24 88 L 64 108 L 104 88 L 104 28).
  drawLine(24, 28, 24, 88, SHIELD, 3);
  drawLine(24, 88, 64, 108, SHIELD, 3);
  drawLine(64, 108, 104, 88, SHIELD, 3);
  drawLine(104, 88, 104, 28, SHIELD, 3);

  // 3 conectores de la neurona, primero (para que los nodos queden por encima).
  drawLine(64, 46, 64, 55, NEURON, 3); // central -> superior
  drawLine(58, 72, 51, 78, NEURON, 3); // central -> inferior izquierdo
  drawLine(70, 72, 77, 78, NEURON, 3); // central -> inferior derecho

  // 4 nodos.
  fillCircle(64, 40, 6, NEURON); // superior
  fillCircle(46, 82, 6, NEURON); // inferior izquierdo
  fillCircle(82, 82, 6, NEURON); // inferior derecho
  fillCircle(64, 64, 9, NEURON); // central (mas grande)
}

/** Codificador PNG minimo (firma + IHDR + IDAT + IEND). */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildIhdr() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: standard
  ihdr[12] = 0; // interlace: none
  return chunk('IHDR', ihdr);
}

function buildIdat() {
  // Cada scanline lleva un byte de filtro (0 = ninguno) seguido de W*4 bytes RGBA.
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 4)] = 0;
    pixels.copy(raw, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
  }
  return chunk('IDAT', deflateSync(raw));
}

function buildPng() {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, buildIhdr(), buildIdat(), chunk('IEND', Buffer.alloc(0))]);
}

paint();
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'media', 'icon.png');
writeFileSync(out, buildPng());
