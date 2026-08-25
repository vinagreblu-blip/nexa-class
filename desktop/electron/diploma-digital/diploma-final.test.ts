// ============================================================
// TESTE M4 — Diploma final (pós-registro) contra o XSD OFICIAL
// ============================================================
// Fluxo completo: DA gerada → assinada (XAdES-BES real com cert de
// teste) → DadosDiploma extraído byte-idêntico → Diploma final com
// DadosRegistro (retorno da registradora) → valida contra o XSD.
// As assinaturas da REGISTRADORA permanecem esqueleto (estrutural)
// — competência dela, jamais simulada.
import { describe, expect, it } from 'vitest';
import { gerarDocumentacaoAcademicaXml } from './gerar-documentacao-academica';
import { gerarDiplomaFinalXml, type DadosRegistroRetorno } from './gerar-diploma-xml';
import { assinarTodosEsqueletos, contarEsqueletos } from './xades-signer';
import { validarXmlContraXsd } from './xsd-validator';

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
  id: 3, nome: 'ADMINISTRAÇÃO', codigo_emec: 106513, modalidade: 'Presencial',
  titulo_conferido: 'Bacharel', outro_titulo: null, grau_conferido: 'Bacharelado',
  endereco_json: null, carga_horaria: '3000',
  autorizacao_json: '{"tipo":"Portaria","numero":"10","data":"2010-03-01"}',
  reconhecimento_json: '{"tipo":"Portaria","numero":"20","data":"2015-06-15"}',
};
const IES = {
  id: 1, nome: 'INSTITUTO ERICH FROMM', codigo_emec: 1234, cnpj: '03.466.601/0001-82',
  logradouro: 'AV PRINCIPAL', numero: '100', complemento: null, bairro: 'CENTRO',
  codigo_municipio: '2927408', nome_municipio: 'Salvador', uf: 'BA', cep: '40000000',
  credenciamento_json: '{"tipo":"Portaria","numero":"999","data":"2008-01-15"}',
};
const REGISTRADORA = {
  id: 2, nome: 'UNIVERSIDADE REGISTRADORA', codigo_emec: 5678, cnpj: '00.000.000/0001-91',
  logradouro: 'RUA B', numero: '10', complemento: null, bairro: 'CENTRO',
  codigo_municipio: '2927408', nome_municipio: 'Salvador', uf: 'BA', cep: '40010000',
  papel: 'registradora',
  credenciamento_json: '{"tipo":"Decreto","numero":"5","data":"1990-01-01"}',
  mantenedora_json: '{"razaoSocial":"MANTENEDORA X","cnpj":"00.000.000/0001-00","endereco":{"logradouro":"RUA C","bairro":"CENTRO","codigoMunicipio":"2927408","nomeMunicipio":"Salvador","uf":"BA","cep":"40020000"}}',
  ato_autorizacao_registro_json: null,
};
const DISCIPLINAS = [
  { periodo: '1.2020', disciplina: 'ADMINISTRAÇÃO GERAL', docente: 'CARLOS SOUZA', titulacao: 'Doutor', ch: '80H', nota: '9,5', status: 'AP' },
];
const PROCESSO = {
  id: 42, aluno_id: 7, ies_emissora_id: 1,
  chave_acesso: 'Dip' + '1'.repeat(44),
  chave_req: 'ReqDip' + '2'.repeat(44),
  codigo_validacao_historico: null, data_expedicao: null,
};

function gerarCertTeste(): { certPem: string; chavePem: string } {
  const forge = require('node-forge');
  const pair = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = pair.publicKey;
  cert.serialNumber = '01' + String(Date.now());
  cert.validity.notBefore = new Date(Date.now() - 86400e3);
  cert.validity.notAfter = new Date(Date.now() + 86400e3 * 365);
  const attrs = [
    { name: 'commonName', value: 'NEXA CLASS TESTE' },
    { name: 'organizationName', value: 'Teste' },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(pair.privateKey, forge.md.sha256.create());
  return { certPem: forge.pki.certificateToPem(cert), chavePem: forge.pki.privateKeyToPem(pair.privateKey) };
}

describe('M4: Diploma final pós-registro × XSD oficial', () => {
  it('DA assinada (emissora) + DadosRegistro → Diploma VÁLIDO contra o XSD', async () => {
    const { certPem, chavePem } = gerarCertTeste();
    const snapshot = { processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any;

    // DA com documento comprobatório em arquivo temporário
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-dip-'));
    const pdf = path.join(tmp, 'rg.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4 fixture');
    try {
      const da = gerarDocumentacaoAcademicaXml(snapshot, [{ caminho: pdf, tipo: 'DocumentoIdentidadeDoAluno' }]);
      expect(da).toBeTruthy();
      expect(contarEsqueletos(da!)).toBe(2); // DadosDiploma + nível doc

      const daAssinada = assinarTodosEsqueletos(da!, { signatureIdBase: 'Sign-DD42', chavePem, certPem });
      expect(contarEsqueletos(daAssinada)).toBe(0);

      const registro: DadosRegistroRetorno = {
        livro: 'L1',
        numeroRegistro: '000123',
        dataExpedicaoDiploma: '2026-08-25',
        dataRegistroDiploma: '2026-08-25',
        responsavel: { nome: 'RESPONSAVEL REGISTRO', cpf: '98765432100' },
        codigoValidacao: '1234.5678.abcdef0123456789',
      };

      const chaveVdip = 'VDip' + '1'.repeat(44);
      const chaveRdip = 'RDip' + '1'.repeat(44);
      const final = gerarDiplomaFinalXml(snapshot, daAssinada, registro, REGISTRADORA, chaveVdip, chaveRdip);
      expect(final).toBeTruthy();
      // Assinaturas da REGISTRADORA permanecem esqueleto (2 posições)
      expect(contarEsqueletos(final!)).toBe(2);

      const r = await validarXmlContraXsd(final!, 'diploma');
      if (!r.valido) console.error('ERROS XSD:', r.erros);
      expect(r.valido).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 60000);

  it('registradora sem mantenedora → Diploma não montado (anti-invenção)', () => {
    const snapshot = { processo: PROCESSO, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISCIPLINAS } as any;
    const da = '<DocumentacaoAcademicaRegistro xmlns="x"><DadosDiploma id="Dip1">D</DadosDiploma></DocumentacaoAcademicaRegistro>';
    const out = gerarDiplomaFinalXml(
      snapshot, da,
      { livro: 'L1', numeroRegistro: '1', dataExpedicaoDiploma: '2026-08-25', dataRegistroDiploma: '2026-08-25', responsavel: { nome: 'X', cpf: '98765432100' }, codigoValidacao: '1.2.abcdef012345' },
      { ...REGISTRADORA, mantenedora_json: null }, 'VDip1', 'RDip1'
    );
    expect(out).toBeNull();
  });
});
