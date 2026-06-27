"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarAlunosHandlers = registrarAlunosHandlers;
const electron_1 = require("electron");
const node_crypto_1 = require("node:crypto");
const database_1 = require("../database");
const types_1 = require("../types");
const auth_1 = require("./auth");
const historico_template_1 = require("../historico-template");
// Gera sequência de semestres a partir de um período inicial (ex: "2021.1" → ["2021.1","2021.2","2022.1",...])
function gerarPeriodos(inicio, quantidade) {
    const m = /^(\d{4})\.(1|2)$/.exec(inicio);
    if (!m)
        return [];
    let ano = parseInt(m[1]);
    let sem = parseInt(m[2]);
    const out = [];
    for (let i = 0; i < quantidade; i++) {
        out.push(`${ano}.${sem}`);
        if (sem === 1) {
            sem = 2;
        }
        else {
            ano++;
            sem = 1;
        }
    }
    return out;
}
function popularHistoricoPadrao(alunoId, template, anoIngresso) {
    const db = (0, database_1.getDb)();
    const stmt = db.prepare(`INSERT INTO historico_disciplinas
     (aluno_id, periodo, disciplina, docente, titulacao, ch, nota, status, ordem)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    // Extrai períodos únicos do template (na ordem)
    const periodosTemplate = [];
    for (const d of template) {
        if (!periodosTemplate.includes(d.periodo))
            periodosTemplate.push(d.periodo);
    }
    // Gera novos períodos baseados no ano do vestibular do aluno
    let mapa;
    if (anoIngresso && /^\d{4}\.(1|2)$/.test(anoIngresso)) {
        const novos = gerarPeriodos(anoIngresso, periodosTemplate.length);
        mapa = new Map(periodosTemplate.map((old, i) => [old, novos[i] ?? old]));
    }
    else {
        mapa = new Map(); // sem mapeamento, usa períodos do template
    }
    const ordemPorPeriodo = new Map();
    for (const d of template) {
        const periodoFinal = mapa.get(d.periodo) ?? d.periodo;
        const ordem = (ordemPorPeriodo.get(periodoFinal) ?? 0) + 1;
        ordemPorPeriodo.set(periodoFinal, ordem);
        stmt.run(alunoId, periodoFinal, d.disciplina, d.docente, d.titulacao, d.ch, null, d.status, ordem);
    }
}
function gerarMatricula(rg, anoIngresso) {
    const digitos = (rg || '').replace(/\D/g, '').split('');
    let amostra = '';
    for (let i = 0; i < 5; i++) {
        if (digitos.length === 0) {
            amostra += (0, node_crypto_1.randomInt)(0, 10).toString();
        }
        else {
            const idx = (0, node_crypto_1.randomInt)(0, digitos.length);
            amostra += digitos[idx];
            digitos.splice(idx, 1);
        }
    }
    return `${anoIngresso.split('.')[0]}${amostra}`;
}
function listar(_event, busca) {
    const db = (0, database_1.getDb)();
    let rows;
    const baseSelect = `SELECT a.*, u.nome AS created_by_nome, u.codigo AS created_by_codigo
                      FROM alunos a
                      LEFT JOIN usuarios u ON u.id = a.created_by`;
    if (busca && busca.trim()) {
        const termo = `%${busca.trim()}%`;
        rows = db
            .prepare(`${baseSelect}
         WHERE a.nome LIKE ? OR a.matricula LIKE ? OR a.cpf LIKE ? OR a.rg LIKE ? OR a.curso LIKE ?
         ORDER BY a.nome ASC`)
            .all(termo, termo, termo, termo, termo);
    }
    else {
        rows = db.prepare(`${baseSelect} ORDER BY a.nome ASC`).all();
    }
    return { ok: true, data: rows };
}
function buscar(_event, id) {
    const db = (0, database_1.getDb)();
    const row = db.prepare('SELECT * FROM alunos WHERE id = ?').get(id);
    if (!row)
        return { ok: false, error: 'Aluno não encontrado' };
    return { ok: true, data: row };
}
function validarInput(input) {
    if (!input.nome?.trim())
        return 'Nome é obrigatório';
    if (!input.cpf?.trim())
        return 'CPF é obrigatório';
    if (!input.rg?.trim())
        return 'RG é obrigatório';
    if (!input.ano_ingresso?.trim())
        return 'Ano de ingresso é obrigatório (necessário para gerar a matrícula)';
    if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
        return 'E-mail inválido';
    }
    return null;
}
const COLS_INSERT = '(matricula, nome, cpf, rg, nacionalidade, naturalidade, cidade, sexo, orgao_emissor, turno, forma_ingresso, data_vestibular, data_colacao, email, telefone, curso, faculdade, ano_ingresso, ano_conclusao, data_nascimento, created_by)';
function valoresInsert(input, matricula) {
    return [
        matricula,
        input.nome?.trim() || null,
        input.cpf?.trim() || null,
        input.rg?.trim() || null,
        input.nacionalidade?.trim() || null,
        input.naturalidade?.trim() || null,
        input.cidade?.trim() || null,
        input.sexo?.trim() || null,
        input.orgao_emissor?.trim() || null,
        input.turno?.trim() || null,
        input.forma_ingresso?.trim() || null,
        input.data_vestibular?.trim() || null,
        input.data_colacao?.trim() || null,
        input.email?.trim() || null,
        input.telefone?.trim() || null,
        input.curso?.trim() || null,
        input.faculdade?.trim() || null,
        input.ano_ingresso?.trim() || null,
        input.ano_conclusao?.trim() || null,
        input.data_nascimento?.trim() || null,
    ];
}
function criar(_event, input) {
    const erro = validarInput(input);
    if (erro)
        return { ok: false, error: erro };
    const db = (0, database_1.getDb)();
    const placeholders = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    for (let tentativa = 0; tentativa < 12; tentativa++) {
        const matricula = tentativa === 0 && input.matricula?.trim()
            ? input.matricula.trim()
            : gerarMatricula(input.rg || '', input.ano_ingresso || '');
        try {
            const info = db
                .prepare(`INSERT INTO alunos ${COLS_INSERT} VALUES ${placeholders}`)
                .run(...valoresInsert(input, matricula), (0, auth_1.getSessao)()?.usuario.id ?? null);
            // Popula o histórico padrão automaticamente para Hélio Rocha
            const faculdade = input.faculdade?.trim();
            const curso = input.curso?.trim();
            const vestibular = input.ano_ingresso?.trim() ?? '';
            if (faculdade === 'Hélio Rocha' && curso === 'Administração') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_HELIOROCHA_ADM, vestibular);
            }
            else if (faculdade === 'Hélio Rocha' && curso === 'Comunicação Social (Publicidade e Propaganda)') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_HELIOROCHA_COM_SOCIAL_PP, vestibular);
            }
            else if (faculdade === 'Hélio Rocha' && curso === 'Engenharia Civil') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_HELIOROCHA_ENG_CIVIL, vestibular);
            }
            else if (faculdade === 'Hélio Rocha' && curso === 'Engenharia de Produção') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_HELIOROCHA_ENG_PRODUCAO, vestibular);
            }
            else if (faculdade === 'Hélio Rocha' && curso === 'Engenharia Elétrica') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_HELIOROCHA_ENG_ELETRICA, vestibular);
            }
            else if (faculdade === 'Hélio Rocha' && curso === 'Fisioterapia') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_HELIOROCHA_FISIOTERAPIA, vestibular);
            }
            else if (faculdade === 'Hélio Rocha' && curso === 'Serviço Social') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_HELIOROCHA_SERVICO_SOCIAL, vestibular);
            }
            else if (faculdade === 'Hélio Rocha' && curso === 'Sistema de Informação') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_HELIOROCHA_SISTEMA_INFORMACAO, vestibular);
            }
            else if (faculdade === 'Hélio Rocha' && curso === 'Turismo') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_HELIOROCHA_TURISMO, vestibular);
            }
            else if (faculdade === 'FACIIP' && curso === 'Administração') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_FACIIP_ADM, vestibular);
            }
            else if (faculdade === 'FACIIP' && curso === 'Administração Hospitalar') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_FACIIP_ADM_HOSPITALAR, vestibular);
            }
            else if (faculdade === 'FACIIP' && curso === 'Comunicação Social (Relações Públicas)') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_FACIIP_COM_SOCIAL_RP, vestibular);
            }
            else if (faculdade === 'FACIIP' && curso === 'Ciências Contábeis') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_FACIIP_CONTABEIS, vestibular);
            }
            else if (faculdade === 'FACIIP' && curso === 'Engenharia de Produção Mecânica') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_FACIIP_ENG_PRODUCAO_MEC, vestibular);
            }
            else if (faculdade === 'FACIIP' && curso === 'Jornalismo') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_FACIIP_JORNALISMO, vestibular);
            }
            else if (faculdade === 'FACIIP' && curso === 'Pedagogia') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_FACIIP_PEDAGOGIA, vestibular);
            }
            else if (faculdade === 'FACIIP' && curso === 'Turismo e Hotelaria') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_FACIIP_TURISMO_HOTELARIA, vestibular);
            }
            else if (faculdade === 'FATECE' && curso === 'Administração') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_HELIOROCHA_ADM, vestibular);
            }
            else if (faculdade === 'FATECE' && curso === 'Pedagogia') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_FATECE_PEDAGOGIA, vestibular);
            }
            else if (faculdade === 'FATECE' && curso === 'Teologia') {
                popularHistoricoPadrao(info.lastInsertRowid, historico_template_1.HISTORICO_PADRAO_FATECE_TEOLOGIA, vestibular);
            }
            const row = db.prepare('SELECT * FROM alunos WHERE id = ?').get(info.lastInsertRowid);
            return { ok: true, data: row };
        }
        catch (e) {
            if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                continue;
            }
            return { ok: false, error: e?.message ?? 'Erro ao cadastrar aluno' };
        }
    }
    return { ok: false, error: 'Não foi possível gerar uma matrícula única. Tente novamente.' };
}
function atualizar(_event, id, input) {
    const erro = validarInput(input);
    if (erro)
        return { ok: false, error: erro };
    const db = (0, database_1.getDb)();
    try {
        const result = db
            .prepare(`UPDATE alunos
         SET matricula = ?, nome = ?, cpf = ?, rg = ?, nacionalidade = ?, naturalidade = ?,
             cidade = ?, sexo = ?, orgao_emissor = ?, turno = ?, forma_ingresso = ?,
             data_vestibular = ?, data_colacao = ?, email = ?, telefone = ?, curso = ?,
             faculdade = ?, ano_ingresso = ?, ano_conclusao = ?, data_nascimento = ?,
             updated_at = datetime('now')
         WHERE id = ?`)
            .run(...valoresInsert(input, input.matricula.trim()), id);
        if (result.changes === 0)
            return { ok: false, error: 'Aluno não encontrado' };
        const row = db.prepare('SELECT * FROM alunos WHERE id = ?').get(id);
        return { ok: true, data: row };
    }
    catch (e) {
        if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return { ok: false, error: 'Já existe um aluno com essa matrícula' };
        }
        return { ok: false, error: e?.message ?? 'Erro ao atualizar aluno' };
    }
}
function excluir(_event, id) {
    const db = (0, database_1.getDb)();
    const decl = db
        .prepare('SELECT COUNT(*) AS total FROM declaracoes WHERE aluno_id = ?')
        .get(id);
    if (decl.total > 0) {
        return {
            ok: false,
            error: `Não é possível excluir: existem ${decl.total} declaração(ões) vinculada(s) a este aluno`,
        };
    }
    const result = db.prepare('DELETE FROM alunos WHERE id = ?').run(id);
    if (result.changes === 0)
        return { ok: false, error: 'Aluno não encontrado' };
    return { ok: true, data: true };
}
function registrarAlunosHandlers() {
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.ALUNO_LISTAR, (0, auth_1.requerAuth)(listar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.ALUNO_BUSCAR, (0, auth_1.requerAuth)(buscar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.ALUNO_CRIAR, (0, auth_1.requerAuth)(criar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.ALUNO_ATUALIZAR, (0, auth_1.requerAuth)(atualizar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.ALUNO_EXCLUIR, (0, auth_1.requerAuth)(excluir));
}
//# sourceMappingURL=alunos.js.map