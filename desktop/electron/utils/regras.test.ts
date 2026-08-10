import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import {
  validarNovaSenha,
  validarInputUsuario,
  validarExclusaoDeclaracao,
  validarExclusaoUsuario,
  podeTrocarFotoPerfil,
  validarSenhaMaster,
  validarEstadoReset,
  RESET_TENTATIVAS_MAX,
  SENHA_MIN_LENGTH,
} from './regras';
import type { Sessao, UsuarioInput } from '../types';

// Sessão admin canônica usada nos testes de exclusão de declaração.
function sessaoAdmin(): Sessao {
  return {
    usuario: {
      id: 1,
      codigo: 'ADM001',
      username: 'admin',
      nome: 'Admin',
      email: null,
      role: 'admin',
      foto_path: null,
      ativo: 1,
      senha_temporaria: 0,
    },
  };
}

function sessaoOperador(): Sessao {
  return {
    usuario: {
      id: 2,
      codigo: 'OPR001',
      username: 'operador1',
      nome: 'Operador',
      email: null,
      role: 'operador',
      foto_path: null,
      ativo: 1,
      senha_temporaria: 0,
    },
  };
}

function inputFixture(overrides: Partial<UsuarioInput> = {}): UsuarioInput {
  return {
    username: 'joao',
    password: 'senha123',
    nome: 'João',
    role: 'operador',
    ...overrides,
  };
}

describe('validarNovaSenha', () => {
  it('aceita senha com pelo menos SENHA_MIN_LENGTH caracteres', () => {
    expect(validarNovaSenha('senha12')).toBeNull();
    expect(validarNovaSenha('senha123')).toBeNull();
  });

  it('rejeita senha curta', () => {
    expect(validarNovaSenha('12345')).toBe('A senha deve ter ao menos 6 caracteres');
  });

  it('rejeita senha vazia, null ou undefined', () => {
    expect(validarNovaSenha('')).not.toBeNull();
    expect(validarNovaSenha(null)).not.toBeNull();
    expect(validarNovaSenha(undefined)).not.toBeNull();
  });

  it(`SENHA_MIN_LENGTH === 6`, () => {
    expect(SENHA_MIN_LENGTH).toBe(6);
  });
});

describe('validarInputUsuario', () => {
  it('aceita input completo e válido', () => {
    expect(validarInputUsuario(inputFixture())).toBeNull();
  });

  it('rejeita username vazio (apenas espaços)', () => {
    expect(validarInputUsuario(inputFixture({ username: '   ' }))).toBe('Username é obrigatório');
  });

  it('rejeita nome vazio', () => {
    expect(validarInputUsuario(inputFixture({ nome: '' }))).toBe('Nome é obrigatório');
  });

  it('rejeita senha curta', () => {
    expect(validarInputUsuario(inputFixture({ password: '123' }))).toBe(
      'A senha deve ter ao menos 6 caracteres'
    );
  });

  it('rejeita role inválido', () => {
    expect(validarInputUsuario(inputFixture({ role: 'superuser' as any }))).toBe('Role inválido');
  });

  it('aceita roles admin e operador', () => {
    expect(validarInputUsuario(inputFixture({ role: 'admin' }))).toBeNull();
    expect(validarInputUsuario(inputFixture({ role: 'operador' }))).toBeNull();
  });
});

describe('validarExclusaoDeclaracao', () => {
  const senhaForte = 'master-secret-123';
  const hashCorreto = bcrypt.hashSync(senhaForte, 10);

  it('permite quando admin autenticado + senha master correta', () => {
    expect(
      validarExclusaoDeclaracao({
        sessao: sessaoAdmin(),
        senha: senhaForte,
        senhaMasterHash: hashCorreto,
      })
    ).toBeNull();
  });

  it('bloqueia sessão nula (não autenticado)', () => {
    expect(
      validarExclusaoDeclaracao({
        sessao: null,
        senha: senhaForte,
        senhaMasterHash: hashCorreto,
      })
    ).toBe('Não autenticado');
  });

  it('bloqueia operador mesmo com senha master correta', () => {
    // Proteção importante: role admin não basta — exige username 'admin'.
    expect(
      validarExclusaoDeclaracao({
        sessao: sessaoOperador(),
        senha: senhaForte,
        senhaMasterHash: hashCorreto,
      })
    ).toBe('Apenas o administrador (admin) pode excluir declarações');
  });

  it('bloqueia admin com senha master errada', () => {
    expect(
      validarExclusaoDeclaracao({
        sessao: sessaoAdmin(),
        senha: 'senha-errada',
        senhaMasterHash: hashCorreto,
      })
    ).toBe('Senha de exclusão incorreta');
  });

  it('bloqueia admin com senha vazia ou null', () => {
    expect(
      validarExclusaoDeclaracao({
        sessao: sessaoAdmin(),
        senha: '',
        senhaMasterHash: hashCorreto,
      })
    ).toBe('Senha de exclusão incorreta');
    expect(
      validarExclusaoDeclaracao({
        sessao: sessaoAdmin(),
        senha: null as unknown as string,
        senhaMasterHash: hashCorreto,
      })
    ).toBe('Senha de exclusão incorreta');
  });

  it('verifica ordem das checagens: autenticação vem antes de senha', () => {
    // Sem sessão, a senha nem é comparada — evita timing/error leak.
    expect(
      validarExclusaoDeclaracao({
        sessao: null,
        senha: 'qualquer',
        senhaMasterHash: hashCorreto,
      })
    ).toBe('Não autenticado');
  });

  it('verifica ordem: role admin vem antes de senha', () => {
    expect(
      validarExclusaoDeclaracao({
        sessao: sessaoOperador(),
        senha: 'senha-errada',
        senhaMasterHash: hashCorreto,
      })
    ).toBe('Apenas o administrador (admin) pode excluir declarações');
  });
});

describe('validarExclusaoUsuario', () => {
  it('permite excluir outro usuário não-admin', () => {
    expect(
      validarExclusaoUsuario({
        sessaoUsuarioId: 1,
        alvoId: 2,
        alvoRole: 'operador',
        alvoAtivo: 1,
        totalAdminsAtivos: 2,
      })
    ).toBeNull();
  });

  it('permite excluir outro admin quando há mais de 1 ativo', () => {
    expect(
      validarExclusaoUsuario({
        sessaoUsuarioId: 1,
        alvoId: 2,
        alvoRole: 'admin',
        alvoAtivo: 1,
        totalAdminsAtivos: 3,
      })
    ).toBeNull();
  });

  it('bloqueia autoexclusão', () => {
    expect(
      validarExclusaoUsuario({
        sessaoUsuarioId: 5,
        alvoId: 5,
        alvoRole: 'operador',
        alvoAtivo: 1,
        totalAdminsAtivos: 2,
      })
    ).toBe('Você não pode excluir o próprio usuário');
  });

  it('bloqueia exclusão do último admin ativo', () => {
    expect(
      validarExclusaoUsuario({
        sessaoUsuarioId: 1,
        alvoId: 2,
        alvoRole: 'admin',
        alvoAtivo: 1,
        totalAdminsAtivos: 1,
      })
    ).toBe('Não é possível excluir o último administrador ativo');
  });

  it('permite excluir admin inativo mesmo se for o único admin', () => {
    // admin inativo não conta para o lock — pode reativar outro depois.
    expect(
      validarExclusaoUsuario({
        sessaoUsuarioId: 1,
        alvoId: 2,
        alvoRole: 'admin',
        alvoAtivo: 0,
        totalAdminsAtivos: 1,
      })
    ).toBeNull();
  });

  it('permite excluir operador mesmo se for o único usuário não-admin', () => {
    expect(
      validarExclusaoUsuario({
        sessaoUsuarioId: 1,
        alvoId: 2,
        alvoRole: 'operador',
        alvoAtivo: 1,
        totalAdminsAtivos: 1,
      })
    ).toBeNull();
  });

  it('prioriza autoexclusão sobre lock de admin (mesmo usuário, último admin)', () => {
    // O admin logado é o último admin e tenta se autoexcluir — a regra de
    // autoexclusão aparece primeiro (mensagem mais útil).
    expect(
      validarExclusaoUsuario({
        sessaoUsuarioId: 1,
        alvoId: 1,
        alvoRole: 'admin',
        alvoAtivo: 1,
        totalAdminsAtivos: 1,
      })
    ).toBe('Você não pode excluir o próprio usuário');
  });
});

describe('podeTrocarFotoPerfil', () => {
  it('admin pode trocar foto de qualquer usuário', () => {
    expect(
      podeTrocarFotoPerfil({ sessaoRole: 'admin', sessaoUsuarioId: 1, alvoId: 99 })
    ).toBe(true);
  });

  it('operador só pode trocar a própria foto', () => {
    expect(
      podeTrocarFotoPerfil({ sessaoRole: 'operador', sessaoUsuarioId: 5, alvoId: 5 })
    ).toBe(true);
    expect(
      podeTrocarFotoPerfil({ sessaoRole: 'operador', sessaoUsuarioId: 5, alvoId: 6 })
    ).toBe(false);
  });
});

describe('validarSenhaMaster', () => {
  const senha = 'master-secret-123';
  const hash = bcrypt.hashSync(senha, 10);

  it('retorna true para senha correta', () => {
    expect(validarSenhaMaster(senha, hash)).toBe(true);
  });

  it('retorna false para senha errada', () => {
    expect(validarSenhaMaster('errada', hash)).toBe(false);
  });

  it('trata senha null/undefined como string vazia (não lança)', () => {
    // Reproduz o comportamento do inline original `senha ?? ''`.
    expect(validarSenhaMaster(null as any, hash)).toBe(false);
    expect(validarSenhaMaster(undefined as any, hash)).toBe(false);
  });

  it('compara de forma constante (bcrypt)', () => {
    // Sanity check: a função delega para bcrypt.compareSync, que é timing-safe
    // dentro do que o bcrypt permite.
    const hashDiferente = bcrypt.hashSync('outra-senha', 10);
    expect(validarSenhaMaster(senha, hashDiferente)).toBe(false);
    expect(validarSenhaMaster('outra-senha', hashDiferente)).toBe(true);
  });
});

describe('validarEstadoReset', () => {
  // Janela fixa para testes determinísticos — expires sempre "daqui a 10 min".
  const agora = new Date('2026-08-10T12:00:00.000Z');
  const expiresFuturo = new Date('2026-08-10T12:10:00.000Z').toISOString();
  const expiresPassado = new Date('2026-08-10T11:00:00.000Z').toISOString();

  it('aceita token ativo dentro do TTL com tentativas abaixo do limite', () => {
    expect(
      validarEstadoReset({
        temToken: true,
        expiresIso: expiresFuturo,
        tentativas: 0,
        agora,
      })
    ).toEqual({ ok: true });
    expect(
      validarEstadoReset({
        temToken: true,
        expiresIso: expiresFuturo,
        tentativas: RESET_TENTATIVAS_MAX - 1,
        agora,
      })
    ).toEqual({ ok: true });
  });

  it('recusa quando não há token ativo (solicitação nunca feita ou já utilizada)', () => {
    const r = validarEstadoReset({
      temToken: false,
      expiresIso: null,
      tentativas: 0,
      agora,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/nenhum código ativo/i);
  });

  it('recusa token expirado', () => {
    const r = validarEstadoReset({
      temToken: true,
      expiresIso: expiresPassado,
      tentativas: 0,
      agora,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/expirado/i);
  });

  it('recusa quando expires é null mesmo com temToken true', () => {
    const r = validarEstadoReset({
      temToken: true,
      expiresIso: null,
      tentativas: 0,
      agora,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/expirado/i);
  });

  it('recusa quando tentativas atingiram o limite (lockout)', () => {
    const r = validarEstadoReset({
      temToken: true,
      expiresIso: expiresFuturo,
      tentativas: RESET_TENTATIVAS_MAX,
      agora,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/muitas tentativas/i);
  });

  it('recusa quando tentativas excederam o limite', () => {
    const r = validarEstadoReset({
      temToken: true,
      expiresIso: expiresFuturo,
      tentativas: RESET_TENTATIVAS_MAX + 5,
      agora,
    });
    expect(r.ok).toBe(false);
  });

  it('RESET_TENTATIVAS_MAX === 5', () => {
    expect(RESET_TENTATIVAS_MAX).toBe(5);
  });

  it('usa Date.now() como default quando `agora` não é fornecido', () => {
    // Sanity: sem `agora`, a função usa o relógio real — deve aceitar um token
    // válido "daqui a 10 min" relativo a agora.
    const futuro = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    expect(
      validarEstadoReset({
        temToken: true,
        expiresIso: futuro,
        tentativas: 0,
      })
    ).toEqual({ ok: true });
  });
});
