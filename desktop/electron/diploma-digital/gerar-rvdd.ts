// ============================================================
// RVDD — REPRESENTAÇÃO VISUAL DO DIPLOMA DIGITAL (PDF/A-1b)
// ============================================================
// PDF visual do diploma registrado: dados oficiais + QR apontando
// para a consulta pública /d/:codigo (URL do serviço de verificação —
// sem dados sensíveis no QR). NÃO substitui o diploma impresso
// tradicional: é a representação visual do documento digital.
//
// CONFORMIDADE PDF/A-1b (ISO 19005-1 nível b): fontes TrueType EMBUTIDAS
// (Noto Sans OFL — base-14 não embutida é não-conforme), PDF 1.4 e, no
// pós-processo (pdfa.ts), OutputIntent ICC sRGB + XMP pdfaid:part=1
// conformance=B + serialização sem object streams. A conformidade é
// AUTOVERIFICADA estruturalmente (verificarPdfA1b) e, com o veraPDF
// configurado (config 'verapdf'/env NEXA_VERAPDF), validada pelo motor
// oficial — o resultado vai para diploma_arquivos.conformidade_pdfa.
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { gerarQrPng } from '../utils';
import { caminhoAsset, converterParaPdfA1b } from './pdfa';

export interface DadosRvdd {
  alunoNome: string;
  cpf: string; // 11 dígitos
  cursoNome: string;
  grauConferido: string;
  tituloConferido: string;
  iesNome: string;
  iesCodigoEmec: number | string;
  livroRegistro: string;
  numeroRegistro: string;
  dataColacao: string; // AAAA-MM-DD
  dataExpedicao: string;
  dataRegistro: string;
  codigoValidacao: string; // eMEC.eMEC.hex
  chaveAcesso: string; // VDip{44}
  /** URL pública da consulta (serviço de verificação /d/:codigo) — o QR aponta para ela. */
  urlConsulta: string;
}

function fontesNoto(): { regular: string; bold: string } {
  const regular = caminhoAsset(path.join('fonts', 'NotoSans-Regular.ttf'));
  const bold = caminhoAsset(path.join('fonts', 'NotoSans-Bold.ttf'));
  if (!fs.existsSync(regular) || !fs.existsSync(bold)) {
    throw new Error(
      'Fontes Noto Sans não encontradas (assets/fonts) — necessárias para a conformidade PDF/A-1b. ' +
        'Reinstale o app ou verifique assets/ no repositório.'
    );
  }
  return { regular, bold };
}

/**
 * Gera o PDF/A-1b da RVDD. Erros de fonte/QR/PDF-A abortam — RVDD nunca
 * é gerada incompleta (nem "quase PDF/A").
 */
export async function gerarRvddPdf(d: DadosRvdd): Promise<Buffer> {
  const qr = await gerarQrPng(d.urlConsulta);
  const { regular, bold } = fontesNoto();
  const tituloDoc = `RVDD — ${d.alunoNome} — ${d.cursoNome}`;

  const bruto = await new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 56,
        pdfVersion: '1.4', // PDF/A-1 é baseado no PDF 1.4
        displayTitle: true,
        info: {
          Title: tituloDoc,
          Author: d.iesNome,
          Subject: 'Representação Visual do Diploma Digital (PDF/A-1b)',
          Creator: 'NEXA CLASS — Diploma Digital MEC',
          Producer: 'NEXA CLASS (pdfkit + pdf-lib)',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.registerFont('Noto', regular);
      doc.registerFont('NotoBold', bold);

      const W = doc.page.width;
      const cx = W / 2;

      // Cabeçalho institucional
      doc.font('NotoBold').fontSize(13).fillColor('#1f2937');
      doc.text(String(d.iesNome).toUpperCase(), cx, 56, { align: 'center' });
      doc.font('Noto').fontSize(8.5).fillColor('#6b7280');
      doc.text(`e-MEC ${d.iesCodigoEmec} — REPÚBLICA FEDERATIVA DO BRASIL`, { align: 'center' });
      doc.moveTo(56, 96).lineTo(W - 56, 96).lineWidth(1).strokeColor('#d1d5db').stroke();

      // Título
      doc.font('NotoBold').fontSize(15).fillColor('#111827');
      doc.text('REPRESENTAÇÃO VISUAL DO DIPLOMA DIGITAL', cx, 116, { align: 'center' });
      doc.font('Noto').fontSize(8).fillColor('#9ca3af');
      doc.text('Documento digital registrado — a autenticidade é validada pelo código/QR abaixo', { align: 'center' });

      // Corpo
      const linha = (label: string, valor: string, y: number) => {
        doc.font('Noto').fontSize(8.5).fillColor('#6b7280').text(label, 96, y);
        doc.font('NotoBold').fontSize(11.5).fillColor('#111827').text(valor, 96, y + 13);
      };
      linha('DIPLOMADO(A)', d.alunoNome, 176);
      linha('CPF', d.cpf, 216);
      linha('CURSO', d.cursoNome, 256);
      linha(
        'GRAU / TÍTULO',
        `${d.grauConferido} — ${d.tituloConferido}`,
        296
      );
      linha(
        'REGISTRO',
        `Livro ${d.livroRegistro} · Reg. ${d.numeroRegistro} · Colação ${d.dataColacao} · Expedição ${d.dataExpedicao} · Registro ${d.dataRegistro}`,
        336
      );

      // QR + código (canto direito)
      doc.image(qr, W - 190, 176, { width: 118 });
      doc.font('Noto').fontSize(6.8).fillColor('#94a3b8');
      doc.text('Consulte a autenticidade:', W - 190, 300, { width: 118, align: 'center' });
      doc.font('Noto').fontSize(6.4).fillColor('#475569');
      doc.text(d.codigoValidacao, W - 190, 314, { width: 118, align: 'center' });

      // Rodapé com chave de acesso
      doc.moveTo(56, 400).lineTo(W - 56, 400).strokeColor('#e5e7eb').stroke();
      doc.font('Noto').fontSize(7.5).fillColor('#6b7280');
      doc.text(
        `Chave de acesso: ${d.chaveAcesso}`,
        cx,
        412,
        { align: 'center', width: W - 112 }
      );
      doc.fontSize(6.5).fillColor('#9ca3af');
      doc.text(
        'Este documento é a representação visual de diploma digital. A versão eletrônica assinada é o documento oficial.',
        cx,
        428,
        { align: 'center', width: W - 112 }
      );

      doc.end();
    } catch (e) {
      reject(e as Error);
    }
  });

  // Pós-processo PDF/A-1b: OutputIntent ICC + XMP pdfaid + header 1.4
  return converterParaPdfA1b(bruto, { titulo: tituloDoc, criador: 'NEXA CLASS — Diploma Digital MEC' });
}
