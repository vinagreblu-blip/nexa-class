import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export function Home() {
  const { usuario } = useAuth();
  const [totalAlunos, setTotalAlunos] = useState(0);
  const [totalDocentes, setTotalDocentes] = useState(0);
  const [totalDisciplinas, setTotalDisciplinas] = useState(0);
  const [totalDeclaracoes, setTotalDeclaracoes] = useState(0);

  useEffect(() => {
    Promise.all([
      api.alunos.listar(),
      api.docentes.listar(),
      api.disciplinas.listar(),
      api.declaracoes.listar(),
    ]).then(([alunos, docentes, disciplinas, declaracoes]) => {
      if (alunos.ok && alunos.data) setTotalAlunos(alunos.data.length);
      if (docentes.ok && docentes.data) setTotalDocentes(docentes.data.length);
      if (disciplinas.ok && disciplinas.data) setTotalDisciplinas(disciplinas.data.length);
      if (declaracoes.ok && declaracoes.data) setTotalDeclaracoes(declaracoes.data.length);
    });
  }, []);

  const cards = [
    { label: 'Alunos', valor: totalAlunos, cor: 'var(--btn-bg)' },
    { label: 'Docentes', valor: totalDocentes, cor: '#2d6478' },
    { label: 'Disciplinas', valor: totalDisciplinas, cor: '#4a7c59' },
    { label: 'Declarações Emitidas', valor: totalDeclaracoes, cor: '#8a5a2a' },
  ];

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 26 }}>
          Bem-vindo, {usuario?.nome?.split(' ')[0] ?? 'usuário'}!
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
          NEXA CLASS — Network for Education and Academic Excellence Class
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 28,
        }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            className="card"
            style={{
              padding: 22,
              borderLeft: `4px solid ${c.cor}`,
            }}
          >
            <div style={{ fontSize: 32, fontWeight: 800, color: c.cor }}>{c.valor}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{c.label}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 22 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>Resumo do Sistema</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ItemResumo label="Faculdades cadastradas" valor="5 (Hélio Rocha, FACIIP, FATECE, FACEI, 2 de Julho)" />
          <ItemResumo label="Cursos com histórico automático" valor="20+" />
          <ItemResumo label="Seu perfil" valor={usuario?.role === 'admin' ? 'Administrador' : 'Operador'} />
          <ItemResumo label="Seu código" valor={usuario?.codigo ?? '—'} />
        </div>
      </div>
    </div>
  );
}

function ItemResumo({ label, valor }: { label: string; valor: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: 13 }}>{valor}</span>
    </div>
  );
}
