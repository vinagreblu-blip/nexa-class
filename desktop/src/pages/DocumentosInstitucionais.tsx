import { useState } from 'react';
import { Declaracoes } from './Declaracoes';
import { DeclaracaoDiploma } from './DeclaracaoDiploma';
import { EmBreve } from './EmBreve';

type Vista = 'menu' | 'certidao' | 'declaracao-diploma' | 'declaracao-historico' | 'projeto-pedagogico';

export function DocumentosInstitucionais() {
  const [vista, setVista] = useState<Vista>('menu');

  const voltar = (
    <button className="btn-ghost" style={{ marginBottom: 16, padding: '6px 14px', fontSize: 13 }} onClick={() => setVista('menu')}>
      ← Voltar
    </button>
  );

  if (vista === 'certidao') {
    return <div>{voltar}<Declaracoes comXml labels={{
      titulo: 'Certidão de Autenticidade',
      subtitulo: 'Emita certidões em PDF com QR Code e código de verificação.',
      btnEmitir: '+ Emitir Nova Certidão',
      btnEmitirSA: '+ Emitir Nova Certidão (SA)',
      docSingular: 'Certidão',
      docPlural: 'Certidão',
    }} /></div>;
  }

  if (vista === 'declaracao-diploma') {
    return (
      <div>
        {voltar}
        <DeclaracaoDiploma />
      </div>
    );
  }

  if (vista === 'declaracao-historico') {
    return (
      <div>
        {voltar}
        <Declaracoes
          comXml
          labels={{
            titulo: 'Declaração de Autenticidade de Histórico Escolar',
            subtitulo:
              'Emita declarações específicas para histórico escolar em PDF com QR Code e código de verificação.',
            btnEmitir: '+ Emitir Nova Declaração',
            btnEmitirSA: '+ Emitir Nova Declaração (SA)',
            docSingular: 'Declaração',
            docPlural: 'declaração',
          }}
          tipo="historico"
        />
      </div>
    );
  }

  if (vista === 'projeto-pedagogico') {
    return (
      <div>
        {voltar}
        <EmBreve titulo="Projeto Pedagógico do Curso" />
      </div>
    );
  }

  const cards = [
    {
      cor: '#2563EB',
      corClara: '#DBEAFE',
      titulo: 'Certidão de Conclusão de Curso',
      desc: 'Emita certidões de conclusão de curso dos alunos em PDF com QR Code de verificação.',
      onClick: () => setVista('certidao'),
      icon: (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="15" x2="15" y2="15" />
          <path d="M9 18h6" />
        </>
      ),
    },
    {
      cor: '#16A34A',
      corClara: '#DCFCE7',
      titulo: 'Declaração de Autenticidade de Diploma',
      desc: 'Emita declarações de autenticidade para diplomas com QR Code e código de verificação.',
      onClick: () => setVista('declaracao-diploma'),
      icon: (
        <>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </>
      ),
    },
    {
      cor: '#7C3AED',
      corClara: '#EDE9FE',
      titulo: 'Declaração de Autenticidade de Histórico',
      desc: 'Emita declarações de autenticidade de histórico escolar e certidão de conclusão com QR Code.',
      onClick: () => setVista('declaracao-historico'),
      icon: (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M9 13l2 2 4-4" />
        </>
      ),
    },
    {
      cor: '#EA580C',
      corClara: '#FFEDD5',
      titulo: 'Projeto Pedagógico do Curso',
      desc: 'Gerencie e disponibilize os projetos pedagógicos dos cursos da instituição.',
      onClick: () => setVista('projeto-pedagogico'),
      icon: (
        <>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
          Documentos Institucionais
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15 }}>
          Escolha o tipo de documento para emitir, gerenciar e verificar.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {cards.map((c) => (
          <CardDocumento key={c.titulo} {...c} />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// CARD GENÉRICO
// ============================================================

function CardDocumento({
  cor,
  corClara,
  titulo,
  desc,
  onClick,
  icon,
}: {
  cor: string;
  corClara: string;
  titulo: string;
  desc: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const [btnHover, setBtnHover] = useState(false);
  const gradId = `doc-${titulo.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1,
        minWidth: 280,
        maxWidth: 380,
        background: 'var(--surface)',
        borderRadius: 20,
        boxShadow: hover
          ? '0 4px 8px rgba(0,0,0,0.06), 0 20px 50px rgba(0,0,0,0.10)'
          : '0 1px 3px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.05)',
        padding: '40px 28px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
        transform: hover ? 'translateY(-6px)' : 'translateY(0)',
        transition: 'box-shadow 0.25s ease, transform 0.25s ease',
      }}
    >
      <svg
        style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '20%' }}
        viewBox="0 0 400 100"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={corClara} stopOpacity="0" />
            <stop offset="100%" stopColor={corClara} stopOpacity="0.8" />
          </linearGradient>
        </defs>
        <path
          d="M0,40 C60,80 140,10 220,50 C300,85 380,30 400,40 L400,100 L0,100 Z"
          fill={`url(#${gradId})`}
        />
        <path
          d="M0,60 C50,30 170,95 250,55 C320,25 400,60 400,60 L400,100 L0,100 Z"
          fill={`url(#${gradId})`}
          opacity="0.4"
        />
      </svg>
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: corClara,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: cor,
          marginBottom: 24,
          position: 'relative',
          zIndex: 1,
        }}
      >
        <svg
          width="34"
          height="34"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon}
        </svg>
      </div>
      <h2
        style={{
          margin: '0 0 10px',
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--text)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {titulo}
      </h2>
      <p
        style={{
          margin: '0 0 28px',
          color: 'var(--text-muted)',
          fontSize: 13.5,
          lineHeight: 1.6,
          maxWidth: 280,
          position: 'relative',
          zIndex: 1,
          flex: 1,
        }}
      >
        {desc}
      </p>
      <button
        onClick={onClick}
        onMouseEnter={() => setBtnHover(true)}
        onMouseLeave={() => setBtnHover(false)}
        style={{
          background: cor,
          color: '#fff',
          border: 'none',
          borderRadius: 10,
          padding: '11px 26px',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          boxShadow: hover ? `0 6px 20px ${cor}50` : `0 3px 12px ${cor}25`,
          transform: btnHover ? 'scale(1.03)' : 'scale(1)',
          transition: 'transform 0.2s ease, box-shadow 0.25s ease',
          position: 'relative',
          zIndex: 1,
        }}
      >
        Acessar
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: btnHover ? 'translateX(4px)' : 'translateX(0)',
            transition: 'transform 0.2s ease',
          }}
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </button>
    </div>
  );
}
