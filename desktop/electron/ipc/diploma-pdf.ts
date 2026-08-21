import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { getImageSize, getPngContentBounds } from '../image-size';
import { formatarDataExtensoBrasilia } from '../utils';
import type { FaculdadeInfo } from '../faculdades';
import type { Aluno } from '../types';

export interface AssinaturaDiplomaInfo {
  nome_signatario?: string | null;
  cargo?: string | null;
  imagem_path?: string | null;
  certificado_path?: string | null;
  certificado_tipo?: string | null;
  certificado_a3_thumbprint?: string | null;
}

export interface DiplomaPdfOpts {
  aluno: Aluno;
  codigo: string;
  hash: string;
  qrBuffer: Buffer;
  emitidoEm: string;
  destinoPath: string;
  cursoTexto: string;
  cursoRegulatory?: string;
  cargaHorariaTotal: number;
  faculdadeNome: string;
  diretor: string;
  emitidoPorNome: string;
  faculdade: FaculdadeInfo;
  assinatura?: AssinaturaDiplomaInfo | null;
  semAssinatura?: boolean;
}

function desenharMarcaDagua(
  doc: PDFKit.PDFDocument,
  largura: number,
  altura: number,
  logoPath: string | null | undefined
): void {
  if (!logoPath || !fs.existsSync(logoPath)) return;
  try {
    const dim = getImageSize(logoPath);
    const wMark = Math.min(320, dim.width);
    const hMark = (dim.height / dim.width) * wMark;
    doc.save().opacity(0.06);
    doc.image(logoPath, (largura - wMark) / 2, (altura - hMark) / 2, { width: wMark });
    doc.restore();
  } catch { /* ignora */ }
}

function desenharMoldura(doc: PDFKit.PDFDocument, largura: number, altura: number, cor: string): void {
  const m = 35;
  const g = 8;
  const c = m + g;
  doc.save().strokeColor(cor);
  doc.lineWidth(2.5).rect(m, m, largura - 2 * m, altura - 2 * m).stroke();
  doc.lineWidth(0.75).rect(c, c, largura - 2 * c, altura - 2 * c).stroke();
  const o = 16;
  doc.lineWidth(1);
  doc.moveTo(c + o, c).lineTo(c, c + o);
  doc.moveTo(largura - c - o, c).lineTo(largura - c, c + o);
  doc.moveTo(c, altura - c - o).lineTo(c + o, altura - c);
  doc.moveTo(largura - c, altura - c - o).lineTo(largura - c - o, altura - c);
  doc.stroke();
  doc.restore();
}

function desenharFileteLosango(doc: PDFKit.PDFDocument, centro: number, y: number, cor: string): void {
  doc.save().strokeColor(cor).lineWidth(0.75);
  doc.moveTo(centro - 110, y).lineTo(centro - 12, y).stroke();
  doc.moveTo(centro + 12, y).lineTo(centro + 110, y).stroke();
  doc.restore();
  const los = 3.4;
  doc.save().fillColor(cor);
  doc.polygon([centro, y - los], [centro + los, y], [centro, y + los], [centro - los, y]);
  doc.fill();
  doc.restore();
}

export function gerarPdf(opts: DiplomaPdfOpts): Promise<void> {
  const { aluno, codigo, hash, qrBuffer, emitidoEm, destinoPath, cursoTexto, cursoRegulatory, cargaHorariaTotal, faculdadeNome, diretor, emitidoPorNome, faculdade, assinatura, semAssinatura } = opts;

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
  const stream = fs.createWriteStream(destinoPath);
  stream.on('error', () => {});
  doc.pipe(stream);

  const largura = doc.page.width;
  const altura = doc.page.height;
  const cor = faculdade.corDiploma || '#A8842C';
  const dateFmt = formatarDataExtensoBrasilia(emitidoEm);
  const logoExiste = !!(faculdade.logoPath && fs.existsSync(faculdade.logoPath));

  // ===== MARCA D'ÁGUA + MOLDURA (FRENTE) =====
  desenharMarcaDagua(doc, largura, altura, faculdade.logoPath);
  desenharMoldura(doc, largura, altura, cor);

  const esq = 58;
  const dir = largura - 58;
  const centro = largura / 2;

  // ===== CABEÇALHO =====
  let yTopo = 78;
  if (logoExiste) {
    try {
      const dim = getImageSize(faculdade.logoPath!);
      let hLogo = 46;
      let wLogo = (dim.width / dim.height) * hLogo;
      if (wLogo > 160) {
        wLogo = 160;
        hLogo = (dim.height / dim.width) * wLogo;
      }
      doc.image(faculdade.logoPath!, centro - wLogo / 2, 58, { width: wLogo });
      yTopo = 58 + hLogo + 6;
    } catch { /* ignora */ }
  }

  doc.fillColor('#000000');
  doc.font('Times-Bold').fontSize(14);
  doc.text(faculdade.nome.toUpperCase(), esq, yTopo, { width: dir - esq, align: 'center', characterSpacing: 1.5 });

  const infoParts: string[] = [];
  if (faculdade.cnpj) infoParts.push(`CNPJ ${faculdade.cnpj}`);
  if (faculdade.endereco) infoParts.push(faculdade.endereco);
  if (infoParts.length) {
    doc.font('Times-Roman').fontSize(7.5).fillColor('#555555');
    doc.text(infoParts.join('  •  '), esq + 60, yTopo + 21, { width: dir - esq - 120, align: 'center', lineGap: 1 });
  }

  // Filete decorativo com losango
  const yLinha = yTopo + 48;
  desenharFileteLosango(doc, centro, yLinha, cor);

  // ===== TÍTULO =====
  doc.font('Times-Bold').fontSize(30).fillColor('#000000');
  doc.text('DIPLOMA', esq, yLinha + 14, { width: dir - esq, align: 'center', characterSpacing: 8 });
  doc.font('Times-Italic').fontSize(11.5).fillColor(cor);
  doc.text('de conclusão de curso de graduação', esq, yLinha + 56, { width: dir - esq, align: 'center' });

  // ===== TEXTO PRINCIPAL =====
  const yTexto = yLinha + 82;
  doc.font('Times-Roman').fontSize(11).fillColor('#000000');
  doc.text(
    `O Diretor da ${faculdadeNome}, no uso de suas atribuições legais, confere o presente diploma de`,
    esq + 40, yTexto, { width: dir - esq - 80, align: 'center', lineGap: 3 }
  );

  // Nome do aluno em destaque com filetes laterais (auto-ajuste para 1 linha)
  const yNome = Math.max(yTexto + 26, doc.y + 10);
  const nomeLimit = dir - esq - 80;
  let nomeFont = 19;
  while (nomeFont > 13 && doc.font('Times-Bold').fontSize(nomeFont).widthOfString(aluno.nome) > nomeLimit) {
    nomeFont -= 0.5;
  }
  doc.font('Times-Bold').fontSize(nomeFont);
  const nomeW = doc.widthOfString(aluno.nome);
  if (nomeW < nomeLimit - 130) {
    const xNome = centro - nomeW / 2;
    const yFilete = yNome + nomeFont * 0.45;
    doc.save().strokeColor(cor).lineWidth(0.6);
    if (xNome - 16 > esq + 6) {
      doc.moveTo(esq + 6, yFilete).lineTo(xNome - 16, yFilete).stroke();
    }
    if (xNome + nomeW + 16 < dir - 6) {
      doc.moveTo(xNome + nomeW + 16, yFilete).lineTo(dir - 6, yFilete).stroke();
    }
    doc.restore();
  }
  doc.fillColor('#000000');
  doc.text(aluno.nome, esq + 40, yNome, { width: nomeLimit, align: 'center', lineGap: 2 });

  const yCurso = yNome + 32;
  doc.font('Times-Roman').fontSize(11).fillColor('#000000');
  doc.text(
    `concluiu o curso de ${cursoTexto}, com carga horária total de ${cargaHorariaTotal.toLocaleString('pt-BR')} horas/aula, ` +
      `tendo cumprido todos os requisitos acadêmicos necessários para a obtenção do título.`,
    esq + 60, yCurso, { width: dir - esq - 120, align: 'center', lineGap: 3 }
  );

  const yOutorga = Math.max(yCurso + 38, doc.y + 8);
  doc.text(
    `Em reconhecimento ao mérito e à dedicação demonstrados ao longo do curso, outorgamos-lhe o presente diploma ` +
      `para gozo de todos os direitos e prerrogativas a ele inerentes.`,
    esq + 60, yOutorga, { width: dir - esq - 120, align: 'center', lineGap: 3 }
  );

  // ===== DADOS DO ALUNO =====
  const yDados = Math.min(Math.max(yOutorga + 44, doc.y + 16), 404);
  const colunas: { label: string; valor: string }[] = [
    { label: 'MATRÍCULA', valor: aluno.matricula },
    { label: 'CPF', valor: aluno.cpf || '—' },
  ];
  if (aluno.data_nascimento) colunas.push({ label: 'NASCIMENTO', valor: aluno.data_nascimento });
  const passo = (dir - esq) / colunas.length;
  colunas.forEach((col, i) => {
    const xCol = esq + passo * i;
    doc.font('Times-Bold').fontSize(7).fillColor('#777777');
    doc.text(col.label, xCol, yDados, { width: passo, align: 'center', characterSpacing: 1 });
    doc.font('Times-Roman').fontSize(10.5).fillColor('#000000');
    doc.text(col.valor, xCol, yDados + 12, { width: passo, align: 'center' });
  });

  // ===== FAIXA INFERIOR =====
  // Coluna esquerda: assinatura do diplomado
  const xEsq = esq + 110;
  const linhaAssEsq = 506;
  doc.save().lineWidth(0.7).strokeColor('#000000');
  doc.moveTo(xEsq - 95, linhaAssEsq).lineTo(xEsq + 95, linhaAssEsq).stroke();
  doc.restore();
  let nomeAlunoFont = 10.5;
  while (nomeAlunoFont > 7.5 && doc.font('Times-Bold').fontSize(nomeAlunoFont).widthOfString(aluno.nome) > 186) {
    nomeAlunoFont -= 0.25;
  }
  doc.font('Times-Bold').fontSize(nomeAlunoFont).fillColor('#000000');
  doc.text(aluno.nome, xEsq - 95, linhaAssEsq + 4, { width: 190, align: 'center' });
  doc.font('Times-Italic').fontSize(9).fillColor('#444444');
  doc.text('Diplomado(a)', xEsq - 95, doc.y, { width: 190, align: 'center' });

  // Coluna central: data por extenso + selo
  doc.font('Times-Italic').fontSize(10.5).fillColor('#000000');
  doc.text(`${faculdadeNome}, aos ${dateFmt}.`, centro - 130, 426, { width: 260, align: 'center', lineGap: 2 });

  const seloCy = 504;
  doc.save().strokeColor(cor);
  doc.lineWidth(1.6).circle(centro, seloCy, 28).stroke();
  doc.lineWidth(0.6).circle(centro, seloCy, 21).stroke();
  const ptsEstrela: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 12 : 5;
    ptsEstrela.push([centro + r * Math.cos(ang), seloCy + r * Math.sin(ang)]);
  }
  doc.fillColor(cor);
  doc.polygon(...ptsEstrela);
  doc.fill();
  doc.restore();

  // Coluna direita: assinatura
  const xDir = dir - 110;
  const nomeAss = assinatura?.nome_signatario || diretor;
  const cargoAss = assinatura?.cargo || 'Diretor Geral';
  const temCertificado = !!(
    (assinatura?.certificado_path && fs.existsSync(assinatura.certificado_path)) ||
    (assinatura?.certificado_tipo === 'A3' && !!assinatura.certificado_a3_thumbprint)
  );
  const temImagem = !semAssinatura && !!(assinatura?.imagem_path && fs.existsSync(assinatura.imagem_path));

  let assW = 150;
  let assH = 0;
  if (temImagem) {
    try {
      const dim = getImageSize(assinatura!.imagem_path!);
      assH = (dim.height / dim.width) * assW;
      if (assH > 62) {
        assH = 62;
        assW = (dim.width / dim.height) * assH;
      }
    } catch { /* ignora */ }
  }
  const linhaAss = 506;
  if (temImagem) {
    try {
      const dim = getImageSize(assinatura!.imagem_path!);
      const bounds = getPngContentBounds(assinatura!.imagem_path!);
      const baselineFrac = bounds ? bounds.baseline / dim.height : 1;
      const imageTop = linhaAss - baselineFrac * assH + 2.835;
      doc.image(assinatura!.imagem_path!, xDir - assW / 2, imageTop, { width: assW });
    } catch { /* ignora */ }
  }
  doc.save().lineWidth(0.7).strokeColor('#000000');
  doc.moveTo(xDir - 95, linhaAss).lineTo(xDir + 95, linhaAss).stroke();
  doc.restore();
  doc.font('Times-Bold').fontSize(10.5).fillColor('#000000');
  doc.text(nomeAss, xDir - 95, linhaAss + 4, { width: 190, align: 'center' });
  doc.font('Times-Italic').fontSize(9).fillColor('#444444');
  doc.text(cargoAss, xDir - 95, doc.y, { width: 190, align: 'center' });
  if (temCertificado) {
    doc.font('Times-Roman').fontSize(6.5).fillColor('#777777');
    doc.text('Assinado digitalmente com certificado ICP-Brasil', xDir - 95, doc.y + 1, { width: 190, align: 'center' });
  }

  // ===================== VERSO (PÁGINA 2) =====================
  doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
  desenharMarcaDagua(doc, largura, altura, faculdade.logoPath);
  desenharMoldura(doc, largura, altura, cor);

  // Cabeçalho reduzido
  if (logoExiste) {
    try {
      const dim = getImageSize(faculdade.logoPath!);
      let hLogo = 30;
      let wLogo = (dim.width / dim.height) * hLogo;
      if (wLogo > 100) {
        wLogo = 100;
        hLogo = (dim.height / dim.width) * wLogo;
      }
      doc.image(faculdade.logoPath!, centro - wLogo / 2, 58, { width: wLogo });
    } catch { /* ignora */ }
  }
  doc.fillColor('#000000');
  doc.font('Times-Bold').fontSize(12);
  doc.text(faculdade.nome.toUpperCase(), esq, 94, { width: dir - esq, align: 'center', characterSpacing: 1.5 });
  desenharFileteLosango(doc, centro, 118, cor);

  // Título
  doc.font('Times-Bold').fontSize(18).fillColor('#000000');
  doc.text('REGISTRO', esq, 140, { width: dir - esq, align: 'center', characterSpacing: 5 });
  doc.font('Times-Italic').fontSize(9.5).fillColor(cor);
  doc.text('Verso do Diploma — Dados de Registro e Validação', esq, 166, { width: dir - esq, align: 'center' });

  // Coluna esquerda: dados de registro
  const regX = esq + 36;
  const regW = 360;
  const registros: { label: string; valor: string }[] = [
    { label: 'NOME', valor: aluno.nome },
    { label: 'MATRÍCULA', valor: aluno.matricula },
    { label: 'CPF', valor: aluno.cpf || '—' },
    { label: 'CURSO', valor: cursoTexto },
    { label: 'CARGA HORÁRIA', valor: `${cargaHorariaTotal.toLocaleString('pt-BR')} horas/aula` },
    { label: 'DATA DE EMISSÃO', valor: dateFmt },
    { label: 'EMITIDO POR', valor: emitidoPorNome },
  ];
  let yReg = 208;
  registros.forEach((r) => {
    doc.font('Times-Bold').fontSize(7.5).fillColor('#777777');
    doc.text(r.label, regX, yReg, { width: regW, align: 'left', characterSpacing: 1 });
    let valorFont = 11;
    while (valorFont > 8 && doc.font('Times-Roman').fontSize(valorFont).widthOfString(r.valor) > regW) {
      valorFont -= 0.25;
    }
    doc.font('Times-Roman').fontSize(valorFont).fillColor('#000000');
    doc.text(r.valor, regX, yReg + 11, { width: regW, align: 'left' });
    yReg += 38;
  });

  // Coluna direita: QR grande + código + hash
  const qrVSize = 120;
  const qrVX = dir - 200;
  doc.image(qrBuffer, qrVX, 196, { width: qrVSize, height: qrVSize });
  doc.font('Times-Roman').fontSize(8).fillColor('#666666');
  doc.text('Escaneie para verificar a autenticidade deste diploma', qrVX - 30, 322, { width: qrVSize + 60, align: 'center' });
  doc.font('Times-Bold').fontSize(7).fillColor('#777777');
  doc.text('CÓDIGO DE VERIFICAÇÃO', qrVX - 30, 340, { width: qrVSize + 60, align: 'center', characterSpacing: 1 });
  doc.font('Courier-Bold').fontSize(9).fillColor('#000000');
  doc.text(codigo, qrVX - 40, 353, { width: qrVSize + 80, align: 'center' });
  doc.font('Times-Roman').fontSize(6.5).fillColor('#888888');
  doc.text(`Hash: ${hash}`, qrVX - 40, 368, { width: qrVSize + 80, align: 'center', lineGap: 1 });

  // Rodapé: reconhecimento MEC + validade
  let yRod = 480;
  if (cursoRegulatory) {
    doc.font('Times-Italic').fontSize(7.5).fillColor('#555555');
    doc.text(cursoRegulatory, esq + 36, yRod, { width: dir - esq - 72, align: 'center', lineGap: 1 });
    yRod = Math.max(yRod + 18, doc.y + 6);
  }
  if (faculdade.registroRtd) {
    doc.font('Times-Italic').fontSize(7.5).fillColor('#555555');
    doc.text(`Registro: ${faculdade.registroRtd}`, esq + 36, yRod, { width: dir - esq - 72, align: 'center', lineGap: 1 });
    yRod = Math.max(yRod + 16, doc.y + 6);
  }
  doc.font('Times-Roman').fontSize(7).fillColor('#888888');
  doc.text('Documento válido em todo território nacional.', esq + 36, Math.min(yRod, 530), { width: dir - esq - 72, align: 'center' });

  return new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.end();
  });
}
