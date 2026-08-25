// ============================================================
// DIPLOMAS DIGITAIS MEC — handlers IPC (M2)
// ============================================================
// Fluxo do processo (status): aguardando_conclusao → apto →
// em_preparacao → xml_gerado → (xml_invalido ↺) → aguardando_
// assinatura (M4)... A criação do processo SÓ ocorre sem
// pendências (verificarPendenciasDiploma) — nada é simulado.
// Cadastro institucional (IES/cursos) exige admin.
import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { getSessao, requerAuth, requerAdmin } from './auth';
import { verificarPendenciasDiploma, type PendenciaDiploma } from '../diploma-digital/pendencias';
import { normalizarCnpj, normalizarCep, normalizarUf, normalizarCpf, normalizarData } from '../diploma-digital/normalizadores';
import { logger } from '../utils/logger';
import { coletarSnapshot, pendenciasHistorico, pendenciasDA } from '../diploma-digital/coletor';
import { gerarHistoricoXml } from '../diploma-digital/gerar-historico-xml';
import { gerarDocumentacaoAcademicaXml } from '../diploma-digital/gerar-documentacao-academica';
import { validarXmlContraXsd, type ArtefatoXsd, type ResultadoValidacao } from '../diploma-digital/xsd-validator';
import { getClient } from '../cloud';

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
  return { ok: true, data: verificarPendenciasDiploma(getDb(), alunoId) };
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
    ? (db.prepare('SELECT id FROM cursos WHERE LOWER(nome) = LOWER(?) AND ativo = 1 ORDER BY id LIMIT 1').get(aluno.curso) as any)
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
  }
): ApiResult<any> {
  if (!input.nome?.trim()) return { ok: false, error: 'Nome da IES é obrigatório' };
  if (input.cnpj && !normalizarCnpj(input.cnpj)) return { ok: false, error: 'CNPJ inválido — informe 14 dígitos' };
  if (input.cep && !normalizarCep(input.cep)) return { ok: false, error: 'CEP inválido — informe 8 dígitos' };
  if (input.uf && !normalizarUf(input.uf)) return { ok: false, error: 'UF inválida' };
  if (input.codigoMunicipio && !/^\d{7}$/.test(input.codigoMunicipio)) return { ok: false, error: 'Código IBGE do município deve ter 7 dígitos' };
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
  ];
  if (input.id) {
    db.prepare(
      `UPDATE ies SET nome=?, codigo_emec=?, cnpj=?, logradouro=?, numero=?, complemento=?, bairro=?,
       codigo_municipio=?, nome_municipio=?, uf=?, cep=?, papel=?, credenciamento_json=?, updated_at=datetime('now')
       WHERE id=?`
    ).run(...vals, input.id);
    auditar(null, 'ies_atualizacao', 'sucesso', { iesId: input.id });
    return { ok: true, data: db.prepare('SELECT * FROM ies WHERE id=?').get(input.id) };
  }
  const info = db
    .prepare(
      `INSERT INTO ies (nome, codigo_emec, cnpj, logradouro, numero, complemento, bairro,
       codigo_municipio, nome_municipio, uf, cep, papel, credenciamento_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
    enderecoJson?: string;
    autorizacaoJson?: string;
    reconhecimentoJson?: string;
    renovacaoReconhecimentoJson?: string;
  }
): ApiResult<any> {
  if (!input.nome?.trim()) return { ok: false, error: 'Nome do curso é obrigatório' };
  if (input.modalidade && !['Presencial', 'EAD'].includes(input.modalidade)) {
    return { ok: false, error: 'Modalidade deve ser Presencial ou EAD' };
  }
  const db = getDb();
  const ies = db.prepare('SELECT id FROM ies WHERE id = ?').get(input.iesId) as any;
  if (!ies) return { ok: false, error: 'IES não encontrada' };
  const vals = [
    input.iesId,
    input.nome.trim(),
    input.codigoEmec ?? null,
    input.modalidade?.trim() || null,
    input.tituloConferido?.trim() || null,
    input.outroTitulo?.trim() || null,
    input.grauConferido?.trim() || null,
    input.enderecoJson?.trim() || null,
    input.autorizacaoJson?.trim() || null,
    input.reconhecimentoJson?.trim() || null,
    input.renovacaoReconhecimentoJson?.trim() || null,
  ];
  if (input.id) {
    db.prepare(
      `UPDATE cursos SET ies_id=?, nome=?, codigo_emec=?, modalidade=?, titulo_conferido=?, outro_titulo=?,
       grau_conferido=?, endereco_json=?, autorizacao_json=?, reconhecimento_json=?, renovacao_reconhecimento_json=?,
       updated_at=datetime('now') WHERE id=?`
    ).run(...vals, input.id);
    auditar(null, 'curso_atualizacao', 'sucesso', { cursoId: input.id });
    return { ok: true, data: db.prepare('SELECT * FROM cursos WHERE id=?').get(input.id) };
  }
  const info = db
    .prepare(
      `INSERT INTO cursos (ies_id, nome, codigo_emec, modalidade, titulo_conferido, outro_titulo,
       grau_conferido, endereco_json, autorizacao_json, reconhecimento_json, renovacao_reconhecimento_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(...vals);
  auditar(null, 'curso_cadastro', 'sucesso', { cursoId: info.lastInsertRowid });
  return { ok: true, data: db.prepare('SELECT * FROM cursos WHERE id=?').get(info.lastInsertRowid) };
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

function gerarXmlHandler(
  _event: IpcMainInvokeEvent,
  diplomaId: number,
  artefato: 'historico_escolar' | 'documentacao_academica'
): Promise<ApiResult<{ valido: boolean; erros: string[]; arquivoId: number }>> {
  return (async () => {
    const db = getDb();
    const snapshot = coletarSnapshot(db as any, diplomaId);
    if (!snapshot) return { ok: false, error: 'Processo de diploma não encontrado' };

    // 1) Pendências específicas do artefato — nada é gerado com dado faltante
    const pends: PendenciaDiploma[] =
      artefato === 'historico_escolar' ? pendenciasHistorico(snapshot) : pendenciasDA(db as any, snapshot);
    if (pends.length > 0) {
      auditar(diplomaId, `geracao_xml_${artefato}`, 'bloqueado', { pendencias: pends.length });
      return {
        ok: false,
        error: `XML não gerado: ${pends.length} pendência(s). ${pends.map((p) => p.campo).join('; ')}`,
      };
    }

    // 2) GERA
    let xml: string | null;
    if (artefato === 'historico_escolar') {
      xml = gerarHistoricoXml(snapshot);
    } else {
      const docs = (db
        .prepare('SELECT * FROM aluno_documentos WHERE aluno_id = ? AND caminho IS NOT NULL')
        .all(snapshot.aluno.id) as any[])
        .map((d) => ({ caminho: d.caminho, tipo: tipoDocumentoMec(d.nome ?? '') }));
      xml = gerarDocumentacaoAcademicaXml(snapshot, docs);
    }
    if (!xml) {
      auditar(diplomaId, `geracao_xml_${artefato}`, 'erro_geracao');
      return { ok: false, error: 'Falha ao montar o XML (dados insuficientes — verifique as pendências).' };
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
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(xml, 'utf8').digest('hex');

    const storagePath = await subirXmlStorage(diplomaId, nomeArquivo, xml);

    // Persiste chaves/códigos na 1ª geração
    if (artefato === 'historico_escolar' && !snapshot.processo?.codigo_validacao_historico) {
      const m = /<CodigoValidacao>([^<]+)<\/CodigoValidacao>/.exec(xml);
      if (m) db.prepare('UPDATE diplomas_digitais SET codigo_validacao_historico = ? WHERE id = ?').run(m[1], diplomaId);
    }
    if (artefato === 'documentacao_academica' && !snapshot.processo?.chave_acesso) {
      const m = /<DadosDiploma id="Dip([0-9]{44})"/.exec(xml);
      if (m) db.prepare('UPDATE diplomas_digitais SET chave_acesso = ? WHERE id = ?').run(`Dip${m[1]}`, diplomaId);
    }

    const info = db
      .prepare(
        `INSERT INTO diploma_arquivos (diploma_id, tipo_arquivo, nome, caminho_storage, hash, versao_schema, valido_xsd, erros_validacao_json)
         VALUES (?, ?, ?, ?, ?, '1.05', ?, ?)`
      )
      .run(diplomaId, artefato, nomeArquivo, storagePath ?? localPath, hash, validacao.valido ? 1 : 0, JSON.stringify(validacao.erros));

    const novoStatus = validacao.valido ? 'aguardando_assinatura' : 'xml_invalido';
    db.prepare('UPDATE diplomas_digitais SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(novoStatus, diplomaId);
    auditar(diplomaId, `geracao_xml_${artefato}`, validacao.valido ? 'sucesso' : 'xml_invalido', {
      erros: validacao.valido ? undefined : validacao.erros.slice(0, 10),
    });

    if (!validacao.valido) {
      return {
        ok: false,
        error: `XML gerado porém INVÁLIDO contra o XSD ${validacao.versaoSchema}. Correção necessária antes de prosseguir.\n` +
          validacao.erros.slice(0, 5).join('\n'),
      };
    }
    return { ok: true, data: { valido: true, erros: [], arquivoId: info.lastInsertRowid as number } };
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
  ipcMain.handle(IPC_CHANNELS.DIPLOMAS_DIGITAIS_GERAR_XML, requerAuth(gerarXmlHandler));
}
