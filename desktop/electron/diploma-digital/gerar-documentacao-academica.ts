// ============================================================
// GERADOR — DOCUMENTAÇÃO ACADÊMICA p/ EMISSÃO E REGISTRO (XSD v1.05)
// ============================================================
// Root: DocumentacaoAcademicaRegistro (TDocumentacaoAcademicaRegistro)
// → RegistroReq (TRegistroReq): o que a IES EMISSORA envia à IES
// REGISTRADORA para obter o registro. Contém:
//   DadosDiploma (com @id Dip+44) + DadosPrivadosDiplomado
//   (Filiacao + HistoricoEscolar embutido) + TermoResponsabilidade*
//   + DocumentacaoComprobatoria (PDFs em base64).
// A montagem do DIPLOMA FINAL (DadosDiploma + DadosRegistro) só
// ocorre APÓS o retorno da registradora (M4) — nunca antes.
//
import fs from 'node:fs';
import {
  el, elAttrs, documentoXml, assinaturaEstrutural, blocoAto, blocoEndereco, blocoDiplomado,
} from './xml-utils';
import { normalizarCpf, normalizarCnpj, normalizarData, normalizarSexo, normalizarRg, normalizarUf } from './normalizadores';
import { montarChaveAcesso44 } from './normalizadores';
import type { SnapshotDiploma } from './coletor';
import { gerarHistoricoXml } from './gerar-historico-xml';

function dadosDiplomaCompleto(s: SnapshotDiploma, chaveDip: string): string | null {
  const a = s.aluno;
  const c = s.curso;
  const ies = s.ies;
  if (!a || !c || !ies) return null;
  // Sexo/naturalidade: o gate de pendências bloqueia valor inválido ANTES
  // da geração — aqui NÃO há fallback inventado (?? 'M' fabricava sexo).
  const sexo = normalizarSexo(a.sexo);
  if (!sexo) return null;

  const diplomado = blocoDiplomado({
    matricula: a.matricula,
    nome: a.nome,
    nomeSocial: a.nome_social,
    sexo,
    nacionalidade: a.nacionalidade,
    naturalidade: a.naturalidade_estrangeira
      ? { nome: a.naturalidade_estrangeira }
      : { codigoIbge: a.naturalidade_codigo_ibge, nome: a.naturalidade, uf: a.naturalidade_uf },
    cpf: normalizarCpf(a.cpf) ?? '',
    rg: { numero: normalizarRg(a.rg) ?? '', orgaoExpedidor: a.orgao_emissor, uf: normalizarUf(a.rg_uf) ?? '' },
    dataNascimento: normalizarData(a.data_nascimento) ?? '',
  });

  // EnderecoCurso: endereço próprio do curso OU o da IES (campus único —
  // transformação documentada em mapeamento-campos.ts)
  let endCurso: string | null = null;
  if (c.endereco_json) {
    try {
      const e = JSON.parse(c.endereco_json);
      endCurso = blocoEndereco(e);
    } catch { /* ignora JSON inválido */ }
  }
  if (!endCurso) {
    endCurso = blocoEndereco({
      logradouro: ies.logradouro, numero: ies.numero, complemento: ies.complemento,
      bairro: ies.bairro, codigoMunicipio: ies.codigo_municipio,
      nomeMunicipio: ies.nome_municipio, uf: ies.uf, cep: ies.cep,
    });
  }
  if (!endCurso) return null;

  const titulo =
    c.outro_titulo
      ? '<TituloConferido>' + '<OutroTitulo>' + (c.outro_titulo ?? '') + '</OutroTitulo>' + '</TituloConferido>'
      : '<TituloConferido><Titulo>' + (c.titulo_conferido ?? '') + '</Titulo></TituloConferido>';

  const dadosCurso =
    '<DadosCurso>' +
    el('NomeCurso', c.nome) +
    el('CodigoCursoEMEC', c.codigo_emec) +
    el('Modalidade', c.modalidade) +
    titulo +
    el('GrauConferido', c.grau_conferido) +
    `<EnderecoCurso>${endCurso}</EnderecoCurso>` +
    (blocoAto(c.autorizacao_json, 'Autorizacao') ?? '') +
    (blocoAto(c.reconhecimento_json, 'Reconhecimento') ?? '') +
    (blocoAto(c.renovacao_reconhecimento_json, 'RenovacaoReconhecimento') ?? '') +
    '</DadosCurso>';

  const iesEmissora = (() => {
    // Endereço incompleto → null (pendência): interpolar null geraria
    // o texto literal "null" e rejeição XSD fora do gate de pendências.
    const end = blocoEndereco({
      logradouro: ies.logradouro, numero: ies.numero, complemento: ies.complemento,
      bairro: ies.bairro, codigoMunicipio: ies.codigo_municipio,
      nomeMunicipio: ies.nome_municipio, uf: ies.uf, cep: ies.cep,
    });
    if (!end) return null;
    // Opcionais do XSD (TDadosIesEmissora) — emitidos quando persistidos
    // no cadastro institucional (antes eram descartados silenciosamente).
    const mantenedora = (() => {
      if (!ies.mantenedora_json) return null;
      try {
        const m = JSON.parse(ies.mantenedora_json);
        if (!m.razaoSocial || !m.cnpj) return null;
        const endM = m.endereco ? blocoEndereco(m.endereco) : null;
        if (!endM) return null;
        return (
          '<Mantenedora>' +
          el('RazaoSocial', m.razaoSocial) +
          el('CNPJ', normalizarCnpj(m.cnpj) ?? '') +
          `<Endereco>${endM}</Endereco>` +
          '</Mantenedora>'
        );
      } catch { return null; }
    })();
    return (
      '<IesEmissora>' +
      el('Nome', ies.nome) +
      el('CodigoMEC', ies.codigo_emec) +
      el('CNPJ', normalizarCnpj(ies.cnpj) ?? '') +
      `<Endereco>${end}</Endereco>` +
      (blocoAto(ies.credenciamento_json, 'Credenciamento') ?? '') +
      (blocoAto(ies.recredenciamento_json, 'Recredenciamento') ?? '') +
      (blocoAto(ies.renovacao_recredenciamento_json, 'RenovacaoDeRecredenciamento') ?? '') +
      (mantenedora ?? '') +
      '</IesEmissora>'
    );
  })();
  if (!iesEmissora) return null;

  return (
    elAttrs('DadosDiploma', { id: chaveDip },
      '<Diplomado>' + diplomado + '</Diplomado>' +
      (normalizarData(`${a.ano_conclusao}-01-01`) ? el('DataConclusao', normalizarData(`${a.ano_conclusao}-01-01`)) : '') +
      dadosCurso +
      iesEmissora +
      // Assinantes (opcional no XSD): só entra quando houver CPF+cargo
      // reais cadastrados — elemento vazio é INVÁLIDO no schema
      assinaturaEstrutural()
    )
  );
}

/**
 * Gera o XML da Documentação Acadêmica (RegistroReq).
 * @param documentosPdf: [{ caminho, tipo }] — arquivos lidos e embutidos
 *        em base64 (TPdfA). Tipo na enum TTipoDocumentacao.
 */
export function gerarDocumentacaoAcademicaXml(
  s: SnapshotDiploma,
  documentosPdf: { caminho: string; tipo: string }[]
): string | null {
  const a = s.aluno;
  if (!a) return null;

  // Chaves de acesso (pattern XSD: Dip[0-9]{44} / ReqDip[0-9]{44})
  // processo.chave_* (persistidas com prefixo) têm precedência.
  const ch44dip = montarChaveAcesso44(a.cpf, a.matricula, `dip-${s.processo.id}`);
  const chaveDip = s.processo?.chave_acesso ?? (ch44dip ? `Dip${ch44dip}` : null);
  const ch44req = montarChaveAcesso44(a.cpf, a.matricula, `req-${s.processo.id}`);
  const chaveReq = s.processo?.chave_req ?? (ch44req ? `ReqDip${ch44req}` : null);
  if (!chaveDip || !/^Dip[0-9]{44}$/.test(chaveDip)) return null;
  if (!chaveReq || !/^ReqDip[0-9]{44}$/.test(chaveReq)) return null;

  const dadosDiploma = dadosDiplomaCompleto(s, chaveDip);
  if (!dadosDiploma) return null;

  // Filiacao (≥1 Genitor com Nome+Sexo)
  const genitores: string[] = [];
  const addGenitor = (nome: string | null | undefined, sexo: string | null | undefined) => {
    const sx = normalizarSexo(sexo);
    if (nome && sx) genitores.push('<Genitor>' + el('Nome', nome) + el('Sexo', sx) + '</Genitor>');
  };
  addGenitor(a.mae_nome, a.mae_sexo);
  addGenitor(a.pai_nome, a.pai_sexo);
  if (genitores.length === 0) return null;

  // Histórico embutido (mesma estrutura do documento próprio)
  const historicoCompleto = gerarHistoricoXml(s);
  if (!historicoCompleto) return null;
  // extrai o bloco <HistoricoEscolar>…</HistoricoEscolar> (interno, sem ns)
  const m = /<HistoricoEscolar>([\s\S]*?)<\/HistoricoEscolar>/.exec(historicoCompleto);
  if (!m) return null;
  const historicoEmbutido = '<HistoricoEscolar>' + m[1] + '</HistoricoEscolar>';

  // Documentação comprobatória: PDFs em base64
  const docs: string[] = [];
  for (const d of documentosPdf.slice(0, 20)) {
    try {
      const buf = fs.readFileSync(d.caminho);
      docs.push(elAttrs('Documento', { tipo: d.tipo }, buf.toString('base64')));
    } catch { /* arquivo ausente — pendência já tratada pelo coletor */ }
  }
  if (docs.length === 0) return null;

  const registroReq =
    elAttrs('RegistroReq', { versao: '1.05', id: chaveReq, ambiente: 'Produção' },
      dadosDiploma +
      '<DadosPrivadosDiplomado>' +
      '<Filiacao>' + genitores.join('') + '</Filiacao>' +
      historicoEmbutido +
      '</DadosPrivadosDiplomado>' +
      '<DocumentacaoComprobatoria>' + docs.join('') + '</DocumentacaoComprobatoria>'
    );

  return documentoXml('DocumentacaoAcademicaRegistro', registroReq + assinaturaEstrutural());
}

/** Chave Dip persistível (o handler grava na 1ª geração). */
export function chaveDiploma(s: SnapshotDiploma): string | null {
  const chave = montarChaveAcesso44(s.aluno?.cpf, s.aluno?.matricula, `dip-${s.processo.id}`);
  return chave ? `Dip${chave}` : null;
}
