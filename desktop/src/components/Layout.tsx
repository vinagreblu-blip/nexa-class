import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Home } from '../pages/Home';
import { Alunos } from '../pages/Alunos';
import { Docentes } from '../pages/Docentes';
import { Disciplinas } from '../pages/Disciplinas';
import { Historicos } from '../pages/Historicos';
import { Usuarios } from '../pages/Usuarios';
import { Declaracoes } from '../pages/Declaracoes';
import { Diploma } from '../pages/Diploma';
import { CursosLivres } from '../pages/CursosLivres';
import { AssinaturaDigital } from '../pages/AssinaturaDigital';
import { Conversoes } from '../pages/Conversoes';
import { CloudConfig } from '../pages/CloudConfig';
import { Configuracoes } from '../pages/Configuracoes';
import { Perfil } from '../pages/Perfil';
import { Avatar } from './Avatar';
import luaIcon from '../assets/lua.png';
import solIcon from '../assets/sol.png';

type Aba =
  | 'home'
  | 'alunos'
  | 'docentes'
  | 'disciplinas'
  | 'historicos'
  | 'declaracoes'
  | 'diploma'
  | 'cursos-livres'
  | 'assinatura'
  | 'conversoes'
  | 'cloud'
  | 'configuracoes'
  | 'usuarios'
  | 'perfil';

export function Layout() {
  const { usuario, logout } = useAuth();
  const { tema, alternar } = useTheme();
  const [aba, setAba] = useState<Aba>('home');
  const [fotoRefresh, setFotoRefresh] = useState(0);
  const [trocandoFoto, setTrocandoFoto] = useState(false);

  const itens: { id: Aba; label: string; adminOnly?: boolean }[] = [
    { id: 'home', label: 'Home' },
    { id: 'alunos', label: 'Alunos' },
    { id: 'docentes', label: 'Docentes' },
    { id: 'disciplinas', label: 'Disciplinas' },
    { id: 'historicos', label: 'Histórico Acadêmico' },
    { id: 'declaracoes', label: 'Declarações' },
    { id: 'diploma', label: 'Diploma', adminOnly: true },
    { id: 'cursos-livres', label: 'Cursos', adminOnly: true },
    { id: 'assinatura', label: 'Assinatura Digital' },
    { id: 'conversoes', label: 'Converter arquivos' },
    { id: 'configuracoes', label: 'Configurações', adminOnly: true },
    { id: 'cloud', label: 'Nuvem (Supabase)', adminOnly: true },
    { id: 'usuarios', label: 'Usuários', adminOnly: true },
    { id: 'perfil', label: 'Perfil' },
  ];

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <aside
        style={{
          width: 240,
          background: 'var(--primary)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: '18px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>NEXA CLASS</div>
            <div style={{ fontSize: 8, opacity: 0.7, marginTop: 2, lineHeight: 1.2 }}>
              Network for Education and<br />Academic Excellence Class
            </div>
          </div>
          <button
            onClick={alternar}
            title={tema === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
            style={{
              flexShrink: 0,
              width: 40,
              height: 40,
              padding: 0,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.12)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={tema === 'dark' ? solIcon : luaIcon}
              alt={tema === 'dark' ? 'Sol' : 'Lua'}
              style={{
                width: 22,
                height: 22,
                objectFit: 'contain',
                filter: 'brightness(0) invert(1)',
              }}
            />
          </button>
        </div>

        <nav style={{ flex: 1, padding: '14px 10px' }}>
          {itens
            .filter((i) => !i.adminOnly || usuario?.role === 'admin')
            .map((i) => (
              <button
                key={i.id}
                onClick={() => setAba(i.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 14px',
                  marginBottom: 4,
                  borderRadius: 6,
                  background: aba === i.id ? 'rgba(255,255,255,0.15)' : 'transparent',
                  color: '#fff',
                  border: 'none',
                  fontWeight: aba === i.id ? 600 : 400,
                }}
              >
                {i.label}
              </button>
            ))}
        </nav>

        <div style={{ padding: 16, borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            {usuario && (
              <div style={{ position: 'relative', cursor: 'pointer' }} title="Clique para trocar sua foto" onClick={async () => {
                if (trocandoFoto || !usuario) return;
                setTrocandoFoto(true);
                const res = await api.usuarios.trocarFoto(usuario.id);
                setTrocandoFoto(false);
                if (res.ok) setFotoRefresh((n) => n + 1);
              }}>
                {trocandoFoto ? (
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff' }}>…</div>
                ) : (
                  <>
                    <Avatar userId={usuario.id} nome={usuario.nome} size={40} refreshKey={fotoRefresh} />
                    <div style={{
                      position: 'absolute', bottom: -2, right: -2,
                      background: 'rgba(255,255,255,0.25)', borderRadius: '50%',
                      width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, color: '#fff', border: '1.5px solid var(--primary)',
                    }}>📷</div>
                  </>
                )}
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {usuario?.nome}
              </div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                {usuario?.role === 'admin' ? 'Administrador' : 'Operador'} · @{usuario?.username}
              </div>
            </div>
          </div>
          {usuario?.codigo && (
            <div style={{ marginBottom: 10 }}>
              <span
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  color: '#fff',
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'monospace',
                  letterSpacing: 1,
                }}
                title="Seu código identificador"
              >
                {usuario.codigo}
              </span>
            </div>
          )}
          <button
            onClick={logout}
            style={{
              background: 'rgba(255,255,255,0.1)',
              color: '#fff',
              width: '100%',
              padding: '8px',
              borderRadius: 6,
            }}
          >
            Sair
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: 'auto', padding: 28 }}>
        {aba === 'home' && <Home />}
        {aba === 'alunos' && <Alunos />}
        {aba === 'docentes' && <Docentes />}
        {aba === 'disciplinas' && <Disciplinas />}
        {aba === 'historicos' && <Historicos />}
        {aba === 'declaracoes' && <Declaracoes />}
        {aba === 'diploma' && <Diploma />}
        {aba === 'cursos-livres' && usuario?.role === 'admin' && <CursosLivres />}
        {aba === 'assinatura' && <AssinaturaDigital />}
        {aba === 'conversoes' && <Conversoes />}
        {aba === 'cloud' && usuario?.role === 'admin' && <CloudConfig />}
        {aba === 'configuracoes' && usuario?.role === 'admin' && <Configuracoes />}
        {aba === 'usuarios' && usuario?.role === 'admin' && <Usuarios />}
        {aba === 'perfil' && <Perfil />}
      </main>
    </div>
  );
}
