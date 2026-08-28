// ============================================================
// COMPARADOR ESTRUTURAL × XSD OFICIAL v1.05
// ============================================================
// O XML gerado pelo gerador oficial deve ser 100% conforme à
// estrutura do leiaute; mutações estruturais (ordem, namespace,
// elemento inesperado, Aprovado com texto, assinatura ausente)
// devem produzir as divergências correspondentes.
import { describe, expect, it } from 'vitest';
import { compararEstruturaHistorico } from './comparador-estrutural';
import { gerarHistoricoXml } from './gerar-historico-xml';

const ALUNO = {
  id: 7, matricula: '202012345', nome: 'MARIA DA SILVA', nome_social: null,
  sexo: 'F', nacionalidade: 'Brasileira', naturalidade: 'Salvador',
  naturalidade_codigo_ibge: '2927408', naturalidade_uf: 'BA', naturalidade_estrangeira: null,
  cpf: '123.456.789-00', rg: '1.234.567', rg_uf: 'BA', orgao_emissor: 'SSP-BA',
  data_nascimento: '10/05/2000', curso: 'ADMINISTRAÇÃO', ano_conclusao: '2024',
  ano_ingresso: '2020', data_vestibular: '15/01/2020', data_colacao: '20/12/2024',
  forma_ingresso: 'Vestibular', mae_nome: 'JOANA SILVA', mae_sexo: 'F',
  pai_nome: 'JOAO SILVA', pai_sexo: 'M',
};
const CURSO = {
  id: 3, nome: 'ADMINISTRAÇÃO', codigo_emec: 1065, modalidade: 'Presencial',
  titulo_conferido: 'Bacharel', outro_titulo: null, grau_conferido: 'Bacharelado',
  endereco_json: null, carga_horaria: '3000',
  autorizacao_json: '{"tipo":"Portaria","numero":"10","data":"2010-03-01"}',
  reconhecimento_json: '{"tipo":"Portaria","numero":"20","data":"2015-06-15"}',
  renovacao_reconhecimento_json: null,
};
const IES = {
  id: 1, nome: 'INSTITUTO ERICH FROMM', codigo_emec: 1234, cnpj: '03.466.601/0001-82',
  logradouro: 'AV PRINCIPAL', numero: '100', complemento: null, bairro: 'CENTRO',
  codigo_municipio: '2927408', nome_municipio: 'Salvador', uf: 'BA', cep: '40000000',
  credenciamento_json: '{"tipo":"Portaria","numero":"999","data":"2008-01-15"}',
  recredenciamento_json: null,
};
const DISCIPLINAS = [
  { id: 1, aluno_id: 7, periodo: '1.2020', disciplina: 'ADMINISTRAÇÃO GERAL', docente: 'CARLOS SOUZA', titulacao: 'Doutorado', ch: '80H', nota: '95', ft: null, status: 'AP', ordem: 1 },
  { id: 2, aluno_id: 7, periodo: '2.2020', disciplina: 'MATEMÁTICA APLICADA', docente: 'ANA LIMA', titulacao: 'Mestrado', ch: '60', nota: '8,0', ft: null, status: 'AP', ordem: 1 },
];
const PROCESSO = { id: 42, aluno_id: 7, ies_emissora_id: 1, chave_acesso: null, codigo_validacao_historico: null, data_expedicao: null };

const snapshot = () => ({ processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any);

describe('Comparador estrutural × XSD oficial v1.05', () => {
  it('XML do gerador oficial é 100% conforme à estrutura do leiaute', () => {
    const xml = gerarHistoricoXml(snapshot())!;
    expect(xml).toBeTruthy();
    const r = compararEstruturaHistorico(xml);
    if (!r.conforme) console.error('DIVERGÊNCIAS:', JSON.stringify(r.divergencias, null, 2));
    expect(r.conforme).toBe(true);
  }, 30000);

  it('detecta namespace errado na raiz', () => {
    const xml = gerarHistoricoXml(snapshot())!
      .replace('http://portal.mec.gov.br/diplomadigital/arquivos-em-xsd', 'https://nexa-class.edu/diploma');
    const r = compararEstruturaHistorico(xml);
    expect(r.divergencias.some((d) => d.tipo === 'namespace')).toBe(true);
  });

  it('detecta versão divergente do leiaute', () => {
    const xml = gerarHistoricoXml(snapshot())!.replace('versao="1.05"', 'versao="1.04"');
    const r = compararEstruturaHistorico(xml);
    expect(r.divergencias.some((d) => d.tipo === 'versao')).toBe(true);
  });

  it('detecta elemento fora de ordem', () => {
    const xml = gerarHistoricoXml(snapshot())!;
    // move DataEmissaoHistorico para depois de IngressoCurso (fora da ordem do leiaute)
    const dataEmissao = xml.match(/<DataEmissaoHistorico>[^<]*<\/DataEmissaoHistorico>/)![0];
    const sem = xml.replace(dataEmissao, '');
    const ingressoFim = sem.indexOf('</IngressoCurso>');
    const foraDeOrdem = sem.slice(0, ingressoFim + '</IngressoCurso>'.length) + dataEmissao + sem.slice(ingressoFim + '</IngressoCurso>'.length);
    const r = compararEstruturaHistorico(foraDeOrdem);
    expect(r.divergencias.some((d) => d.tipo === 'ordem' || d.tipo === 'inesperado')).toBe(true);
  });

  it('detecta elemento não previsto no leiaute', () => {
    const xml = gerarHistoricoXml(snapshot())!.replace('<SegurancaHistorico>', '<ElementoInventado>X</ElementoInventado><SegurancaHistorico>');
    const r = compararEstruturaHistorico(xml);
    expect(r.divergencias.some((d) => d.tipo === 'inesperado' && d.caminho.includes('ElementoInventado'))).toBe(true);
  });

  it('detecta <Aprovado> com texto (deve ser elemento vazio)', () => {
    const xml = gerarHistoricoXml(snapshot())!.replace('<Aprovado />', '<Aprovado>true</Aprovado>');
    const r = compararEstruturaHistorico(xml);
    expect(r.divergencias.some((d) => d.tipo === 'conteudo' && d.caminho.includes('Aprovado'))).toBe(true);
  });

  it('detecta elemento obrigatório ausente (IesEmissora)', () => {
    const xml = gerarHistoricoXml(snapshot())!;
    const semIes = xml.replace(/<IesEmissora>.*?<\/IesEmissora>/s, '');
    const r = compararEstruturaHistorico(semIes);
    expect(r.divergencias.some((d) => d.tipo === 'obrigatorioAusente' && d.caminho.includes('IesEmissora'))).toBe(true);
  });

  it('detecta assinatura ausente', () => {
    const xml = gerarHistoricoXml(snapshot())!.replace(/<ds:Signature xmlns:ds="[^"]*">.*?<\/ds:Signature>/s, '');
    const r = compararEstruturaHistorico(xml);
    expect(r.divergencias.some((d) => d.tipo === 'assinatura')).toBe(true);
  });

  it('esqueleto pré-assinatura (sem Object) não gera exigência de arquitetura XAdES', () => {
    const xml = gerarHistoricoXml(snapshot())!;
    const r = compararEstruturaHistorico(xml);
    expect(r.divergencias.some((d) => d.tipo === 'assinatura' && d.esperado.includes('QualifyingProperties'))).toBe(false);
  });

  it('detecta Reference SignedProperties ausente quando há QualifyingProperties', () => {
    const xml = gerarHistoricoXml(snapshot())!;
    // assinatura sintética com QualifyingProperties mas sem Reference Type=SignedProperties
    const assinaturaXadesIncompleta =
      '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
      '<ds:SignedInfo><ds:CanonicalizationMethod Algorithm=""/><ds:SignatureMethod Algorithm=""/><ds:Reference URI=""></ds:Reference></ds:SignedInfo>' +
      '<ds:SignatureValue>AAA</ds:SignatureValue>' +
      '<ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">' +
      '<xades:SignedProperties><xades:SignedSignatureProperties>' +
      '<xades:SigningTime>2026-01-01T00:00:00-03:00</xades:SigningTime>' +
      '<xades:SigningCertificate/>' +
      '<xades:SignaturePolicyIdentifier/>' +
      '</xades:SignedSignatureProperties></xades:SignedProperties>' +
      '</xades:QualifyingProperties></ds:Object>' +
      '</ds:Signature>';
    const comXades = xml.replace(/<ds:Signature xmlns:ds="[^"]*">.*?<\/ds:Signature>/s, assinaturaXadesIncompleta);
    const r = compararEstruturaHistorico(comXades);
    expect(r.divergencias.some((d) => d.tipo === 'assinatura' && d.esperado.includes('SignedProperties'))).toBe(true);
  });

  it('detecta SignatureTimeStamp com EncapsulatedTimeStamp vazio', () => {
    const xml = gerarHistoricoXml(snapshot())!;
    const assinaturaComCarimboVazio =
      '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
      '<ds:SignedInfo><ds:CanonicalizationMethod Algorithm=""/><ds:SignatureMethod Algorithm=""/><ds:Reference URI="" Type="http://uri.etsi.org/01903#SignedProperties"></ds:Reference></ds:SignedInfo>' +
      '<ds:SignatureValue>AAA</ds:SignatureValue>' +
      '<ds:Object><xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">' +
      '<xades:SignedProperties><xades:SignedSignatureProperties>' +
      '<xades:SigningTime>2026-01-01T00:00:00-03:00</xades:SigningTime>' +
      '<xades:SigningCertificate/>' +
      '<xades:SignaturePolicyIdentifier/>' +
      '</xades:SignedSignatureProperties></xades:SignedProperties>' +
      '<xades:UnsignedProperties><xades:UnsignedSignatureProperties>' +
      '<xades:SignatureTimeStamp><xades:EncapsulatedTimeStamp></xades:EncapsulatedTimeStamp></xades:SignatureTimeStamp>' +
      '</xades:UnsignedSignatureProperties></xades:UnsignedProperties>' +
      '</xades:QualifyingProperties></ds:Object>' +
      '</ds:Signature>';
    const comCarimbo = xml.replace(/<ds:Signature xmlns:ds="[^"]*">.*?<\/ds:Signature>/s, assinaturaComCarimboVazio);
    const r = compararEstruturaHistorico(comCarimbo);
    expect(r.divergencias.some((d) => d.tipo === 'assinatura' && d.caminho.includes('EncapsulatedTimeStamp'))).toBe(true);
  });
});
