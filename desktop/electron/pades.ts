import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import signpdf from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { getAssinaturaAtiva, traduzirErroA3 } from './ipc/assinatura';
import { SignerA3 } from './pades-a3';
import { logger } from './utils/logger';

export interface ResultadoPades {
  ok: boolean;
  error?: string;
}

export interface PadesOpts {
  /** Senha do PFX — usada apenas no A1. Ignorada no A3 (PIN vem pelo driver do token). */
  senha?: string;
  /** Texto do campo "Reason" (motivo) da assinatura. */
  razao?: string;
}

/**
 * Assina um PDF em disco com PAdES (adbe.pkcs7.detached / CAdES detached) usando o
 * certificado ativo: A1 (arquivo .pfx) ou A3 (token USB/SmartCard).
 *
 * Fluxo:
 *   1. Lê o PDF gerado pelo pdfkit.
 *   2. Adiciona um placeholder de assinatura (pdf-lib + @signpdf/placeholder-pdf-lib).
 *   3. Escolhe o Signer conforme o tipo (A1 → P12Signer, A3 → SignerA3).
 *   4. @signpdf/signpdf calcula o ByteRange, chama signer.sign() e embute o CMS.
 *   5. Sobrescreve o arquivo original pelo PDF assinado.
 */
export async function assinarPdfPades(pdfPath: string, opts: PadesOpts = {}): Promise<ResultadoPades> {
  const ass = getAssinaturaAtiva();
  if (!ass) {
    return { ok: false, error: 'Nenhum certificado digital cadastrado. Vá em Assinatura Digital para cadastrar.' };
  }

  const ehA3 = ass.certificado_tipo === 'A3' && !!ass.certificado_a3_thumbprint;
  const ehA1 = !!ass.certificado_path && fs.existsSync(ass.certificado_path);
  if (!ehA3 && !ehA1) {
    return { ok: false, error: 'Certificado ativo não encontrado. Reimporte o certificado em Assinatura Digital.' };
  }

  try {
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    pdflibAddPlaceholder({
      pdfDoc,
      reason: opts.razao || 'Assinatura digital ICP-Brasil',
      contactInfo: ass.nome_signatario || '',
      name: ass.nome_signatario || '',
      location: 'Brasil',
    });
    const placeholderPdf = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));

    const signer = ehA3
      ? new SignerA3({ thumbprint: ass.certificado_a3_thumbprint as string })
      : new P12Signer(fs.readFileSync(ass.certificado_path as string), { passphrase: opts.senha || '' });

    const signedPdf = await signpdf.sign(placeholderPdf, signer);

    fs.writeFileSync(pdfPath, signedPdf);
    return { ok: true };
  } catch (e: any) {
    const msg = (e?.message ?? '').toString();
    logger.error({ err: msg, a3: ehA3 }, 'assinarPdfPades: falha ao assinar PDF');
    if (ehA3) return { ok: false, error: traduzirErroA3(msg) };
    return { ok: false, error: 'Falha ao assinar o PDF: ' + (msg || 'verifique a senha do certificado') };
  }
}

/**
 * Assina o PDF automaticamente quando há certificado ativo configurado.
 * Não assina quando: o usuário pediu "sem assinatura" ou não há certificado
 * (nesse caso o documento segue válido, apenas com a imagem + o texto impresso).
 */
export async function assinarPdfSeConfigurado(
  pdfPath: string,
  opts: { semAssinatura?: boolean; senha?: string; razao?: string } = {}
): Promise<ResultadoPades> {
  if (opts.semAssinatura) return { ok: true };
  const ass = getAssinaturaAtiva();
  if (!ass) return { ok: true };
  const temCert =
    (ass.certificado_tipo === 'A3' && !!ass.certificado_a3_thumbprint) ||
    (!!ass.certificado_path && fs.existsSync(ass.certificado_path));
  if (!temCert) return { ok: true };
  return assinarPdfPades(pdfPath, { senha: opts.senha, razao: opts.razao });
}
