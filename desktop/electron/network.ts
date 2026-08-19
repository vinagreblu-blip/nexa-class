import os from 'node:os';

function isRfc1918(addr: string): boolean {
  if (addr.startsWith('192.168.')) return true;
  if (addr.startsWith('10.')) return true;
  const m = /^172\.(\d+)\./.exec(addr);
  if (m) {
    const n = parseInt(m[1], 10);
    return n >= 16 && n <= 31;
  }
  return false;
}

export function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  // Adaptadores virtuais (Wi-Fi Direct, Bluetooth PAN etc.) costumam receber
  // IPv4 link-local 169.254.x.x que não são alcançáveis por outros devices —
  // nunca usá-los no QR. Prioriza endereços RFC1918 (roteadores reais).
  let fallback: string | null = null;
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (iface.address.startsWith('169.254.')) continue;
      if (isRfc1918(iface.address)) return iface.address;
      if (!fallback) fallback = iface.address;
    }
  }
  return fallback ?? '127.0.0.1';
}
