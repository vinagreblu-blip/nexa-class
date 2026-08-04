/**
 * Helpers compartilhados entre handlers IPC.
 * Antes estes eram duplicados em 2-3 arquivos cada (declaracao.ts, diploma.ts, historico.ts,
 * documentos.ts, conversoes.ts, extracao.ts).
 */
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import type { Aluno } from '../types';

/**
 * Hash SHA-256 do conteúdo do documento para verificação de integridade.
 * Concatena campos estáveis do aluno + timestamp de emissão.
 */
export function gerarHashConteudo(aluno: Aluno, emitidoEm: string): string {
  const payload = [aluno.id, aluno.matricula, aluno.nome, aluno.cpf ?? '', aluno.curso ?? '', emitidoEm].join('|');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Gera QR Code em PNG a partir de uma URL.
 * Tamanho 240px, margem 1, cores preto e branco (compatível com impressão).
 */
export async function gerarQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    margin: 1,
    width: 240,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

/**
 * Escape de caracteres especiais para conteúdo XML.
 * Escapa: & < > " '
 */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Fuso de Brasília (UTC−3, sem horário de verão desde 2019).
 * Identificador IANA usado em todas as exibições de data/hora dos documentos.
 */
const TZ_BRASILIA = 'America/Sao_Paulo';

/**
 * Formata um ISO timestamp em "dd/mm/aaaa hh:mm" no horário de Brasília.
 * Usado nos rodapés/campos de emissão dos PDFs.
 */
export function formatarDataHoraBrasilia(iso: string | Date): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: TZ_BRASILIA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formata um ISO timestamp por extenso em Brasília (ex.: "04 de agosto de 2026").
 * Usado no texto cerimonial do diploma.
 */
export function formatarDataExtensoBrasilia(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    timeZone: TZ_BRASILIA,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Extrai imagens JPEG embutidas em PDF (DCTDecode filter).
 * Usado para OCR quando pdfjs não encontra texto direto.
 * Threshold de 5KB filtra ícones pequenos (provável foto do documento).
 */
export function extrairJPEGsDoPDF(buf: Buffer): Buffer[] {
  const imagens: Buffer[] = [];
  const SOI = Buffer.from([0xff, 0xd8]); // JPEG Start of Image
  const EOI = Buffer.from([0xff, 0xd9]); // JPEG End of Image
  let pos = 0;
  while (pos < buf.length - 1) {
    const soi = buf.indexOf(SOI, pos);
    if (soi === -1) break;
    const eoi = buf.indexOf(EOI, soi + 2);
    if (eoi === -1) break;
    const jpeg = buf.subarray(soi, eoi + 2);
    if (jpeg.length > 5000) imagens.push(Buffer.from(jpeg));
    pos = eoi + 2;
  }
  return imagens;
}
