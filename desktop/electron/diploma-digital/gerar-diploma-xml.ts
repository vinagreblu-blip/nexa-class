// ============================================================
// GERADOR — DIPLOMA DIGITAL FINAL (XSD v1.05, pós-registro)
// ============================================================
// Root: Diploma → infDiploma{versao, id=VDip{44}, ambiente}
//   ├─ DadosDiploma (id=Dip{44}) — extraído DO XML DA DA JÁ ASSINADO
//   │  pela emissora (assinatura real preservada dentro do elemento)
//   └─ DadosRegistro (id=RDip{44}) — montado com o RETORNO REAL da
//      IES Registradora (livro/folha/nº/datas/responsável/CodigoValidacao)
//      + ds:Signature ESQUELETO: quem assina o registro é a
//      REGISTRADORA — o sistema da emissora NUNCA assina por ela.
// O ds:Signature do nível Diploma (TDiploma) também permanece
// esqueleto pelo mesmo motivo (competência da registradora).
//
// Registro assistido: os dados vêm do formulário preenchido com o que
// a registradora devolveu. Nada é simulado nem pré-preenchido.
import { el, elAttrs, documentoXml, assinaturaEstrutural, blocoAto, blocoEndereco } from './xml-utils';
import { normalizarCnpj, normalizarCpf, normalizarData } from './normalizadores';
import type { SnapshotDiploma } from './coletor';

export interface DadosRegistroRetorno {
  /** Livro de registro (código). */
  livro: string;
  /** Nº de registro OU (folha + sequência) — um dos dois. */
  numeroRegistro?: string;
  numeroFolha?: string;
  numeroSequencia?: string;
  processoDiploma?: string;
  dataExpedicaoDiploma: string; // AAAA-MM-DD
  dataRegistroDiploma: string; // AAAA-MM-DD
  responsavel: { nome: string; cpf: string; matricula?: string };
  /** CodigoValidacao oficial retornado pela registradora (eMEC.eMEC.hex12+). */
  codigoValidacao: string;
  informacoesAdicionais?: string;
}

/** Extrai o elemento DadosDiploma (com assinaturas internas) da DA assinada. */
export function extrairDadosDiploma(xmlDaAssinada: string): string | null {
  const m = /<DadosDiploma[\s\S]*?<\/DadosDiploma>/.exec(xmlDaAssinada);
  return m ? m[0] : null;
}

/**
 * Bloco IES Registradora (TDadosIesRegistradora — exige mantenedora).
 * @param tag nome do elemento no leiaute-alvo: 'IesRegistradora'
 * (Diploma final) ou 'IESRegistradora' (Lista Anulados — o leiaute
 * oficial usa grafia diferente!).
 */
export function blocoIesRegistradoraCompleta(registradora: any, tag = 'IesRegistradora'): string | null {
  const cnpjReg = normalizarCnpj(registradora?.cnpj);
  const credReg = blocoAto(registradora?.credenciamento_json, 'Credenciamento');
  const recredReg = blocoAto(registradora?.recredenciamento_json, 'Recredenciamento');
  const atoReg = blocoAto(registradora?.ato_autorizacao_registro_json, 'AtoRegulatorioAutorizacaoRegistro');
  const endReg = blocoEndereco({
    logradouro: registradora?.logradouro, numero: registradora?.numero,
    complemento: registradora?.complemento, bairro: registradora?.bairro,
    codigoMunicipio: registradora?.codigo_municipio,
    nomeMunicipio: registradora?.nome_municipio, uf: registradora?.uf, cep: registradora?.cep,
  });
  let mantenedora: string | null = null;
  if (registradora?.mantenedora_json) {
    try {
      const m = JSON.parse(registradora.mantenedora_json);
      if (m.razaoSocial && m.cnpj) {
        const endM = m.endereco ? blocoEndereco(m.endereco) : null;
        if (endM) {
          mantenedora =
            '<Mantenedora>' +
            el('RazaoSocial', m.razaoSocial) +
            el('CNPJ', normalizarCnpj(m.cnpj) ?? '') +
            `<Endereco>${endM}</Endereco>` +
            '</Mantenedora>';
        }
      }
    } catch { /* ignora JSON inválido */ }
  }
  if (!cnpjReg || !credReg || !endReg || !mantenedora) return null;
  return (
    `<${tag}>` +
    el('Nome', registradora.nome) +
    el('CodigoMEC', registradora.codigo_emec) +
    el('CNPJ', cnpjReg) +
    `<Endereco>${endReg}</Endereco>` +
    credReg +
    (recredReg ?? '') +
    (atoReg ?? '') +
    mantenedora +
    `</${tag}>`
  );
}

/**
 * Monta o Diploma final. @xmlDaAssinada = XML da Documentação
 * Acadêmica com a assinatura real da emissora (dadosDiploma extraído
 * de lá, byte-idêntico). @registradora = linha da tabela ies com
 * papel de registradora (dados oficiais completos).
 */
export function gerarDiplomaFinalXml(
  s: SnapshotDiploma,
  xmlDaAssinada: string,
  registro: DadosRegistroRetorno,
  registradora: any,
  chaveVdip: string,
  chaveRdip: string
): string | null {
  const dadosDiploma = extrairDadosDiploma(xmlDaAssinada);
  if (!dadosDiploma) return null;

  const iesReg = blocoIesRegistradoraCompleta(registradora, 'IesRegistradora');
  if (!iesReg) return null;

  const a = s.aluno;
  const colacao = normalizarData(a?.data_colacao);
  if (!colacao) return null;

  const identificador =
    registro.numeroRegistro
      ? el('NumeroRegistro', registro.numeroRegistro)
      : el('NumeroFolhaDoDiploma', registro.numeroFolha ?? '') + el('NumeroSequenciaDoDiploma', registro.numeroSequencia ?? '');
  if (!registro.numeroRegistro && !(registro.numeroFolha && registro.numeroSequencia)) return null;

  // Normaliza o retorno da registradora (formulário aceita DD/MM/YYYY
  // e CPF mascarado; XSD exige AAAA-MM-DD/11 dígitos). Valor não
  // normalizável segue cru — a revalidação XSD reporta o campo exato.
  const dataExp = normalizarData(registro.dataExpedicaoDiploma) ?? registro.dataExpedicaoDiploma;
  const dataReg = normalizarData(registro.dataRegistroDiploma) ?? registro.dataRegistroDiploma;
  const cpfResp = normalizarCpf(registro.responsavel.cpf) ?? registro.responsavel.cpf;

  const livroRegistro =
    '<LivroRegistro>' +
    el('LivroRegistro', registro.livro) +
    identificador +
    (registro.processoDiploma ? el('ProcessoDoDiploma', registro.processoDiploma) : '') +
    el('DataColacaoGrau', colacao) +
    el('DataExpedicaoDiploma', dataExp) +
    el('DataRegistroDiploma', dataReg) +
    '<ResponsavelRegistro>' +
    el('Nome', registro.responsavel.nome) +
    el('CPF', cpfResp) +
    (registro.responsavel.matricula ? el('IDouNumeroMatricula', registro.responsavel.matricula) : '') +
    '</ResponsavelRegistro>' +
    '</LivroRegistro>';

  // Id da DA (ReqDip{44}) — vem da chave da DA registrada no processo
  const reqDip = s.processo?.chave_req ?? null;
  if (!reqDip) return null;

  const dadosRegistro =
    elAttrs('DadosRegistro', { id: chaveRdip },
      iesReg +
      livroRegistro +
      el('IdDocumentacaoAcademica', reqDip) +
      '<Seguranca>' + el('CodigoValidacao', registro.codigoValidacao) + '</Seguranca>' +
      (registro.informacoesAdicionais ? el('InformacoesAdicionais', registro.informacoesAdicionais) : '') +
      assinaturaEstrutural()
    );

  const infDiploma =
    elAttrs('infDiploma', { versao: '1.05', id: chaveVdip, ambiente: 'Produção' },
      dadosDiploma + dadosRegistro
    );

  return documentoXml('Diploma', infDiploma + assinaturaEstrutural());
}
