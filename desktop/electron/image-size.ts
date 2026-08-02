import fs from 'node:fs';
import { inflateSync } from 'node:zlib';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ContentBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
  baseline: number;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Lê dimensões de PNG, JPG/JPEG sem bibliotecas externas */
export function getImageSize(filePath: string): ImageDimensions {
  const buf = fs.readFileSync(filePath);

  // PNG: assinatura nos primeiros 8 bytes, width em 16-19, height em 20-23
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // JPEG: percorre os marcadores até achar SOF0 (0xFFC0) ou SOF2 (0xFFC2)
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length - 1) {
      if (buf[offset] !== 0xff) { offset++; continue; }
      const marker = buf[offset + 1];
      // SOF0, SOF1, SOF2, SOF3 (0xC0-C3), SOF5-SOF7, SOF9-SOF11, SOF13-SOF15
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return { width, height };
      }
      // Próximo segmento
      const segLen = buf.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
  }

  // Fallback
  return { width: 200, height: 80 };
}

/**
 * Detecta o bounding box do conteúdo NÃO-TRANSPARENTE de um PNG com canal alpha.
 * Retorna null se o PNG não tiver alpha ou se for totalmente transparente.
 */
export function getPngContentBounds(filePath: string): ContentBounds | null {
  const buf = fs.readFileSync(filePath);

  // Verifica assinatura PNG
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;

  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buf.length - 8) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4; // +4 para o CRC
  }

  // Só funciona com canal alpha: colorType 6 (RGBA) ou 4 (Gray+Alpha)
  if (colorType !== 6 && colorType !== 4) return null;
  if (bitDepth !== 8) return null;

  const channels = colorType === 6 ? 4 : 2;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(height * stride);
  let rawOffset = 0;

  // Defiltering scanline por scanline
  for (let y = 0; y < height; y++) {
    const filter = raw[rawOffset++];
    const scanline = raw.subarray(rawOffset, rawOffset + stride);
    rawOffset += stride;
    const prevRow = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    const curRow = pixels.subarray(y * stride, (y + 1) * stride);

    switch (filter) {
      case 0: // None
        scanline.copy(curRow);
        break;
      case 1: // Sub
        for (let i = 0; i < stride; i++) {
          const left = i >= channels ? curRow[i - channels] : 0;
          curRow[i] = (scanline[i] + left) & 0xff;
        }
        break;
      case 2: // Up
        for (let i = 0; i < stride; i++) {
          const up = prevRow ? prevRow[i] : 0;
          curRow[i] = (scanline[i] + up) & 0xff;
        }
        break;
      case 3: // Average
        for (let i = 0; i < stride; i++) {
          const left = i >= channels ? curRow[i - channels] : 0;
          const up = prevRow ? prevRow[i] : 0;
          curRow[i] = (scanline[i] + Math.floor((left + up) / 2)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let i = 0; i < stride; i++) {
          const left = i >= channels ? curRow[i - channels] : 0;
          const up = prevRow ? prevRow[i] : 0;
          const upLeft = (prevRow && i >= channels) ? prevRow[i - channels] : 0;
          curRow[i] = (scanline[i] + paethPredictor(left, up, upLeft)) & 0xff;
        }
        break;
    }
  }

  // Índice do canal alpha (último canal de cada pixel)
  const alphaIndex = channels - 1;
  let top = height, bottom = -1, left = width, right = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = pixels[y * stride + x * channels + alphaIndex];
      if (alpha > 10) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  if (bottom === -1) return null;

  // Detecta a baseline do texto: ultima linha com densidade significativa (>= 3% da largura).
  // Ignora descenders (g, j, p, y) que tem poucos pixels e ficam abaixo da baseline.
  const threshold = Math.max(5, Math.floor(width * 0.03));
  let baseline = bottom;
  for (let y = bottom; y >= top; y--) {
    let count = 0;
    for (let x = left; x <= right; x++) {
      if (pixels[y * stride + x * channels + alphaIndex] > 10) count++;
    }
    if (count >= threshold) { baseline = y; break; }
  }

  return { top, bottom, left, right, baseline };
}
