// ============================================================
// DIPLOMAS DIGITAIS MEC — handlers IPC (M2)
// ============================================================
// Fluxo do processo (status): aguardando_conclusao → apto →
// em_preparacao → xml_gerado → (xml_invalido ↺) → aguardando_
// assinatura (M4)... A criação do processo SÓ ocorre sem
// pendências (verificarPendenciasDiploma) — nada é simulado.
// Cadastro institucional (IES/cursos) exige admin.
import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain, app, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { getSessao, requerAuth, requerAdmin } from './auth';
import { verificarPendenciasDiploma, type PendenciaDiploma } from '../diploma-digital/pendencias';
import { encontrarCursoPorNome } from '../diploma-digital/match-curso';
import { normalizarCnpj, normalizarCep, normalizarUf, normalizarCpf, normalizarData, normalizarSexo } from '../diploma-digital/normalizadores';
import { logger } from '../utils/logger';
import { coletarSnapshot, pendenciasHistorico, pendenciasDA } from '../diploma-digital/coletor';
import { gerarHistoricoXml } from '../diploma-digital/gerar-historico-xml';
import { gerarDocumentacaoAcademicaXml } from '../diploma-digital/gerar-documentacao-academica';
import { gerarDiplomaFinalXml, type DadosRegistroRetorno } from '../diploma-digital/gerar-diploma-xml';
import { gerarListaDiplomasAnuladosXml } from '../diploma-digital/gerar-lista-anulados';
import { gerarArquivoFiscalizacaoXml, type DiplomaFiscalizadoEntrada } from '../diploma-digital/gerar-arquivo-fiscalizacao';
import { gerarRvddPdf } from '../diploma-digital/gerar-rvdd';
import { assinarTodosEsqueletos, contarEsqueletos } from '../diploma-digital/xades-signer';
import { validarArtefatoDiploma, type ResultadoValidacaoArtefato } from '../diploma-digital/validar-artefato';
import { validarXmlContraXsd, type ArtefatoXsd, type ResultadoValidacao } from '../diploma-digital/xsd-validator';
import { getClient } from '../cloud';
import { validarSenhaMaster } from '../utils/regras';
import { CONFIG } from '../config';
import { registrarDiplomaPublicoWeb } from '../web-registro-diploma';

export interface DiplomaDigitalRow {
  id: number;
  aluno_id: number;
  aluno_nome: string;
  aluno_cpf: string | null;
  matricula: string;
  curso: string | null;
  conclusao: string | null;
  colacao: string | null;
  status: string;
  versao_schema: string;
  chave_acesso: string | null;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  aguardando_conclusao: 'Aguardando conclusão',
  apto: 'Apto para diploma',
  em_preparacao: 'Em preparação',
  xml_gerado: 'XML gerado',
  xml_invalido: 'XML inválido',
  aguardando_assinatura: 'Aguardando assinatura',
  assinado: 'Assinado',
  aguardando_registro: 'Aguardando registro',
  registrado: 'Registrado',
  publicado: 'Publicado',
  anulado: 'Anulado',
  cancelado: 'Cancelado',
};

export function labelStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function auditar(diplomaId: number | null, acao: string, resultado: string, detalhes?: unknown): void {
  const sessao = getSessao();
  try {
    getDb()
      .prepare(
        `INSERT INTO auditoria_diploma (diploma_id, usuario_id, usuario_nome, acao, resultado, detalhes_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        diplomaId,
        sessao?.usuario?.id ?? null,
        sessao?.usuario?.nome ?? 'sistema',
        acao,
        resultado,
        detalhes ? JSON.stringify(detalhes) : null
      );
  } catch (e: any) {
    logger.warn({ err: e?.message }, 'auditoria_diploma: falha ao registrar');
  }
}

function listar(_event: IpcMainInvokeEvent, busca?: string): ApiResult<DiplomaDigitalRow[]> {
  const db = getDb();
  const filtro = busca ? `WHERE a.nome LIKE ? OR a.matricula LIKE ?` : '';
  const args = busca ? [`%${busca}%`, `%${busca}%`] : [];
  const rows = db
    .prepare(
      `SELECT dd.id, dd.aluno_id, a.nome AS aluno_nome, a.cpf AS aluno_cpf, a.matricula,
              a.curso, a.ano_conclusao AS conclusao, a.data_colacao AS colacao,
              dd.status, dd.versao_schema, dd.chave_acesso, dd.created_at
       FROM diplomas_digitais dd JOIN alunos a ON a.id = dd.aluno_id
       ${filtro} ORDER BY dd.id DESC`
    )
    .all(...args) as DiplomaDigitalRow[];
  return { ok: true, data: rows };
}

/** Alunos concluídos sem processo de diploma (candidatos a "apto"). */
function listarAptos(_event: IpcMainInvokeEvent, busca?: string): ApiResult<any[]> {
  const db = getDb();
  const filtro = busca ? `AND (a.nome LIKE ? OR a.matricula LIKE ?)` : '';
  const args = busca ? [`%${busca}%`, `%${busca}%`] : [];
  const rows = db
    .prepare(
      `SELECT a.id, a.nome, a.cpf, a.matricula, a.curso, a.ano_conclusao, a.data_colacao
       FROM alunos a
       WHERE a.ano_conclusao IS NOT NULL AND a.ano_conclusao != 'Cursando'
         AND NOT EXISTS (SELECT 1 FROM diplomas_digitais dd WHERE dd.aluno_id = a.id)
       ${filtro} ORDER BY a.nome LIMIT 200`
    )
    .all(...args);
  return { ok: true, data: rows };
}

function pendencias(_event: IpcMainInvokeEvent, alunoId: number): ApiResult<PendenciaDiploma[]> {
  const db = getDb();
  const pendsCriacao = verificarPendenciasDiploma(db, alunoId);
  // Inclui pendências de ARTEFATO (histórico/DA) quando o processo existe —
  // a tela de detalhe chama este canal para o botão "Ver pendências"
  const processo = db.prepare('SELECT id FROM diplomas_digitais WHERE aluno_id = ?').get(alunoId) as any;
  if (processo) {
    const snapshot = coletarSnapshot(db as any, processo.id);
    if (snapshot) {
      const pendsHistorico = pendenciasHistorico(snapshot);
      return { ok: true, data: [...pendsCriacao, ...pendsHistorico] };
    }
  }
  return { ok: true, data: pendsCriacao };
}

function criar(_event: IpcMainInvokeEvent, alunoId: number): ApiResult<DiplomaDigitalRow> {
  const sessao = getSessao();
  if (!sessao) return { ok: false, error: 'Não autenticado' };
  const db = getDb();

  const aluno = db.prepare('SELECT id, curso FROM alunos WHERE id = ?').get(alunoId) as any;
  if (!aluno) return { ok: false, error: 'Aluno não encontrado' };

  const existe = db.prepare('SELECT id FROM diplomas_digitais WHERE aluno_id = ?').get(alunoId) as any;
  if (existe) return { ok: false, error: 'Este aluno já possui processo de Diploma Digital aberto.' };

  const pends = verificarPendenciasDiploma(db, alunoId);
  if (pends.length > 0) {
    auditar(null, 'criacao', 'bloqueado', { alunoId, pendencias: pends.length });
    return {
      ok: false,
      error: `Diploma não pode ser gerado. ${pends.length} pendência(s) — resolva na tela de Pendências.`,
    };
  }

  const ies = db.prepare("SELECT id FROM ies WHERE papel = 'emissora' AND ativo = 1 ORDER BY id LIMIT 1").get() as any;
  if (!ies) return { ok: false, error: 'Nenhuma IES emissora cadastrada. Configure o Cadastro Institucional primeiro.' };

  const curso = aluno.curso
    ? encontrarCursoPorNome(
        db.prepare('SELECT * FROM cursos WHERE ativo = 1 ORDER BY id').all() as any[],
        aluno.curso
      )
    : undefined;

  const info = db
    .prepare(
      `INSERT INTO diplomas_digitais (aluno_id, curso_id, ies_emissora_id, status, criado_por)
       VALUES (?, ?, ?, 'apto', ?)`
    )
    .run(alunoId, curso?.id ?? null, ies.id, sessao.usuario.id);
  const id = info.lastInsertRowid as number;
  auditar(id, 'criacao', 'sucesso', { alunoId });
  const row = db
    .prepare(
      `SELECT dd.id, dd.aluno_id, a.nome AS aluno_nome, a.cpf AS aluno_cpf, a.matricula,
              a.curso, a.ano_conclusao AS conclusao, a.data_colacao AS colacao,
              dd.status, dd.versao_schema, dd.chave_acesso, dd.created_at
       FROM diplomas_digitais dd JOIN alunos a ON a.id = dd.aluno_id WHERE dd.id = ?`
    )
    .get(id) as DiplomaDigitalRow;
  return { ok: true, data: row };
}

function obter(_event: IpcMainInvokeEvent, id: number): ApiResult<any> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT dd.*, a.nome AS aluno_nome, a.cpf, a.matricula, a.curso, a.data_nascimento,
              a.data_colacao, a.ano_conclusao, i.nome AS ies_emissora_nome
       FROM diplomas_digitais dd
       JOIN alunos a ON a.id = dd.aluno_id
       LEFT JOIN ies i ON i.id = dd.ies_emissora_id
       WHERE dd.id = ?`
    )
    .get(id) as any;
  if (!row) return { ok: false, error: 'Processo de diploma não encontrado' };
  const arquivos = db
    .prepare('SELECT * FROM diploma_arquivos WHERE diploma_id = ? ORDER BY id DESC')
    .all(id);
  const assinaturas = db
    .prepare('SELECT * FROM diploma_assinaturas WHERE diploma_id = ? ORDER BY id')
    .all(id);
  const auditoria = db
    .prepare('SELECT * FROM auditoria_diploma WHERE diploma_id = ? ORDER BY id DESC LIMIT 100')
    .all(id);
  return { ok: true, data: { ...row, arquivos, assinaturas, auditoria } };
}

/** Complementa dados do aluno exigidos pelo XSD (tela de Pendências). */
function completarAluno(
  _event: IpcMainInvokeEvent,
  input: {
    alunoId: number;
    cpf?: string;
    sexo?: string;
    nacionalidade?: string;
    rg?: string;
    rgUf?: string;
    dataNascimento?: string;
    naturalidadeCodigoIbge?: string;
    naturalidadeUf?: string;
    naturalidadeEstrangeira?: string;
    dataColacao?: string;
    /** Filiação (XSD da DA exige ≥1 genitor com nome+sexo). */
    maeNome?: string;
    maeSexo?: string;
    paiNome?: string;
    paiSexo?: string;
  }
): ApiResult<true> {
  const db = getDb();
  const sets: string[] = [];
  const args: any[] = [];
  const add = (col: string, val: string | undefined) => {
    if (val !== undefined && val !== null) {
      sets.push(`${col} = ?`);
      args.push(val.trim() || null);
    }
  };
  if (input.cpf !== undefined && !normalizarCpf(input.cpf)) {
    return { ok: false, error: 'CPF inválido — informe 11 dígitos.' };
  }
  if (input.rgUf !== undefined && input.rgUf && !normalizarUf(input.rgUf)) {
    return { ok: false, error: 'UF do RG inválida.' };
  }
  if (input.naturalidadeUf !== undefined && input.naturalidadeUf && !normalizarUf(input.naturalidadeUf)) {
    return { ok: false, error: 'UF da naturalidade inválida.' };
  }
  if (input.naturalidadeCodigoIbge !== undefined && input.naturalidadeCodigoIbge && !/^\d{7}$/.test(input.naturalidadeCodigoIbge)) {
    return { ok: false, error: 'Código IBGE deve ter 7 dígitos.' };
  }
  if (input.dataNascimento !== undefined && input.dataNascimento && !normalizarData(input.dataNascimento)) {
    return { ok: false, error: 'Data de nascimento em formato não reconhecido (use DD/MM/AAAA).' };
  }
  if (input.maeSexo && !normalizarSexo(input.maeSexo)) {
    return { ok: false, error: 'Sexo da mãe deve ser M ou F.' };
  }
  if (input.paiSexo && !normalizarSexo(input.paiSexo)) {
    return { ok: false, error: 'Sexo do pai deve ser M ou F.' };
  }
  if ((input.maeSexo && !input.maeNome?.trim()) || (input.paiSexo && !input.paiNome?.trim())) {
    return { ok: false, error: 'Informe o nome junto com o sexo do genitor.' };
  }
  add('cpf', input.cpf);
  add('sexo', input.sexo);
  add('nacionalidade', input.nacionalidade);
  add('rg', input.rg);
  add('rg_uf', input.rgUf);
  add('data_nascimento', input.dataNascimento);
  add('naturalidade_codigo_ibge', input.naturalidadeCodigoIbge);
  add('naturalidade_uf', input.naturalidadeUf);
  add('naturalidade_estrangeira', input.naturalidadeEstrangeira);
  add('data_colacao', input.dataColacao);
  add('mae_nome', input.maeNome);
  if (input.maeSexo !== undefined) {
    sets.push('mae_sexo = ?');
    args.push(input.maeSexo.trim() ? normalizarSexo(input.maeSexo) : null);
  }
  add('pai_nome', input.paiNome);
  if (input.paiSexo !== undefined) {
    sets.push('pai_sexo = ?');
    args.push(input.paiSexo.trim() ? normalizarSexo(input.paiSexo) : null);
  }
  if (sets.length === 0) return { ok: false, error: 'Nada para atualizar' };
  db.prepare(`UPDATE alunos SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args, input.alunoId);
  auditar(null, 'completar_dados_aluno', 'sucesso', { alunoId: input.alunoId, campos: sets });
  return { ok: true, data: true };
}

// ---------- Cadastro institucional (IES + cursos; admin) ----------

function iesListar(_event: IpcMainInvokeEvent): ApiResult<any[]> {
  const db = getDb();
  return { ok: true, data: db.prepare('SELECT * FROM ies ORDER BY ativo DESC, nome').all() };
}

function iesSalvar(
  _event: IpcMainInvokeEvent,
  input: {
    id?: number;
    nome: string;
    codigoEmec?: number;
    cnpj?: string;
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    codigoMunicipio?: string;
    nomeMunicipio?: string;
    uf?: string;
    cep?: string;
    papel?: string;
    credenciamentoJson?: string;
    recredenciamentoJson?: string;
    renovacaoRecredenciamentoJson?: string;
    /** Mantenedora da registradora (obrigatória no XSD do Diploma):
     *  { razaoSocial, cnpj, endereco: {logradouro, numero?, complemento?,
     *    bairro, codigoMunicipio, nomeMunicipio, uf, cep} }. */
    mantenedoraJson?: string;
  }
): ApiResult<any> {
  if (!input.nome?.trim()) return { ok: false, error: 'Nome da IES é obrigatório' };
  if (input.cnpj && !normalizarCnpj(input.cnpj)) return { ok: false, error: 'CNPJ inválido — informe 14 dígitos' };
  if (input.cep && !normalizarCep(input.cep)) return { ok: false, error: 'CEP inválido — informe 8 dígitos' };
  if (input.uf && !normalizarUf(input.uf)) return { ok: false, error: 'UF inválida' };
  if (input.codigoMunicipio && !/^\d{7}$/.test(input.codigoMunicipio)) return { ok: false, error: 'Código IBGE do município deve ter 7 dígitos' };
  // Ato regulatório: JSON parseável com tipo+numero+data (o XSD exige o ato
  // completo — gate de mera presença deixava passar JSON incompleto).
  const validarAto = (json: string | undefined, rotulo: string): string | null => {
    if (!json?.trim()) return null;
    try {
      const ato = JSON.parse(json);
      if (!ato?.tipo || !ato?.numero || !normalizarData(ato.data)) {
        return `${rotulo}: informe tipo, número e data (AAAA-MM-DD) do ato`;
      }
      return null;
    } catch {
      return `${rotulo}: conteúdo inválido`;
    }
  };
  for (const [json, rotulo] of [
    [input.credenciamentoJson, 'Credenciamento'],
    [input.recredenciamentoJson, 'Recredenciamento'],
    [input.renovacaoRecredenciamentoJson, 'Renovação de recredenciamento'],
  ] as const) {
    const erro = validarAto(json, rotulo);
    if (erro) return { ok: false, error: erro };
  }
  // Mantenedora (obrigatória p/ registradora no Diploma final): valida
  // completude — RazaoSocial + CNPJ + endereço estruturado.
  let mantenedoraNorm: string | null = null;
  if (input.mantenedoraJson?.trim()) {
    try {
      const m = JSON.parse(input.mantenedoraJson);
      if (!m?.razaoSocial?.trim() || !normalizarCnpj(m.cnpj)) {
        return { ok: false, error: 'Mantenedora: razão social e CNPJ (14 dígitos) são obrigatórios' };
      }
      const e = m.endereco ?? {};
      if (!e.logradouro?.trim() || !e.bairro?.trim() || !e.nomeMunicipio?.trim() || !normalizarCep(e.cep)) {
        return { ok: false, error: 'Mantenedora: endereço incompleto (logradouro, bairro, município e CEP)' };
      }
      if (e.codigoMunicipio && !/^\d{7}$/.test(String(e.codigoMunicipio))) {
        return { ok: false, error: 'Mantenedora: código IBGE do município deve ter 7 dígitos' };
      }
      mantenedoraNorm = JSON.stringify({
        razaoSocial: String(m.razaoSocial).trim(),
        cnpj: normalizarCnpj(m.cnpj),
        endereco: {
          logradouro: String(e.logradouro).trim(),
          numero: e.numero?.trim() || undefined,
          complemento: e.complemento?.trim() || undefined,
          bairro: String(e.bairro).trim(),
          codigoMunicipio: e.codigoMunicipio ? String(e.codigoMunicipio).trim() : undefined,
          nomeMunicipio: String(e.nomeMunicipio).trim(),
          uf: e.uf ? normalizarUf(e.uf) ?? '' : '',
          cep: normalizarCep(e.cep),
        },
      });
    } catch {
      return { ok: false, error: 'Mantenedora: conteúdo inválido' };
    }
  }
  const db = getDb();
  const vals = [
    input.nome.trim(),
    input.codigoEmec ?? null,
    input.cnpj ? normalizarCnpj(input.cnpj) : null,
    input.logradouro?.trim() || null,
    input.numero?.trim() || null,
    input.complemento?.trim() || null,
    input.bairro?.trim() || null,
    input.codigoMunicipio?.trim() || null,
    input.nomeMunicipio?.trim() || null,
    input.uf ? normalizarUf(input.uf) : null,
    input.cep ? normalizarCep(input.cep) : null,
    input.papel ?? 'emissora',
    input.credenciamentoJson?.trim() || null,
    input.recredenciamentoJson?.trim() || null,
    input.renovacaoRecredenciamentoJson?.trim() || null,
    mantenedoraNorm,
  ];
  if (input.id) {
    db.prepare(
      `UPDATE ies SET nome=?, codigo_emec=?, cnpj=?, logradouro=?, numero=?, complemento=?, bairro=?,
       codigo_municipio=?, nome_municipio=?, uf=?, cep=?, papel=?, credenciamento_json=?,
       recredenciamento_json=?, renovacao_recredenciamento_json=?, mantenedora_json=?,
       updated_at=datetime('now') WHERE id=?`
    ).run(...vals, input.id);
    auditar(null, 'ies_atualizacao', 'sucesso', { iesId: input.id });
    return { ok: true, data: db.prepare('SELECT * FROM ies WHERE id=?').get(input.id) };
  }
  const info = db
    .prepare(
      `INSERT INTO ies (nome, codigo_emec, cnpj, logradouro, numero, complemento, bairro,
       codigo_municipio, nome_municipio, uf, cep, papel, credenciamento_json,
       recredenciamento_json, renovacao_recredenciamento_json, mantenedora_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(...vals);
  auditar(null, 'ies_cadastro', 'sucesso', { iesId: info.lastInsertRowid });
  return { ok: true, data: db.prepare('SELECT * FROM ies WHERE id=?').get(info.lastInsertRowid) };
}

function cursoGraduacaoListar(_event: IpcMainInvokeEvent, iesId?: number): ApiResult<any[]> {
  const db = getDb();
  const rows = iesId
    ? db.prepare('SELECT * FROM cursos WHERE ies_id = ? ORDER BY ativo DESC, nome').all(iesId)
    : db.prepare('SELECT * FROM cursos ORDER BY ativo DESC, nome').all();
  return { ok: true, data: rows };
}

function cursoGraduacaoSalvar(
  _event: IpcMainInvokeEvent,
  input: {
    id?: number;
    iesId: number;
    nome: string;
    codigoEmec?: number;
    modalidade?: string;
    tituloConferido?: string;
    outroTitulo?: string;
    grauConferido?: string;
    cargaHoraria?: string;
    enderecoJson?: string;
    autorizacaoJson?: string;
    reconhecimentoJson?: string;
    reconhecimentoEmecJson?: string;
    habilitacaoJson?: string;
    renovacaoReconhecimentoJson?: string;
  }
): ApiResult<any> {
  if (!input.nome?.trim()) return { ok: false, error: 'Nome do curso é obrigatório' };
  if (input.modalidade && !['Presencial', 'EAD'].includes(input.modalidade)) {
    return { ok: false, error: 'Modalidade deve ser Presencial ou EAD' };
  }
  if (input.cargaHoraria && !/^\d+$/.test(input.cargaHoraria)) {
    return { ok: false, error: 'Carga horária deve ser um número inteiro de horas (ex.: 3000)' };
  }
  const db = getDb();
  const ies = db.prepare('SELECT id FROM ies WHERE id = ?').get(input.iesId) as any;
  if (!ies) return { ok: false, error: 'IES não encontrada' };
  // Duplicidade: mesmo nome (normalizado — acentos/caixa) na mesma IES.
  // O vínculo aluno↔curso casa por nome; duas linhas iguais criam ambiguidade
  // (a pendência/geração usam a primeira por id) e já aconteceu na prática.
  const normalizarTexto = (t: string) =>
    t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const duplicado = (db.prepare('SELECT id, nome FROM cursos WHERE ies_id = ?').all(input.iesId) as any[])
    .find((c: any) => c.id !== input.id && normalizarTexto(c.nome ?? '') === normalizarTexto(input.nome));
  if (duplicado) {
    return {
      ok: false,
      error: `Já existe o curso "${duplicado.nome}" (id ${duplicado.id}) nesta IES — edite o existente em vez de cadastrar novamente.`,
    };
  }
  const vals = [
    input.iesId,
    input.nome.trim(),
    input.codigoEmec ?? null,
    input.modalidade?.trim() || null,
    input.tituloConferido?.trim() || null,
    input.outroTitulo?.trim() || null,
    input.grauConferido?.trim() || null,
    input.cargaHoraria?.trim() || null,
    input.enderecoJson?.trim() || null,
    input.autorizacaoJson?.trim() || null,
    input.reconhecimentoJson?.trim() || null,
    input.reconhecimentoEmecJson?.trim() || null,
    input.habilitacaoJson?.trim() || null,
    input.renovacaoReconhecimentoJson?.trim() || null,
  ];
  if (input.id) {
    db.prepare(
      `UPDATE cursos SET ies_id=?, nome=?, codigo_emec=?, modalidade=?, titulo_conferido=?, outro_titulo=?,
       grau_conferido=?, carga_horaria=?, endereco_json=?, autorizacao_json=?, reconhecimento_json=?,
       reconhecimento_emec_json=?, habilitacao_json=?, renovacao_reconhecimento_json=?,
       updated_at=datetime('now') WHERE id=?`
    ).run(...vals, input.id);
    auditar(null, 'curso_atualizacao', 'sucesso', { cursoId: input.id });
    return { ok: true, data: db.prepare('SELECT * FROM cursos WHERE id=?').get(input.id) };
  }
  const info = db
    .prepare(
      `INSERT INTO cursos (ies_id, nome, codigo_emec, modalidade, titulo_conferido, outro_titulo,
       grau_conferido, carga_horaria, endereco_json, autorizacao_json, reconhecimento_json,
       reconhecimento_emec_json, habilitacao_json, renovacao_reconhecimento_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(...vals);
  auditar(null, 'curso_cadastro', 'sucesso', { cursoId: info.lastInsertRowid });
  return { ok: true, data: db.prepare('SELECT * FROM cursos WHERE id=?').get(info.lastInsertRowid) };
}

/** Desativação soft (ativo=0): o curso some do matching de pendências/geração
 *  sem perder histórico — usado p/ limpar duplicados (o vínculo aluno↔curso é
 *  por nome; duas linhas ativas iguais causam ambiguidade). */
function cursoGraduacaoDesativar(_event: IpcMainInvokeEvent, id: number): ApiResult<true> {
  const db = getDb();
  const info = db.prepare('UPDATE cursos SET ativo = 0, updated_at = datetime(\'now\') WHERE id = ?').run(id);
  if (info.changes === 0) return { ok: false, error: 'Curso não encontrado' };
  auditar(null, 'curso_desativacao', 'sucesso', { cursoId: id });
  return { ok: true, data: true };
}

// ---------- Geração de XML oficial (M3): GERAR → VALIDAR XSD → PERSISTIR ----------

const TIPO_DOC_XML: { padrao: RegExp; tipo: string }[] = [
  { padrao: /rg|identidade|cpf/i, tipo: 'DocumentoIdentidadeDoAluno' },
  { padrao: /ensafo|ensino m[\u00e9]dio/i, tipo: 'ProvaConclusaoEnsinoMedio' },
  { padrao: /colacao|colação/i, tipo: 'ProvaColacao' },
  { padrao: /estagio|estágio/i, tipo: 'ComprovacaoEstagioCurricular' },
  { padrao: /nascimento/i, tipo: 'CertidaoNascimento' },
  { padrao: /casamento/i, tipo: 'CertidaoCasamento' },
  { padrao: /titulo|título eleitor/i, tipo: 'TituloEleitor' },
  { padrao: /naturaliza/i, tipo: 'AtoNaturalizacao' },
];

function tipoDocumentoMec(nome: string): string {
  for (const t of TIPO_DOC_XML) if (t.padrao.test(nome)) return t.tipo;
  return 'Outros';
}

/** Upload best-effort para o bucket privado (diplomas-digitais). */
async function subirXmlStorage(diplomaId: number, arquivo: string, conteudo: string): Promise<string | null> {
  try {
    const client = getClient();
    if (!client) return null;
    const caminho = `${diplomaId}/${arquivo}`;
    const { error } = await client.storage
      .from('diplomas-digitais')
      .upload(caminho, Buffer.from(conteudo, 'utf8'), { contentType: 'application/xml', upsert: true });
    if (error) {
      logger.warn({ err: error.message, diplomaId }, 'Upload do XML ao Storage falhou (mantido local)');
      return null;
    }
    return caminho;
  } catch (e: any) {
    logger.warn({ err: e?.message, diplomaId }, 'Storage indisponível — XML mantido apenas local');
    return null;
  }
}

/** Diagnóstico ESPECÍFICO quando o histórico retorna null — em vez de
 *  "dados insuficientes", informa o campo exato que bloqueou. */
function diagnosticarFalhaHistorico(s: any): string {
  const motivos: string[] = [];
  if (!s.aluno) motivos.push('aluno não encontrado');
  if (!s.curso) motivos.push('curso do aluno não encontrado no Cadastro Institucional (verifique nome/acentos/ativo)');
  if (!s.ies) motivos.push('IES emissora não encontrada');
  if (s.aluno && !s.ies?.logradouro) motivos.push('endereço da IES incompleto');
  if (s.aluno && s.curso && !s.curso.carga_horaria) motivos.push('carga horária total do curso ausente (Cadastre no Cadastro Institucional → Curso)');
  // Verifica se alguma disciplina tem CH/aprovada
  const disciplinasValidas = (s.disciplinas ?? []).filter((d: any) => {
    const status = (d.status ?? '').trim().toUpperCase();
    return status === 'AP' || status === 'CUMP' || status.startsWith('APROV');
  });
  if (disciplinasValidas.length === 0) motivos.push('nenhuma disciplina com status aprovado (AP/CUMP) — a carga horária integralizada ficaria zero');
  return motivos.length > 0 ? motivos.join('; ') : 'causa não identificada (contate o suporte com o ID do processo)';
}

/** Diagnóstico ESPECÍFICO quando a DA retorna null. */
function diagnosticarFalhaDA(_db: any, s: any, docs: { caminho: string; tipo: string }[]): string {  const motivos: string[] = diagnosticarFalhaHistorico(s).split('; ').filter((m: string) => m && !m.includes('contate'));
  // Documentos físicos
  const docsExistentes = docs.filter((d) => {
    try { return fs.existsSync(d.caminho); } catch { return false; }
  });
  if (docs.length > 0 && docsExistentes.length === 0) {
    motivos.push(`${docs.length} documento(s) registrado(s) mas arquivo(s) físico(s) não encontrado(s) em disco — reanexe em Alunos → Documentos`);
  }
  // Genitores
  const temGenitor = (s.aluno?.mae_nome && s.aluno?.mae_sexo) || (s.aluno?.pai_nome && s.aluno?.pai_sexo);
  if (!temGenitor) motivos.push('filiação incompleta (nome E sexo de pelo menos um genitor)');
  return motivos.length > 0 ? motivos.join('; ') : 'causa não identificada';
}

function gerarXmlHandler(
  _event: IpcMainInvokeEvent,
  diplomaId: number,
  artefato: 'historico_escolar' | 'documentacao_academica'
): Promise<ApiResult<{ valido: boolean; erros: string[]; arquivoId: number }>> {
  return (async () => {
    const db = getDb();
    const snapshot = coletarSnapshot(db as any, diplomaId);
    if (!snapshot) return { ok: false, error: 'Processo de diploma não encontrado' };

    // 1) RE-EXECUTA pendências de criação (dados podem ter degradado
    //    após a criação do processo: endereço IES editado, curso
    //    desativado, CPF apagado etc.) — antes eram silenciosas
    const pendsCriacao = verificarPendenciasDiploma(db as any, snapshot.aluno.id);
    const pendsArtefato: PendenciaDiploma[] =
      artefato === 'historico_escolar' ? pendenciasHistorico(snapshot) : pendenciasDA(db as any, snapshot);
    const pends = [...pendsCriacao, ...pendsArtefato];
    if (pends.length > 0) {
      auditar(diplomaId, `geracao_xml_${artefato}`, 'bloqueado', { pendencias: pends.length });
      const detalhe = pends
        .slice(0, 6)
        .map((p) => `• ${p.campo}: ${p.motivo}`)
        .join('\n');
      return {
        ok: false,
        error: `XML não gerado — ${pends.length} pendência(s):\n${detalhe}${pends.length > 6 ? `\n… e mais ${pends.length - 6}` : ''}`,
      };
    }

    // 2) GERA (com mensagens específicas quando falha)
    let xml: string | null;
    let motivoFalha = '';
    if (artefato === 'historico_escolar') {
      xml = gerarHistoricoXml(snapshot);
      if (!xml) motivoFalha = diagnosticarFalhaHistorico(snapshot);
    } else {
      const docs = (db
        .prepare('SELECT * FROM aluno_documentos WHERE aluno_id = ? AND caminho IS NOT NULL')
        .all(snapshot.aluno.id) as any[])
        .map((d) => ({ caminho: d.caminho, tipo: tipoDocumentoMec(d.nome ?? '') }));
      xml = gerarDocumentacaoAcademicaXml(snapshot, docs);
      if (!xml) motivoFalha = diagnosticarFalhaDA(db as any, snapshot, docs);
    }
    if (!xml) {
      auditar(diplomaId, `geracao_xml_${artefato}`, 'erro_geracao', { motivo: motivoFalha });
      return { ok: false, error: `Falha ao montar o XML: ${motivoFalha}` };
    }

    // 3) VALIDA contra o XSD oficial — inválido NÃO continua
    const artefatoXsd: ArtefatoXsd = artefato === 'historico_escolar' ? 'historicoEscolar' : 'documentacaoAcademica';
    let validacao: ResultadoValidacao;
    try {
      validacao = await validarXmlContraXsd(xml, artefatoXsd);
    } catch (e: any) {
      logger.error({ err: e?.message, diplomaId }, 'Validador XSD falhou');
      return { ok: false, error: 'Falha ao executar a validação XSD: ' + (e?.message ?? '') };
    }

    // 4) PERSISTE (arquivo local + registro + status + auditoria) em qualquer resultado
    const nomeArquivo = artefato === 'historico_escolar' ? 'historico-escolar-digital.xml' : 'documentacao-academica-registro.xml';
    const dir = path.join(app.getPath('userData'), 'diplomas-digitais', String(diplomaId));
    fs.mkdirSync(dir, { recursive: true });
    const localPath = path.join(dir, nomeArquivo);
    fs.writeFileSync(localPath, xml, 'utf8');
    const hash = createHash('sha256').update(xml, 'utf8').digest('hex');

    // Upload ao bucket privado (o caminho da nuvem é derivável; a coluna
    // caminho_storage fica com o caminho LOCAL — ver INSERT abaixo).
    await subirXmlStorage(diplomaId, nomeArquivo, xml);

    // Persiste chaves/códigos na 1ª geração
    if (artefato === 'historico_escolar' && !snapshot.processo?.codigo_validacao_historico) {
      const m = /<CodigoValidacao>([^<]+)<\/CodigoValidacao>/.exec(xml);
      if (m) db.prepare('UPDATE diplomas_digitais SET codigo_validacao_historico = ? WHERE id = ?').run(m[1], diplomaId);
    }
    // Data de expedição: gravada UMA vez na 1ª geração válida do histórico
    // (antes era "fabricada" como data do dia a cada regeneração).
    if (artefato === 'historico_escolar' && validacao.valido && !snapshot.processo?.data_expedicao) {
      const m = /<DataExpedicaoDiploma>([^<]+)<\/DataExpedicaoDiploma>/.exec(xml);
      if (m) db.prepare('UPDATE diplomas_digitais SET data_expedicao = ? WHERE id = ?').run(m[1], diplomaId);
    }
    if (artefato === 'documentacao_academica') {
      if (!snapshot.processo?.chave_acesso) {
        const m = /<DadosDiploma id="Dip([0-9]{44})"/.exec(xml);
        if (m) db.prepare('UPDATE diplomas_digitais SET chave_acesso = ? WHERE id = ?').run(`Dip${m[1]}`, diplomaId);
      }
      if (!snapshot.processo?.chave_req) {
        const m = /<RegistroReq[^>]*id="ReqDip([0-9]{44})"/.exec(xml);
        if (m) db.prepare('UPDATE diplomas_digitais SET chave_req = ? WHERE id = ?').run(`ReqDip${m[1]}`, diplomaId);
      }
    }

    const info = db
      .prepare(
        `INSERT INTO diploma_arquivos (diploma_id, tipo_arquivo, nome, caminho_storage, hash, versao_schema, valido_xsd, erros_validacao_json)
         VALUES (?, ?, ?, ?, ?, '1.05', ?, ?)`
      )
      // v1.4.8: caminho_storage é SEMPRE o caminho local absoluto (o do
      // storage é derivável: ${diplomaId}/${nomeArquivo}). Entre v1.4.4-1.4.7
      // gravava-se o caminho do STORAGE quando o upload dia certo — e o
      // fs.readFileSync de ASSINAR/REGISTRAR nunca achava o arquivo.
      .run(diplomaId, artefato, nomeArquivo, localPath, hash, validacao.valido ? 1 : 0, JSON.stringify(validacao.erros));

    const novoStatus = validacao.valido ? 'aguardando_assinatura' : 'xml_invalido';
    db.prepare('UPDATE diplomas_digitais SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(novoStatus, diplomaId);
    auditar(diplomaId, `geracao_xml_${artefato}`, validacao.valido ? 'sucesso' : 'xml_invalido', {
      erros: validacao.valido ? undefined : validacao.erros.slice(0, 10),
    });

    if (!validacao.valido) {
      return {
        ok: false,
        error: `XML gerado porém INVÁLIDO contra o XSD ${validacao.versaoSchema}. Correção necessária antes de prosseguir.\n` +
          formatarErrosXsd(validacao.erros),
      };
    }
    return { ok: true, data: { valido: true, erros: [], arquivoId: info.lastInsertRowid as number } };
  })();
}

// ---------- M4: ASSINAR / REGISTRAR / PUBLICAR / ANULAR ----------

/** Caminho local canônico do artefato (em disco E gravado no banco). */
function caminhoArtefatoLocal(diplomaId: number, nomeArquivo: string): string {
  return path.join(app.getPath('userData'), 'diplomas-digitais', String(diplomaId), nomeArquivo);
}

/**
 * Lê o XML VÁLIDO mais recente do artefato, resolvendo o arquivo em 3
 * camadas (v1.4.8):
 *  1. caminho absoluto da coluna existindo em disco;
 *  2. caminho local canônico (a coluna podia ter o CAMINHO DO STORAGE —
 *     bug v1.4.4-1.4.7: o gerador gravava "1/arquivo.xml" quando o upload
 *     dava certo, e o fs.readFileSync nunca achava, quebrando ASSINAR e
 *     REGISTRAR mesmo com o arquivo salvo em disco);
 *  3. restauração do bucket privado da nuvem para o caminho canônico
 *     (arquivo gerado em outra máquina / disco mudou).
 * Nas camadas 2-3 a coluna é AUTO-CORRIGIDA para o caminho local — os
 * registros antigos se reparam sozinhos no primeiro uso.
 * Retorna { lido } ou { motivo } com a causa real.
 */
async function lerXmlArquivoComMotivo(
  diplomaId: number,
  tipo: string
): Promise<{ lido: { id: number; xml: string } | null; motivo: string }> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, caminho_storage FROM diploma_arquivos
       WHERE diploma_id = ? AND tipo_arquivo = ? AND valido_xsd = 1
       ORDER BY id DESC LIMIT 1`
    )
    .get(diplomaId, tipo) as any;
  if (!row) {
    const ultima = db
      .prepare(
        `SELECT id, valido_xsd FROM diploma_arquivos
         WHERE diploma_id = ? AND tipo_arquivo = ? ORDER BY id DESC LIMIT 1`
      )
      .get(diplomaId, tipo) as any;
    if (!ultima) return { lido: null, motivo: 'Nenhum XML deste artefato foi gerado ainda — clique em "Gerar XML".' };
    if (!ultima.valido_xsd) {
      return { lido: null, motivo: 'O último XML gerado está INVÁLIDO contra o XSD — gere novamente e corrija os erros antes de assinar.' };
    }
    return { lido: null, motivo: 'XML válido não encontrado' };
  }
  if (!row.caminho_storage) return { lido: null, motivo: 'Registro do arquivo sem caminho — gere o XML novamente.' };

  const nome = path.basename(row.caminho_storage);
  const candidatos = [
    ...(path.isAbsolute(row.caminho_storage) ? [row.caminho_storage] : []),
    caminhoArtefatoLocal(diplomaId, nome),
  ];
  for (const caminho of candidatos) {
    try {
      const xml = fs.readFileSync(caminho, 'utf8');
      if (caminho !== row.caminho_storage) {
        db.prepare('UPDATE diploma_arquivos SET caminho_storage = ? WHERE id = ?').run(caminho, row.id);
        logger.info({ arquivoId: row.id, caminho }, 'caminho_storage auto-corrigido para o local canônico');
      }
      return { lido: { id: row.id, xml }, motivo: '' };
    } catch { /* tenta o próximo */ }
  }

  // 3) restaura do bucket privado para o caminho canônico
  const destino = caminhoArtefatoLocal(diplomaId, nome);
  const r = await baixarXmlStorage(diplomaId, nome, destino);
  if (r.ok) {
    db.prepare('UPDATE diploma_arquivos SET caminho_storage = ? WHERE id = ?').run(destino, row.id);
    try {
      return { lido: { id: row.id, xml: fs.readFileSync(destino, 'utf8') }, motivo: '' };
    } catch { /* segue para o motivo */ }
  }
  return {
    lido: null,
    motivo:
      `O XML válido existe (registro #${row.id}) mas o arquivo não foi encontrado em disco ` +
      `nem na nuvem (${r.erro ?? 'storage indisponível'}). ` +
      `Gere o XML novamente nesta máquina — o processo e o histórico não são afetados.`,
  };
}

/** Atalho síncrono-assíncrono: apenas o XML (sem o motivo). */
async function lerXmlArquivo(diplomaId: number, tipo: string): Promise<{ id: number; xml: string } | null> {
  return (await lerXmlArquivoComMotivo(diplomaId, tipo)).lido;
}

/** Baixa o XML do bucket privado para o caminho local indicado. */
async function baixarXmlStorage(
  diplomaId: number,
  nomeArquivo: string,
  destino: string
): Promise<{ ok: boolean; erro?: string }> {
  try {
    const client = getClient();
    if (!client) return { ok: false, erro: 'nuvem não inicializada' };
    const { data, error } = await client.storage
      .from('diplomas-digitais')
      .download(`${diplomaId}/${nomeArquivo}`);
    if (error || !data) return { ok: false, erro: error?.message ?? 'objeto ausente no bucket' };
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(await data.arrayBuffer()), 'utf8');
    logger.info({ diplomaId, arquivo: nomeArquivo }, 'XML restaurado do storage da nuvem');
    return { ok: true };
  } catch (e: any) {
    logger.warn({ err: e?.message, diplomaId }, 'Restauração do XML do storage falhou');
    return { ok: false, erro: e?.message ?? String(e) };
  }
}

function persistirNovaVersao(
  diplomaId: number,
  tipo: string,
  xml: string,
  validacao: ResultadoValidacao,
  nomeArquivo: string
): number {
  const db = getDb();
  const dir = path.join(app.getPath('userData'), 'diplomas-digitais', String(diplomaId));
  fs.mkdirSync(dir, { recursive: true });
  const localPath = path.join(dir, nomeArquivo);
  fs.writeFileSync(localPath, xml, 'utf8');
  const hash = createHash('sha256').update(xml, 'utf8').digest('hex');
  const info = db
    .prepare(
      `INSERT INTO diploma_arquivos (diploma_id, tipo_arquivo, nome, caminho_storage, hash, versao_schema, valido_xsd, erros_validacao_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(diplomaId, tipo, nomeArquivo, localPath, hash, validacao.versaoSchema, validacao.valido ? 1 : 0, JSON.stringify(validacao.erros));
  return info.lastInsertRowid as number;
}

/** Formata erros do xmllint em "elemento <X> (linha N): mensagem" — o
 *  usuário precisa saber O QUE e ONDE, não só "XML inválido". */
function formatarErrosXsd(erros: string[], max = 5): string {
  const { estruturarErrosXsd } = require('../diploma-digital/validar-artefato') as typeof import('../diploma-digital/validar-artefato');
  return estruturarErrosXsd(erros.slice(0, max))
    .map((e) => `${e.elemento ? `elemento <${e.elemento}>` : 'documento'}${e.linha ? ` (linha ${e.linha})` : ''}: ${e.mensagem}`)
    .join('\n');
}

function extrairPfxA1(caminhoPfx: string, senha: string): { chavePem: string; certPem: string } {

  const forge = require('node-forge');
  const buf = fs.readFileSync(caminhoPfx);
  const asn1 = forge.asn1.fromDer(buf.toString('binary'));
  const pfx = forge.pkcs12.pkcs12FromAsn1(asn1, senha);
  let chavePem = '';
  let certPem = '';
  for (const keyId in pfx.bags) {
    for (const item of pfx.bags[keyId] as any[]) {
      if (item.type === forge.pki.oids.pkcs8ShroudedKeyBag && item.asn1) chavePem = forge.pki.privateKeyToPem(item.key);
      if (item.type === forge.pki.oids.certBag && item.cert) certPem = forge.pki.certificateToPem(item.cert);
    }
  }
  if (!chavePem || !certPem) throw new Error('Não foi possível extrair chave/certificado do .pfx — verifique a senha.');
  return { chavePem, certPem };
}

/** Extrai o certificado PÚBLICO (PEM) do Windows Store pelo thumbprint —
 *  usado no caminho A3 (o KeyInfo precisa do cert; só a parte pública). */
async function extrairCertPublicoPem(thumbprint: string): Promise<string> {
  const os = await import('node:os');
  const pathMod = await import('node:path');
  const script = `
param([string]$Thumbprint, [string]$OutFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
foreach ($locName in @('CurrentUser','LocalMachine')) {
  try {
    $loc = [System.Security.Cryptography.X509Certificates.StoreLocation]::$locName
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', $loc)
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    foreach ($c in $store.Certificates) {
      if ($c.Thumbprint -ieq $Thumbprint) {
        $b64 = [Convert]::ToBase64String($c.RawData, 'InsertLineBreaks')
        $pem = "-----BEGIN CERTIFICATE-----" + [char]10 + $b64 + [char]10 + "-----END CERTIFICATE-----" + [char]10
        [System.IO.File]::WriteAllText($OutFile, $pem, (New-Object System.Text.UTF8Encoding($false)))
        $store.Close(); exit 0
      }
    }
    $store.Close()
  } catch {}
}
throw 'Certificado nao encontrado'
`.trim();
  const { runPowerShellScriptAsync } = await import('./assinatura');
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const outFile = pathMod.join(os.tmpdir(), `nexa_cert_${id}.pem`);
  await runPowerShellScriptAsync(script, { Thumbprint: thumbprint, OutFile: outFile }, 30000);
  try {
    const conteudo = fs.readFileSync(outFile, 'utf8');
    if (!conteudo.includes('BEGIN CERTIFICATE')) throw new Error('PEM inválido exportado do store');
    return conteudo.replace(/\r\n/g, '\n');
  } finally {
    try { fs.unlinkSync(outFile); } catch { /* noop */ }
  }
}

/**
 * Assina TODAS as posições da emissora no artefato indicado.
 * A1 e A3 produzem o MESMO XAdES-BES real (ds canônico http://, como o
 * validador oficial compila): no A3 o digest do SignedInfo é assinado
 * DENTRO do token via SignHash bruto (assinarHashA3) — a chave nunca sai
 * do hardware.
 */
function assinarHandler(
  _event: IpcMainInvokeEvent,
  diplomaId: number,
  artefato: 'historico_escolar' | 'documentacao_academica',
  senhaPfx?: string
): Promise<ApiResult<{ arquivoId: number; carimbos?: string[]; avisoCarimbo?: string }>> {
  return (async () => {
    const db = getDb();
    const proc = db.prepare('SELECT * FROM diplomas_digitais WHERE id = ?').get(diplomaId) as any;
    if (!proc) return { ok: false, error: 'Processo não encontrado' };
    if (!['aguardando_assinatura', 'xml_gerado', 'xml_invalido'].includes(proc.status)) {
      return { ok: false, error: `Status atual "${labelStatus(proc.status)}" não permite assinar (gere/valide o XML antes).` };
    }
    const { lido, motivo } = await lerXmlArquivoComMotivo(diplomaId, artefato);
    if (!lido) return { ok: false, error: motivo || 'Nenhum XML válido disponível — gere antes de assinar.' };
    if (contarEsqueletos(lido.xml) === 0) return { ok: false, error: 'Artefato já assinado.' };

    const assinatura = db
      .prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1')
      .get() as any;
    if (!assinatura) {
      return {
        ok: false,
        error:
          'CONFIGURAÇÃO NECESSÁRIA: nenhum certificado digital vinculado. ' +
          'Vá em Assinatura Digital e cadastre o certificado A1 (.pfx) ou A3 (token) da IES.',
      };
    }

    let xmlAssinado: string;
    let avisoCarimbo: string | undefined;
    const carimbos: string[] = [];
    // XAdES-T: carimbo do tempo (exigência da política de assinatura da
    // IN Sesu 1/2020) sobre cada assinatura real, APLICADO LOGO APÓS cada
    // assinatura (a da raiz cobre o documento com o carimbo da interna).
    // Sem TSA configurado ou com falha, segue sem carimbo com AVISO
    // EXPLÍCITO (nunca fabricado).
    const { obterTsaConfig, obterConfigBryHub } = await import('./tsa');
    const { obterPoliticaAssinatura } = await import('./politica');
    const { carimbarDigest } = await import('../diploma-digital/tsa-cliente');
    const cfgTsa = obterTsaConfig(); // modo rfc3161 (BASIC/RFC 3161 direto)
    const cfgBryHub = obterConfigBryHub(); // modo bry_hub (carimbo PÓS-assinatura)
    const politica = obterPoliticaAssinatura();
    const carimbador: ((digest: Buffer) => Promise<{ token: Buffer; genTime?: string }>) | undefined = cfgTsa
      ? async (digest) => {
          try {
            const c = await carimbarDigest(cfgTsa, digest, 20000);
            if (c.genTime) carimbos.push(c.genTime);
            return { token: c.token, genTime: c.genTime };
          } catch (e: any) {
            (e as any).erroTsa = true; // catch externo reverte p/ sem carimbo
            throw e;
          }
        }
      : undefined;
    if (!cfgTsa && !cfgBryHub) {
      avisoCarimbo = 'Assinado SEM carimbo do tempo (XAdES-BES) — a política do Diploma Digital exige carimbo (XAdES-T): configure o TSA da IES em Assinatura Digital → Carimbo do Tempo.';
    }

    const ehA3 = assinatura.certificado_tipo === 'A3' && !!assinatura.certificado_a3_thumbprint;
    if (!ehA3) {
      if (!assinatura.certificado_path || !fs.existsSync(assinatura.certificado_path)) {
        return { ok: false, error: 'CONFIGURAÇÃO NECESSÁRIA: certificado A1 (.pfx) não encontrado — reimporte em Assinatura Digital.' };
      }
      if (!senhaPfx) return { ok: false, error: 'Senha do certificado A1 é obrigatória.' };
    }

    const assinarCom = async (comCarimbo: boolean): Promise<string> => {
      const carimb = comCarimbo && carimbador ? { carimbador } : {};
      if (ehA3) {
        // A3: digest assinado DENTRO do token (SignHash bruto);
        // certificado público PEM do Windows Store.
        const certPem = await extrairCertPublicoPem(assinatura.certificado_a3_thumbprint!);
        return assinarTodosEsqueletos(lido.xml, {
          certPem,
          thumbprintA3: assinatura.certificado_a3_thumbprint,
          politica,
          ...carimb,
        });
      }
      const { chavePem, certPem } = extrairPfxA1(assinatura.certificado_path!, senhaPfx!);
      return assinarTodosEsqueletos(lido.xml, {
        chavePem,
        certPem,
        politica,
        ...carimb,
      });
    };

    try {
      xmlAssinado = await assinarCom(true);
      // LTV (perfil XL da PA-AD-RC v2.4): cadeia + CRLs reais + SigAndRefs
      // (2º carimbo). Best-effort: falha (offline/AIA) → segue sem LTV com
      // aviso — nunca valores fictícios.
      if (carimbador) {
        try {
          const certPemLeaf = ehA3
            ? await extrairCertPublicoPem(assinatura.certificado_a3_thumbprint!)
            : extrairPfxA1(assinatura.certificado_path!, senhaPfx!).certPem;
          const { aplicarLtv } = await import('../diploma-digital/ltv');
          const rLtv = await aplicarLtv(xmlAssinado, certPemLeaf, async (d) => carimbador(d));
          xmlAssinado = rLtv.xml;
          if (rLtv.avisos.length) avisoCarimbo = (avisoCarimbo ? avisoCarimbo + ' ' : '') + rLtv.avisos.join(' ');
        } catch (e: any) {
          avisoCarimbo = (avisoCarimbo ? avisoCarimbo + ' ' : '') +
            'Sem LTV (CompleteCertificateRefs/RevocationValues): ' + (e?.message ?? String(e)) + ' — assinatura válida, perfil reduzido.';
        }
      }
    } catch (e: any) {
      if ((e as any)?.erroTsa) {
        // TSA fora do ar: assina XAdES-BES (sem carimbo) + aviso claro
        carimbos.length = 0;
        try {
          xmlAssinado = await assinarCom(false);
        } catch {
          return { ok: false, error: 'Falha ao assinar: ' + (e?.message ?? String(e)) };
        }
        avisoCarimbo = 'Assinado SEM carimbo do tempo (XAdES-BES): falha no TSA — ' + (e?.message ?? String(e)) + '. Configure/teste em Assinatura Digital → Carimbo do Tempo e assine novamente.';
      } else {
        auditar(diplomaId, `assinatura_${artefato}`, 'erro', { err: e?.message });
        return { ok: false, error: 'Falha ao assinar: ' + (e?.message ?? String(e)) };
      }
    }

    // MODO BRy HUB (v1.4.9): o carimbo é aplicado DEPOIS da assinatura
    // local (BES), pelo Completador da BRy — nunca durante. Falha no HUB
    // NÃO perde a assinatura: persiste BES com aviso claro (mesma
    // semântica de falha do TSA clássico).
    if (cfgBryHub) {
      try {
        const { upgradeCarimboBry } = await import('../diploma-digital/bry-hub-cliente');
        const r = await upgradeCarimboBry(cfgBryHub, xmlAssinado, 60000);
        if (r.carimbosAdicionados > 0) {
          carimbos.push(`BRy HUB (${new Date().toISOString()})`);
        }
        xmlAssinado = r.xml;
        avisoCarimbo =
          (avisoCarimbo ? avisoCarimbo + ' ' : '') +
          `Carimbo do tempo aplicado via BRy HUB (${r.carimbosAdicionados} SignatureTimeStamp adicionado(s)) — XAdES-T.`;
      } catch (e: any) {
        avisoCarimbo =
          (avisoCarimbo ? avisoCarimbo + ' ' : '') +
          'Assinado SEM carimbo do tempo (XAdES-BES): falha no BRy HUB — ' +
          (e?.message ?? String(e)) +
          '. Confira o modo BRy HUB em Assinatura Digital → Carimbo do Tempo (Testar) e assine novamente.';
      }
    }

    // Revalida XSD — inválido não continua
    const artefatoXsd: ArtefatoXsd = artefato === 'historico_escolar' ? 'historicoEscolar' : 'documentacaoAcademica';
    const validacao = await validarXmlContraXsd(xmlAssinado, artefatoXsd);
    persistirNovaVersao(
      diplomaId, artefato === 'historico_escolar' ? 'historico_escolar_assinado' : 'documentacao_academica_assinada',
      xmlAssinado, validacao,
      artefato === 'historico_escolar' ? 'historico-escolar-digital-assinado.xml' : 'documentacao-academica-registro-assinada.xml'
    );
    if (!validacao.valido) {
      db.prepare("UPDATE diplomas_digitais SET status = 'xml_invalido', updated_at = datetime('now') WHERE id = ?").run(diplomaId);
      auditar(diplomaId, `assinatura_${artefato}`, 'xml_invalido', { erros: validacao.erros.slice(0, 10) });
      return { ok: false, error: 'XML assinado rejeitado na revalidação XSD:\n' + formatarErrosXsd(validacao.erros) };
    }

    // VERIFICAÇÃO COMPLETA antes de liberar (fluxo oficial: validar
    // assinatura/certificado/carimbo, não só o schema). Assinatura que não
    // confere criptograficamente NÃO marca como assinado. Cadeia/CRL da TSA
    // ficam para o diagnóstico completo (aqui seria rede no meio da assinatura).
    const diagnostico = await validarArtefatoDiploma(xmlAssinado, artefatoXsd, { exigirCarimbo: false, verificarCadeiaCrl: false });
    const assinaturasInvalidas = diagnostico.assinaturas.filter((a) => !a.criptografiaOk || a.certDigestOk === false);
    if (assinaturasInvalidas.length > 0) {
      db.prepare("UPDATE diplomas_digitais SET status = 'xml_invalido', updated_at = datetime('now') WHERE id = ?").run(diplomaId);
      auditar(diplomaId, `assinatura_${artefato}`, 'verificacao_cripto_falhou', {
        problemas: assinaturasInvalidas.map((a) => ({ id: a.id, erros: a.errosCripto })),
      });
      return {
        ok: false,
        error: 'Assinatura verificada e REJEITADA (digests/RSA não conferem):\n' +
          assinaturasInvalidas.map((a) => `• ${a.id}: ${a.errosCripto.join('; ')}`).join('\n'),
      };
    }
    if (diagnostico.assinaturas.some((a) => !a.carimbo?.tokenOk) && !avisoCarimbo) {
      avisoCarimbo = 'Assinado SEM carimbo do tempo (XAdES-BES) — configure o TSA e assine novamente.';
    }

    db.prepare("UPDATE diplomas_digitais SET status = 'assinado', updated_at = datetime('now') WHERE id = ?").run(diplomaId);
    auditar(diplomaId, `assinatura_${artefato}`, 'sucesso', {
      tipo: assinatura.certificado_tipo,
      carimbado: carimbos.length > 0,
      carimbos: carimbos.filter(Boolean),
      avisoCarimbo,
    });
    return { ok: true, data: { arquivoId: 0, carimbos, avisoCarimbo } };
  })();
}

/** Registro assistido: grava o retorno da registradora e monta o Diploma final. */
function registrarHandler(
  _event: IpcMainInvokeEvent,
  diplomaId: number,
  registro: DadosRegistroRetorno
): Promise<ApiResult<{ valido: boolean }>> {
  return (async () => {
    const db = getDb();
    const snapshot = coletarSnapshot(db as any, diplomaId);
    if (!snapshot) return { ok: false, error: 'Processo não encontrado' };
    if (snapshot.processo.status !== 'assinado') {
      return { ok: false, error: `Status "${labelStatus(snapshot.processo.status)}": é preciso assinar a Documentação Acadêmica antes de registrar.` };
    }
    if (!/^\d{1,}\.\d{1,}\.[a-f0-9]{12,}$/.test(registro.codigoValidacao ?? '')) {
      return { ok: false, error: 'Código de validação inválido — formato oficial: eMEC-emissora.eMEC-registradora.hexadecimal (retornado pela registradora).' };
    }
    // Validações imediatas do retorno da registradora (antes eram pegas só
    // na revalidação XSD, com mensagem tardia e genérica).
    if (!registro.livro?.trim()) return { ok: false, error: 'Livro de registro é obrigatório.' };
    if (!registro.numeroRegistro?.trim() && !(registro.numeroFolha?.trim() && registro.numeroSequencia?.trim())) {
      return { ok: false, error: 'Informe o nº de registro OU o par folha + sequência.' };
    }
    if (!normalizarData(registro.dataExpedicaoDiploma)) {
      return { ok: false, error: 'Data de expedição inválida — use AAAA-MM-DD (ou DD/MM/AAAA).' };
    }
    if (!normalizarData(registro.dataRegistroDiploma)) {
      return { ok: false, error: 'Data de registro inválida — use AAAA-MM-DD (ou DD/MM/AAAA).' };
    }
    if (!registro.responsavel?.nome?.trim()) return { ok: false, error: 'Nome do responsável pelo registro é obrigatório.' };
    if (!normalizarCpf(registro.responsavel?.cpf)) {
      return { ok: false, error: 'CPF do responsável inválido — informe 11 dígitos.' };
    }
    const registradora = db
      .prepare("SELECT * FROM ies WHERE papel IN ('registradora','emissora_registradora') AND ativo = 1 ORDER BY id LIMIT 1")
      .get() as any;
    if (!registradora) {
      return { ok: false, error: 'CONFIGURAÇÃO NECESSÁRIA: cadastre a IES Registradora (com mantenedora) no Cadastro Institucional.' };
    }
    const da =
      (await lerXmlArquivo(diplomaId, 'documentacao_academica_assinada')) ??
      (await lerXmlArquivo(diplomaId, 'documentacao_academica'));
    if (!da) return { ok: false, error: 'Documentação Acadêmica assinada não encontrada.' };

    const chaveVdip = `VDip${(snapshot.processo.chave_acesso ?? '').replace(/^Dip/, '')}`;
    const chaveRdip = `RDip${(snapshot.processo.chave_acesso ?? '').replace(/^Dip/, '')}`;
    const xml = gerarDiplomaFinalXml(snapshot, da.xml, registro, registradora, chaveVdip, chaveRdip);
    if (!xml) {
      auditar(diplomaId, 'registro', 'bloqueado');
      return { ok: false, error: 'Dados insuficientes para montar o Diploma final (verifique registradora/mantenedora, datas e livro).' };
    }

    const validacao = await validarXmlContraXsd(xml, 'diploma');
    persistirNovaVersao(diplomaId, 'diploma_final', xml, validacao, 'diploma-digital-final.xml');
    if (!validacao.valido) {
      db.prepare("UPDATE diplomas_digitais SET status = 'xml_invalido', updated_at = datetime('now') WHERE id = ?").run(diplomaId);
      auditar(diplomaId, 'registro', 'xml_invalido', { erros: validacao.erros.slice(0, 10) });
      return { ok: false, error: 'Diploma final inválido contra o XSD:\n' + formatarErrosXsd(validacao.erros) };
    }
    db.prepare("UPDATE diplomas_digitais SET status = 'registrado', dados_registro_json = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(registro), diplomaId);
    auditar(diplomaId, 'registro', 'sucesso', { codigoValidacao: registro.codigoValidacao });
    return { ok: true, data: { valido: true } };
  })();
}

/** Publicação: expõe consulta pública (dados mínimos) no serviço web. */
function publicarHandler(_event: IpcMainInvokeEvent, diplomaId: number): Promise<ApiResult<true>> {
  return (async () => {
    const db = getDb();
    const snapshot = coletarSnapshot(db as any, diplomaId);
    if (!snapshot) return { ok: false, error: 'Processo não encontrado' };
    if (snapshot.processo.status !== 'registrado') {
      return { ok: false, error: 'Só diplomas REGISTRADOS podem ser publicados.' };
    }
    const reg = snapshot.processo.dados_registro_json ? JSON.parse(snapshot.processo.dados_registro_json) : null;
    const r = await registrarDiplomaPublicoWeb({
      codigo: snapshot.processo.dados_registro_json ? reg?.codigoValidacao : snapshot.processo.chave_acesso,
      alunoNome: snapshot.aluno.nome,
      curso: snapshot.aluno.curso,
      nomeIes: snapshot.ies.nome,
      dataRegistro: reg?.dataRegistroDiploma,
      registradoPor: reg?.responsavel?.nome,
    });
    if (!r.ok) {
      return { ok: false, error: 'Falha ao publicar na consulta pública: ' + (r.error ?? '') + ' — verifique VERIFICACAO_BASE_URL/API key.' };
    }
    db.prepare("UPDATE diplomas_digitais SET status = 'publicado', updated_at = datetime('now') WHERE id = ?").run(diplomaId);
    auditar(diplomaId, 'publicacao', 'sucesso');
    return { ok: true, data: true };
  })();
}

/** Motivos de anulação da enumeração oficial TMotivoAnulacao (XSD v1.05). */
export const MOTIVOS_ANULACAO_MEC = [
  'Erro de Fato',
  'Erro de Direito',
  'Decisão Judicial',
  'Reemissão para Complemento de Informação',
  'Reemissão para Inclusão de Habilitação',
  'Reemissão para Anotaçao de Registro',
] as const;

/** Anulação: soft — preserva documento, motivo, data e usuário. Nunca apaga. */
function anularHandler(
  _event: IpcMainInvokeEvent,
  diplomaId: number,
  motivo: string,
  senhaMaster: string,
  anotacao?: string
): ApiResult<true> {
  const sessao = getSessao();
  if (!sessao || sessao.usuario.role !== 'admin') {
    return { ok: false, error: 'Somente administrador pode anular diploma digital.' };
  }
  if (!validarSenhaMaster(senhaMaster, CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH)) {
    return { ok: false, error: 'Senha master incorreta.' };
  }
  if (!MOTIVOS_ANULACAO_MEC.includes(motivo as any)) {
    return { ok: false, error: 'Motivo inválido — use um dos motivos oficiais (enumeração do MEC).' };
  }
  if (anotacao && anotacao.trim().length < 10) {
    return { ok: false, error: 'Anotação da anulação deve ter ao menos 10 caracteres (ou ficar vazia).' };
  }
  const db = getDb();
  const proc = db.prepare('SELECT status FROM diplomas_digitais WHERE id = ?').get(diplomaId) as any;
  if (!proc) return { ok: false, error: 'Processo não encontrado' };
  if (proc.status === 'anulado') return { ok: false, error: 'Diploma já está anulado.' };
  db.prepare(
    `UPDATE diplomas_digitais SET status = 'anulado', motivo_anulacao = ?, anotacao_anulacao = ?, anulado_em = datetime('now'), anulado_por = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(motivo, anotacao?.trim() || null, sessao.usuario.id, diplomaId);
  auditar(diplomaId, 'anulacao', 'sucesso', { motivo, anotacao: anotacao?.trim() || undefined });
  return { ok: true, data: true };
}

// ---------- M5: LISTA ANULADOS / FISCALIZAÇÃO / RVDD / VALIDADOR MEC ----------

/** Signed URL (https) do arquivo no bucket privado — máximo do Supabase: 7 dias. */
async function signedUrlStorage(caminho: string): Promise<string | null> {
  try {
    const client = getClient();
    if (!client) return null;
    const { data, error } = await client.storage
      .from('diplomas-digitais')
      .createSignedUrl(caminho, 604800);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Gera a Lista de Diplomas Anulados (preparada para a REGISTRADORA assinar). */
function gerarListaAnuladosHandler(
  _event: IpcMainInvokeEvent,
  input: { numeroSequencia: number; dataMaximaProximaAtualizacao: string }
): Promise<ApiResult<{ salvoPath: string; anulados: number }>> {
  return (async () => {
    const db = getDb();
    const sessao = getSessao();
    if (!sessao || sessao.usuario.role !== 'admin') {
      return { ok: false, error: 'Somente administrador gera a Lista de Diplomas Anulados.' };
    }
    const registradora = db
      .prepare("SELECT * FROM ies WHERE papel IN ('registradora','emissora_registradora') AND ativo = 1 ORDER BY id LIMIT 1")
      .get() as any;
    if (!registradora) {
      return { ok: false, error: 'CONFIGURAÇÃO NECESSÁRIA: cadastre a IES Registradora (com mantenedora) no Cadastro Institucional.' };
    }
    const rows = db
      .prepare(
        `SELECT dd.motivo_anulacao, dd.anotacao_anulacao, dd.anulado_em, a.cpf,
                dd.dados_registro_json
         FROM diplomas_digitais dd JOIN alunos a ON a.id = dd.aluno_id
         WHERE dd.status = 'anulado' AND dd.dados_registro_json IS NOT NULL
         ORDER BY dd.anulado_em`
      )
      .all() as any[];

    const anulados = rows
      .map((r) => {
        const reg = JSON.parse(r.dados_registro_json);
        return {
          codigoValidacao: reg?.codigoValidacao ?? '',
          dataAnulacao: String(r.anulado_em ?? ''),
          motivo: r.motivo_anulacao ?? '',
          anotacao: r.anotacao_anulacao ?? null,
        };
      })
      .filter((x) => x.codigoValidacao);

    const xml = gerarListaDiplomasAnuladosXml({
      numeroSequencia: input.numeroSequencia,
      registradora,
      anulados,
      dataMaximaProximaAtualizacao: input.dataMaximaProximaAtualizacao,
    });
    if (!xml) {
      return {
        ok: false,
        error:
          anulados.length === 0
            ? 'Nenhum diploma anulado com registro para listar.'
            : 'Dados insuficientes/inconsistentes para a lista (verifique motivo oficial e datas AAAA-MM-DD).',
      };
    }
    const validacao = await validarXmlContraXsd(xml, 'listaDiplomasAnulados');
    const dir = path.join(app.getPath('userData'), 'diplomas-digitais', 'relatorios');
    fs.mkdirSync(dir, { recursive: true });
    const salvoPath = path.join(dir, `lista-diplomas-anulados-seq${input.numeroSequencia}.xml`);
    fs.writeFileSync(salvoPath, xml, 'utf8');
    auditar(null, 'lista_anulados', validacao.valido ? 'sucesso' : 'xml_invalido', {
      seq: input.numeroSequencia, total: anulados.length, erros: validacao.erros.slice(0, 8),
    });
    if (!validacao.valido) {
      return { ok: false, error: 'Lista inválida contra o XSD:\n' + formatarErrosXsd(validacao.erros) };
    }
    return { ok: true, data: { salvoPath, anulados: anulados.length } };
  })();
}

/** Gera a RVDD (PDF) do diploma registrado e a publica no bucket privado. */
function gerarRvddHandler(_event: IpcMainInvokeEvent, diplomaId: number): Promise<ApiResult<{ salvoPath: string }>> {
  return (async () => {
    const db = getDb();
    const snapshot = coletarSnapshot(db as any, diplomaId);
    if (!snapshot) return { ok: false, error: 'Processo não encontrado' };
    if (!['registrado', 'publicado'].includes(snapshot.processo.status)) {
      return { ok: false, error: 'A RVDD só é gerada para diplomas REGISTRADOS.' };
    }
    const reg = snapshot.processo.dados_registro_json ? JSON.parse(snapshot.processo.dados_registro_json) : null;
    if (!reg?.codigoValidacao) return { ok: false, error: 'Registro sem código de validação.' };

    const { normalizarCpf, normalizarData } = await import('../diploma-digital/normalizadores');
    const pdf = await gerarRvddPdf({
      alunoNome: snapshot.aluno.nome,
      cpf: normalizarCpf(snapshot.aluno.cpf) ?? '',
      cursoNome: snapshot.aluno.curso ?? '',
      grauConferido: snapshot.curso?.grau_conferido ?? '',
      tituloConferido: snapshot.curso?.outro_titulo ?? snapshot.curso?.titulo_conferido ?? '',
      iesNome: snapshot.ies.nome,
      iesCodigoEmec: snapshot.ies.codigo_emec ?? '',
      livroRegistro: reg.livro ?? '',
      numeroRegistro: reg.numeroRegistro ?? `${reg.numeroFolha ?? ''}/${reg.numeroSequencia ?? ''}`,
      dataColacao: normalizarData(snapshot.aluno.data_colacao) ?? '',
      dataExpedicao: reg.dataExpedicaoDiploma ?? '',
      dataRegistro: reg.dataRegistroDiploma ?? '',
      codigoValidacao: reg.codigoValidacao,
      chaveAcesso: `VDip${String(snapshot.processo.chave_acesso ?? '').replace(/^Dip/, '')}`,
      urlConsulta: `${CONFIG.VERIFICACAO_BASE_URL.replace(/\/+$/, '')}/d/${encodeURIComponent(reg.codigoValidacao)}`,
    });

    const dir = path.join(app.getPath('userData'), 'diplomas-digitais', String(diplomaId));
    fs.mkdirSync(dir, { recursive: true });
    const salvoPath = path.join(dir, 'rvdd.pdf');
    fs.writeFileSync(salvoPath, pdf);

    // Conformidade PDF/A-1b: autochecagem estrutural SEMPRE + veraPDF
    // (motor oficial) quando configurado — resultado persistido; sem
    // veraPDF a pendência fica explícita (nunca "conforme" por fé).
    const { verificarPdfA1b, caminhoVeraPdf, rodarVeraPdf } = await import('../diploma-digital/pdfa');
    const auto = await verificarPdfA1b(pdf);
    let veraPdf: { executado: boolean; conforme: boolean | null; detalhe: string; falhas?: string[] } | undefined;
    const exeVera = caminhoVeraPdf(dbLikeParaVeraPdf());
    if (exeVera) veraPdf = await rodarVeraPdf(exeVera, salvoPath);
    const conformidade = { auto, veraPdf: veraPdf ?? { executado: false, conforme: null, detalhe: 'veraPDF não configurado (config "verapdf" ou env NEXA_VERAPDF) — validação estrutural interna apenas.' } };

    // Bucket privado (mesmo path do XML) — alimenta a URLRVDD da fiscalização.
    const storagePath = await subirXmlStorage(diplomaId, 'rvdd.pdf', pdf.toString('binary')).catch(() => null);

    db.prepare(
      `INSERT INTO diploma_arquivos (diploma_id, tipo_arquivo, nome, caminho_storage, hash, versao_schema, valido_xsd, erros_validacao_json, conformidade_pdfa)
       VALUES (?, 'rvdd', 'rvdd.pdf', ?, ?, '1.05', NULL, ?, ?)`
    ).run(
      diplomaId,
      salvoPath,
      createHash('sha256').update(pdf).digest('hex'),
      auto.conforme ? null : JSON.stringify({ pendencia: 'Autochecagem PDF/A-1b apontou não-conformidade — ver conformidade_pdfa.' }),
      JSON.stringify(conformidade)
    );
    auditar(diplomaId, 'geracao_rvdd', 'sucesso', {
      bytes: pdf.length,
      storage: !!storagePath,
      pdfaAuto: auto.conforme,
      veraPdf: veraPdf ? { executado: veraPdf.executado, conforme: veraPdf.conforme } : null,
    });
    return { ok: true, data: { salvoPath, pdfaAuto: auto.conforme, veraPdfConforme: veraPdf?.conforme ?? null } };
  })();
}

/** Acesso mínimo à tabela configuracoes p/ o pdfa.ts (chave 'verapdf'). */
function dbLikeParaVeraPdf(): { preparar: (sql: string) => { get: (k: string) => unknown } } {
  const db = getDb();
  return {
    preparar: (sql: string) => ({
      get: (k: string) => db.prepare(sql).get(k),
    }),
  };
}

/** Gera o Arquivo de Fiscalização (emissora) para o período informado. */
function gerarFiscalizacaoHandler(
  _event: IpcMainInvokeEvent,
  input: { dataInicio: string; dataFim: string }
): Promise<ApiResult<{ salvoPath: string; diplomas: number }>> {
  return (async () => {
    const db = getDb();
    const sessao = getSessao();
    if (!sessao || sessao.usuario.role !== 'admin') {
      return { ok: false, error: 'Somente administrador gera o Arquivo de Fiscalização.' };
    }
    const emissora = db
      .prepare("SELECT id FROM ies WHERE papel IN ('emissora','emissora_registradora') AND ativo = 1 ORDER BY id LIMIT 1")
      .get() as any;
    if (!emissora) return { ok: false, error: 'IES emissora não cadastrada.' };

    const rows = db
      .prepare(
        `SELECT dd.*, a.cpf AS aluno_cpf, a.curso AS aluno_curso FROM diplomas_digitais dd
         JOIN alunos a ON a.id = dd.aluno_id
         WHERE dd.status IN ('registrado','publicado') AND dd.dados_registro_json IS NOT NULL`
      )
      .all() as any[];
    if (rows.length === 0) {
      return { ok: false, error: 'Nenhum diploma registrado no período — o arquivo exige ao menos 1.' };
    }

    const semRvdd: number[] = [];
    const semUrl: number[] = [];
    const diplomas: DiplomaFiscalizadoEntrada[] = [];
    for (const r of rows) {
      const reg = JSON.parse(r.dados_registro_json);
      const rvdd = db
        .prepare("SELECT id FROM diploma_arquivos WHERE diploma_id = ? AND tipo_arquivo = 'rvdd' ORDER BY id DESC LIMIT 1")
        .get(r.id) as any;
      if (!rvdd) { semRvdd.push(r.id); continue; }
      const urlXml = await signedUrlStorage(`${r.id}/diploma-digital-final.xml`);
      const urlRvdd = await signedUrlStorage(`${r.id}/rvdd.pdf`);
      if (!urlXml || !urlRvdd) { semUrl.push(r.id); continue; }
      const curso = r.aluno_curso
        ? encontrarCursoPorNome(
            db.prepare('SELECT * FROM cursos WHERE ativo = 1 ORDER BY id').all() as any[],
            r.aluno_curso
          )
        : null;
      diplomas.push({
        codigoValidacao: reg.codigoValidacao,
        cpfDetentor: r.aluno_cpf ?? '',
        codigoEmecCurso: curso?.codigo_emec ?? null,
        dataEmissao: reg.dataExpedicaoDiploma ?? '',
        dataRegistro: reg.dataRegistroDiploma ?? '',
        urlXmlDiplomado: urlXml,
        urlRvdd,
        urlXmlRegistroAcademico: null,
      });
    }
    if (semRvdd.length > 0) {
      return { ok: false, error: `Gere a RVDD antes (processos sem RVDD: ${semRvdd.join(', ')}).` };
    }
    if (diplomas.length === 0) {
      return { ok: false, error: 'CONFIGURAÇÃO NECESSÁRIA: nuvem/Storage indisponível — as URLs https do arquivo não puderam ser geradas (processos: ' + semUrl.join(', ') + ').' };
    }

    const snapshotIes = coletarSnapshot(db as any, rows[0].id);
    if (!snapshotIes) return { ok: false, error: 'Snapshot indisponível' };
    const xml = gerarArquivoFiscalizacaoXml({ dataInicio: input.dataInicio, dataFim: input.dataFim, snapshotIes, diplomas });
    if (!xml) return { ok: false, error: 'Dados insuficientes para o arquivo de fiscalização.' };

    const validacao = await validarXmlContraXsd(xml, 'arquivoFiscalizacao');
    const dir = path.join(app.getPath('userData'), 'diplomas-digitais', 'relatorios');
    fs.mkdirSync(dir, { recursive: true });
    const salvoPath = path.join(dir, `arquivo-fiscalizacao-${input.dataInicio}_a_${input.dataFim}.xml`);
    fs.writeFileSync(salvoPath, xml, 'utf8');
    auditar(null, 'arquivo_fiscalizacao', validacao.valido ? 'sucesso' : 'xml_invalido', {
      periodo: `${input.dataInicio}..${input.dataFim}`, total: diplomas.length, erros: validacao.erros.slice(0, 8),
    });
    if (!validacao.valido) {
      return { ok: false, error: 'Arquivo inválido contra o XSD:\n' + formatarErrosXsd(validacao.erros) };
    }
    return { ok: true, data: { salvoPath, diplomas: diplomas.length } };
  })();
}

/** Abre o validador oficial do MEC no navegador (verificação MANUAL). */
function abrirValidadorMecHandler(_event: IpcMainInvokeEvent): ApiResult<true> {
  const { shell } = require('electron');
  void shell.openExternal('https://verificadordiplomadigital.mec.gov.br/diploma');
  return { ok: true, data: true };
}

/** Registra o RESULTADO MANUAL da validação no validador oficial do MEC. */
function registrarValidacaoMecHandler(
  _event: IpcMainInvokeEvent,
  diplomaId: number,
  resultado: 'valido' | 'invalido',
  observacoes?: string
): ApiResult<true> {
  const sessao = getSessao();
  if (!sessao) return { ok: false, error: 'Não autenticado' };
  const db = getDb();
  const agora = new Date().toISOString();
  db.prepare('UPDATE diplomas_digitais SET validado_mec_em = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(resultado === 'valido' ? agora : `INVALIDO:${agora}`, diplomaId);
  auditar(diplomaId, 'validacao_manual_mec', resultado, { observacoes: observacoes?.slice(0, 500) });
  return { ok: true, data: true };
}

/** Baixa um XML/PDF do processo (diálogo "Salvar como"). Prioridade:
 *  caminho local gravado → caminho canônico do userData → bucket privado
 *  (arquivo gerado em outra máquina). O arquivo do validador oficial do
 *  MEC é o "diploma_final" (raiz <Diploma>); o de ENVIO à registradora
 *  é a DA assinada. */
function baixarArquivoHandler(
  event: IpcMainInvokeEvent,
  arquivoId: number
): Promise<ApiResult<{ salvoPath: string }>> {
  return (async () => {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM diploma_arquivos WHERE id = ?')
      .get(arquivoId) as
      | { id: number; diploma_id: number; tipo_arquivo: string; nome: string | null; caminho_storage: string | null }
      | undefined;
    if (!row) return { ok: false, error: 'Arquivo não encontrado.' };

    // 1) caminho local registrado (persistido por gerarXml/persistirNovaVersao)
    if (row.caminho_storage && fs.existsSync(row.caminho_storage)) {
      return salvarCopia(event, row.caminho_storage, row.tipo_arquivo);
    }
    // 2) caminho canônico do userData (todo gerador escreve aqui)
    const canonico = path.join(
      app.getPath('userData'), 'diplomas-digitais', String(row.diploma_id),
      row.nome ?? path.basename(row.caminho_storage ?? '')
    );
    if (fs.existsSync(canonico)) {
      return salvarCopia(event, canonico, row.tipo_arquivo);
    }
    // 3) bucket privado (arquivo gerado em outra máquina): caminho_storage
    //    é a chave "{diplomaId}/{arquivo}" quando o upload funcionou.
    if (row.caminho_storage && !path.isAbsolute(row.caminho_storage)) {
      try {
        const client = getClient();
        if (client) {
          const { data, error } = await client.storage.from('diplomas-digitais').download(row.caminho_storage);
          if (!error && data) {
            fs.mkdirSync(path.dirname(canonico), { recursive: true });
            fs.writeFileSync(canonico, Buffer.from(await data.arrayBuffer()));
            return salvarCopia(event, canonico, row.tipo_arquivo);
          }
          logger.warn({ err: error?.message, chave: row.caminho_storage }, 'Download do XML do Storage falhou');
        }
      } catch (e: any) {
        logger.warn({ err: e?.message }, 'Storage indisponível para baixar XML');
      }
    }
    return {
      ok: false,
      error: 'Arquivo não encontrado nesta máquina nem na nuvem (gere o XML novamente).',
    };
  })();
}

/** Diálogo "Salvar como" + cópia do arquivo local para o destino escolhido. */
async function salvarCopia(event: IpcMainInvokeEvent, origem: string, tipoArquivo: string): Promise<ApiResult<{ salvoPath: string }>> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const ext = tipoArquivo === 'rvdd' ? 'pdf' : 'xml';
  const destino = win
    ? await dialog.showSaveDialog(win, {
        title: 'Salvar arquivo do Diploma Digital',
        defaultPath: path.basename(origem),
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      })
    : { canceled: true, filePath: '' };
  if (destino.canceled || !destino.filePath) return { ok: false, error: 'Cancelado' };
  fs.copyFileSync(origem, destino.filePath);
  return { ok: true, data: { salvoPath: destino.filePath } };
}

/** Resolve o CONTEÚDO do arquivo do processo (local → userData → nuvem),
 *  mesmo pipeline do download, sem diálogo. */
async function conteudoDoArquivo(arquivoId: number): Promise<string | null> {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM diploma_arquivos WHERE id = ?')
    .get(arquivoId) as
    | { diploma_id: number; nome: string | null; caminho_storage: string | null }
    | undefined;
  if (!row) return null;
  if (row.caminho_storage && fs.existsSync(row.caminho_storage)) {
    return fs.readFileSync(row.caminho_storage, 'utf8');
  }
  const canonico = path.join(
    app.getPath('userData'), 'diplomas-digitais', String(row.diploma_id),
    row.nome ?? path.basename(row.caminho_storage ?? '')
  );
  if (fs.existsSync(canonico)) return fs.readFileSync(canonico, 'utf8');
  if (row.caminho_storage && !path.isAbsolute(row.caminho_storage)) {
    try {
      const client = getClient();
      if (client) {
        const { data, error } = await client.storage.from('diplomas-digitais').download(row.caminho_storage);
        if (!error && data) return Buffer.from(await data.arrayBuffer()).toString('utf8');
      }
    } catch { /* segue p/ null */ }
  }
  return null;
}

/** "Validar Diploma Digital": verificação consolidada do artefato —
 *  XSD oficial + assinatura (cripto) + XAdES + carimbo (ACT/hora) +
 *  certificado + hash + veredito APROVADO/REJEITADO. */
function validarArtefatoHandler(
  _event: IpcMainInvokeEvent,
  arquivoId: number
): Promise<ApiResult<ResultadoValidacaoArtefato>> {
  return (async () => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM diploma_arquivos WHERE id = ?').get(arquivoId) as
      | { diploma_id: number; tipo_arquivo: string }
      | undefined;
    if (!row) return { ok: false, error: 'Arquivo não encontrado.' };
    const xml = await conteudoDoArquivo(arquivoId);
    if (!xml) return { ok: false, error: 'Arquivo não encontrado nesta máquina nem na nuvem (gere novamente).' };
    const artefato: ArtefatoXsd =
      row.tipo_arquivo.startsWith('historico') ? 'historicoEscolar'
        : row.tipo_arquivo.startsWith('documentacao') ? 'documentacaoAcademica'
          : 'diploma';
    try {
      const resultado = await validarArtefatoDiploma(xml, artefato, { exigirCarimbo: true });
      auditar(row.diploma_id, 'validar_artefato', resultado.veredito, {
        arquivoId,
        pendencias: resultado.pendencias.slice(0, 10),
      });
      return { ok: true, data: resultado };
    } catch (e: any) {
      return { ok: false, error: 'Falha na validação: ' + (e?.message ?? String(e)) };
    }
  })();
}

export function registrarDiplomasDigitaisHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_LISTAR, requerAuth(listar));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_LISTAR_APTOS, requerAuth(listarAptos));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_CRIAR, requerAuth(criar));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_OBTER, requerAuth(obter));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_PENDENCIAS, requerAuth(pendencias));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_COMPLETAR_ALUNO, requerAuth(completarAluno));
  ipcMain.handle(IPC_CHANNELS.IES_LISTAR, requerAuth(iesListar));
  ipcMain.handle(IPC_CHANNELS.IES_SALVAR, requerAdmin(iesSalvar));
  ipcMain.handle(IPC_CHANNELS.CURSO_GRADUACAO_LISTAR, requerAuth(cursoGraduacaoListar));
  ipcMain.handle(IPC_CHANNELS.CURSO_GRADUACAO_SALVAR, requerAdmin(cursoGraduacaoSalvar));
  ipcMain.handle(IPC_CHANNELS.CURSO_GRADUACAO_DESATIVAR, requerAdmin(cursoGraduacaoDesativar));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_GERAR_XML, requerAuth(gerarXmlHandler));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_ASSINAR, requerAuth(assinarHandler));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_REGISTRAR, requerAuth(registrarHandler));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_PUBLICAR, requerAuth(publicarHandler));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_ANULAR, requerAuth(anularHandler));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_GERAR_LISTA_ANULADOS, requerAuth(gerarListaAnuladosHandler));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_GERAR_RVDD, requerAuth(gerarRvddHandler));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_GERAR_FISCALIZACAO, requerAuth(gerarFiscalizacaoHandler));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_ABRIR_VALIDADOR_MEC, requerAuth(abrirValidadorMecHandler));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_BAIXAR_ARQUIVO, requerAuth(baixarArquivoHandler));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_VALIDAR_ARTEFATO, requerAuth(validarArtefatoHandler));
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_REGISTRAR_VALIDACAO_MEC, requerAuth(registrarValidacaoMecHandler));
}
