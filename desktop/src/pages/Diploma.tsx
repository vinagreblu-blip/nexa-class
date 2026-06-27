export function Diploma() {
  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>Diploma</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
          Emissão e gestão de diplomas dos alunos concluintes.
        </p>
      </div>

      <div className="card" style={{ padding: 28, textAlign: 'center' }}>
        <div
          style={{
            fontSize: 40,
            marginBottom: 12,
            opacity: 0.4,
          }}
        >
          🎓
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Módulo de Diplomas</h2>
        <p style={{ margin: '0 auto 18px', color: 'var(--text-muted)', fontSize: 13, maxWidth: 420 }}>
          Aqui será possível selecionar um aluno concluinte e emitir o diploma em PDF com QR Code
          de autenticidade, seguindo o mesmo padrão das declarações.
        </p>
        <span className="badge badge-pendente">Funcionalidade a ser definida</span>
      </div>
    </div>
  );
}
