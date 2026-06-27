import { useEffect, useState } from 'react';
import { api } from '../api';

export function Avatar({
  userId,
  nome,
  size = 36,
  refreshKey = 0,
}: {
  userId: number;
  nome?: string;
  size?: number;
  refreshKey?: number;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    api.usuarios.foto(userId).then((res) => {
      if (ativo) {
        setDataUrl(res.ok && res.data ? res.data.dataUrl : null);
        setCarregando(false);
      }
    });
    return () => {
      ativo = false;
    };
  }, [userId, refreshKey]);

  const iniciais = (nome || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  const estilo: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    objectFit: 'cover',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255,255,255,0.18)',
    color: '#fff',
    fontWeight: 700,
    fontSize: size * 0.4,
    flexShrink: 0,
    overflow: 'hidden',
  };

  if (carregando) return <div style={estilo} />;
  if (dataUrl) return <img src={dataUrl} alt={nome || ''} style={{ ...estilo, background: 'none' }} />;
  return <div style={estilo}>{iniciais || '?'}</div>;
}
