// ============================================================
// NORMALIZADORES — dados locais → tipos do XSD oficial MEC v1.05
// ============================================================
// Módulo PURO (sem imports do Electron) — testável em vitest.
// Cada função leva o valor como está no banco (texto livre, com
// pontuação, formatos variados) e devolve o formato exato exigido
// pelos tipos de tiposBasicos_v1.05.xsd, ou null quando o dado
// não pode ser normalizado (vira pendência, nunca é inventado).
//

/** CPF → 11 dígitos (TCpf: pattern [0-9]{11}). Null se inválido. */
export function normalizarCpf(v: string | null | undefined): string | null {
  if (!v) return null;
  const digitos = v.replace(/\D/g, '');
  return digitos.length === 11 ? digitos : null;
}

/** CNPJ → 14 dígitos (TCnpj: pattern [0-9]{14}). Null se inválido. */
export function normalizarCnpj(v: string | null | undefined): string | null {
  if (!v) return null;
  const digitos = v.replace(/\D/g, '');
  return digitos.length === 14 ? digitos : null;
}

/** CEP → 8 dígitos (pattern [0-9]{8}). Null se inválido. */
export function normalizarCep(v: string | null | undefined): string | null {
  if (!v) return null;
  const digitos = v.replace(/\D/g, '');
  return digitos.length === 8 ? digitos : null;
}

/**
 * Data → AAAA-MM-DD (TData = xs:date). Aceita os formatos usados
 * no banco: YYYY-MM-DD(THH:mm...), DD/MM/YYYY e DD/MM/YY.
 * Null se não conseguir interpretar (não inventa).
 */
export function normalizarData(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(s);
  if (m) return `20${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** Sexo do cadastro ('M'/'F' livres, 'Masculino'...) → TSexo (M|F). Null se indefinido. */
export function normalizarSexo(v: string | null | undefined): 'M' | 'F' | null {
  if (!v) return null;
  const s = v.trim().toUpperCase();
  if (s.startsWith('M')) return 'M';
  if (s.startsWith('F')) return 'F';
  return null;
}

/** RG → TNumeroRg (4-15 alfanuméricos, sem pontuação). Null se fora do padrão. */
export function normalizarRg(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.replace(/[\s.\-/]/g, '');
  return /^[a-zA-Z0-9]{4,15}$/.test(s) ? s.toUpperCase() : null;
}

/** UF → TUf (sigla da enumeração). Null se não casar. */
const UFS = new Set(['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']);
export function normalizarUf(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toUpperCase();
  return UFS.has(s) ? s : null;
}

/** Data/hora de BRASÍLIA (America/Sao_Paulo) para os campos de emissão
 *  do histórico — o mapeamento oficial declara hora local; usar UTC
 *  deslocaria data/hora em até 3h (THora/TData não carregam fuso). */
export function dataHoraBrasilia(agora = new Date()): { data: string; hora: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const partes: Record<string, string> = {};
  for (const p of fmt.formatToParts(agora)) partes[p.type] = p.value;
  const hh = partes.hour === '24' ? '00' : (partes.hour ?? '00');
  return {
    data: `${partes.year}-${partes.month}-${partes.day}`,
    hora: `${hh}:${partes.minute ?? '00'}:${partes.second ?? '00'}`,
  };
}

/**
 * Carga horária → TCargaHoraria XSD. O banco guarda texto livre
 * ("80H", "80", "80,5h", "2.300"...). Devolve HoraAula (inteiro)
 * ou HoraRelogio (2 casas); sem unidade explícita assume HoraAula.
 * Null se não houver número interpretável.
 */
export function normalizarCargaHoraria(
  v: string | null | undefined
): { horaAula: number } | { horaRelogio: number } | null {
  if (v == null) return null;
  const s = String(v).toLowerCase().trim();
  const m = /(\d+(?:[.,]\d+)?)\s*(h[ra]*)?/.exec(s.replace(/\s/g, ''));
  if (!m) return null;
  const bruto = m[1].replace(',', '.');
  const valor = Number(bruto);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  const unidade = (m[2] ?? '').trim();
  if (unidade.startsWith('hr')) return { horaRelogio: Math.round(valor * 100) / 100 };
  return Number.isInteger(valor) ? { horaAula: valor } : { horaRelogio: Math.round(valor * 100) / 100 };
}

/**
 * Nota → TNota (0–10, até 2 casas) | TConceito | null.
 * O banco guarda texto ("9,5", "10", "AP", "A"...). Conceitos
 * válidos conforme enum TConceito/TConceitoRM do XSD.
 */
const CONCEITOS = new Set(['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','E+','E','E-','F+','F','F-','APD','APP','APR']);
export function normalizarNota(v: string | null | undefined): { nota: number } | { conceito: string } | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (CONCEITOS.has(s.toUpperCase())) return { conceito: s.toUpperCase() };
  const n = Number(s.replace(',', '.'));
  if (Number.isFinite(n) && n >= 0 && n <= 10) return { nota: Math.round(n * 100) / 100 };
  return null;
}

/**
 * Chave de acesso dos IDs do XSD: 44 dígitos (pattern VDip|Dip|RDip|ReqDip[0-9]{44}).
 * Origem: CPF (11) + dados do diploma — derivada determinística quando possível.
 * Sem dados suficientes → null (pendência; o processo não inventa chave).
 */
export function montarChaveAcesso44(cpf: string | null, matricula: string | null, sementeExtra: string): string | null {
  const c = normalizarCpf(cpf);
  if (!c) return null;
  const base = (c + (matricula ?? '') + sementeExtra).replace(/\D/g, '');
  const input = (c + '|' + (matricula ?? '') + '|' + sementeExtra).padEnd(44, '0');
  // Expansão determinística até 44 dígitos (FNV-1a em janelas)
  let out = base;
  let salt = 0;
  while (out.length < 44) {
    let h = 0x811c9dc5;
    const chunk = input + String(salt++);
    for (let i = 0; i < chunk.length; i++) {
      h ^= chunk.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += String(h);
  }
  return out.slice(0, 44);
}
