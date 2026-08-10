export function EmBreve({ titulo }: { titulo: string }) {
  return (
    <div style={{ maxWidth: 480 }}>
      <h1 style={{ margin: '0 0 4px', fontSize: 22 }}>{titulo}</h1>
      <p style={{ margin: '0 0 22px', color: 'var(--text-muted)', fontSize: 13 }}>Em breve.</p>
    </div>
  );
}
