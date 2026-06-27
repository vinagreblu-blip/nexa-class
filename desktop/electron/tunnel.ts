import { spawn } from 'node:child_process';
import { getLocalIP } from './network';

let tunnelUrl: string | null = null;
let tunnelProcess: any = null;

export async function iniciarTunnel(): Promise<string | null> {
  const localIP = getLocalIP();

  try {
    const url = await tentarPinggy();
    if (url) {
      tunnelUrl = url;
      console.log(`[tunnel] URL pública criada: ${url}`);
      return url;
    }
  } catch (e: any) {
    console.warn('[tunnel] Túnel público falhou:', e?.message);
  }

  // Fallback: IP local (mesma rede WiFi)
  tunnelUrl = `http://${localIP}:3001`;
  console.log(`[tunnel] Usando IP local: ${tunnelUrl} (funciona na mesma rede WiFi)`);
  return tunnelUrl;
}

function tentarPinggy(): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    let output = '';

    try {
      const proc = spawn('ssh', [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=10',
        '-o', 'ServerAliveInterval=30',
        '-p', '443',
        '-R0:localhost:3001',
        'a.pinggy.io',
      ], { shell: false });

      const checkUrl = (data: string) => {
        output += data;
        // Pinggy mostra a URL no formato: https://xxxx.pinggy.io
        const match = output.match(/https:\/\/[a-z0-9]+\.pinggy\.io/);
        if (match && !resolved) {
          resolved = true;
          tunnelProcess = proc;
          resolve(match[0]);
        }
      };

      proc.stdout.on('data', (data: Buffer) => checkUrl(data.toString()));
      proc.stderr.on('data', (data: Buffer) => checkUrl(data.toString()));
      proc.on('error', () => { if (!resolved) resolve(null); });
      proc.on('close', () => { if (!resolved) resolve(null); });

      // Timeout de 15 segundos
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { proc.kill(); } catch {}
          resolve(null);
        }
      }, 15000);
    } catch {
      resolve(null);
    }
  });
}

export function getTunnelUrl(): string | null {
  return tunnelUrl;
}

export function getBaseUrl(): string {
  if (tunnelUrl && tunnelUrl.startsWith('https://')) return tunnelUrl;
  return `http://${getLocalIP()}:3001`;
}

export function fecharTunnel(): void {
  if (tunnelProcess) {
    try { tunnelProcess.kill(); } catch {}
    tunnelProcess = null;
  }
}
