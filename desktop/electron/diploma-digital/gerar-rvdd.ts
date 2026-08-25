// ============================================================
// RVDD — REPRESENTAÇÃO VISUAL DO DIPLOMA DIGITAL
// ============================================================
// PDF visual do diploma registrado: dados oficiais + QR apontando
// para a consulta pública /d/:codigo (URL do serviço de verificação —
// sem dados sensíveis no QR). NÃO substitui o diploma impresso
// tradicional: é a representação visual do documento digital.
//
// CONFORMIDADE PDF/A: o XSD da DA exige PDF/A para documentos
// COMPROBATÓRIOS anexados; a RVDD do diploma deve seguir a
// especificação oficial (IN-05 anexos). A geração abaixo produz PDF
// visualmente completo, porém a CONFORMIDADE PDF/A-1b NÃO é afirmada
// — requer OutputIntent ICC + verificação veraPDF (pendência
// documentada em DIPLOMA_DIGITAL.md; gravada como valido_xsd=NULL).
import PDFDocument from 'pdfkit';
import { gerarQrPng } from '../utils';

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

/**
 * Gera o PDF da RVDD. @onDone recebe os bytes (stream finalizado).
 * Erros de fonte/QR abortam — RVDD nunca é gerada incompleta.
 */
export async function gerarRvddPdf(d: DadosRvdd): Promise<Buffer> {
  const qr = await gerarQrPng(d.urlConsulta);

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 56 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;
      const cx = W / 2;

      // Cabeçalho institucional
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#1f2937');
      doc.text(String(d.iesNome).toUpperCase(), cx, 56, { align: 'center' });
      doc.font('Helvetica').fontSize(8.5).fillColor('#6b7280');
      doc.text(`e-MEC ${d.iesCodigoEmec} — REPÚBLICA FEDERATIVA DO BRASIL`, { align: 'center' });
      doc.moveTo(56, 96).lineTo(W - 56, 96).lineWidth(1).strokeColor('#d1d5db').stroke();

      // Título
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#111827');
      doc.text('REPRESENTAÇÃO VISUAL DO DIPLOMA DIGITAL', cx, 116, { align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor('#9ca3af');
      doc.text('Documento digital registrado — a autenticidade é validada pelo código/QR abaixo', { align: 'center' });

      // Corpo
      const linha = (label: string, valor: string, y: number) => {
        doc.font('Helvetica').fontSize(8.5).fillColor('#6b7280').text(label, 96, y);
        doc.font('Helvetica-Bold').fontSize(11.5).fillColor('#111827').text(valor, 96, y + 13);
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
      doc.font('Helvetica').fontSize(6.8).fillColor('#94a3b8');
      doc.text('Consulte a autenticidade:', W - 190, 300, { width: 118, align: 'center' });
      doc.font('Courier').fontSize(6.4).fillColor('#475569');
      doc.text(d.codigoValidacao, W - 190, 314, { width: 118, align: 'center' });

      // Rodapé com chave de acesso
      doc.moveTo(56, 400).lineTo(W - 56, 400).strokeColor('#e5e7eb').stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor('#6b7280');
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
}
