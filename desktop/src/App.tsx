import { useAuth } from './context/AuthContext';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';

export default function App() {
  const { usuario, carregando } = useAuth();

  if (carregando) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Carregando…</p>
      </div>
    );
  }

  return usuario ? <Layout /> : <Login />;
}
