// ============================================================
// GERADOR — HISTÓRICO ESCOLAR DIGITAL (XSD v1.05)
// ============================================================
// Root: DocumentoHistoricoEscolarFinal (TDocumentoHistoricoEscolar).
// Mapa de campos: mapeamento-campos.ts (MAPA_HISTORICO etc.).
// Função PURA sobre o snapshot — validação XSD acontece no fluxo
// do handler (ipc/diplomas-digitais.ts), NUNCA no gerador.
//
// CONFORMIDADE JSON→XSD (tiposBasicos_v1.05):
//  - IesEmissora.CodigoMEC/CNPJ/Endereco/Credenciamento/Mantenedora
//  - DadosCurso (TDadosMinimoCurso): NomeCurso + e-MEC + Habilitacao +
//    Autorizacao + Reconhecimento (via InformacoesTramitacaoEMEC quando
//    o curso tem processo e-MEC em vez de ato publicado)
//  - ElementosHistorico: Disciplina (NotaAteCem 0-100 | Nota 0-10 |
//    Conceito; <Aprovado/> vazio conforme referência) +
//    AtividadeComplementar (quando houver)
//  - SituacaoAtualDiscente: PeriodoLetivo → Formado
//  - ENADE: estruturado (NaoHabilitado{Condicao, Edicao, Motivo|OutroMotivo})
//  - SegurancaHistorico.CodigoValidacao: "eMEC.16hex" (gerado 1x)
//
import {
  el, elAttrs, documentoXml, assinaturaEstrutural, blocoAto, blocoEndereco,
  blocoCargaHoraria, blocoCargaHorariaEtiqueta, blocoDiplomado, blocoDocentes,
} from './xml-utils';
import {
  normalizarCpf, normalizarCnpj, normalizarData, normalizarSexo, normalizarRg, normalizarUf,
  normalizarCargaHoraria, normalizarNota, dataHoraBrasilia,
} from './normalizadores';
import { mapearTitulacao, mapearFormaAcesso, codigoDisciplinaDerivado } from './mapeamento-campos';
import type { SnapshotDiploma } from './coletor';
import { randomBytes } from 'node:crypto';

/** Reconhecimento via InformacoesTramitacaoEMEC (ramo do choice do XSD
 *  usado pela referência quando o curso tem processo no e-MEC em vez de
 *  ato regulatório publicado). */
function blocoTramitacaoEmec(json: string | null | undefined, tag: string): string | null {
  if (!json) return null;
  try {
    const m = JSON.parse(json);
    if (!m?.numeroProcesso || !m?.tipoProcesso || !normalizarData(m.dataCadastro) || !normalizarData(m.dataProtocolo)) {
      return null;
    }
    return (
      `<${tag}><InformacoesTramitacaoEMEC>` +
      el('NumeroProcesso', m.numeroProcesso) +
      el('TipoProcesso', m.tipoProcesso) +
      el('DataCadastro', normalizarData(m.dataCadastro)) +
      el('DataProtocolo', normalizarData(m.dataProtocolo)) +
      `</InformacoesTramitacaoEMEC></${tag}>`
    );
  } catch { return null; }
}

/** Habilitacao do curso (opcional): {nome, data} ou {nomeHabilitacao, dataHabilitacao}. */
function blocoHabilitacoes(json: string | null | undefined): string {
  if (!json) return '';
  try {
    const raw = JSON.parse(json);
    const lista = Array.isArray(raw) ? raw : [raw];
    return lista
      .filter((h: any) => h?.nomeHabilitacao || h?.nome)
      .map((h: any) => {
        const nome = h.nomeHabilitacao ?? h.nome;
        const data = normalizarData(h.dataHabilitacao ?? h.data) ?? '';
        return '<Habilitacao>' + el('NomeHabilitacao', nome) + (data ? el('DataHabilitacao', data) : '') + '</Habilitacao>';
      })
      .join('');
  } catch { return ''; }
}

/** ENADE estruturado conforme referência: NaoHabilitado{Condicao, Edicao,
 *  Motivo(enum)|OutroMotivo(string)} — 0..n. Dados do campo
 *  enade_json do aluno/processo. */
function blocoEnade(json: string | null | undefined): string {
  if (!json) return '<ENADE />';
  try {
    const lista = JSON.parse(json);
    if (!Array.isArray(lista) || lista.length === 0) return '<ENADE />';
    return '<ENADE>' + lista.map((e: any) => {
      if (!e?.condicao || !e?.edicao) return '';
      const motivo = e.motivo ? el('Motivo', e.motivo) : '';
      const outroMotivo = e.outroMotivo ? el('OutroMotivo', e.outroMotivo) : '';
      if (!motivo && !outroMotivo) return '';
      return '<NaoHabilitado>' + el('Condicao', e.condicao) + el('Edicao', e.edicao) + motivo + outroMotivo + '</NaoHabilitado>';
    }).filter(Boolean).join('') + '</ENADE>';
  } catch { return '<ENADE />'; }
}

/**
 * Bloco IesEmissora (TDadosIesEmissora).
 * @param tag 'IesEmissora' (Histórico/DA/Diploma) ou 'IESEmissora'
 * (ArquivoFiscalizacao — grafia diferente no leiaute oficial!).
 */
export function blocoIesEmissora(s: SnapshotDiploma, tag = 'IesEmissora'): string | null {
  const ies = s.ies;
  const cred = blocoAto(ies.credenciamento_json, 'Credenciamento');
  const recred = blocoAto(ies.recredenciamento_json, 'Recredenciamento');
  const renov = blocoAto(ies.renovacao_recredenciamento_json, 'RenovacaoDeRecredenciamento');
  // Endereço incompleto → null (pendência): interpolar null geraria
  // o texto literal "null" e rejeição XSD fora do gate de pendências.
  const end = blocoEndereco({
    logradouro: ies.logradouro, numero: ies.numero, complemento: ies.complemento,
    bairro: ies.bairro, codigoMunicipio: ies.codigo_municipio,
    nomeMunicipio: ies.nome_municipio, uf: ies.uf, cep: ies.cep,
  });
  if (!end) return null;
  // Mantenedora (opcional no XSD do histórico, presente na referência)
  const mantenedora = (() => {
    if (!ies.mantenedora_json) return '';
    try {
      const m = JSON.parse(ies.mantenedora_json);
      if (!m?.razaoSocial || !normalizarCnpj(m.cnpj)) return '';
      const endM = m.endereco ? blocoEndereco(m.endereco) : null;
      if (!endM) return '';
      return (
        '<Mantenedora>' +
        el('RazaoSocial', m.razaoSocial) +
        el('CNPJ', normalizarCnpj(m.cnpj)) +
        `<Endereco>${endM}</Endereco>` +
        '</Mantenedora>'
      );
    } catch { return ''; }
  })();
  return (
    `<${tag}>` +
    el('Nome', ies.nome) +
    el('CodigoMEC', ies.codigo_emec) +
    el('CNPJ', normalizarCnpj(ies.cnpj) ?? '') +
    `<Endereco>${end}</Endereco>` +
    (cred ?? '') +
    (recred ?? '') +
    (renov ?? '') +
    mantenedora +
    `</${tag}>`
  );
}

/** Bloco HistoricoEscolar (THistoricoEscolar) — compartilhado com a DA. */
export function blocoHistoricoEscolar(s: SnapshotDiploma, agora: Date): string | null {
  const c = s.curso;
  const a = s.aluno;
  const usados = new Set<string>();
  const disciplinasXml: string[] = [];
  let chIntegralizada = 0;

  for (const d of s.disciplinas) {
    const ch = normalizarCargaHoraria(d.ch);
    if (!ch) continue; // já é pendência via coletor quando ausente em todas
    const aprovado = d.status === 'AP' || d.status === 'CUMP';
    const reprovado = d.status === 'REP';
    if (aprovado) chIntegralizada += 'horaAula' in ch ? ch.horaAula : ch.horaRelogio;

    const nota = normalizarNota(d.nota);
    // NotaAteCem (0-100) quando a escala da IES for centesimal;
    // Nota (0-10) quando decimal; Conceito quando alfabético.
    const notaXml = !nota
      ? ''
      : 'notaAteCem' in nota
        ? el('NotaAteCem', nota.notaAteCem)
        : 'nota' in nota
          ? el('Nota', nota.nota)
          : el('Conceito', nota.conceito);
    const situacaoXml = aprovado ? '<Aprovado />'
      : reprovado ? '<Reprovado />' : '<Pendente />';
    // Titulação fora do enum = pendência (coletor) — linha não entra no XML
    if (d.docente && mapearTitulacao(d.titulacao) == null) continue;
    const docente = d.docente
      ? blocoDocentes([{ nome: d.docente, titulacao: mapearTitulacao(d.titulacao)! }])
      : null;

    disciplinasXml.push(
      '<Disciplina>' +
      el('CodigoDisciplina', codigoDisciplinaDerivado(d.disciplina, usados)) +
      el('NomeDisciplina', d.disciplina) +
      el('PeriodoLetivo', d.periodo) +
      blocoCargaHorariaEtiqueta(ch, undefined)! +
      notaXml +
      situacaoXml +
      (docente ?? '') +
      '</Disciplina>'
    );
  }
  if (disciplinasXml.length === 0) return null;

  // CH integralizada > 0 é exigida pelo XSD (TNumeroPositivo) — aluno sem
  // nenhuma aprovação não pode gerar histórico (antes emitia HoraAula 0).
  if (chIntegralizada <= 0) return null;

  const chCurso = normalizarCargaHoraria(c.carga_horaria);
  const formaAcesso = mapearFormaAcesso(a.forma_ingresso);
  const ingresso =
    normalizarData(a.data_vestibular) ??
    (a.ano_ingresso && /^\d{4}$/.test(a.ano_ingresso) ? `${a.ano_ingresso}-01-01` : null);
  if (!chCurso || !formaAcesso || !ingresso) return null;

  // Emissão em hora local de Brasília (mapeamento oficial: data/hora
  // de geração — UTC deslocaria até 3h)
  const brasilia = dataHoraBrasilia(agora);
  const dataEmissao = brasilia.data;
  const horaEmissao = brasilia.hora;

  const expedicao = normalizarData(s.processo?.data_expedicao ?? null) ?? dataEmissao;

  return (
    '<HistoricoEscolar>' +
    el('CodigoCurriculo', `CUR-${c.id}`) +
    '<ElementosHistorico>' + disciplinasXml.join('') + '</ElementosHistorico>' +
    el('DataEmissaoHistorico', dataEmissao) +
    el('HoraEmissaoHistorico', horaEmissao) +
    '<SituacaoAtualDiscente>' +
    // PeriodoLetivo (opcional, presente na referência: "2024/1")
    (a.ano_conclusao && /^\d{4}$/.test(a.ano_conclusao)
      ? el('PeriodoLetivo', `${a.ano_conclusao}/1`)
      : '') +
    '<Formado>' +
    el('DataConclusaoCurso', normalizarData(`${a.ano_conclusao}-01-01`) ?? '') +
    el('DataColacaoGrau', normalizarData(a.data_colacao) ?? '') +
    el('DataExpedicaoDiploma', expedicao) +
    '</Formado></SituacaoAtualDiscente>' +
    // ENADE estruturado conforme referência (NaoHabilitado{Condicao,Edicao,...})
    blocoEnade(a.enade_json) +
    `<CargaHorariaCursoIntegralizada>${blocoCargaHoraria(
      Number.isInteger(chIntegralizada) ? { horaAula: chIntegralizada } : { horaRelogio: chIntegralizada }
    )}</CargaHorariaCursoIntegralizada>` +
    `<CargaHorariaCurso>${blocoCargaHoraria(chCurso)}</CargaHorariaCurso>` +
    '<IngressoCurso>' + el('Data', ingresso) + el('FormaAcesso', formaAcesso) + '</IngressoCurso>' +
    '</HistoricoEscolar>'
  );
}

/** Gera o XML completo do DocumentoHistoricoEscolarFinal. */
export function gerarHistoricoXml(s: SnapshotDiploma, agora = new Date()): string | null {
  const a = s.aluno;
  const c = s.curso;
  const ies = s.ies;
  if (!a || !c || !ies) return null;
  // Sexo inválido → não gera (o gate de pendências deve bloquear antes;
  // gerar com 'M' fabricado seria simulação).
  if (!normalizarSexo(a.sexo)) return null;

  const diplomado =
    blocoDiplomado({
      matricula: a.matricula,
      nome: a.nome,
      nomeSocial: a.nome_social,
      // O gate de pendências bloqueia sexo inválido ANTES — aqui não há
      // fallback inventado (?? 'M' fabricava sexo); o guard acima garante.
      sexo: normalizarSexo(a.sexo) as 'M' | 'F',
      nacionalidade: a.nacionalidade,
      naturalidade: a.naturalidade_estrangeira
        ? { nome: a.naturalidade_estrangeira }
        : { codigoIbge: a.naturalidade_codigo_ibge, nome: a.naturalidade, uf: a.naturalidade_uf },
      cpf: normalizarCpf(a.cpf) ?? '',
      rg: { numero: normalizarRg(a.rg) ?? '', orgaoExpedidor: a.orgao_emissor, uf: normalizarUf(a.rg_uf) ?? '' },
      dataNascimento: normalizarData(a.data_nascimento) ?? '',
    });
  if (!diplomado) return null;

  const cursoXml =
    '<DadosCurso>' +
    el('NomeCurso', c.nome) +
    el('CodigoCursoEMEC', c.codigo_emec) +
    // Habilitacao (opcional, presente na referência)
    blocoHabilitacoes(c.habilitacao_json) +
    (blocoAto(c.autorizacao_json, 'Autorizacao') ?? '') +
    // Reconhecimento: ramo InformacoesTramitacaoEMEC quando houver processo
    // e-MEC (conforme referência); senão ato completo
    (blocoTramitacaoEmec(c.reconhecimento_emec_json, 'Reconhecimento') ??
      blocoAto(c.reconhecimento_json, 'Reconhecimento') ?? '') +
    '</DadosCurso>';

  const iesXml = blocoIesEmissora(s);
  if (!iesXml) return null;

  const historico = blocoHistoricoEscolar(s, agora);
  if (!historico) return null;

  // CodigoValidacao do histórico: eMEC-emissora + "." + 16 hex
  // (persistido pelo handler na 1ª geração; aqui aceita o existente)
  const codigo = s.processo?.codigo_validacao_historico ?? `${ies.codigo_emec}.${randomBytes(8).toString('hex')}`;

  const infHistorico =
    elAttrs('infHistoricoEscolar', { versao: '1.05', ambiente: 'Produção' },
      '<Aluno>' + diplomado + '</Aluno>' +
      cursoXml +
      iesXml +
      historico +
      '<SegurancaHistorico>' + el('CodigoValidacao', codigo) + '</SegurancaHistorico>'
    );

  return documentoXml('DocumentoHistoricoEscolarFinal', infHistorico + assinaturaEstrutural());
}
