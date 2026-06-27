import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Usuario } from '../types';
import { Modal, ConfirmDialog } from '../components/Modal';
import { Avatar } from '../components/Avatar';

export function Usuarios() {
  const [lista, setLista] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excluirId, setExcluirId] = useState<number | null>(null);
  const [fotoRefresh, setFotoRefresh] = useState(0);
  const [trocandoFotoId, setTrocandoFotoId] = useState<number | null>(null);
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetMaster, setResetMaster] = useState('');
  const [resetErro, setResetErro] = useState<string | null>(null);
  const [resetSucesso, setResetSucesso] = useState<string | null>(null);
  const [resetando, setResetando] = useState(false);

  const [username, setUsername] = useState('');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'operador'>('operador');
  const [password, setPassword] = useState('');
  const [ativo, setAtivo] = useState(true);

  async function carregar() {
    setCarregando(true);
    const res = await api.usuarios.listar();
    if (res.ok && res.data) setLista(res.data);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  function abrirNovo() {
    setEditando(null);
    setUsername('');
    setNome('');
    setEmail('');
    setRole('operador');
    setPassword('');
    setAtivo(true);
    setErro(null);
    setModalAberto(true);
  }

  function abrirEdicao(u: Usuario) {
    setEditando(u);
    setUsername(u.username);
    setNome(u.nome);
    setEmail(u.email ?? '');
    setRole(u.role);
    setPassword('');
    setAtivo(u.ativo === 1);
    setErro(null);
    setModalAberto(true);
  }

  async function salvar() {
    setErro(null);

    if (!username.trim() || !nome.trim()) {
      setErro('Preencha usuário e nome');
      return;
    }
    if (!editando && password.length < 6) {
      setErro('A senha deve ter ao menos 6 caracteres');
      return;
    }

    setSalvando(true);
    let res;
    if (editando) {
      res = await api.usuarios.atualizar(editando.id, {
        username: username.trim(),
        nome: nome.trim(),
        email: email.trim(),
        role,
        ativo,
        ...(password ? { password } : {}),
      });
    } else {
      res = await api.usuarios.criar({ username: username.trim(), nome: nome.trim(), email: email.trim(), role, password });
    }
    setSalvando(false);

    if (res.ok) {
      setModalAberto(false);
      setSucesso(editando ? 'Usuário atualizado.' : 'Usuário criado.');
      await carregar();
      setTimeout(() => setSucesso(null), 3000);
    } else {
      setErro(res.error ?? 'Erro ao salvar');
    }
  }

  async function confirmarExclusao() {
    if (excluirId == null) return;
    const res = await api.usuarios.excluir(excluirId);
    setExcluirId(null);
    if (res.ok) {
      setSucesso('Usuário excluído.');
      await carregar();
      setFotoRefresh((n) => n + 1);
      setTimeout(() => setSucesso(null), 3000);
    } else {
      setErro(res.error ?? 'Erro ao excluir usuário');
      setTimeout(() => setErro(null), 5000);
    }
  }

  async function trocarFoto(id: number) {
    setErro(null);
    setSucesso(null);
    setTrocandoFotoId(id);
    const res = await api.usuarios.trocarFoto(id);
    setTrocandoFotoId(null);
    if (res.ok) {
      setSucesso('Foto de perfil atualizada.');
      setFotoRefresh((n) => n + 1);
      setTimeout(() => setSucesso(null), 3000);
    } else if (res.error && res.error !== 'Nenhum arquivo selecionado') {
      setErro(res.error);
      setTimeout(() => setErro(null), 5000);
    }
  }

  function abrirReset(id: number) {
    setResetUserId(id);
    setResetMaster('');
    setResetErro(null);
    setResetSucesso(null);
  }

  async function confirmarReset() {
    if (resetUserId == null) return;
    setResetErro(null);
    setResetSucesso(null);
    setResetando(true);
    const res = await api.usuarios.resetarSenha(resetUserId, resetMaster);
    setResetando(false);
    if (res.ok && res.data) {
      setResetSucesso(
        `Senha resetada! A nova senha temporária é: ${res.data.senhaTemporaria}. O usuário deve alterá-la no Perfil após o login.`
      );
      setResetMaster('');
    } else {
      setResetErro(res.error ?? 'Erro ao resetar senha');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Usuários</h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Gestão de usuários e permissões.
          </p>
        </div>
        <button className="btn-primary" onClick={abrirNovo}>
          + Novo Usuário
        </button>
      </div>

      {sucesso && <div className="alert alert-success">{sucesso}</div>}
      {erro && !modalAberto && <div className="alert alert-error">{erro}</div>}

      <div className="card" style={{ overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Foto</th>
              <th>Código</th>
              <th>Usuário</th>
              <th>Nome</th>
              <th>Perfil</th>
              <th>Status</th>
              <th style={{ width: 240 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {carregando && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  Carregando…
                </td>
              </tr>
            )}
            {lista.map((u) => (
              <tr key={u.id}>
                <td>
                  <Avatar userId={u.id} nome={u.nome} size={36} refreshKey={fotoRefresh} />
                </td>
                <td>
                  <span className="badge badge-admin" title="Código identificador">
                    {u.codigo || '—'}
                  </span>
                </td>
                <td style={{ fontFamily: 'monospace' }}>@{u.username}</td>
                <td>{u.nome}</td>
                <td>
                  <span className={u.role === 'admin' ? 'badge badge-admin' : 'badge badge-operador'}>
                    {u.role === 'admin' ? 'Administrador' : 'Operador'}
                  </span>
                </td>
                <td>
                  <span className={u.ativo === 1 ? 'badge badge-ok' : 'badge badge-pendente'}>
                    {u.ativo === 1 ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => trocarFoto(u.id)}
                      disabled={trocandoFotoId === u.id}
                      title="Trocar foto de perfil"
                    >
                      {trocandoFotoId === u.id ? '…' : 'Foto'}
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => abrirEdicao(u)}>
                      Editar
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => abrirReset(u.id)}
                      title="Resetar senha do usuário"
                    >
                      🔑 Resetar
                    </button>
                    <button className="btn-danger btn-sm" onClick={() => setExcluirId(u.id)}>
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalAberto && (
        <Modal
          title={editando ? 'Editar Usuário' : 'Novo Usuário'}
          onClose={() => setModalAberto(false)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setModalAberto(false)} disabled={salvando}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          }
        >
          {erro && <div className="alert alert-error">{erro}</div>}
          <div className="form-grid">
            <div className="form-row">
              <label>Usuário *</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Perfil *</label>
              <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'operador')}>
                <option value="operador">Operador</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <div className="full form-row">
              <label>Nome *</label>
              <input value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="full form-row">
              <label>E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="exemplo@email.com"
              />
            </div>
            <div className="full form-row">
              <label>
                {editando ? 'Nova senha (deixe em branco para manter)' : 'Senha *'} (mín. 6)
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={editando ? '•••••••' : ''}
              />
            </div>
            {editando && (
              <div className="full form-row">
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={ativo}
                    onChange={(e) => setAtivo(e.target.checked)}
                    style={{ width: 'auto' }}
                  />
                  Usuário ativo
                </label>
              </div>
            )}
          </div>
        </Modal>
      )}

      {excluirId != null && (
        <ConfirmDialog
          title="Excluir Usuário"
          message="Tem certeza que deseja excluir este usuário?"
          confirmLabel="Excluir"
          onConfirm={confirmarExclusao}
          onCancel={() => setExcluirId(null)}
        />
      )}

      {resetUserId != null && (
        <Modal
          title="Resetar Senha do Usuário"
          onClose={() => (resetando ? undefined : setResetUserId(null))}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setResetUserId(null)} disabled={resetando}>
                Cancelar
              </button>
              <button
                className="btn-danger"
                onClick={confirmarReset}
                disabled={resetando || !resetMaster}
              >
                {resetando ? 'Resetando…' : 'Resetar Senha'}
              </button>
            </>
          }
        >
          {resetSucesso ? (
            <>
              <div className="alert alert-success">{resetSucesso}</div>
              <button className="btn-primary" onClick={() => setResetUserId(null)}>
                Concluir
              </button>
            </>
          ) : (
            <>
              <div className="alert alert-warning">
                A senha do usuário será resetada para <strong>senha123</strong>. O usuário deverá trocá-la no Perfil após o login.
              </div>
              {resetErro && <div className="alert alert-error">{resetErro}</div>}
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label>Confirme a senha master de administrador</label>
                <input
                  type="password"
                  autoFocus
                  autoComplete="off"
                  value={resetMaster}
                  onChange={(e) => setResetMaster(e.target.value)}
                  placeholder="Senha master"
                />
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
