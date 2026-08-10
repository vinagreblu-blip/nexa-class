import bcrypt from 'bcryptjs';
import type { Role, Sessao, UsuarioInput } from '../types';

/**
 * Regras de negócio puras (sem DB, sem Electron, sem IO).
 *
 * Cada função retorna `null` quando a entrada é válida, ou uma string de erro
 * legível ao usuário quando inválida. Extraídas dos handlers IPC para poderem
 * ser testadas isoladamente — antes estavam inline em arquivos que importam
 * `electron` / `../database`, inviabilizando testes diretos.
 *
 * Convenção: nome `validar*` retorna string|null; nome `pode*` retorna boolean.
 */

export const SENHA_MIN_LENGTH = 6;

/** Valida senha nova (criação ou troca). Min 6 chars. */
export function validarNovaSenha(senha: string | undefined | null): string | null {
  if (!senha || senha.length < SENHA_MIN_LENGTH) {
    return 'A senha deve ter ao menos 6 caracteres';
  }
  return null;
}

/**
 * Valida os campos de input de usuário no cadastro.
 * Espelha exatamente as mensagens que eram produzidas inline em usuarios.ts.
 */
export function validarInputUsuario(input: UsuarioInput): string | null {
  if (!input.username?.trim()) return 'Username é obrigatório';
  if (!input.nome?.trim()) return 'Nome é obrigatório';
  const erroSenha = validarNovaSenha(input.password);
  if (erroSenha) return erroSenha;
  if (input.role !== 'admin' && input.role !== 'operador') {
    return 'Role inválido';
  }
  return null;
}

/**
 * Regras para exclusão de declaração (operacao crítica, auditável).
 * - Usuário precisa estar autenticado
 * - Apenas o username 'admin' (role admin não basta — trava conta clonada)
 * - Senha master independente da senha de login (SENHA_EXCLUSAO_DECLARACAO_HASH)
 *
 * O hash é verificado com bcrypt.compareSync — recebe via parâmetro para manter
 * a função pura em relação ao CONFIG.
 */
export function validarExclusaoDeclaracao(opts: {
  sessao: Sessao | null;
  senha: string;
  senhaMasterHash: string;
}): string | null {
  if (!opts.sessao) return 'Não autenticado';
  if (opts.sessao.usuario.username !== 'admin') {
    return 'Apenas o administrador (admin) pode excluir declarações';
  }
  if (!bcrypt.compareSync(opts.senha ?? '', opts.senhaMasterHash)) {
    return 'Senha de exclusão incorreta';
  }
  return null;
}

/**
 * Regras para exclusão de usuário.
 * - Não pode excluir a si mesmo (lockout acidental)
 * - Não pode excluir o último administrador ativo (lockout do sistema)
 *
 * Recebe os dados pré-buscados do DB para manter a função pura.
 */
export function validarExclusaoUsuario(opts: {
  sessaoUsuarioId: number;
  alvoId: number;
  alvoRole: Role | null | undefined;
  alvoAtivo: number | null | undefined;
  totalAdminsAtivos: number;
}): string | null {
  if (opts.sessaoUsuarioId === opts.alvoId) {
    return 'Você não pode excluir o próprio usuário';
  }
  if (opts.alvoRole === 'admin' && opts.alvoAtivo === 1 && opts.totalAdminsAtivos <= 1) {
    return 'Não é possível excluir o último administrador ativo';
  }
  return null;
}

/**
 * Regra de permissão para trocar foto de perfil.
 * Admin pode trocar de qualquer um; operador só a sua própria.
 */
export function podeTrocarFotoPerfil(opts: {
  sessaoRole: Role;
  sessaoUsuarioId: number;
  alvoId: number;
}): boolean {
  if (opts.sessaoRole === 'admin') return true;
  return opts.sessaoUsuarioId === opts.alvoId;
}

/**
 * Verifica a senha master independente da senha de login.
 * Usada por operações sensíveis: resetar senha, excluir/resetar declarações,
 * editar docentes/disciplinas/cursos-livres, emitir diploma.
 *
 * Centralizada aqui porque antes o mesmo `bcrypt.compareSync(senha, CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH)`
 * estava duplicado em 5+ handlers. Retorna true/false para ficar idêntico ao
 * padrão inline original — sem mudar mensagens.
 */
export function validarSenhaMaster(senha: string, senhaMasterHash: string): boolean {
  return bcrypt.compareSync(senha ?? '', senhaMasterHash);
}

/**
 * Limite de tentativas falhas antes de invalidar o token de reset.
 * Com 6 dígitos (10^6 combinações) e 5 tentativas por 30 min, o atacante tem
 * 5/1M = 0,0005% de chance por janela. Após o lockout, precisa pedir novo
 * token (e o admin/notificação por e-mail pode detectar abuso).
 */
export const RESET_TENTATIVAS_MAX = 5;

/**
 * Valida o estado de um pedido de redefinição de senha ANTES de comparar o token.
 * Regras puras (sem bcrypt, sem DB):
 *  - Token deve existir (foi solicitado)
 *  - Não pode estar expirado (TTL 30 min)
 *  - Não pode ter excedido o limite de tentativas
 *
 * Retorna `{ ok: true }` ou `{ ok: false, erro }`. O chamador decide o que fazer
 * quando `ok: false` (ex.: incrementar tentativas, invalidar token, etc.).
 */
export function validarEstadoReset(opts: {
  temToken: boolean;
  expiresIso: string | null | undefined;
  tentativas: number;
  agora?: Date;
}): { ok: true } | { ok: false; erro: string } {
  if (!opts.temToken) {
    return { ok: false, erro: 'Nenhum código ativo. Solicite uma nova redefinição.' };
  }
  const agora = opts.agora ?? new Date();
  if (!opts.expiresIso || new Date(opts.expiresIso) < agora) {
    return { ok: false, erro: 'Código expirado. Solicite uma nova redefinição.' };
  }
  if (opts.tentativas >= RESET_TENTATIVAS_MAX) {
    return { ok: false, erro: 'Muitas tentativas incorretas. Solicite uma nova redefinição.' };
  }
  return { ok: true };
}
