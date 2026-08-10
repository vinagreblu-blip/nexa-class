import { useAuth } from './context/AuthContext';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { TrocarSenhaObrigatoria } from './pages/TrocarSenhaObrigatoria';

export default function App() {
  const { usuario, carregando } = useAuth();

  if (carregando) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Carregando…</p>
      </div>
    );
  }

  if (!usuario) return <Login />;
  if (usuario.senha_temporaria === 1) return <TrocarSenhaObrigatoria />;
  return <Layout />;
}
