import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, type DbAdapter } from './sqlite-adapter';
import { logger } from './utils/logger';
import { getDbPath, getDbPathAntigo, getDbPathAntigo2, CONFIG } from './config';
import { instalarInfraSincronizacao, TABELAS_SINCRONIZADAS } from './sync-core';

let db: DbAdapter;

function migrarArquivoDb(): void {
  const novo = getDbPath();
  if (fs.existsSync(novo)) return;
  const candidatos = [getDbPathAntigo2(), getDbPathAntigo()];
  for (const antigo of candidatos) {
    if (fs.existsSync(antigo)) {
      try {
        fs.renameSync(antigo, novo);
        logger.info({ de: path.basename(antigo) }, 'Arquivo de DB migrado para nexa-class.sqlite');
        return;
      } catch {
        /* ignora */
      }
    }
  }
}

export async function initDatabase(): Promise<DbAdapter> {
  migrarArquivoDb();
  const dbPath = getDbPath();
  db = await openDatabase(dbPath);
  createSchema();
  migrateAtasColacao();
  migrateAlunos();
  migrateDiplomasDigitais();
  migrateDelecoes();
  atribuirCodigosUsuarios();
  seedAdmin();
  atribuirCodigosUsuarios();
  seedDocentes();
  seedDisciplinas();
  return db;
}

/**
 * Infraestrutura de sincronização multiusuário (tombstones de exclusão +
 * bump automático de updated_at). Implementação em sync-core.ts —
 * compartilhada com os testes unitários.
 */
function migrateDelecoes(): void {
  instalarInfraSincronizacao(db, TABELAS_SINCRONIZADAS);
}

// Gera um código identificador de 2 letras + 3 números (ex.: AB123) único entre os usuários
export function gerarCodigoUsuarioUnico(): string {
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digitos = '0123456789';
  const gerar = () => {
    let c = '';
    for (let i = 0; i < 2; i++) c += letras[Math.floor(Math.random() * letras.length)];
    for (let i = 0; i < 3; i++) c += digitos[Math.floor(Math.random() * digitos.length)];
    return c;
  };
  for (let i = 0; i < 50; i++) {
    const cand = gerar();
    const exists = db.prepare('SELECT 1 FROM usuarios WHERE codigo = ?').get(cand);
    if (!exists) return cand;
  }
  // fallback muito improvável
  return gerar();
}

function atribuirCodigosUsuarios(): void {
  const cols = db.prepare('PRAGMA table_info(usuarios)').all() as { name: string }[];
  if (!cols.map((c) => c.name).includes('codigo')) {
    db.exec('ALTER TABLE usuarios ADD COLUMN codigo TEXT');
  }
  if (!cols.map((c) => c.name).includes('foto_path')) {
    db.exec('ALTER TABLE usuarios ADD COLUMN foto_path TEXT');
  }
  if (!cols.map((c) => c.name).includes('email')) {
    db.exec('ALTER TABLE usuarios ADD COLUMN email TEXT');
  }
  if (!cols.map((c) => c.name).includes('reset_token')) {
    db.exec('ALTER TABLE usuarios ADD COLUMN reset_token TEXT');
  }
  if (!cols.map((c) => c.name).includes('reset_expires')) {
    db.exec('ALTER TABLE usuarios ADD COLUMN reset_expires TEXT');
  }
  // Contador de tentativas falhas de redefinição por token — lockout após 5.
  if (!cols.map((c) => c.name).includes('reset_attempts')) {
    db.exec('ALTER TABLE usuarios ADD COLUMN reset_attempts INTEGER NOT NULL DEFAULT 0');
  }

  // Tipo de declaração: 'generico' (default, retrocompatível) | 'historico' | 'diploma'
  // 'diploma' exige diploma_id preenchido referenciando a tabela diplomas.
  const colsDeclaracoes = (db.prepare("PRAGMA table_info(declaracoes)").all() as { name: string }[]);
  if (!colsDeclaracoes.map((c) => c.name).includes('tipo')) {
    db.exec("ALTER TABLE declaracoes ADD COLUMN tipo TEXT NOT NULL DEFAULT 'generico'");
  }
  if (!colsDeclaracoes.map((c) => c.name).includes('diploma_id')) {
    db.exec('ALTER TABLE declaracoes ADD COLUMN diploma_id INTEGER');
  }
  const semCodigo = db
    .prepare('SELECT id FROM usuarios WHERE codigo IS NULL OR codigo = \'\'')
    .all() as { id: number }[];
  if (semCodigo.length === 0) return;
  const stmt = db.prepare('UPDATE usuarios SET codigo = ? WHERE id = ?');
  let n = 0;
  for (const u of semCodigo) {
    stmt.run(gerarCodigoUsuarioUnico(), u.id);
    n++;
  }
  if (n > 0) logger.info({ total: n }, 'Códigos identificadores atribuídos a usuários');
}

export function getDb(): DbAdapter {
  if (!db) {
    throw new Error('Database não inicializado. Chame initDatabase() primeiro.');
  }
  return db;
}

function createSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nome TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operador' CHECK (role IN ('admin','operador')),
      foto_path TEXT,
      email TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      senha_temporaria INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alunos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matricula TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      cpf TEXT,
      rg TEXT,
      nacionalidade TEXT,
      naturalidade TEXT,
      cidade TEXT,
      sexo TEXT,
      orgao_emissor TEXT,
      turno TEXT,
      forma_ingresso TEXT,
      data_vestibular TEXT,
      data_colacao TEXT,
      email TEXT,
      telefone TEXT,
      curso TEXT,
      faculdade TEXT,
      ano_ingresso TEXT,
      ano_conclusao TEXT,
      data_nascimento TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS historico_disciplinas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aluno_id INTEGER NOT NULL,
      periodo TEXT NOT NULL,
      disciplina TEXT NOT NULL,
      docente TEXT,
      titulacao TEXT,
      ch TEXT,
      nota TEXT,
      ft TEXT,
      status TEXT,
      ordem INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS docentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT UNIQUE NOT NULL,
      titulacao TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS disciplinas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT UNIQUE NOT NULL,
      docente_id INTEGER,
      ch TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (docente_id) REFERENCES docentes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS aluno_documentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aluno_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      caminho TEXT NOT NULL,
      xml_path TEXT,
      convertido INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS configuracoes (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS declaracoes_web (
      codigo_verificacao TEXT PRIMARY KEY,
      hash_conteudo TEXT NOT NULL,
      dados_aluno_json TEXT NOT NULL,
      emitido_em TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assinaturas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome_signatario TEXT NOT NULL,
      cargo TEXT NOT NULL,
      imagem_path TEXT,
      certificado_path TEXT,
      certificado_tipo TEXT,
      certificado_a3_thumbprint TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS declaracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aluno_id INTEGER NOT NULL,
      codigo_verificacao TEXT UNIQUE NOT NULL,
      hash_conteudo TEXT NOT NULL,
      emitido_por INTEGER NOT NULL,
      emitido_em TEXT NOT NULL DEFAULT (datetime('now')),
      enviado_web INTEGER NOT NULL DEFAULT 0,
      pdf_caminho TEXT,
      FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
      FOREIGN KEY (emitido_por) REFERENCES usuarios(id)
    );

    CREATE INDEX IF NOT EXISTS idx_alunos_matricula ON alunos(matricula);
    CREATE INDEX IF NOT EXISTS idx_alunos_nome ON alunos(nome);
    CREATE INDEX IF NOT EXISTS idx_declaracoes_aluno ON declaracoes(aluno_id);
    CREATE INDEX IF NOT EXISTS idx_declaracoes_codigo ON declaracoes(codigo_verificacao);

    CREATE TABLE IF NOT EXISTS diplomas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aluno_id INTEGER NOT NULL,
      codigo_verificacao TEXT UNIQUE NOT NULL,
      hash_conteudo TEXT NOT NULL,
      emitido_por INTEGER NOT NULL,
      emitido_em TEXT NOT NULL DEFAULT (datetime('now')),
      enviado_web INTEGER NOT NULL DEFAULT 0,
      pdf_caminho TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
      FOREIGN KEY (emitido_por) REFERENCES usuarios(id)
    );
    CREATE INDEX IF NOT EXISTS idx_diplomas_aluno ON diplomas(aluno_id);
    CREATE INDEX IF NOT EXISTS idx_diplomas_codigo ON diplomas(codigo_verificacao);

    CREATE TABLE IF NOT EXISTS cursos_livres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      descricao TEXT,
      carga_horaria TEXT,
      data_inicio TEXT,
      data_fim TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS curso_livre_alunos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      curso_livre_id INTEGER NOT NULL,
      aluno_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (curso_livre_id) REFERENCES cursos_livres(id) ON DELETE CASCADE,
      FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
      UNIQUE(curso_livre_id, aluno_id)
    );

    CREATE TABLE IF NOT EXISTS atas_colacao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aluno_id INTEGER NOT NULL UNIQUE,
      numero_ata TEXT,
      data TEXT,
      horario TEXT,
      plataforma TEXT,
      instituicao TEXT,
      cidade TEXT,
      estado TEXT,
      grau TEXT,
      modalidade TEXT,
      presidente_nome TEXT,
      presidente_cargo TEXT,
      diretor_nome TEXT,
      diretor_cargo TEXT,
      pdf_caminho TEXT,
      emitido_por INTEGER,
      emitido_em TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_atas_colacao_aluno ON atas_colacao(aluno_id);

    CREATE TABLE IF NOT EXISTS certificados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      curso_livre_id INTEGER NOT NULL,
      aluno_id INTEGER NOT NULL,
      codigo_verificacao TEXT UNIQUE NOT NULL,
      hash_conteudo TEXT NOT NULL,
      emitido_por INTEGER NOT NULL,
      emitido_em TEXT NOT NULL DEFAULT (datetime('now')),
      pdf_caminho TEXT,
      FOREIGN KEY (curso_livre_id) REFERENCES cursos_livres(id) ON DELETE CASCADE,
      FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
      FOREIGN KEY (emitido_por) REFERENCES usuarios(id)
    );
    CREATE INDEX IF NOT EXISTS idx_certificados_aluno ON certificados(aluno_id);
    CREATE INDEX IF NOT EXISTS idx_certificados_curso ON certificados(curso_livre_id);
    CREATE INDEX IF NOT EXISTS idx_certificados_codigo ON certificados(codigo_verificacao);

    CREATE TABLE IF NOT EXISTS historicos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aluno_id INTEGER NOT NULL,
      codigo_verificacao TEXT UNIQUE NOT NULL,
      hash_conteudo TEXT NOT NULL,
      emitido_por INTEGER NOT NULL,
      emitido_em TEXT NOT NULL DEFAULT (datetime('now')),
      enviado_web INTEGER NOT NULL DEFAULT 0,
      pdf_caminho TEXT,
      FOREIGN KEY (aluno_id) REFERENCES alunos(id) ON DELETE CASCADE,
      FOREIGN KEY (emitido_por) REFERENCES usuarios(id)
    );
    CREATE INDEX IF NOT EXISTS idx_historicos_aluno ON historicos(aluno_id);
    CREATE INDEX IF NOT EXISTS idx_historicos_codigo ON historicos(codigo_verificacao);

    -- ============================================================
    -- DIPLOMA DIGITAL MEC (XSD v1.05) — processo oficial.
    -- Separação total da Certidão de Conclusão (declaracoes), que
    -- segue existindo com PDF/QR/código próprios.
    -- ============================================================

    -- IES emissoras/registradoras com dados oficiais (e-MEC, CNPJ,
    -- endereço estruturado e atos regulatórios em JSON — estrutura
    -- espelha os tipos TAtoRegulatorio/TEndereco do XSD oficial).
    CREATE TABLE IF NOT EXISTS ies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      codigo_emec INTEGER,
      cnpj TEXT,
      logradouro TEXT,
      numero TEXT,
      complemento TEXT,
      bairro TEXT,
      codigo_municipio TEXT,
      nome_municipio TEXT,
      uf TEXT,
      cep TEXT,
      papel TEXT NOT NULL DEFAULT 'emissora',
      credenciamento_json TEXT,
      recredenciamento_json TEXT,
      mantenedora_json TEXT,
      ato_autorizacao_registro_json TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Cursos de graduação com dados exigidos pelo DadosCurso do XSD.
    CREATE TABLE IF NOT EXISTS cursos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ies_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      codigo_emec INTEGER,
      modalidade TEXT,
      titulo_conferido TEXT,
      outro_titulo TEXT,
      grau_conferido TEXT,
      endereco_json TEXT,
      autorizacao_json TEXT,
      reconhecimento_json TEXT,
      renovacao_reconhecimento_json TEXT,
      carga_horaria TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ies_id) REFERENCES ies(id) ON DELETE CASCADE
    );

    -- Processo do diploma digital (uma linha por diplomando).
    CREATE TABLE IF NOT EXISTS diplomas_digitais (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aluno_id INTEGER NOT NULL,
      curso_id INTEGER,
      ies_emissora_id INTEGER NOT NULL,
      ies_registradora_id INTEGER,
      status TEXT NOT NULL DEFAULT 'aguardando_conclusao',
      versao_schema TEXT NOT NULL DEFAULT '1.05',
      chave_acesso TEXT,
      chave_req TEXT,
      codigo_validacao_historico TEXT,
      dados_registro_json TEXT,
      certidao_id INTEGER,
      motivo_anulacao TEXT,
      anulado_em TEXT,
      anulado_por INTEGER,
      criado_por INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (aluno_id) REFERENCES alunos(id),
      FOREIGN KEY (curso_id) REFERENCES cursos(id),
      FOREIGN KEY (ies_emissora_id) REFERENCES ies(id),
      FOREIGN KEY (ies_registradora_id) REFERENCES ies(id),
      FOREIGN KEY (certidao_id) REFERENCES declaracoes(id),
      FOREIGN KEY (criado_por) REFERENCES usuarios(id)
    );
    CREATE INDEX IF NOT EXISTS idx_diplomas_digitais_aluno ON diplomas_digitais(aluno_id);

    -- Artefatos XML/PDF do processo, com resultado da validação XSD.
    CREATE TABLE IF NOT EXISTS diploma_arquivos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      diploma_id INTEGER NOT NULL,
      tipo_arquivo TEXT NOT NULL,
      nome TEXT,
      caminho_storage TEXT,
      hash TEXT,
      versao_schema TEXT NOT NULL,
      valido_xsd INTEGER,
      erros_validacao_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (diploma_id) REFERENCES diplomas_digitais(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_diploma_arquivos_diploma ON diploma_arquivos(diploma_id);

    -- Assinaturas (XAdES, M4) — quem assina, cargo (enum MEC) e status.
    -- NUNCA guarda chave privada ou PIN: apenas metadados do certificado.
    CREATE TABLE IF NOT EXISTS diploma_assinaturas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      diploma_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      cpf TEXT NOT NULL,
      nome TEXT NOT NULL,
      cargo TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      cert_serial TEXT,
      assinado_em TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (diploma_id) REFERENCES diplomas_digitais(id) ON DELETE CASCADE
    );

    -- Trilha de auditoria do fluxo (criação, geração, validação,
    -- assinatura, registro, publicação, anulação...). Append-only na
    -- aplicação; nunca apaga histórico de diploma.
    CREATE TABLE IF NOT EXISTS auditoria_diploma (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      diploma_id INTEGER,
      usuario_id INTEGER,
      usuario_nome TEXT,
      acao TEXT NOT NULL,
      resultado TEXT NOT NULL DEFAULT 'sucesso',
      detalhes_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_auditoria_diploma ON auditoria_diploma(diploma_id);
  `);
}

function migrateAtasColacao(): void {
  const cols = db.prepare('PRAGMA table_info(atas_colacao)').all() as { name: string }[];
  const names = cols.map((c) => c.name);
  if (names.includes('secretario_nome')) {
    db.exec('ALTER TABLE atas_colacao RENAME COLUMN secretario_nome TO diretor_nome');
  }
  if (names.includes('secretario_cargo')) {
    db.exec('ALTER TABLE atas_colacao RENAME COLUMN secretario_cargo TO diretor_cargo');
  }
}

// Diploma Digital MEC: colunas adicionadas após a criação inicial das
// tabelas do módulo (idempotente para DBs de dev criados no M2).
function migrateDiplomasDigitais(): void {
  const addCol = (tabela: string, col: string, def: string) => {
    const cols = db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[];
    if (cols.length > 0 && !cols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${def}`);
    }
  };
  addCol('cursos', 'carga_horaria', 'carga_horaria TEXT');
  addCol('diplomas_digitais', 'codigo_validacao_historico', 'codigo_validacao_historico TEXT');
  addCol('diplomas_digitais', 'chave_req', 'chave_req TEXT');
  addCol('ies', 'ato_autorizacao_registro_json', 'ato_autorizacao_registro_json TEXT');
  addCol('alunos', 'mae_nome', 'mae_nome TEXT');
  addCol('alunos', 'mae_sexo', 'mae_sexo TEXT');
  addCol('alunos', 'pai_nome', 'pai_nome TEXT');
  addCol('alunos', 'pai_sexo', 'pai_sexo TEXT');
}

function migrateAlunos(): void {
  const cols = db.prepare('PRAGMA table_info(alunos)').all() as { name: string }[];
  const names = cols.map((c) => c.name);
  const adicionar = (col: string, definicao: string) => {
    if (!names.includes(col)) {
      db.exec(`ALTER TABLE alunos ADD COLUMN ${definicao}`);
    }
  };
  adicionar('faculdade', 'faculdade TEXT');
  adicionar('ano_ingresso', 'ano_ingresso TEXT');
  adicionar('ano_conclusao', 'ano_conclusao TEXT');
  adicionar('rg', 'rg TEXT');
  adicionar('nacionalidade', 'nacionalidade TEXT');
  adicionar('naturalidade', 'naturalidade TEXT');
  adicionar('cidade', 'cidade TEXT');
  adicionar('sexo', 'sexo TEXT');
  adicionar('orgao_emissor', 'orgao_emissor TEXT');
  adicionar('turno', 'turno TEXT');
  adicionar('forma_ingresso', 'forma_ingresso TEXT');
  adicionar('data_vestibular', 'data_vestibular TEXT');
  adicionar('data_colacao', 'data_colacao TEXT');
  adicionar('created_by', 'created_by INTEGER');
  // Diploma Digital MEC (XSD v1.05): RG exige UF; naturalidade exige
  // código IBGE 7 dígitos + UF (ou município estrangeiro); nome social
  // é opcional no XSD (TDadosDiplomado → GPessoa).
  adicionar('rg_uf', 'rg_uf TEXT');
  adicionar('nome_social', 'nome_social TEXT');
  adicionar('naturalidade_codigo_ibge', 'naturalidade_codigo_ibge TEXT');
  adicionar('naturalidade_uf', 'naturalidade_uf TEXT');
  adicionar('naturalidade_estrangeira', 'naturalidade_estrangeira TEXT');
  // Diploma Digital MEC: filiação (Filiacao/Genitor no XSD da DA)
  adicionar('mae_nome', 'mae_nome TEXT');
  adicionar('mae_sexo', 'mae_sexo TEXT');
  adicionar('pai_nome', 'pai_nome TEXT');
  adicionar('pai_sexo', 'pai_sexo TEXT');

  // declaracoes: pdf_caminho
  const colsDecl = db.prepare('PRAGMA table_info(declaracoes)').all() as { name: string }[];
  if (colsDecl.map((c) => c.name).includes('pdf_caminho') === false) {
    db.exec('ALTER TABLE declaracoes ADD COLUMN pdf_caminho TEXT');
  }

  // assinaturas: certificado_path
  const colsAss = db.prepare('PRAGMA table_info(assinaturas)').all() as { name: string }[];
  if (colsAss.map((c) => c.name).includes('certificado_path') === false) {
    db.exec('ALTER TABLE assinaturas ADD COLUMN certificado_path TEXT');
  }
  // assinaturas: suporte a A3 via Windows Certificate Store (tipo + thumbprint)
  if (colsAss.map((c) => c.name).includes('certificado_tipo') === false) {
    db.exec("ALTER TABLE assinaturas ADD COLUMN certificado_tipo TEXT"); // 'A1' | 'A3'
  }
  if (colsAss.map((c) => c.name).includes('certificado_a3_thumbprint') === false) {
    db.exec('ALTER TABLE assinaturas ADD COLUMN certificado_a3_thumbprint TEXT');
  }

  // historico_disciplinas: updated_at (necessário para sync entre máquinas)
  const colsHist = db.prepare('PRAGMA table_info(historico_disciplinas)').all() as { name: string }[];
  if (colsHist.map((c) => c.name).includes('updated_at') === false) {
    db.exec('ALTER TABLE historico_disciplinas ADD COLUMN updated_at TEXT');
    db.exec("UPDATE historico_disciplinas SET updated_at = datetime('now') WHERE updated_at IS NULL");
  }

  // historico_disciplinas: ft (faltas)
  if (colsHist.map((c) => c.name).includes('ft') === false) {
    db.exec('ALTER TABLE historico_disciplinas ADD COLUMN ft TEXT');
  }

  // declaracoes: updated_at (necessário para sync entre máquinas)
  if (colsDecl.map((c) => c.name).includes('updated_at') === false) {
    db.exec('ALTER TABLE declaracoes ADD COLUMN updated_at TEXT');
    db.exec("UPDATE declaracoes SET updated_at = datetime('now') WHERE updated_at IS NULL");
  }

  // alunos: origem (separa alunos de cursos livres dos do sistema principal)
  const colsAluno = db.prepare('PRAGMA table_info(alunos)').all() as { name: string }[];
  if (colsAluno.map((c) => c.name).includes('origem') === false) {
    db.exec("ALTER TABLE alunos ADD COLUMN origem TEXT DEFAULT 'sistema'");
  }

  // usuarios: senha_temporaria (força troca de senha no primeiro login / reset)
  const colsUsuario = db.prepare('PRAGMA table_info(usuarios)').all() as { name: string }[];
  if (colsUsuario.map((c) => c.name).includes('senha_temporaria') === false) {
    db.exec('ALTER TABLE usuarios ADD COLUMN senha_temporaria INTEGER NOT NULL DEFAULT 0');
  }
}

function gerarSenhaForte(): string {
  return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

function seedAdmin(): void {
  const username = CONFIG.ADMIN_SEED.username;
  const nome = CONFIG.ADMIN_SEED.nome;
  const existing = db
    .prepare('SELECT id FROM usuarios WHERE username = ?')
    .get(username);

  if (existing) {
    // Garante role/nome corretos sem sobrescrever a senha do gestor.
    db.prepare('UPDATE usuarios SET role = ?, nome = ? WHERE username = ?')
      .run('admin', nome, username);
    // Migração de segurança: instalações antigas que ainda usam o padrão público
    // "admin123" são marcadas como temporárias para forçar a troca no próximo login.
    const row = db
      .prepare('SELECT password_hash FROM usuarios WHERE username = ?')
      .get(username) as { password_hash: string } | undefined;
    if (row?.password_hash && bcrypt.compareSync('admin123', row.password_hash)) {
      db.prepare('UPDATE usuarios SET senha_temporaria = 1 WHERE username = ?').run(username);
      logger.warn('Admin ainda usa a senha padrão "admin123" — troca obrigatória no próximo login');
    }
    return;
  }

  // Criação: senha = ADMIN_PASSWORD (env, build controlado) ou aleatória forte.
  // Nunca há senha padrão pública.
  const senha = CONFIG.ADMIN_SEED.password || gerarSenhaForte();
  const hash = bcrypt.hashSync(senha, 10);
  db.prepare(
    'INSERT INTO usuarios (username, password_hash, nome, role, senha_temporaria) VALUES (?, ?, ?, ?, 1)'
  ).run(username, hash, nome, 'admin');

  // Persiste a credencial inicial localmente (fora do repo) para o gestor recuperar
  // no primeiro acesso. Pode ser apagado após a troca de senha.
  try {
    const credsPath = path.join(path.dirname(getDbPath()), 'credenciais-iniciais.txt');
    const conteudo =
      `NEXA CLASS — credenciais iniciais\n` +
      `Usuario: ${username}\n` +
      `Senha: ${senha}\n\n` +
      `Troque a senha no primeiro login. Voce pode apagar este arquivo com seguranca.\n`;
    fs.writeFileSync(credsPath, conteudo, 'utf8');
    logger.info({ username, credsPath }, 'Admin inicial criado (credenciais salvas em arquivo)');
  } catch (e: any) {
    // NUNCA logar a senha em texto — falha aqui exige intervenção (recriar DB
    // ou ler a senha via tooling administrativo). Antes este catch imprimia
    // a senha no console, o que vazava para qualquer um com acesso aos logs.
    logger.error({ err: e, username }, 'Falha ao salvar credenciais iniciais — senha NÃO está nos logs; recriar DB ou ler via recovery');
  }
}

// Docentes extraídos dos documentos "ADM Helio Rocha-historico.docx" e "COM.SOCIAL E P&P-historico.docx"
const DOCENTES_SEED: ReadonlyArray<{ nome: string; titulacao: string }> = [
  { nome: 'NADILSON RIBEIRO DE SIQUEIRA', titulacao: 'DOUTOR' },
  { nome: 'ELTON BORGES DE SENA BARRETO', titulacao: 'MESTRADO' },
  { nome: 'JOAQUIM JORGE MARTINS GALO', titulacao: 'DOUTOR' },
  { nome: 'TUANE LISBOA SILVA PAIXÃO', titulacao: 'ESPECIALISTA' },
  { nome: 'MARCOS MOUTINHO SILVA', titulacao: 'MESTRADO' },
  { nome: 'MARIA DE LOURDES O. REIS DA SILVA', titulacao: 'DOUTORA' },
  { nome: 'MOISÉS NUNES PEREIRA', titulacao: 'ESPECIALISTA' },
  { nome: 'LUIS CLAUDIO BATISTA LOPES', titulacao: 'ESPECIALISTA' },
  { nome: 'RAVIR RODRIGUES FARIAS', titulacao: 'DOUTOR' },
  { nome: 'MILENA CRISTINA T. ROSA', titulacao: 'MESTRADO' },
  { nome: 'KAIO DA GUARDA', titulacao: 'ESPECIALISTA' },
  { nome: 'VÍTOR PINHEIRO', titulacao: 'MESTRADO' },
  { nome: 'JERÔNIMO BRITO', titulacao: 'ESPECIALISTA' },
  { nome: 'MOZART ESTRELA', titulacao: 'DOUTOR' },
  { nome: 'CARLOS EDUARDO', titulacao: 'MESTRADO' },
  { nome: 'KATIA MENEZES', titulacao: 'MESTRADO' },
  { nome: 'FERNANDO BARRETO NUNES FILHO', titulacao: 'DOUTOR' },
  { nome: 'ALBERT DE JESUS', titulacao: 'MESTRADO' },
  { nome: 'PATRÍCIA LINS CERQUEIRA R. BARBOSA', titulacao: 'ESPECIALISTA' },
  { nome: 'EDER LUIS CORDEIRO DE SANTANA', titulacao: 'ESPECIALISTA' },
  // Docentes do curso de Engenharia Civil
  { nome: 'JOSÉ NILTON SANTANA DOS SANTOS', titulacao: 'ESPECIALISTA' },
  { nome: 'MARCELO RIBEIRO PASTORE', titulacao: 'GRADUADO' },
  { nome: 'LICIA SILVA DE OLIVEIRA VIGAS', titulacao: 'MESTRADO' },
  { nome: 'MARCOS BATISTA FIGUEREDO', titulacao: 'MESTRADO' },
  { nome: 'CARLOS HENRIQUE RODRIGUES', titulacao: 'ESPECIALISTA' },
  { nome: 'GERSON LUIS OLIVEIRA SANTOS', titulacao: 'ESPECIALISTA' },
  { nome: 'ADSON SAMPAIO MELO', titulacao: 'GRADUADO' },
  { nome: 'CÉSAR AUGUSTO ALFLEN FEIJÓ', titulacao: 'ESPECIALISTA' },
  { nome: 'ANA CRISTINA CERQUEIRA', titulacao: 'MESTRADO' },
  { nome: 'FRANCISCO CARLOS FERREIRA SOUTO', titulacao: 'ESPECIALISTA' },
  { nome: 'MARCUS VINICIUS MENDES GOMES', titulacao: 'ESPECIALISTA' },
  { nome: 'ARIANE OLIVEIRA DA SILVA', titulacao: 'GRADUADO' },
  { nome: 'JOSE CARLOS ALVES PINHEIRO', titulacao: 'GRADUADO' },
  { nome: 'CARLOS ANTÔNIO C. C. CALADO', titulacao: 'GRADUADO' },
  { nome: 'KARINA RAMOS BARBOSA', titulacao: 'ESPECIALISTA' },
  { nome: 'GILSON ALVES DOS SANTOS', titulacao: 'MESTRADO' },
  { nome: 'ALEXANDRE CESTARI DE BRITO', titulacao: 'ESPECIALISTA' },
  { nome: 'PAULA GOIS LIMA', titulacao: 'MESTRADO' },
  { nome: 'FRANCISLEI SANTA ANNA SANTOS', titulacao: 'MESTRADO' },
  { nome: 'ALEXANDRE CRUZ VAZ DA SILVA', titulacao: 'MESTRADO' },
  { nome: 'ANDERSON CARVALHO PASSOS', titulacao: 'ESPECIALISTA' },
  { nome: 'JONAS FERNANDES GUEDES N. MARQUES', titulacao: 'ESPECIALISTA' },
  { nome: 'LEONEL ARTUR FARIAS MARTINS', titulacao: 'ESPECIALISTA' },
  { nome: 'LOURDES APARECIDA RIBEIRO RODRIGUES', titulacao: 'GRADUADO' },
  { nome: 'FRANCISCO CEZAR FREIRE', titulacao: 'ESPECIALISTA' },
  { nome: 'SÉRGIO ANTÔNIO TAVARES PEDROSA', titulacao: 'GRADUADO' },
  { nome: 'ANDERSON SOUZA NEVES', titulacao: 'GRADUADO' },
  { nome: 'DIANA COUTO COELHO', titulacao: 'MESTRADO' },
  { nome: 'CLAUDIO LUIS LIMA DOS SANTOS', titulacao: 'ESPECIALISTA' },
  { nome: 'MICHELL THOMP FERREIRA DA MATA', titulacao: 'ESPECIALISTA' },
  { nome: 'ADELMO FERNANDO R. SCHINDLER JÚNIOR', titulacao: 'MESTRADO' },
  { nome: 'PAULO INACIO PRYSTON DE MELLO', titulacao: 'ESPECIALISTA' },
  { nome: 'FLAVIO DINIZ FONTES', titulacao: 'ESPECIALISTA' },
  { nome: 'JOÃO PAULO DIAS', titulacao: 'DOUTOR' },
  // Docentes do curso de Turismo
  { nome: 'ADRIANO BITTENCOURT ANDRADE', titulacao: 'ESPECIALISTA' },
  { nome: 'ADEMAR OLIVEIRA CIRNE FILHO', titulacao: 'MESTRADO' },
  { nome: 'CLOVIS M. SANTOS', titulacao: 'ESPECIALISTA' },
  { nome: 'ABÍLIO MANOEL M. DE MENDONÇA', titulacao: 'ESPECIALISTA' },
  { nome: 'CARLOS ALBERTO G. DE SÁ', titulacao: 'ESPECIALISTA' },
  { nome: 'DJALMA JORGE DE S. NUNES', titulacao: 'ESPECIALISTA' },
  { nome: 'ADRIANO MOITINHO', titulacao: 'ESPECIALISTA' },
  { nome: 'CLÍMACO CÉSAR SIQUEIRA DIAS', titulacao: 'ESPECIALISTA' },
  { nome: 'ACÉRSIO PEREIRA ESTEVES', titulacao: 'MESTRADO' },
  { nome: 'ALANO CASTRO FILHO', titulacao: 'ESPECIALISTA' },
  { nome: 'EMILIA SALVADOR SILVA', titulacao: 'ESPECIALISTA' },
  { nome: 'ELIO', titulacao: 'ESPECIALISTA' },
  { nome: 'ANDREZA VIANA CANTO', titulacao: 'MESTRADO' },
  { nome: 'ANTONIO AMARILIO', titulacao: 'ESPECIALISTA' },
  { nome: 'JUREMA HUGHES', titulacao: 'GRADUADO' },
  { nome: 'CINARA CARDOSO', titulacao: 'ESPECIALISTA' },
  { nome: 'ANDREA CIRINO REZENDE', titulacao: 'MESTRADO' },
  { nome: 'ANA MARIA FREIRE SANTOS', titulacao: 'ESPECIALISTA' },
  { nome: 'LUIS MANOEL DA CRUZ GAGO', titulacao: 'MESTRADO' },
  { nome: 'ANA MARIA SEIXAS PAMPONET', titulacao: 'MESTRADO' },
  { nome: 'ANTONIO CARLOS R. DA SILVA', titulacao: 'ESPECIALISTA' },
  { nome: 'CÍNTIA NÍCOLAS BASTOS ROCHA', titulacao: 'ESPECIALISTA' },
  { nome: 'POLIANA CORNEAU', titulacao: 'ESPECIALISTA' },
  { nome: 'INEZ MARIA DANTAS A. GARRIDO', titulacao: 'ESPECIALISTA' },
  { nome: 'ALBÉRICO CORREIA', titulacao: 'ESPECIALISTA' },
  { nome: 'SIMONA GROPPER BERENSTEIN', titulacao: 'MESTRADO' },
  { nome: 'JALINE DOS SANTOS MENEZES', titulacao: 'ESPECIALISTA' },
  // Docentes da FACIIP (Administração)
  { nome: 'ALDIZETE SOUZA CARDOSO', titulacao: 'ESPECIALISTA' },
  { nome: 'AFRÂNIO MÁRCIA PINTO', titulacao: 'MESTRADO' },
  { nome: 'ADRIANA PAULA DE C. MORBECK', titulacao: 'MESTRADO' },
  { nome: 'GRACIELE CARNEIRO LEAL', titulacao: 'MESTRADO' },
  { nome: 'HEBERT DA SILVA SANTOS JÚNIOR', titulacao: 'ESPECIALISTA' },
  { nome: 'BRIOLÂNGIA BISPO DA CRUZ', titulacao: 'MESTRADO' },
  { nome: 'MARIA TEREZA ALVES TEIXEIRA', titulacao: 'ESPECIALISTA' },
  { nome: 'MIRIAM MENDONÇA BARRETO', titulacao: 'ESPECIALISTA' },
  { nome: 'CARLOS EDUARDO C. DE SANTANA', titulacao: 'MESTRADO' },
  { nome: 'JAIME DE MOURA FERREIRA', titulacao: 'ESPECIALISTA' },
  { nome: 'ANTERO PAULO F. DE SOUZA FILHO', titulacao: 'ESPECIALISTA' },
  { nome: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', titulacao: 'ESPECIALISTA' },
  { nome: 'MARIA DAS GRAÇAS M. DE A. DOMINGUES', titulacao: 'MESTRADO' },
  { nome: 'DENISE ARAÚJO BRITTO', titulacao: 'ESPECIALISTA' },
  { nome: 'CÉSAR ERNESTO DETONI', titulacao: 'DOUTOR' },
  { nome: 'CRISTINA MASCARENHAS SANTOS', titulacao: 'MESTRADO' },
  { nome: 'ADRIANA ESTEVES GAMA NOVAES', titulacao: 'MESTRADO' },
  { nome: 'ANTONIO ARÃAS SOBRINHO', titulacao: 'MESTRADO' },
  { nome: 'TAÍS GUALBERTO DE ALMEIDA', titulacao: 'ESPECIALISTA' },
  { nome: 'PAULA CRISTINA VASCONCELOS ARAÚJO', titulacao: 'ESPECIALISTA' },
  // Docentes da FACIIP (demais cursos)
  { nome: 'VALMENIA ANGELICA SANTOS GOMES DE MIRANDA', titulacao: 'ESPECIALISTA' },
  { nome: 'VICENTE DE PAULO QUEIROZ PERRONI', titulacao: 'GRADUADO' },
  { nome: 'MATILDE EUGÊNIA SCHNITMAN', titulacao: 'MESTRADO' },
  { nome: 'ALEX CONTREIRAS ROSIER', titulacao: 'ESPECIALISTA' },
  { nome: 'CINTIA MORENO MORAES', titulacao: 'GRADUADO' },
  { nome: 'LARISSA IVO RAMOS', titulacao: 'GRADUADO' },
  { nome: 'MARIA MARCIA PEREIRA', titulacao: 'ESPECIALISTA' },
  { nome: 'CARLOS EDUARDO CARVALHO DE SANTANA', titulacao: 'MESTRADO' },
  { nome: 'ISABELA ARAGÃO MORAES', titulacao: 'ESPECIALISTA' },
  { nome: 'GEORGE DE CARVALHO AFONSO', titulacao: 'ESPECIALISTA' },
  { nome: 'HANAYANA BRANDÃO GUIMARÃES FONTES LIMA', titulacao: 'GRADUADO' },
  { nome: 'NAURELICE MAIA DE MELO', titulacao: 'MESTRADO' },
  { nome: 'ROSANE MENDES CAVALCANTE', titulacao: 'ESPECIALISTA' },
  { nome: 'UBIRAJARA BOMFIM VIGAS', titulacao: 'MESTRADO' },
  { nome: 'LUIZ CLÁUDIO LUZ GÓES', titulacao: 'GRADUADO' },
  { nome: 'ELISEU ALVES TEIXEIRA', titulacao: 'ESPECIALISTA' },
  { nome: 'AHIRAM CARDOSO SILVA LIMA', titulacao: 'ESPECIALISTA' },
  { nome: 'SELMO ALVES DOS SANTOS JUNIOR', titulacao: 'ESPECIALISTA' },
  { nome: 'RENILSON ROBERTO SANTOS', titulacao: 'ESPECIALISTA' },
  { nome: 'LUIS ANDRÉ DE AGUIAR ALVES', titulacao: 'MESTRADO' },
  { nome: 'TÂNIA REGINA PINTO SOUSA', titulacao: 'ESPECIALISTA' },
  { nome: 'UBALDINO VIEIRA LEITE FILHO', titulacao: 'ESPECIALISTA' },
  { nome: 'EDIMAR CAETIÉ JÚNIOR', titulacao: 'MESTRADO' },
  { nome: 'ANA PAULA TAVARES SILVA', titulacao: 'ESPECIALISTA' },
  { nome: 'ALBERTO OLIVEIRA DE ALMEIDA', titulacao: 'GRADUADO' },
  { nome: 'GERSON FERREIRA JUNIOR', titulacao: 'MESTRADO' },
  { nome: 'FERNANDO ANTÔNIO VASCONCELOS FROTA', titulacao: 'MESTRADO' },
  { nome: 'ESTEVÃO RIBEIRO MONTI', titulacao: 'DOUTOR' },
  { nome: 'MARIA ELIELZA DOS SANTOS', titulacao: 'ESPECIALISTA' },
  { nome: 'VILMA ALVES DA SILVA', titulacao: 'ESPECIALISTA' },
  { nome: 'JUSSARA REGINA DE SOUZA LISBOA', titulacao: 'DOUTORA' },
  { nome: 'HELENA BARBACENA DE SOUZA', titulacao: 'ESPECIALISTA' },
  { nome: 'ALESSANDRA GUEDES RIBEIRO COZZA DE MIRANDA', titulacao: 'ESPECIALISTA' },
  { nome: 'ALYNE DAYANE PACIFICO SOUSA', titulacao: 'MESTRADO' },
  { nome: 'UVERLAND BARROS DA SILVA', titulacao: 'DOUTOR' },
  { nome: 'ALEX LEONARDO RIBEIRO', titulacao: 'MESTRADO' },
  { nome: 'MARIA APARECIDA PEIXOTO SOARES', titulacao: 'ESPECIALISTA' },
  { nome: 'CINTHIA DA CUNHA BARBOSA', titulacao: 'ESPECIALISTA' },
  { nome: 'VANESSA DE CARVALHO PEDRA', titulacao: 'ESPECIALISTA' },
  { nome: 'MARIA DO SOCORRO BEZERRA DA SILVA', titulacao: 'ESPECIALISTA' },
  { nome: 'WELLINGTON JONATHAN DE SOUZA RODRIGUES', titulacao: 'ESPECIALISTA' },
  { nome: 'MARCUS ANDRÉ NERY', titulacao: 'MESTRADO' },
  { nome: 'ROSIMERE CALAÇA MARQUES', titulacao: 'ESPECIALISTA' },
  { nome: 'DAYSE BENIGNA BERNARDO ARAUJO GOMES', titulacao: 'MESTRADO' },
  { nome: 'RAIMUNDO NONATO SILVA DAMASCENO JÚNIOR', titulacao: 'ESPECIALISTA' },
  { nome: 'GEORGE FELINTO DA SILVA', titulacao: 'ESPECIALISTA' },
  { nome: 'JACKSON PEDRO VERAS', titulacao: 'ESPECIALISTA' },
  { nome: 'ANA CLAUDIA RODRIGUES FERNANDES', titulacao: 'DOUTORA' },
  { nome: 'ANA ELISA DE CARLI BLACKMAN', titulacao: 'MESTRADO' },
  { nome: 'FABIANE REGINA GERALDES MOREIRA MARQUES', titulacao: 'MESTRADO' },
  // Docentes da FATECE (Pedagogia e Teologia)
  { nome: 'MARIA HELENA SILVA', titulacao: 'ESPECIALISTA' },
  { nome: 'JOAO CARLOS SOBREIRO', titulacao: 'ESPECIALISTA' },
  { nome: 'SÉRGIO LOPES', titulacao: 'MESTRADO' },
  { nome: 'CINTHIA ALVES', titulacao: 'MESTRADO' },
  { nome: 'MARCELO ABRÃO', titulacao: 'MESTRADO' },
  { nome: 'PEDRO GUSTAVO', titulacao: 'ESPECIALISTA' },
  { nome: 'ROBERTO MOREIRA', titulacao: 'MESTRADO' },
  { nome: 'CASSIA BORGES', titulacao: 'MESTRADO' },
  { nome: 'GUSTAVO SIQUEIRA', titulacao: 'MESTRADO' },
  { nome: 'FLORA CAMPOS', titulacao: 'MESTRADO' },
  { nome: 'MARIA GORETE BRITO', titulacao: 'MESTRADO' },
  { nome: 'VALTER DE PAULA', titulacao: 'MESTRADO' },
  { nome: 'LUZIA PACHECO', titulacao: 'MESTRADO' },
  { nome: 'LUIZ VIDAL', titulacao: 'MESTRADO' },
  { nome: 'PATRÍCIA SILVA', titulacao: 'MESTRADO' },
  { nome: 'ANDRÉ NASCIMENTO', titulacao: 'MESTRADO' },
  { nome: 'JOÃO SOUZA', titulacao: 'MESTRADO' },
  { nome: 'FAUSTO BARROS', titulacao: 'ESPECIALISTA' },
  { nome: 'MARCOS VINÍCIUS', titulacao: 'ESPECIALISTA' },
  { nome: 'EDUARDO BARBOSA', titulacao: 'MESTRADO' },
  { nome: 'REGINA RANNA', titulacao: 'ESPECIALISTA' },
  { nome: 'KARINE GONTIJO', titulacao: 'MESTRADO' },
  { nome: 'MONICA CASTRO', titulacao: 'MESTRADO' },
  { nome: 'CARLOS MOURÃO', titulacao: 'MESTRADO' },
];

function seedDocentes(): void {
  const stmt = db.prepare('INSERT OR IGNORE INTO docentes (nome, titulacao) VALUES (?, ?)');
  let novos = 0;
  for (const d of DOCENTES_SEED) {
    const r = stmt.run(d.nome, d.titulacao);
    if (r.changes > 0) novos++;
  }
  if (novos > 0) logger.info({ novos, total: DOCENTES_SEED.length }, 'Seed de docentes aplicada');
}

// Disciplinas extraídas do documento "ADM Helio Rocha-historico.docx"
const DISCIPLINAS_SEED: ReadonlyArray<{ nome: string; docente: string; ch: string }> = [
  { nome: 'Teoria Geral de Administração', docente: 'NADILSON RIBEIRO DE SIQUEIRA', ch: '120H' },
  { nome: 'Matemática Introdutória e Cálculo', docente: 'ELTON BORGES DE SENA BARRETO', ch: '60H' },
  { nome: 'Ciência Política e Teoria Geral do Estado', docente: 'JOAQUIM JORGE MARTINS GALO', ch: '60H' },
  { nome: 'Linguagem e Métodos Universitários', docente: 'TUANE LISBOA SILVA PAIXÃO', ch: '60H' },
  { nome: 'Economia Empresarial', docente: 'MARCOS MOUTINHO SILVA', ch: '60H' },
  { nome: 'Introdução a Contabilidade', docente: 'MARCOS MOUTINHO SILVA', ch: '60H' },
  { nome: 'Fundamentos de Direito Público e Privado', docente: 'ELTON BORGES DE SENA BARRETO', ch: '60H' },
  { nome: 'Cultura Organizacional', docente: 'MARIA DE LOURDES O. REIS DA SILVA', ch: '60H' },
  { nome: 'Fundamentos de Antropologia e Sociologia', docente: 'MOISÉS NUNES PEREIRA', ch: '60H' },
  { nome: 'Matemática Financeira', docente: 'MARCOS MOUTINHO SILVA', ch: '60H' },
  { nome: 'Contabilidade Gerencial', docente: 'MOISÉS NUNES PEREIRA', ch: '60H' },
  { nome: 'Organização Sistemas e Métodos', docente: 'ELTON BORGES DE SENA BARRETO', ch: '60H' },
  { nome: 'Gestão de Pequenas e Médias Empresas', docente: 'LUIS CLAUDIO BATISTA LOPES', ch: '60H' },
  { nome: 'Psicologia Organizacional', docente: 'RAVIR RODRIGUES FARIAS', ch: '60H' },
  { nome: 'Administração Financeira e Orçamentária', docente: 'MARCOS MOUTINHO SILVA', ch: '120H' },
  { nome: 'Gestão e Desenvolvimento de Pessoas', docente: 'RAVIR RODRIGUES FARIAS', ch: '60H' },
  { nome: 'Direito Empresarial e do Trabalho', docente: 'LUIS CLAUDIO BATISTA LOPES', ch: '60H' },
  { nome: 'Estatística Empresarial', docente: 'ELTON BORGES DE SENA BARRETO', ch: '60H' },
  { nome: 'Marketing', docente: 'MILENA CRISTINA T. ROSA', ch: '60H' },
  { nome: 'Logística', docente: 'KAIO DA GUARDA', ch: '60H' },
  { nome: 'Planejamento Estratégico', docente: 'VÍTOR PINHEIRO', ch: '60H' },
  { nome: 'Gestão de Qualidade', docente: 'JERÔNIMO BRITO', ch: '60H' },
  { nome: 'Administração de Recursos Materiais e Patrimoniais', docente: 'MOZART ESTRELA', ch: '60H' },
  { nome: 'Auditoria e Perícia Contábil', docente: 'CARLOS EDUARDO', ch: '60H' },
  { nome: 'Administração da Produção e Operação', docente: 'KATIA MENEZES', ch: '60H' },
  { nome: 'Gestão Pública', docente: 'ELTON BORGES DE SENA BARRETO', ch: '60H' },
  { nome: 'Administração Mercadológica', docente: 'LUIS CLAUDIO BATISTA LOPES', ch: '60H' },
  { nome: 'Mercado de Capitais', docente: 'TUANE LISBOA SILVA PAIXÃO', ch: '60H' },
  { nome: 'Elaboração e Analise de Projetos', docente: 'FERNANDO BARRETO NUNES FILHO', ch: '120H' },
  { nome: 'Gestão Ambiental e Sustentável', docente: 'LUIS CLAUDIO BATISTA LOPES', ch: '60H' },
  { nome: 'Jogos de Empresa', docente: 'TUANE LISBOA SILVA PAIXÃO', ch: '60H' },
  { nome: 'Empreendedorismo', docente: 'LUIS CLAUDIO BATISTA LOPES', ch: '60H' },
  { nome: 'Estágio Supervisionado', docente: 'ALBERT DE JESUS', ch: '180H' },
  { nome: 'Seminários Avançados em Administração', docente: 'ALBERT DE JESUS', ch: '120H' },
  { nome: 'Libras', docente: 'LUIS CLAUDIO BATISTA LOPES', ch: '60H' },
  { nome: 'Planos de Negócios', docente: 'TUANE LISBOA SILVA PAIXÃO', ch: '120H' },
  { nome: 'Estágio Supervisionado I', docente: 'ELTON BORGES DE SENA BARRETO', ch: '180H' },
  // Disciplinas do curso de Comunicação Social (Publicidade e Propaganda)
  { nome: 'Língua Portuguesa', docente: 'NADILSON RIBEIRO DE SIQUEIRA', ch: '80H' },
  { nome: 'Teorias da Comunicação I', docente: 'ELTON BORGES DE SENA BARRETO', ch: '80H' },
  { nome: 'Linguagens e Métodos Universitários', docente: 'JOAQUIM JORGE MARTINS GALO', ch: '80H' },
  { nome: 'Teorias da Comunicação II', docente: 'MARCOS MOUTINHO SILVA', ch: '70H' },
  { nome: 'Teoria e Técnica da Propaganda', docente: 'ELTON BORGES DE SENA BARRETO', ch: '70H' },
  { nome: 'Tecnologia Gráfica', docente: 'MOISÉS NUNES PEREIRA', ch: '70H' },
  { nome: 'História da Arte', docente: 'ELTON BORGES DE SENA BARRETO', ch: '70H' },
  { nome: 'Contato e planejamento Publicitário', docente: 'EDER LUIS CORDEIRO DE SANTANA', ch: '80H' },
  { nome: 'Ciências Política e Teoria Geral do Estado', docente: 'RAVIR RODRIGUES FARIAS', ch: '60H' },
  { nome: 'Designe Gráfico', docente: 'LUIS CLAUDIO BATISTA LOPES', ch: '80H' },
  { nome: 'Promoção de Vendas e Merchandising', docente: 'ELTON BORGES DE SENA BARRETO', ch: '60H' },
  { nome: 'Atividade Complementar I', docente: 'RAVIR RODRIGUES FARIAS', ch: '120H' },
  { nome: 'Fotografia', docente: 'MILENA CRISTINA T. ROSA', ch: '80H' },
  { nome: 'Semiologia e Semiótica', docente: 'KAIO DA GUARDA', ch: '120H' },
  { nome: 'Laboratório de Editoração', docente: 'VÍTOR PINHEIRO', ch: '80H' },
  { nome: 'Midia I', docente: 'JERÔNIMO BRITO', ch: '80H' },
  { nome: 'Midia II', docente: 'CARLOS EDUARDO', ch: '80H' },
  { nome: 'Criação', docente: 'KATIA MENEZES', ch: '80H' },
  { nome: 'Atividade Complementar II', docente: 'ELTON BORGES DE SENA BARRETO', ch: '120H' },
  { nome: 'Produção e Edição de Vídeo', docente: 'LUIS CLAUDIO BATISTA LOPES', ch: '80H' },
  { nome: 'Fundamentos do Direito Público e Privado', docente: 'MILENA CRISTINA T. ROSA', ch: '70H' },
  { nome: 'Direção de Arte', docente: 'FERNANDO BARRETO NUNES FILHO', ch: '80H' },
  { nome: 'Produção em RTVC', docente: 'LUIS CLAUDIO BATISTA LOPES', ch: '80H' },
  { nome: 'Projeto Experimental II', docente: 'TUANE LISBOA SILVA PAIXÃO', ch: '80H' },
  { nome: 'Pesquisa de Mercado', docente: 'LUIS CLAUDIO BATISTA LOPES', ch: '80H' },
  { nome: 'Comunicação On line', docente: 'ALBERT DE JESUS', ch: '80H' },
  { nome: 'Tópicos Especiais em Comunicação', docente: 'TUANE LISBOA SILVA PAIXÃO', ch: '120H' },
  { nome: 'Atividade Complementar III', docente: 'ALBERT DE JESUS', ch: '120H' },
  // Disciplinas do curso de Engenharia Civil
  { nome: 'Química Geral', docente: 'JOSÉ NILTON SANTANA DOS SANTOS', ch: '60H' },
  { nome: 'Geometria Analítica', docente: 'MARCELO RIBEIRO PASTORE', ch: '60H' },
  { nome: 'Introdução ao Cálculo Diferencial', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '80H' },
  { nome: 'Meio Ambiente e Desenvolvimento Sustentável', docente: 'MARCOS BATISTA FIGUEREDO', ch: '60H' },
  { nome: 'Introdução à Engenharia', docente: 'CARLOS HENRIQUE RODRIGUES', ch: '60H' },
  { nome: 'Projeto Integrador I', docente: 'GERSON LUIS OLIVEIRA SANTOS', ch: '40H' },
  { nome: 'Física Geral e Experimental', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '80H' },
  { nome: 'Desenho Técnico Aplicado', docente: 'ADSON SAMPAIO MELO', ch: '80H' },
  { nome: 'Criatividade, Inovação e Interculturalismo', docente: 'CÉSAR AUGUSTO ALFLEN FEIJÓ', ch: '40H' },
  { nome: 'Algoritmos e Programação de Computadores', docente: 'ANA CRISTINA CERQUEIRA', ch: '80H' },
  { nome: 'Cálculo Integral Aplicado à Engenharia', docente: 'MARCELO RIBEIRO PASTORE', ch: '80H' },
  { nome: 'Projeto Integrador II', docente: 'MARCELO RIBEIRO PASTORE', ch: '40H' },
  { nome: 'Física Geral e Experimental II', docente: 'FRANCISCO CARLOS FERREIRA SOUTO', ch: '80H' },
  { nome: 'Álgebra Linear', docente: 'MARCUS VINICIUS MENDES GOMES', ch: '60H' },
  { nome: 'Equações Diferenciais', docente: 'MARCOS BATISTA FIGUEREDO', ch: '60H' },
  { nome: 'Mecânica Geral', docente: 'ARIANE OLIVEIRA DA SILVA', ch: '60H' },
  { nome: 'Liderança e Empreendedorismo', docente: 'JOSE CARLOS ALVES PINHEIRO', ch: '80H' },
  { nome: 'Projeto Integrador III', docente: 'CARLOS ANTÔNIO C. C. CALADO', ch: '40H' },
  { nome: 'Física Geral e Experimental III', docente: 'ANA CRISTINA CERQUEIRA', ch: '80H' },
  { nome: 'Probabilidade e Estatística Aplicada à Engenharia', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '60H' },
  { nome: 'Resistencia dos Materiais I', docente: 'MARCELO RIBEIRO PASTORE', ch: '60H' },
  { nome: 'Fenômeno de Transporte', docente: 'KARINA RAMOS BARBOSA', ch: '60H' },
  { nome: 'Cálculo Numérico', docente: 'GILSON ALVES DOS SANTOS', ch: '60H' },
  { nome: 'Projeto Integrador IV', docente: 'ALEXANDRE CESTARI DE BRITO', ch: '40H' },
  { nome: 'Sistema Hidráulicos', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'Resistencia dos Materiais II', docente: 'ARIANE OLIVEIRA DA SILVA', ch: '120H' },
  { nome: 'Materiais de Construção Civil I', docente: 'FRANCISLEI SANTA ANNA SANTOS', ch: '60H' },
  { nome: 'Mecânica dos Solos I', docente: 'ALEXANDRE CRUZ VAZ DA SILVA', ch: '60H' },
  { nome: 'Expressões Gráficas', docente: 'ANDERSON CARVALHO PASSOS', ch: '60H' },
  { nome: 'Teoria das Estruturas', docente: 'JONAS FERNANDES GUEDES N. MARQUES', ch: '70H' },
  { nome: 'Higiene e Segurança do Trabalho', docente: 'CARLOS ANTÔNIO C. C. CALADO', ch: '70H' },
  { nome: 'Topografia', docente: 'LEONEL ARTUR FARIAS MARTINS', ch: '70H' },
  { nome: 'Mecânica dos Solos II', docente: 'LOURDES APARECIDA RIBEIRO RODRIGUES', ch: '40H' },
  { nome: 'Materiais de Construção Civil II', docente: 'FRANCISCO CEZAR FREIRE', ch: '40H' },
  { nome: 'Hidrologia', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'Construção Civil I', docente: 'FRANCISCO CEZAR FREIRE', ch: '60H' },
  { nome: 'Fundações e Obras de Terra', docente: 'PAULA GOIS LIMA', ch: '70H' },
  { nome: 'Direito Ambiental', docente: 'SÉRGIO ANTÔNIO TAVARES PEDROSA', ch: '70H' },
  { nome: 'Teoria das Estruturas II', docente: 'ANDERSON SOUZA NEVES', ch: '80H' },
  { nome: 'Estruturas Metálicas', docente: 'PAULA GOIS LIMA', ch: '70H' },
  { nome: 'Construção Civil II', docente: 'DIANA COUTO COELHO', ch: '70H' },
  { nome: 'Instalações Hidráulicas e Sanitárias', docente: 'CLAUDIO LUIS LIMA DOS SANTOS', ch: '40H' },
  { nome: 'Elemento de Arquitetura e Urbanismo', docente: 'FRANCISCO CEZAR FREIRE', ch: '40H' },
  { nome: 'Estradas', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'Instalações Elétricas', docente: 'MARCELO RIBEIRO PASTORE', ch: '60H' },
  { nome: 'Análise Econômica de Projetos', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'Concreto Armado I', docente: 'JOSÉ NILTON SANTANA DOS SANTOS', ch: '80H' },
  { nome: 'Métodos dos Elementos Finitos', docente: 'MICHELL THOMP FERREIRA DA MATA', ch: '40H' },
  { nome: 'Saneamento Básico', docente: 'ADELMO FERNANDO R. SCHINDLER JÚNIOR', ch: '40H' },
  { nome: 'Estruturas de Madeira', docente: 'ANA CRISTINA CERQUEIRA', ch: '60H' },
  { nome: 'Gestão de Projetos Aplicados à Engenharia', docente: 'MARCELO RIBEIRO PASTORE', ch: '60H' },
  { nome: 'Concreto Armado II', docente: 'PAULO INACIO PRYSTON DE MELLO', ch: '60H' },
  { nome: 'Sistema de Transporte', docente: 'FLAVIO DINIZ FONTES', ch: '40H' },
  { nome: 'Pontes', docente: 'ANA CRISTINA CERQUEIRA', ch: '60H' },
  { nome: 'Estruturas Protendidas e Especiais', docente: 'MARCELO RIBEIRO PASTORE', ch: '60H' },
  { nome: 'Estágio Curricular Supervisionado em Engenharia', docente: 'PAULA GOIS LIMA', ch: '200H' },
  { nome: 'Trabalho de Conclusão de Curso em Engenharia', docente: 'JOÃO PAULO DIAS', ch: '40H' },
  // Disciplinas do curso de Engenharia de Produção
  { nome: 'Lógica Matemática', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '80H' },
  { nome: 'Física Geral e Experimental I', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '80H' },
  { nome: 'Teoria da Administração', docente: 'ANA CRISTINA CERQUEIRA', ch: '80H' },
  { nome: 'Cálculo Diferencial e Integral Aplicado à Engenharia I', docente: 'MARCELO RIBEIRO PASTORE', ch: '80H' },
  { nome: 'Contabilidade', docente: 'MARCOS BATISTA FIGUEREDO', ch: '60H' },
  { nome: 'Cálculo Diferencial e Integral Aplicado à Engenharia II', docente: 'ARIANE OLIVEIRA DA SILVA', ch: '60H' },
  { nome: 'Sistema de Produção I', docente: 'MARCELO RIBEIRO PASTORE', ch: '60H' },
  { nome: 'Gestão de Tecnologia', docente: 'KARINA RAMOS BARBOSA', ch: '60H' },
  { nome: 'Ciência e Engenharia dos Materiais', docente: 'PAULA GOIS LIMA', ch: '70H' },
  { nome: 'Administração de Produção', docente: 'ARIANE OLIVEIRA DA SILVA', ch: '70H' },
  { nome: 'Economia Aplicada à Engenharia', docente: 'FRANCISLEI SANTA ANNA SANTOS', ch: '70H' },
  { nome: 'Sistemas de Produção II', docente: 'ALEXANDRE CRUZ VAZ DA SILVA', ch: '70H' },
  { nome: 'Pesquisa Operacional I', docente: 'ANDERSON CARVALHO PASSOS', ch: '70H' },
  { nome: 'Logística Empresarial', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '70H' },
  { nome: 'Sistemas de Informações Gerenciais - SIG', docente: 'JONAS FERNANDES GUEDES N. MARQUES', ch: '60H' },
  { nome: 'Custos Gerenciais', docente: 'CARLOS ANTÔNIO C. C. CALADO', ch: '60H' },
  { nome: 'Finanças e Gestão de Empresas', docente: 'LEONEL ARTUR FARIAS MARTINS', ch: '60H' },
  { nome: 'Metrologia, Normalização e Qualidade', docente: 'FRANCISCO CEZAR FREIRE', ch: '60H' },
  { nome: 'Pesquisa Operacional II', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'Direito e Logística', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '60H' },
  { nome: 'Gestão Ambiental', docente: 'SÉRGIO ANTÔNIO TAVARES PEDROSA', ch: '60H' },
  { nome: 'Ergonomia e Segurança do Trabalho', docente: 'ANDERSON SOUZA NEVES', ch: '80H' },
  { nome: 'Custos de Produção', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'Gestão da Cadeia de Suprimentos', docente: 'DIANA COUTO COELHO', ch: '60H' },
  { nome: 'Planejamento e Controle de Produção', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'Marketing e Negócios', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'Projeto de Diplomação I', docente: 'MARCELO RIBEIRO PASTORE', ch: '80H' },
  { nome: 'Estágio Curricular Supervisionado em Engenharia I', docente: 'PAULO INACIO PRYSTON DE MELLO', ch: '250H' },
  { nome: 'Projeto de Diplomação II', docente: 'MARCELO RIBEIRO PASTORE', ch: '80H' },
  { nome: 'Estágio Curricular Supervisionado em Engenharia II', docente: 'PAULA GOIS LIMA', ch: '250H' },
  // Disciplinas do curso de Engenharia Elétrica
  { nome: 'Resistência dos Materiais', docente: 'MARCELO RIBEIRO PASTORE', ch: '60H' },
  { nome: 'Sistemas Digitais', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'Cálculo Vetorial', docente: 'ARIANE OLIVEIRA DA SILVA', ch: '60H' },
  { nome: 'Métodos Matemáticos Aplicados à Engenharia', docente: 'FRANCISLEI SANTA ANNA SANTOS', ch: '60H' },
  { nome: 'Materiais Elétricos', docente: 'ALEXANDRE CRUZ VAZ DA SILVA', ch: '60H' },
  { nome: 'Circuitos Elétricos', docente: 'ANDERSON CARVALHO PASSOS', ch: '140H' },
  { nome: 'Sistemas Lineares e Controle', docente: 'JONAS FERNANDES GUEDES N. MARQUES', ch: '80H' },
  { nome: 'Eletromagnetismo', docente: 'LEONEL ARTUR FARIAS MARTINS', ch: '60H' },
  { nome: 'Arquitetura e Organização de Computadores', docente: 'FRANCISCO CEZAR FREIRE', ch: '60H' },
  { nome: 'Eletrônica Geral e Experimental', docente: 'PAULA GOIS LIMA', ch: '140H' },
  { nome: 'Sistemas de Controle Aplicado à Engenharia', docente: 'PAULA GOIS LIMA', ch: '80H' },
  { nome: 'Sistema de Comunicação para Automação', docente: 'SÉRGIO ANTÔNIO TAVARES PEDROSA', ch: '80H' },
  { nome: 'Sistema e medidas Elétricas', docente: 'ANDERSON SOUZA NEVES', ch: '60H' },
  { nome: 'Termodinâmica', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'Conversão de Energia e Maquinas Elétricas', docente: 'DIANA COUTO COELHO', ch: '60H' },
  { nome: 'Análise Econômico de Projetos', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'Automação Industrial I', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'Acionamentos Hidráulicos e Pneumáticos', docente: 'JOSÉ NILTON SANTANA DOS SANTOS', ch: '60H' },
  { nome: 'Instrumentação Industrial', docente: 'MICHELL THOMP FERREIRA DA MATA', ch: '60H' },
  { nome: 'Eletrônica de Potências e Acionamentos', docente: 'FLAVIO DINIZ FONTES', ch: '60H' },
  { nome: 'Servomecanismo', docente: 'MARCELO RIBEIRO PASTORE', ch: '60H' },
  // Disciplinas do curso de Fisioterapia (sem docente vinculado no documento)
  { nome: 'Anatomia Sistêmica', docente: '', ch: '80H' },
  { nome: 'Biologia Celular', docente: '', ch: '80H' },
  { nome: 'Histologia e Embriologia', docente: '', ch: '80H' },
  { nome: 'Fundamentos da Ciência Sociais Aplicados à Saúde', docente: '', ch: '40H' },
  { nome: 'Introdução à Fisioterapia', docente: '', ch: '80H' },
  { nome: 'Métodos e Técnicas de Pesquisa', docente: '', ch: '60H' },
  { nome: 'Ergonomia e Biossegurança', docente: '', ch: '40H' },
  { nome: 'Microbiologia e Imunologia', docente: '', ch: '80H' },
  { nome: 'Anatomia do Aparelho Locutor', docente: '', ch: '80H' },
  { nome: 'Psicologia', docente: '', ch: '60H' },
  { nome: 'Fisiologia', docente: '', ch: '80H' },
  { nome: 'Biofísica', docente: '', ch: '60H' },
  { nome: 'Cinesiologia e Biomecânica I', docente: '', ch: '80H' },
  { nome: 'Recursos Terapêuticos Manuais', docente: '', ch: '40H' },
  { nome: 'Neuroanatomia', docente: '', ch: '80H' },
  { nome: 'Patologia Geral', docente: '', ch: '80H' },
  { nome: 'Fisiologia Aplicada à Fisioterapia', docente: '', ch: '80H' },
  { nome: 'Bioestatística', docente: '', ch: '40H' },
  { nome: 'Cinesiologia e Biomecânica II', docente: '', ch: '40H' },
  { nome: 'Fisiologia do Exercício', docente: '', ch: '80H' },
  { nome: 'Eletroterapia', docente: '', ch: '80H' },
  { nome: 'Cinesioterapia I', docente: '', ch: '80H' },
  { nome: 'Diagnóstico por Imagem', docente: '', ch: '80H' },
  { nome: 'Prótese e Órtose', docente: '', ch: '80H' },
  { nome: 'Recursos Terapêuticos I', docente: '', ch: '80H' },
  { nome: 'Fundamentos da Pediatria', docente: '', ch: '80H' },
  { nome: 'Movimento e Desenvolvimento Humano I', docente: '', ch: '80H' },
  { nome: 'Fundamentos de Cardiologia e Pneumologia', docente: '', ch: '80H' },
  { nome: 'Fundamentos da Ortopedia', docente: '', ch: '80H' },
  { nome: 'Fundamentos de Neurologia', docente: '', ch: '80H' },
  { nome: 'Fisioterapia Aplicada em Pediatria', docente: '', ch: '80H' },
  { nome: 'Fisioterapia Aplicada à Cardiologia', docente: '', ch: '80H' },
  { nome: 'Fisioterapia Aplicada à Pneumologia', docente: '', ch: '80H' },
  { nome: 'Fisioterapia Aplicada à Ortopedia', docente: '', ch: '80H' },
  { nome: 'Fisioterapia Aplicada à Neurologia', docente: '', ch: '80H' },
  { nome: 'Fundamentos de Ginecologia e Obstétrica e Saúde da Mulher', docente: '', ch: '80H' },
  { nome: 'Clínica I - Ortopedia', docente: '', ch: '80H' },
  { nome: 'Clínica II - Neurologia', docente: '', ch: '80H' },
  { nome: 'Clínica II - Pediatria', docente: '', ch: '80H' },
  { nome: 'Clínica IV - Cardio Respiratório', docente: '', ch: '120H' },
  { nome: 'Fisioterapia Aplicada à Geriatria e Gerontologia', docente: '', ch: '80H' },
  { nome: 'Estágio I - Ambulatório', docente: '', ch: '80H' },
  { nome: 'Estágio II - CTI', docente: '', ch: '80H' },
  { nome: 'Estágio III - Posto de Saúde', docente: '', ch: '80H' },
  { nome: 'Trabalho de Conclusão de Curso', docente: '', ch: '80H' },
  { nome: 'Optativa', docente: '', ch: '80H' },
  { nome: 'Estágio Supervisionado Extramuros', docente: '', ch: '80H' },
  { nome: 'Estágio Supervisionado em Clínica Integrada I', docente: '', ch: '480H' },
  { nome: 'Estágio Supervisionado em Clínica Integrada II', docente: '', ch: '480H' },
  // Disciplinas do curso de Serviço Social (sem docente)
  { nome: 'Oficina de Produção de Textos', docente: '', ch: '80H' },
  { nome: 'Realidade Social e Questões Contemporâneas', docente: '', ch: '60H' },
  { nome: 'Introdução aos Direitos Humanos e Cidadania', docente: '', ch: '80H' },
  { nome: 'Laboratório de Formação Profissional', docente: '', ch: '120H' },
  { nome: 'Formação Sócio Histórica do Brasil I', docente: '', ch: '80H' },
  { nome: 'Fundamentos Histórico, Teóricos e Metodologia do Serviço Social I', docente: '', ch: '80H' },
  { nome: 'Economia Social', docente: '', ch: '60H' },
  { nome: 'Formação Sócio Histórica do Brasil II', docente: '', ch: '60H' },
  { nome: 'Fundamentos Histórico, Teóricos e Metodologia do Serviço Social II', docente: '', ch: '80H' },
  { nome: 'Serviço Social e Projeto Ético - Político', docente: '', ch: '80H' },
  { nome: 'Pesquisa em Serviço Social I', docente: '', ch: '120H' },
  { nome: 'Estatística Social', docente: '', ch: '60H' },
  { nome: 'Fundamentos Histórico, Teóricos e Metodologia do Serviço Social III', docente: '', ch: '80H' },
  { nome: 'Serviço Social e Projeto de Trabalho I', docente: '', ch: '60H' },
  { nome: 'Política Social e Sistema de Proteção Social I (Seguridade Social)', docente: '', ch: '60H' },
  { nome: 'Pesquisa em Serviço Social II', docente: '', ch: '120H' },
  { nome: 'Política Social e Sistema de Proteção Social II (Saúde)', docente: '', ch: '60H' },
  { nome: 'Práticas Sociais I (Indivíduos e Famílias)', docente: '', ch: '60H' },
  { nome: 'Poder Local e Territorialidade', docente: '', ch: '60H' },
  { nome: 'Identidades Culturais e Serviço Social no Brasil', docente: '', ch: '120H' },
  { nome: 'Prática Social e Sistema de Proteção Social III (Assistência)', docente: '', ch: '60H' },
  { nome: 'Práticas Sociais II (Sujeitos Coletivos e Movimentos Sociais)', docente: '', ch: '60H' },
  { nome: 'Administração e Planejamento em Serviço Social', docente: '', ch: '60H' },
  { nome: 'Estágio Supervisionado I', docente: '', ch: '150H' },
  { nome: 'Política Social e Sistema de Proteção Social IV (Previdência)', docente: '', ch: '60H' },
  { nome: 'Gestão Social', docente: '', ch: '60H' },
  { nome: 'Educação Social', docente: '', ch: '60H' },
  { nome: 'Estágio Supervisionado II', docente: '', ch: '150H' },
  { nome: 'Tópicos Avançado em Serviço Social', docente: '', ch: '120H' },
  { nome: 'Estágio Supervisionado III', docente: '', ch: '150H' },
  // Disciplinas do curso de Sistema de Informação
  { nome: 'Comunicação', docente: 'JOSÉ NILTON SANTANA DOS SANTOS', ch: '70H' },
  { nome: 'Introdução a Ciência da Computação', docente: 'MARCELO RIBEIRO PASTORE', ch: '70H' },
  { nome: 'Inglês Técnico I', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '70H' },
  { nome: 'Lógica de Programação e Algoritmo', docente: 'MARCOS BATISTA FIGUEREDO', ch: '70H' },
  { nome: 'Matemática Básica da Computação', docente: 'CARLOS HENRIQUE RODRIGUES', ch: '60H' },
  { nome: 'Arquitetura de Computadores', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '70H' },
  { nome: 'Cálculo Diferencial e Integral I', docente: 'ADSON SAMPAIO MELO', ch: '70H' },
  { nome: 'Inglês Técnico II', docente: 'CÉSAR AUGUSTO ALFLEN FEIJÓ', ch: '70H' },
  { nome: 'Relações Humanas', docente: 'ANA CRISTINA CERQUEIRA', ch: '60H' },
  { nome: 'Técnicas e Linguagens de Programação I', docente: 'MARCELO RIBEIRO PASTORE', ch: '70H' },
  { nome: 'Contabilidade Geral', docente: 'MARCUS VINICIUS MENDES GOMES', ch: '70H' },
  { nome: 'Cálculo Diferencial e Integral II', docente: 'FRANCISCO CARLOS FERREIRA SOUTO', ch: '70H' },
  { nome: 'Estrutura de Dados', docente: 'MARCUS VINICIUS MENDES GOMES', ch: '70H' },
  { nome: 'Introdução à Economia', docente: 'MARCOS BATISTA FIGUEREDO', ch: '50H' },
  { nome: 'Probabilidade e Estatística', docente: 'ARIANE OLIVEIRA DA SILVA', ch: '60H' },
  { nome: 'Teoria Geral de Sistemas', docente: 'JOSE CARLOS ALVES PINHEIRO', ch: '70H' },
  { nome: 'Técnicas e Linguagens de Programação II', docente: 'MARCELO RIBEIRO PASTORE', ch: '70H' },
  { nome: 'Computador e Sociedade', docente: 'ANA CRISTINA CERQUEIRA', ch: '80H' },
  { nome: 'Evolução, Ideias Antropológicas, Políticas e Sociais', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '80H' },
  { nome: 'Metodologia do Estudo e da Pesquisa', docente: 'MARCELO RIBEIRO PASTORE', ch: '70H' },
  { nome: 'Sistemas de Informação', docente: 'KARINA RAMOS BARBOSA', ch: '80H' },
  { nome: 'Teoria Geral da Administração', docente: 'GILSON ALVES DOS SANTOS', ch: '70H' },
  { nome: 'Direito e Legislação', docente: 'ARIANE OLIVEIRA DA SILVA', ch: '70H' },
  { nome: 'Banco de Dados I', docente: 'PAULA GOIS LIMA', ch: '70H' },
  { nome: 'Computação Gráfica', docente: 'ARIANE OLIVEIRA DA SILVA', ch: '80H' },
  { nome: 'Sistemas Operacionais', docente: 'FRANCISLEI SANTA ANNA SANTOS', ch: '80H' },
  { nome: 'Analise e Projetos de Sistemas I', docente: 'ALEXANDRE CRUZ VAZ DA SILVA', ch: '70H' },
  { nome: 'Desenvolvimento Web com Banco de Dados', docente: 'ANDERSON CARVALHO PASSOS', ch: '70H' },
  { nome: 'Analise e Projetos de Sistemas II', docente: 'JONAS FERNANDES GUEDES N. MARQUES', ch: '70H' },
  { nome: 'Banco de Dados II', docente: 'CARLOS ANTÔNIO C. C. CALADO', ch: '70H' },
  { nome: 'Rede de Computadores', docente: 'LEONEL ARTUR FARIAS MARTINS', ch: '70H' },
  { nome: 'Sistemas Distribuídos', docente: 'FRANCISCO CEZAR FREIRE', ch: '70H' },
  { nome: 'Administração Gerência e Segurança de Redes', docente: 'PAULA GOIS LIMA', ch: '70H' },
  { nome: 'Elaboração e Gestão de Projetos', docente: 'SÉRGIO ANTÔNIO TAVARES PEDROSA', ch: '70H' },
  { nome: 'Engenharia de Software I', docente: 'ANDERSON SOUZA NEVES', ch: '70H' },
  { nome: 'Trabalho de Conclusão de Curso I', docente: 'PAULA GOIS LIMA', ch: '70H' },
  { nome: 'Estagio Supervisionado', docente: 'DIANA COUTO COELHO', ch: '300H' },
  { nome: 'Engenharia de Software II', docente: 'PAULA GOIS LIMA', ch: '70H' },
  { nome: 'Segurança e Auditoria de Sistemas', docente: 'MARCELO RIBEIRO PASTORE', ch: '70H' },
  { nome: 'Trabalho de Conclusão de Curso II', docente: 'PAULA GOIS LIMA', ch: '70H' },
  // Disciplinas do curso de Turismo
  { nome: 'Geografia I', docente: 'ADRIANO BITTENCOURT ANDRADE', ch: '60H' },
  { nome: 'História do Brasil', docente: 'ADEMAR OLIVEIRA CIRNE FILHO', ch: '60H' },
  { nome: 'Sociologia Aplicada ao Turismo', docente: 'CLOVIS M. SANTOS', ch: '60H' },
  { nome: 'Comunicação em Língua Portuguesa', docente: 'ABÍLIO MANOEL M. DE MENDONÇA', ch: '60H' },
  { nome: 'Metodologia Científica I', docente: 'CARLOS ALBERTO G. DE SÁ', ch: '60H' },
  { nome: 'Turismo I', docente: 'DJALMA JORGE DE S. NUNES', ch: '60H' },
  { nome: 'Metodologia Científica II', docente: 'CARLOS ALBERTO G. DE SÁ', ch: '60H' },
  { nome: 'Teoria Geral da Administração I', docente: 'ADRIANO MOITINHO', ch: '60H' },
  { nome: 'Geografia II', docente: 'CLÍMACO CÉSAR SIQUEIRA DIAS', ch: '60H' },
  { nome: 'História da Bahia', docente: 'ADEMAR OLIVEIRA CIRNE FILHO', ch: '60H' },
  { nome: 'Turismo II', docente: 'DJALMA JORGE DE S. NUNES', ch: '60H' },
  { nome: 'Manifestações Populares de Cultura', docente: 'ACÉRSIO PEREIRA ESTEVES', ch: '60H' },
  { nome: 'Informática Aplicada ao Turismo', docente: 'ALANO CASTRO FILHO', ch: '60H' },
  { nome: 'Agenciamento e Transporte', docente: 'EMILIA SALVADOR SILVA', ch: '60H' },
  { nome: 'Economia Aplicada ao Turismo', docente: 'ELIO', ch: '60H' },
  { nome: 'Turismo e Meio Ambiente', docente: 'ANDREZA VIANA CANTO', ch: '60H' },
  { nome: 'Direito', docente: 'ANTONIO AMARILIO', ch: '60H' },
  { nome: 'Inglês Técnico', docente: 'ADEMAR OLIVEIRA CIRNE FILHO', ch: '60H' },
  { nome: 'Patrimônio Turístico', docente: 'JUREMA HUGHES', ch: '60H' },
  { nome: 'Roteiros Turístico', docente: 'CINARA CARDOSO', ch: '60H' },
  { nome: 'Estatística Aplicada ao Turismo', docente: 'ANDREA CIRINO REZENDE', ch: '60H' },
  { nome: 'Recreação e Lazer', docente: 'ANDREZA VIANA CANTO', ch: '60H' },
  { nome: 'Psicologia das Relações Humanas', docente: 'ANA MARIA FREIRE SANTOS', ch: '60H' },
  { nome: 'Legislação Aplicada ao Turismo', docente: 'LUIS MANOEL DA CRUZ GAGO', ch: '60H' },
  { nome: 'Planejamento Turístico', docente: 'DJALMA JORGE DE S. NUNES', ch: '60H' },
  { nome: 'Administração de Recursos Humanos', docente: 'ANA MARIA SEIXAS PAMPONET', ch: '60H' },
  { nome: 'Organização de Eventos', docente: 'ANDREZA VIANA CANTO', ch: '60H' },
  { nome: 'Espanhol Técnico I', docente: 'CÍNTIA NÍCOLAS BASTOS ROCHA', ch: '60H' },
  { nome: 'Prática de Hospedagem I', docente: 'POLIANA CORNEAU', ch: '60H' },
  { nome: 'Projetos Turístico', docente: 'INEZ MARIA DANTAS A. GARRIDO', ch: '60H' },
  { nome: 'Administração Financeira e Contábil', docente: 'ELIO', ch: '60H' },
  { nome: 'Administração e Manutenção de Patrimônio', docente: 'ALBÉRICO CORREIA', ch: '60H' },
  { nome: 'Publicidade', docente: 'SIMONA GROPPER BERENSTEIN', ch: '60H' },
  { nome: 'Prática de Hospedagem II', docente: 'JALINE DOS SANTOS MENEZES', ch: '60H' },
  { nome: 'Inglês Técnico III', docente: 'ADEMAR OLIVEIRA CIRNE FILHO', ch: '60H' },
  { nome: 'Marketing Turístico', docente: 'SIMONA GROPPER BERENSTEIN', ch: '60H' },
  { nome: 'Relações Públicas', docente: 'DJALMA JORGE DE S. NUNES', ch: '60H' },
  { nome: 'Promoção de Vendas em Turismo', docente: 'SIMONA GROPPER BERENSTEIN', ch: '60H' },
  { nome: 'Inglês Técnico IV', docente: 'ADEMAR OLIVEIRA CIRNE FILHO', ch: '60H' },
  { nome: 'Projeto de Conclusão de Curso', docente: 'ANDREZA VIANA CANTO', ch: '60H' },
  // Disciplinas da FACIIP (Administração)
  { nome: 'Matemática', docente: 'JOSÉ NILTON SANTANA DOS SANTOS', ch: '60H' },
  { nome: 'Filosofia e Ética Profissional', docente: 'ALDIZETE SOUZA CARDOSO', ch: '60H' },
  { nome: 'Contabilidade Geral I', docente: 'ADELMO FERNANDO R. SCHINDLER JÚNIOR', ch: '60H' },
  { nome: 'Análise Leitura e Produção de Texto', docente: 'GERSON LUIS OLIVEIRA SANTOS', ch: '60H' },
  { nome: 'Sociologia', docente: 'AFRÂNIO MÁRCIA PINTO', ch: '60H' },
  { nome: 'Metodologia Científica', docente: 'ADRIANA PAULA DE C. MORBECK', ch: '60H' },
  { nome: 'Direito', docente: 'GRACIELE CARNEIRO LEAL', ch: '60H' },
  { nome: 'Fundamentos de Economia', docente: 'HEBERT DA SILVA SANTOS JÚNIOR', ch: '60H' },
  { nome: 'Informática', docente: 'CÉSAR AUGUSTO ALFLEN FEIJÓ', ch: '60H' },
  { nome: 'Estatística', docente: 'BRIOLÂNGIA BISPO DA CRUZ', ch: '60H' },
  { nome: 'Gestão com Pessoas', docente: 'MARIA TEREZA ALVES TEIXEIRA', ch: '60H' },
  { nome: 'Direito do Trabalho', docente: 'MIRIAM MENDONÇA BARRETO', ch: '60H' },
  { nome: 'Empreendedorismo e Desenvolvimento de Organizacional', docente: 'JAIME DE MOURA FERREIRA', ch: '60H' },
  { nome: 'Administração Financeira e Orçamentária', docente: 'ADRIANA PAULA DE C. MORBECK', ch: '60H' },
  { nome: 'Relações Internacionais', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'Gestão de Processos Organizacionais', docente: 'MIRIAM MENDONÇA BARRETO', ch: '60H' },
  { nome: 'Liderança e Comportamento Organizacional', docente: 'GRACIELE CARNEIRO LEAL', ch: '60H' },
  { nome: 'Sistema Integrado de Gestão', docente: 'CÉSAR AUGUSTO ALFLEN FEIJÓ', ch: '60H' },
  { nome: 'Negociação e Administração de Conflitos', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'Gestão Estratégica', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'Optativa I', docente: 'ADELMO FERNANDO R. SCHINDLER JÚNIOR', ch: '60H' },
  { nome: 'Administração Mercadológica I', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'Gestão Pública', docente: 'MARIA DAS GRAÇAS M. DE A. DOMINGUES', ch: '60H' },
  { nome: 'Gestão de Cooperativas e ONGS', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'Administração de Materias', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'Administração de Recursos Materiais - Optativa II', docente: 'ANA CRISTINA CERQUEIRA', ch: '60H' },
  { nome: 'Administração Mercadológica II', docente: 'DENISE ARAÚJO BRITTO', ch: '60H' },
  { nome: 'Pesquisa Operacional', docente: 'CÉSAR ERNESTO DETONI', ch: '60H' },
  { nome: 'Estágio Supervisionado I', docente: 'ADELMO FERNANDO R. SCHINDLER JÚNIOR', ch: '150H' },
  { nome: 'Trabalho de Conclusão de Curso I', docente: 'CRISTINA MASCARENHAS SANTOS', ch: '60H' },
  { nome: 'Optativa III', docente: 'ADRIANA ESTEVES GAMA NOVAES', ch: '60H' },
  { nome: 'Atividades Complementares', docente: '', ch: '300H' },
  { nome: 'Administração da Produção e Operações', docente: 'ANTONIO ARÃAS SOBRINHO', ch: '60H' },
  { nome: 'Processos e Soluções de Problemas', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'Estágio Supervisionado II', docente: 'TAÍS GUALBERTO DE ALMEIDA', ch: '150H' },
  { nome: 'Administração Contemporânea', docente: 'PAULA CRISTINA VASCONCELOS ARAÚJO', ch: '60H' },
  { nome: 'Trabalho de Conclusão de Curso II', docente: 'PAULA CRISTINA VASCONCELOS ARAÚJO', ch: '60H' },
  // Disciplinas da FACIIP (demais cursos)
  { nome: 'INFORMÁTICA APLICADA À ADMINISTRAÇÃO', docente: 'JOSÉ NILTON SANTANA DOS SANTOS', ch: '60H' },
  { nome: 'INTRODUÇÃO ÀS TEORIAS ECONÔMICAS', docente: 'ALDIZETE SOUZA CARDOSO', ch: '60H' },
  { nome: 'PSICOLOGIA APLICADA À ADMINISTRAÇÃO', docente: 'CÉSAR AUGUSTO ALFLEN FEIJÓ', ch: '60H' },
  { nome: 'INTRODUÇÃO A SOCIOLOGIA', docente: 'GRACIELE CARNEIRO LEAL', ch: '60H' },
  { nome: 'INTRODUÇÃO À FILOSOFIA', docente: 'AFRÂNIO MÁRCIA PINTO', ch: '60H' },
  { nome: 'TEORIA GERAL DA ADMINISTRAÇÃO II', docente: 'GRACIELE CARNEIRO LEAL', ch: '60H' },
  { nome: 'ECONOMIA BRASILEIRA', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'TEORIA DAS ORGANIZAÇÕES', docente: 'CÉSAR AUGUSTO ALFLEN FEIJÓ', ch: '60H' },
  { nome: 'ESTATÍSTICA I', docente: 'BRIOLÂNGIA BISPO DA CRUZ', ch: '60H' },
  { nome: 'DIREITO APLICADO', docente: 'MARIA TEREZA ALVES TEIXEIRA', ch: '60H' },
  { nome: 'ELEMENTOS E ANÁLISE DE CUSTOS', docente: 'JAIME DE MOURA FERREIRA', ch: '60H' },
  { nome: 'CIÊNCIA POLÍTICA', docente: 'ANA MARIA FREIRE SANTOS', ch: '60H' },
  { nome: 'ESTATÍSTICA II', docente: 'JAIME DE MOURA FERREIRA', ch: '60H' },
  { nome: 'ORGANIZAÇÃO SISTEMA E MÉTODOS', docente: 'ANA MARIA FREIRE SANTOS', ch: '60H' },
  { nome: 'ADM. DE RECURSOS MATERIAIS E PATRIMONIAIS I', docente: 'ADRIANA PAULA DE C. MORBECK', ch: '60H' },
  { nome: 'SAÚDE E SOCIEDADE', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'ELABORAÇÃO E ANÁLISE DE PROGRAMAS E PROJETOS', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'ADMINISTRAÇÃO DE RECURSOS HUMANOS I', docente: 'CÉSAR AUGUSTO ALFLEN FEIJÓ', ch: '60H' },
  { nome: 'ADMINISTRAÇÃO FINANCEIRA E ORÇAMENTÁRIA I', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'ADMINISTRAÇÃO DE RECURSOS MATERIAIS E PATRIMONIAIS II', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'ADMINISTRAÇÃO DA PRODUÇÃO E OPERAÇÕES I', docente: 'JAIME DE MOURA FERREIRA', ch: '60H' },
  { nome: 'POLÍTICA E ORGANIZAÇÃO DOS SERVIÇOS DE SAÚDE', docente: 'ANA MARIA FREIRE SANTOS', ch: '60H' },
  { nome: 'ADMINISTRAÇÃO DE RECURSOS HUMANOS II', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'ADMINISTRAÇÃO FINANCEIRA E ORÇAMENTÁRIA II', docente: 'MARIA DAS GRAÇAS M. DE A. DOMINGUES', ch: '60H' },
  { nome: 'ADMINISTRAÇÃO DA PRODUÇÃO E OPERAÇÕES II', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'ADMINISTRAÇÃO DE SISTEMAS DE INFORMAÇÃO I', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'INSTRUMENTOS DO MARKETING', docente: 'ANA CRISTINA CERQUEIRA', ch: '60H' },
  { nome: 'PROGRAMA E AVALIAÇÃO DOS SERVIÇOS DE SAÚDE', docente: 'CÉSAR AUGUSTO ALFLEN FEIJÓ', ch: '60H' },
  { nome: 'ADMINISTRAÇÃO DE SISTEMAS DE INFORMAÇÃO II', docente: 'DENISE ARAÚJO BRITTO', ch: '60H' },
  { nome: 'PESQUISA APLICADA', docente: 'CÉSAR ERNESTO DETONI', ch: '60H' },
  { nome: 'VIGILÂNCIA E SAÚDE', docente: 'ADELMO FERNANDO R. SCHINDLER JÚNIOR', ch: '150H' },
  { nome: 'TÓPICOS AVANÇADOS DA ADMINISTAÇÃO HOSPITALAR I', docente: 'CRISTINA MASCARENHAS SANTOS', ch: '60H' },
  { nome: 'TÓPICOS AVANÇADOS DA ADMINISTAÇÃO HOSPITALAR II', docente: 'CRISTINA MASCARENHAS SANTOS', ch: '60H' },
  { nome: 'GESTÃO DE SERVIÇOS DE APOIO ADMINISTRATIVO', docente: 'ANTONIO ARÃAS SOBRINHO', ch: '60H' },
  { nome: 'GESTÃO DE SERVIÇOS INTERMEDIÁRIOS', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'GESTÃO DE SERVIÇOS ASSISTENCIAIS', docente: 'TAÍS GUALBERTO DE ALMEIDA', ch: '150H' },
  { nome: 'Comunicação e Língua Portuguesa I', docente: 'VALMENIA ANGELICA SANTOS GOMES DE MIRANDA', ch: '60H' },
  { nome: 'História da Comunicação', docente: 'MATILDE EUGÊNIA SCHNITMAN', ch: '60H' },
  { nome: 'Introdução a Fotografia', docente: 'ALEX CONTREIRAS ROSIER', ch: '60H' },
  { nome: 'Filosofia', docente: 'MARIA TEREZA ALVES TEIXEIRA', ch: '60H' },
  { nome: 'Comunicação e Língua Portuguesa II', docente: 'KARINA RAMOS BARBOSA', ch: '60H' },
  { nome: 'Teoria da Comunicação', docente: 'CINTIA MORENO MORAES', ch: '60H' },
  { nome: 'Introdução à Imagem e Som', docente: 'LARISSA IVO RAMOS', ch: '60H' },
  { nome: 'Legislação e Ética', docente: 'MATILDE EUGÊNIA SCHNITMAN', ch: '60H' },
  { nome: 'Introdução ao Marketing, Publicidade e Propaganda', docente: 'EDER LUIS CORDEIRO DE SANTANA', ch: '60H' },
  { nome: 'História da Arte e Antropologia', docente: 'CARLOS EDUARDO CARVALHO DE SANTANA', ch: '60H' },
  { nome: 'Comunicação Comunitária', docente: 'CINTIA MORENO MORAES', ch: '60H' },
  { nome: 'Planejamento em Comunicação', docente: 'ISABELA ARAGÃO MORAES', ch: '60H' },
  { nome: 'Teoria e Método de Pesquisa de Opinião Pública', docente: 'DIANA COUTO COELHO', ch: '60H' },
  { nome: 'Comunicação Comparada', docente: 'CINTIA MORENO MORAES', ch: '60H' },
  { nome: 'Redação e Expressão Oral', docente: 'KARINA RAMOS BARBOSA', ch: '60H' },
  { nome: 'Produção Gráfica', docente: 'ALEX CONTREIRAS ROSIER', ch: '60H' },
  { nome: 'Estratégia de Marketing', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'Administração e Assessoria em Relações Públicas', docente: 'GEORGE DE CARVALHO AFONSO', ch: '60H' },
  { nome: 'Mídia', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'Criação e Produção de Campanha', docente: 'GEORGE DE CARVALHO AFONSO', ch: '60H' },
  { nome: 'Oficina de Eventos', docente: 'ISABELA ARAGÃO MORAES', ch: '80H' },
  { nome: 'Produção de Multimeios', docente: 'HANAYANA BRANDÃO GUIMARÃES FONTES LIMA', ch: '60H' },
  { nome: 'Marketing de Relacionamentos', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'Técnicas de Comunicação Dirigida', docente: 'PATRÍCIA LINS CERQUEIRA R. BARBOSA', ch: '60H' },
  { nome: 'Planejamento em Relações Públicas', docente: 'GEORGE DE CARVALHO AFONSO', ch: '60H' },
  { nome: 'Assessoria de Imprensa', docente: 'ISABELA ARAGÃO MORAES', ch: '80H' },
  { nome: 'Comunicação Empresarial', docente: 'GEORGE DE CARVALHO AFONSO', ch: '60H' },
  { nome: 'Gestão de Empresas de Comunicação', docente: 'ISABELA ARAGÃO MORAES', ch: '60H' },
  { nome: 'Seminário de Relações Públicas', docente: 'GEORGE DE CARVALHO AFONSO', ch: '60H' },
  { nome: 'Projeto Experimental', docente: 'CINTIA MORENO MORAES', ch: '60H' },
  { nome: 'COMUNICAÇÃO E LINGUA PORTUGUESA', docente: 'KARINA RAMOS BARBOSA', ch: '60H' },
  { nome: 'CONTABILIDADE GERAL II', docente: 'UBIRAJARA BOMFIM VIGAS', ch: '60H' },
  { nome: 'TEORIA DA CONTABILIDADE', docente: 'ELISEU ALVES TEIXEIRA', ch: '60H' },
  { nome: 'CONTABILIDADE INTERMEDIÁRIA', docente: 'AHIRAM CARDOSO SILVA LIMA', ch: '60H' },
  { nome: 'SISTEMA DE INFORMAÇÕES CONTÁBEIS', docente: 'CÉSAR AUGUSTO ALFLEN FEIJÓ', ch: '60H' },
  { nome: 'CONTABILIDADE DE CUSTOS', docente: 'RENILSON ROBERTO SANTOS', ch: '60H' },
  { nome: 'ANALISTA DE PROJETOS E ORÇAMENTO EMPRESARIAL', docente: 'ELISEU ALVES TEIXEIRA', ch: '60H' },
  { nome: 'CONTABILIDADE DAS INSTITUIÇÕES FINANCEIRAS', docente: 'ELISEU ALVES TEIXEIRA', ch: '60H' },
  { nome: 'LABORATÓRIO CONTÁBIL I', docente: 'TÂNIA REGINA PINTO SOUSA', ch: '60H' },
  { nome: 'LEGISLAÇÃO COMERCIAL E TRIBUTÁRIA', docente: 'UBALDINO VIEIRA LEITE FILHO', ch: '60H' },
  { nome: 'CONTABILIDADE APLICADA AO SETOR PÚBLICO', docente: 'UBIRAJARA BOMFIM VIGAS', ch: '60H' },
  { nome: 'APURAÇÃO E ANÁLISE DE CUSTOS', docente: 'RENILSON ROBERTO SANTOS', ch: '60H' },
  { nome: 'EMPREENDEDORISMO E DESENVOLVIMENTO DE NEGÓCIOS', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'LABORATÓRIO CONTÁBIL II', docente: 'CLAUDIO LUIS LIMA DOS SANTOS', ch: '60H' },
  { nome: 'LEGISLAÇÃO TRABALHISTA E PREVIDENCIÁRIA', docente: 'SELMO ALVES DOS SANTOS JUNIOR', ch: '60H' },
  { nome: 'ANÁLISE DAS DEMONSTRAÇÕES CONTÁBEIS', docente: 'TÂNIA REGINA PINTO SOUSA', ch: '60H' },
  { nome: 'CONTABILIDADE AVANÇADA', docente: 'AHIRAM CARDOSO SILVA LIMA', ch: '60H' },
  { nome: 'RESPONSABILIDADE SOCIAL E AMBIENTAL - ELETIVA', docente: 'LUIS ANDRÉ DE AGUIAR ALVES', ch: '60H' },
  { nome: 'PROJETO DE PESQUISA EM CONTABILIDADE', docente: 'DIANA COUTO COELHO', ch: '60H' },
  { nome: 'CONTROLADORIA', docente: 'RENILSON ROBERTO SANTOS', ch: '60H' },
  { nome: 'CONTABILIDADE APLICADA - ELETIVA', docente: 'RENILSON ROBERTO SANTOS', ch: '150H' },
  { nome: 'SIMULAÇÕES EMPRESARIAIS', docente: 'TÂNIA REGINA PINTO SOUSA', ch: '60H' },
  { nome: 'AUDITORIA CONTÁBIL', docente: 'RENILSON ROBERTO SANTOS', ch: '60H' },
  { nome: 'PERÍCIA, ARBITRAGEM E MEDIAÇÃO CONTÁBIL', docente: 'CLAUDIO LUIS LIMA DOS SANTOS', ch: '60H' },
  { nome: 'CONTABILIDADE AMBIENTAL', docente: 'JOSÉ NILTON SANTANA DOS SANTOS', ch: '300H' },
  { nome: 'CONTABILIDADE INTERNACIONAL', docente: 'CLAUDIO LUIS LIMA DOS SANTOS', ch: '60H' },
  { nome: 'EDUCAÇÃO FÍSICA E SAÚDE COLETIVA - ELETIVA', docente: 'GERSON LUIS OLIVEIRA SANTOS', ch: '150H' },
  { nome: 'MONOGRAFIA', docente: 'EDIMAR CAETIÉ JÚNIOR', ch: '60H' },
  { nome: 'FUNDAMENTOS DA MATEMÁTICA', docente: 'JOSÉ NILTON SANTANA DOS SANTOS', ch: '60H' },
  { nome: 'CÁLCULO I', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '80H' },
  { nome: 'FÍSICA TEORICA E EXPERIMENTAL', docente: 'MARCOS BATISTA FIGUEREDO', ch: '80H' },
  { nome: 'INTRODUÇÃO A ENGENHARIA DE PRODUÇÃO', docente: 'CARLOS HENRIQUE RODRIGUES', ch: '40H' },
  { nome: 'ALGEBRA', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '60H' },
  { nome: 'CÁLCULO II', docente: 'ADSON SAMPAIO MELO', ch: '80H' },
  { nome: 'INTRODUÇÃO A PROGRAMAÇÃO NA ENGENHARIA', docente: 'CÉSAR AUGUSTO ALFLEN FEIJÓ', ch: '60H' },
  { nome: 'METODOLOGIA DA PESQUISA CIÊNTIFICA I', docente: 'ANA CRISTINA CERQUEIRA', ch: '60H' },
  { nome: 'FÍSICA TEORICA E EXPERIMENTAL I', docente: 'MARCELO RIBEIRO PASTORE', ch: '80H' },
  { nome: 'CÁLCULO III', docente: 'FRANCISCO CARLOS FERREIRA SOUTO', ch: '80H' },
  { nome: 'DESENHO TÉCNICO', docente: 'MARCUS VINICIUS MENDES GOMES', ch: '80H' },
  { nome: 'QUÍMICA TEORICA E EXPERIMENTAL', docente: 'ARIANE OLIVEIRA DA SILVA', ch: '80H' },
  { nome: 'FÍSICA TEORICA E EXPERIMENTAL II', docente: 'JOSE CARLOS ALVES PINHEIRO', ch: '60H' },
  { nome: 'CÁLCULO IV', docente: 'LICIA SILVA DE OLIVEIRA VIGAS', ch: '60H' },
  { nome: 'ELETRICIDADE APLICADA', docente: 'MARCELO RIBEIRO PASTORE', ch: '60H' },
  { nome: 'MATERIAIS DE CONSTRUÇÃO MECÂNICA', docente: 'GILSON ALVES DOS SANTOS', ch: '60H' },
  { nome: 'PROCESSO DE FABRICAÇÃO A', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'TERMODINÂMICA APLICADA', docente: 'FRANCISLEI SANTA ANNA SANTOS', ch: '80H' },
  { nome: 'MECANICA DOS SÓLIDOS', docente: 'ALEXANDRE CRUZ VAZ DA SILVA', ch: '60H' },
  { nome: 'MÁQUINAS DE FLUXO', docente: 'ANDERSON CARVALHO PASSOS', ch: '60H' },
  { nome: 'PROCESSO DE FABRICAÇÃO B', docente: 'JONAS FERNANDES GUEDES N. MARQUES', ch: '60H' },
  { nome: 'CONTROLES ESTATÍSTICO DE PROCESSOS', docente: 'LEONEL ARTUR FARIAS MARTINS', ch: '60H' },
  { nome: 'ELEMENTOS DE MÁQUINAS', docente: 'LOURDES APARECIDA RIBEIRO RODRIGUES', ch: '60H' },
  { nome: 'MÁQUINAS TÉRMICAS', docente: 'FRANCISCO CEZAR FREIRE', ch: '60H' },
  { nome: 'METROLOGIA INDUSTRIAL', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'MANUTENÇÃO INDUSTRIAL E LOGÍSTICA', docente: 'SÉRGIO ANTÔNIO TAVARES PEDROSA', ch: '60H' },
  { nome: 'SISTEMAS PRODUTIVOS MECÂNICOS', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'RESPONSABILIDADE SOCIAL E AMBIENTAL', docente: 'DIANA COUTO COELHO', ch: '60H' },
  { nome: 'FUNDAMENTOS DA ECONOMIA', docente: 'CLAUDIO LUIS LIMA DOS SANTOS', ch: '60H' },
  { nome: 'PLANEJAMENTO E CONTROLE DA PRODUÇÃO', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'SISTEMA HIDRÁULICO E PNEUMÁTICOS', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'GESTÃO ECONÔMICA', docente: 'JOSÉ NILTON SANTANA DOS SANTOS', ch: '60H' },
  { nome: 'SISTEMA DE GESTÃO DE QUALIDADE', docente: 'MICHELL THOMP FERREIRA DA MATA', ch: '60H' },
  { nome: 'TÓPICOS EMERGENTES ELETIVA – OPTATIVA I', docente: 'ADELMO FERNANDO R. SCHINDLER JÚNIOR', ch: '60H' },
  { nome: 'PROJETO DE PRODUTO', docente: 'PAULO INACIO PRYSTON DE MELLO', ch: '60H' },
  { nome: 'PROJETO DE FÁBRICA', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'AUTOMAÇÃO INDUSTRIAL', docente: 'PAULA GOIS LIMA', ch: '60H' },
  { nome: 'SISTEMA DE GESTÃO AMBIENTAL', docente: 'MARIA TEREZA ALVES TEIXEIRA', ch: '60H' },
  { nome: 'CONTABILIDADE GERENCIAL - ELETIVA – OPTATIVA II', docente: 'ANA PAULA TAVARES SILVA', ch: '60H' },
  { nome: 'GESTÃO ESTRATÉGICA DA PRODUÇÃO', docente: 'FLAVIO DINIZ FONTES', ch: '60H' },
  { nome: 'CUSTOS INDUSTRIAIS', docente: 'GERSON FERREIRA JUNIOR', ch: '60H' },
  { nome: 'GESTÃO DE PROJETOS', docente: 'MARCELO RIBEIRO PASTORE', ch: '60H' },
  { nome: 'MATEMÁTICA FINANCEIRA – OPTATIVA III', docente: 'ANA CRISTINA CERQUEIRA', ch: '60H' },
  { nome: 'Fundamento da Comunicação', docente: 'MATILDE EUGÊNIA SCHNITMAN', ch: '60H' },
  { nome: 'Introdução ao Marketing Publicidade e Propaganda', docente: 'ALEX CONTREIRAS ROSIER', ch: '60H' },
  { nome: 'Comunicação Integrada', docente: 'BRIOLÂNGIA BISPO DA CRUZ', ch: '60H' },
  { nome: 'Fundamento da Economia', docente: 'KARINA RAMOS BARBOSA', ch: '60H' },
  { nome: 'Antropologia', docente: 'ISABELA ARAGÃO MORAES', ch: '60H' },
  { nome: 'Semiótica', docente: 'MARIA MARCIA PEREIRA', ch: '60H' },
  { nome: 'História da Cultura Indígena e Afro Brasileira', docente: 'ANA CRISTINA CERQUEIRA', ch: '60H' },
  { nome: 'Técnicas de Reportagem', docente: 'CARLOS EDUARDO CARVALHO DE SANTANA', ch: '60H' },
  { nome: 'Sociedade Cultural e Tecnologia', docente: 'BRIOLÂNGIA BISPO DA CRUZ', ch: '60H' },
  { nome: 'Fotojornalismo', docente: 'DIANA COUTO COELHO', ch: '60H' },
  { nome: 'Teoria e História do Jornalismo', docente: 'CINTIA MORENO MORAES', ch: '60H' },
  { nome: 'Planejamento Gráfico e Editoração Eletrônica', docente: 'CARLOS EDUARDO CARVALHO DE SANTANA', ch: '60H' },
  { nome: 'Radiojornalismo I', docente: 'DIANA COUTO COELHO', ch: '60H' },
  { nome: 'Telejornalismo I', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'Pesquisa e Opinião Pública', docente: 'GEORGE DE CARVALHO AFONSO', ch: '60H' },
  { nome: 'Oficina de Jornalismo Impresso I', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'Estética', docente: 'ALEX CONTREIRAS ROSIER', ch: '60H' },
  { nome: 'Web Jornalismo I', docente: 'GEORGE DE CARVALHO AFONSO', ch: '60H' },
  { nome: 'Jornalismo Especializado', docente: 'ISABELA ARAGÃO MORAES', ch: '60H' },
  { nome: 'Oficina de Jornalismo Impresso II', docente: 'HANAYANA BRANDÃO GUIMARÃES FONTES LIMA', ch: '60H' },
  { nome: 'Telejornalismo II', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'Radiojornalismo II', docente: 'PATRÍCIA LINS CERQUEIRA R. BARBOSA', ch: '60H' },
  { nome: 'Legislação e Ética em Comunicação', docente: 'ISABELA ARAGÃO MORAES', ch: '60H' },
  { nome: 'Empreendedorismo e Gestão da Comunicação', docente: 'GEORGE DE CARVALHO AFONSO', ch: '60H' },
  { nome: 'Web Jornalismo II', docente: 'ISABELA ARAGÃO MORAES', ch: '60H' },
  { nome: 'Imagem, Gerenciamento de Crise e Média Training', docente: 'CINTIA MORENO MORAES', ch: '60H' },
  { nome: 'Gêneros Jornalistico', docente: 'VICENTE DE PAULO QUEIROZ PERRONI', ch: '60H' },
  { nome: 'Comunicação e Novas Mídias', docente: 'GEORGE DE CARVALHO AFONSO', ch: '60H' },
  { nome: 'Comunicação e Realidade Internacional', docente: 'ISABELA ARAGÃO MORAES', ch: '60H' },
  { nome: 'Atividade Complementar', docente: '', ch: '260H' },
  { nome: 'Língua Portuguesa (Gramática Básica, Leitura e Interpretação de Textos)', docente: 'FERNANDO ANTÔNIO VASCONCELOS FROTA', ch: '60H' },
  { nome: 'História da Educação', docente: 'MARIA ELIELZA DOS SANTOS', ch: '60H' },
  { nome: 'Psicologia da Educação do Desenvolvimento e da Aprendizagem', docente: 'VILMA ALVES DA SILVA', ch: '60H' },
  { nome: 'Didática Geral', docente: 'JUSSARA REGINA DE SOUZA LISBOA', ch: '60H' },
  { nome: 'Ambientação Acadêmica (EAD)', docente: 'HELENA BARBACENA DE SOUZA', ch: '60H' },
  { nome: 'Literatura Infantil, Juvenil e Genêros Textuais', docente: 'VILMA ALVES DA SILVA', ch: '60H' },
  { nome: 'Organização e Gestão do Trabalho Pedagógico I', docente: 'ALESSANDRA GUEDES RIBEIRO COZZA DE MIRANDA', ch: '60H' },
  { nome: 'Filosofia da Educação', docente: 'MARIA ELIELZA DOS SANTOS', ch: '60H' },
  { nome: 'Língua Brasileira de Sinais - Libras', docente: 'ALYNE DAYANE PACIFICO SOUSA', ch: '60H' },
  { nome: 'Praticas de Ensino e Criatividade', docente: 'FERNANDO ANTÔNIO VASCONCELOS FROTA', ch: '80H' },
  { nome: 'Sociedade, Ética, Cidadania e Direitos Humanos (EAD)', docente: 'UVERLAND BARROS DA SILVA', ch: '60H' },
  { nome: 'Organização e Gestão do Trabalho Pedagógico II', docente: 'MARIA ELIELZA DOS SANTOS', ch: '60H' },
  { nome: 'Pedagogia da Educação Infantil', docente: 'ALEX LEONARDO RIBEIRO', ch: '60H' },
  { nome: 'Práticas de Ensino na Educação Infantil', docente: 'MARIA APARECIDA PEIXOTO SOARES', ch: '80H' },
  { nome: 'Diversidade e Acessibilidade (Educação Étnico-Racial e Cultura Afrodescendente)', docente: 'CINTHIA DA CUNHA BARBOSA', ch: '60H' },
  { nome: 'Estágio Curricular Supervisionado na Educação Infantil - I', docente: 'VANESSA DE CARVALHO PEDRA', ch: '100H' },
  { nome: 'Filosofia para Crianças e Adolescentes', docente: 'MARIA DO SOCORRO BEZERRA DA SILVA', ch: '60H' },
  { nome: 'Ensino na Educação Inclusiva: Conteúdos e Orientações', docente: 'MARIA APARECIDA PEIXOTO SOARES', ch: '60H' },
  { nome: 'Práticas na Educação Inclusiva e Dificuldades de Aprendizagem', docente: 'ALESSANDRA GUEDES RIBEIRO COZZA DE MIRANDA', ch: '80H' },
  { nome: 'Tecnologias e Multimeios na Educação', docente: 'WELLINGTON JONATHAN DE SOUZA RODRIGUES', ch: '60H' },
  { nome: 'Gestão Ambiental e Responsabilidade Social.', docente: 'MARCUS ANDRÉ NERY', ch: '60H' },
  { nome: 'Alfabetização e Letramento: Conteúdos e Orientações', docente: 'VILMA ALVES DA SILVA', ch: '60H' },
  { nome: 'Estágio Curricular Supervisionado na Educação Infantil - II', docente: 'ROSIMERE CALAÇA MARQUES', ch: '70H' },
  { nome: 'Ensino Lógico-Matemático: Conteúdos e Orientações', docente: 'VILMA ALVES DA SILVA', ch: '60H' },
  { nome: 'Ensino das Linguagens - Conteúdos e Orientações', docente: 'DAYSE BENIGNA BERNARDO ARAUJO GOMES', ch: '60H' },
  { nome: 'Ensino de Artes e Expressões Artística: Conteúdos e Orientações', docente: 'CINTHIA DA CUNHA BARBOSA', ch: '60H' },
  { nome: 'Ensino das Ciências Físicas e Biológicas: Conteúdos e Orientações', docente: 'MARIA APARECIDA PEIXOTO SOARES', ch: '60H' },
  { nome: 'Ensino de Geografia e História - Conteúdos e Orientações', docente: 'MARIA ELIELZA DOS SANTOS', ch: '60H' },
  { nome: 'Currículo (EAD)', docente: 'RAIMUNDO NONATO SILVA DAMASCENO JÚNIOR', ch: '60H' },
  { nome: 'Práticas de Ensino no Ensino Fundamental I', docente: 'MARIA APARECIDA PEIXOTO SOARES', ch: '80H' },
  { nome: 'Ensino Bilingue no Contexto das Escolas Brasileiras', docente: 'GEORGE FELINTO DA SILVA', ch: '60H' },
  { nome: 'Práticas Bilingues', docente: 'JACKSON PEDRO VERAS', ch: '80H' },
  { nome: 'Andragogia (EAD)', docente: 'ALESSANDRA GUEDES RIBEIRO COZZA DE MIRANDA', ch: '60H' },
  { nome: 'Estágio Curricular Supervisionado no Ensino Fundamental - I', docente: 'ALESSANDRA GUEDES RIBEIRO COZZA DE MIRANDA', ch: '100H' },
  { nome: 'Educação de Jovens e Adultos: Conteúdos e Orientações', docente: 'JACKSON PEDRO VERAS', ch: '60H' },
  { nome: 'Práticas de Ensino em Classes de Adultos - EJA', docente: 'ANA CLAUDIA RODRIGUES FERNANDES', ch: '80H' },
  { nome: 'Metodologia Científica II- Pré Projeto de Trabalho de Conclusão de Curso', docente: 'JUSSARA REGINA DE SOUZA LISBOA', ch: '60H' },
  { nome: 'Optativa II', docente: 'MARCUS ANDRÉ NERY', ch: '60H' },
  { nome: 'Estágio Curricular Supervisionado no Ensino Fundamental - II', docente: 'VILMA ALVES DA SILVA', ch: '70H' },
  { nome: 'Gestão Educacional e Escolar (EAD)', docente: 'ANA ELISA DE CARLI BLACKMAN', ch: '60H' },
  { nome: 'Práticas Avaliativas', docente: 'FABIANE REGINA GERALDES MOREIRA MARQUES', ch: '80H' },
  { nome: 'Empregabilidade - Tópicos Especiais', docente: 'ALESSANDRA GUEDES RIBEIRO COZZA DE MIRANDA', ch: '60H' },
  { nome: 'Trabalho de Conclusão de Curso - TCC', docente: 'JUSSARA REGINA DE SOUZA LISBOA', ch: '80H' },
  { nome: 'Estágio em Gestão Educacional e Escolar', docente: 'ALESSANDRA GUEDES RIBEIRO COZZA DE MIRANDA', ch: '60H' },
  { nome: 'INTRODUÇÃO AO DIREITO I', docente: 'BRIOLÂNGIA BISPO DA CRUZ', ch: '60H' },
  { nome: 'AGENCIAMENTO E TRANSPORTES', docente: 'MARIA TEREZA ALVES TEIXEIRA', ch: '60H' },
  { nome: 'INFORMÁTICA APLICADA AO TURISMO I', docente: 'CARLOS EDUARDO C. DE SANTANA', ch: '60H' },
  { nome: 'ROTEIROS TURISTICOS', docente: 'ANA MARIA FREIRE SANTOS', ch: '60H' },
  { nome: 'INTRODUÇÃO AO DIREITO II', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'PLANEJAMENTO TURISTICO I', docente: 'GRACIELE CARNEIRO LEAL', ch: '60H' },
  { nome: 'HOTELARIA I', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'PRATICA DE HOSPEDAGEM', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'PLANEJAMENTO TURÍSTICO II', docente: 'MARIA DAS GRAÇAS M. DE A. DOMINGUES', ch: '60H' },
  { nome: 'HOTELARIA II', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'PROJETOS TURÍSTICOS', docente: 'CÉSAR ERNESTO DETONI', ch: '60H' },
  { nome: 'PROMOÇÃO DE VENDAS EM TURISMO E HORTELARIA', docente: 'ADRIANA ESTEVES GAMA NOVAES', ch: '60H' },
  { nome: 'ALIMENTOS E BEBIDAS I', docente: 'JOSÉ DOMINGOS LAMBOGLIA COSTA', ch: '60H' },
  { nome: 'PLANEJAMENTO DE DESENVOLVIMENTO DE HOTEIS', docente: 'ANTERO PAULO F. DE SOUZA FILHO', ch: '60H' },
  { nome: 'ALIMENTOS E BEBIDAS II', docente: 'TAÍS GUALBERTO DE ALMEIDA', ch: '150H' },
  { nome: 'PRÁTICA DE ALIMENTOS E BEBIDAS', docente: 'PAULA CRISTINA VASCONCELOS ARAÚJO', ch: '60H' },
  // Disciplinas da FATECE (Pedagogia e Teologia)
  { nome: 'Alfabetização e Letramento', docente: 'MARIA HELENA SILVA', ch: '80H' },
  { nome: 'Atividades Práticas Supervisionadas', docente: 'SÉRGIO LOPES', ch: '80H' },
  { nome: 'Avaliação Educacional', docente: 'CINTHIA ALVES', ch: '80H' },
  { nome: 'Ciências Sociais', docente: 'MARCELO ABRÃO', ch: '80H' },
  { nome: 'Conteúdos de Matemática Para O Ensino Fundamental', docente: 'MARIA HELENA SILVA', ch: '80H' },
  { nome: 'Didática E Metodologia Do Ensino Médio', docente: 'JOAO CARLOS SOBREIRO', ch: '80H' },
  { nome: 'Didática Fundamental', docente: 'PEDRO GUSTAVO', ch: '80H' },
  { nome: 'Educação Ambiental', docente: 'ROBERTO MOREIRA', ch: '80H' },
  { nome: 'Educação Inclusiva', docente: 'ROBERTO MOREIRA', ch: '80H' },
  { nome: 'Escola Currículo e Cultura', docente: 'CASSIA BORGES', ch: '80H' },
  { nome: 'Estrutura e Organização da Escola De Educação Infantil', docente: 'GUSTAVO SIQUEIRA', ch: '80H' },
  { nome: 'Estudo Disciplinares', docente: 'GUSTAVO SIQUEIRA', ch: '80H' },
  { nome: 'Filosofia, Comunicação e Ética', docente: 'FLORA CAMPOS', ch: '80H' },
  { nome: 'Gestão Educacional', docente: 'MARIA GORETE BRITO', ch: '80H' },
  { nome: 'História do Pensamento Filosófico', docente: 'VALTER DE PAULA', ch: '80H' },
  { nome: 'Homem e Sociedade', docente: 'VALTER DE PAULA', ch: '80H' },
  { nome: 'Interpretação E Produção De Textos', docente: 'VALTER DE PAULA', ch: '80H' },
  { nome: 'Metodologia de Arte E Movimento: Corporeidade', docente: 'LUZIA PACHECO', ch: '80H' },
  { nome: 'Metodologia e Prática Do Ensino Da Matemática', docente: 'LUIZ VIDAL', ch: '80H' },
  { nome: 'Metodologia do Trabalho Acadêmico', docente: 'LUIZ VIDAL', ch: '80H' },
  { nome: 'Metodologia e Prática Do Ensino Da História', docente: 'PATRÍCIA SILVA', ch: '80H' },
  { nome: 'Método de Pesquisas', docente: 'ANDRÉ NASCIMENTO', ch: '80H' },
  { nome: 'Orientação e Prática de Projetos Na Infância', docente: 'MARIA HELENA SILVA', ch: '80H' },
  { nome: 'Pedagogia Integrada', docente: 'JOAO CARLOS SOBREIRO', ch: '80H' },
  { nome: 'Pedagogia Interdisciplinar', docente: 'SÉRGIO LOPES', ch: '80H' },
  { nome: 'Política e Organização da Educação Básica', docente: 'SÉRGIO LOPES', ch: '80H' },
  { nome: 'Projetos e Práticas de Ação Pedagógica', docente: 'SÉRGIO LOPES', ch: '80H' },
  { nome: 'Psicologia Construtiva', docente: 'GUSTAVO SIQUEIRA', ch: '80H' },
  { nome: 'Relações Étnico-Raciais No Brasil', docente: 'ROBERTO MOREIRA', ch: '80H' },
  { nome: 'Sociologia e Educação', docente: 'ROBERTO MOREIRA', ch: '80H' },
  { nome: 'Tópicos de Atuação Profissional - Pedagogia', docente: 'JOAO CARLOS SOBREIRO', ch: '80H' },
  { nome: 'Pensamento Científico', docente: 'PEDRO GUSTAVO', ch: '80H' },
  { nome: 'Projeto de Ensino', docente: 'JOÃO SOUZA', ch: '80H' },
  { nome: 'Psicologia da Educação e Aprendizagem', docente: 'MARIA HELENA SILVA', ch: '80H' },
  { nome: 'Sociologia da Educação', docente: 'JOAO CARLOS SOBREIRO', ch: '80H' },
  { nome: 'Antigo Testamento - Históricos e Proféticos', docente: 'MARIA HELENA SILVA', ch: '40H' },
  { nome: 'Ética, Cidadania e Responsabilidade Social', docente: 'JOÃO CARLOS SOBREIRO', ch: '40H' },
  { nome: 'Gestão e Liderança', docente: 'SÉRGIO LOPES', ch: '40H' },
  { nome: 'História da Religião', docente: 'CINTHIA ALVES', ch: '40H' },
  { nome: 'História do Cristianismo - Antigo E Medieval', docente: 'MARCELO ABRÃO', ch: '40H' },
  { nome: 'Homilética', docente: 'PEDRO GUSTAVO', ch: '40H' },
  { nome: 'Teologia da Moral e da Família', docente: 'FAUSTO BARROS', ch: '40H' },
  { nome: 'Antigo Testamento - Pentateuco e Poético', docente: 'MARIA HELENA SILVA', ch: '40H' },
  { nome: 'História e Missão - Israel', docente: 'PEDRO GUSTAVO', ch: '40H' },
  { nome: 'Teologia Geral', docente: 'MARCOS VINÍCIUS', ch: '40H' },
  { nome: 'Evangelismo e Missões', docente: 'CASSIA BORGES', ch: '40H' },
  { nome: 'Hermenêutica', docente: 'CASSIA BORGES', ch: '40H' },
  { nome: 'História do Cristianismo - Moderno e Contemporâneo', docente: 'GUSTAVO SIQUEIRA', ch: '40H' },
  { nome: 'Meio Ambiente e Sustentabilidade Optativa', docente: 'GUSTAVO SIQUEIRA', ch: '40H' },
  { nome: 'Novo Testamento – Evangelhos e Atos', docente: 'FLORA CAMPOS', ch: '40H' },
  { nome: 'Patrística e a Reforma Protestante', docente: 'FLORA CAMPOS', ch: '40H' },
  { nome: 'Teologia Sistemática – Deus e Criação', docente: 'EDUARDO BARBOSA', ch: '40H' },
  { nome: 'Tópicos Especiais: Direitos Humanos e Relações Étnico-Raciais', docente: 'EDUARDO BARBOSA', ch: '40H' },
  { nome: 'Tópicos Especiais: Sociodiversidade e Multiculturalismo', docente: 'REGINA RANNA', ch: '40H' },
  { nome: 'Voleibol: Bases e Metodologia', docente: 'REGINA RANNA', ch: '40H' },
  { nome: 'Administração Eclesiástica', docente: 'MARIA GORETE BRITO', ch: '40H' },
  { nome: 'Direito Eclesiástico', docente: 'MARIA GORETE BRITO', ch: '40H' },
  { nome: 'História e Geografia Bíblica', docente: 'VALTER DE PAULA', ch: '40H' },
  { nome: 'Introdução ao Grego Bíblico', docente: 'VALTER DE PAULA', ch: '40H' },
  { nome: 'Música Cristã', docente: 'KARINE GONTIJO', ch: '40H' },
  { nome: 'Novo Testamento – Cartas E Apocalipse', docente: 'KARINE GONTIJO', ch: '40H' },
  { nome: 'Teologia e Ação Social', docente: 'MONICA CASTRO', ch: '40H' },
  { nome: 'Teologia Sistemática – Cristologia e Soteriologia', docente: 'MONICA CASTRO', ch: '40H' },
  { nome: 'Aconselhamento Pastoral e Familiar', docente: 'LUZIA PACHECO', ch: '40H' },
  { nome: 'Escatologia', docente: 'LUZIA PACHECO', ch: '40H' },
  { nome: 'Oração e Meditação Bíblica', docente: 'LUIZ VIDAL', ch: '40H' },
  { nome: 'Teologia Sistemática – Eclesiologia', docente: 'PATRÍCIA SILVA', ch: '40H' },
  { nome: 'Teologia Sistemática – Pneumatologia e o Sobrenatural', docente: 'PATRÍCIA SILVA', ch: '40H' },
  { nome: 'Tcc – Construção', docente: 'CARLOS MOURÃO', ch: '200H' },
  { nome: 'Teologia e Política', docente: 'CARLOS MOURÃO', ch: '40H' },
  { nome: 'Antropologia Bíblica', docente: 'MARIA HELENA SILVA', ch: '40H' },
  { nome: 'Apologética', docente: 'JOÃO CARLOS SOBREIRO', ch: '40H' },
  { nome: 'Capelania', docente: 'SÉRGIO LOPES', ch: '40H' },
  { nome: 'Educação E Cultura Religiosa', docente: 'CINTHIA ALVES', ch: '40H' },
  { nome: 'Psicologia Da Religião', docente: 'PEDRO GUSTAVO', ch: '40H' },
  { nome: 'Tcc – Construção e Defesa', docente: 'FAUSTO BARROS', ch: '100H' },
  { nome: 'Estágio Curricular Supervisionado', docente: 'JOÃO SOUZA', ch: '100H' },
  { nome: 'Língua Brasileira de Sinais – Libras', docente: 'JOÃO SOUZA', ch: '60H' },
];

function seedDisciplinas(): void {
  const stmt = db.prepare('INSERT OR IGNORE INTO disciplinas (nome, docente_id, ch) VALUES (?, ?, ?)');
  let novas = 0;
  for (const d of DISCIPLINAS_SEED) {
    const doc = db.prepare('SELECT id FROM docentes WHERE nome = ?').get(d.docente) as
      | { id: number }
      | undefined;
    const r = stmt.run(d.nome, doc?.id ?? null, d.ch);
    if (r.changes > 0) novas++;
  }
  if (novas > 0) logger.info({ novas, total: DISCIPLINAS_SEED.length }, 'Seed de disciplinas aplicada');
}
