import { it } from 'vitest';
import { compararEstruturaHistorico } from './comparador-estrutural';
import { gerarHistoricoXml } from './gerar-historico-xml';
const ALUNO = { id:7, matricula:'202012345', nome:'MARIA DA SILVA', nome_social:null, sexo:'F', nacionalidade:'Brasileira', naturalidade:'Salvador', naturalidade_codigo_ibge:'2927408', naturalidade_uf:'BA', naturalidade_estrangeira:null, cpf:'123.456.789-00', rg:'1.234.567', rg_uf:'BA', orgao_emissor:'SSP-BA', data_nascimento:'10/05/2000', curso:'ADMINISTRAÇÃO', ano_conclusao:'2024', ano_ingresso:'2020', data_vestibular:'15/01/2020', data_colacao:'20/12/2024', forma_ingresso:'Vestibular' };
const CURSO = { id:3, nome:'ADMINISTRAÇÃO', codigo_emec:1065, modalidade:'Presencial', titulo_conferido:'Bacharel', outro_titulo:null, grau_conferido:'Bacharelado', endereco_json:null, carga_horaria:'3000', autorizacao_json:'{"tipo":"Portaria","numero":"10","data":"2010-03-01"}', reconhecimento_json:'{"tipo":"Portaria","numero":"20","data":"2015-06-15"}', renovacao_reconhecimento_json:null };
const IES = { id:1, nome:'INSTITUTO ERICH FROMM', codigo_emec:1234, cnpj:'03.466.601/0001-82', logradouro:'AV PRINCIPAL', numero:'100', complemento:null, bairro:'CENTRO', codigo_municipio:'2927408', nome_municipio:'Salvador', uf:'BA', cep:'40000000', credenciamento_json:'{"tipo":"Portaria","numero":"999","data":"2008-01-15"}', recredenciamento_json:null };
const DISC = [ { id:1, aluno_id:7, periodo:'1.2020', disciplina:'ADMINISTRAÇÃO GERAL', docente:'CARLOS SOUZA', titulacao:'Doutorado', ch:'80H', nota:'95', ft:null, status:'AP', ordem:1 } ];
const PROC = { id:42, aluno_id:7, ies_emissora_id:1, chave_acesso:null, codigo_validacao_historico:null, data_expedicao:null };
it('debug', () => {
  const xml = gerarHistoricoXml({ processo: PROC, aluno: ALUNO, curso: CURSO, ies: IES, disciplinas: DISC } as any)!;
  const r = compararEstruturaHistorico(xml);
  console.log('divergencias baseline:', r.divergencias.length, JSON.stringify(r.divergencias.slice(0,5)));
});
