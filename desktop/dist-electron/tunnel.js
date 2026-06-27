"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.iniciarTunnel = iniciarTunnel;
exports.getTunnelUrl = getTunnelUrl;
exports.getBaseUrl = getBaseUrl;
exports.fecharTunnel = fecharTunnel;
const node_child_process_1 = require("node:child_process");
const network_1 = require("./network");
let tunnelUrl = null;
let tunnelProcess = null;
async function iniciarTunnel() {
    const localIP = (0, network_1.getLocalIP)();
    try {
        const url = await tentarPinggy();
        if (url) {
            tunnelUrl = url;
            console.log(`[tunnel] URL pública criada: ${url}`);
            return url;
        }
    }
    catch (e) {
        console.warn('[tunnel] Túnel público falhou:', e?.message);
    }
    // Fallback: IP local (mesma rede WiFi)
    tunnelUrl = `http://${localIP}:3001`;
    console.log(`[tunnel] Usando IP local: ${tunnelUrl} (funciona na mesma rede WiFi)`);
    return tunnelUrl;
}
function tentarPinggy() {
    return new Promise((resolve) => {
        let resolved = false;
        let output = '';
        try {
            const proc = (0, node_child_process_1.spawn)('ssh', [
                '-o', 'StrictHostKeyChecking=no',
                '-o', 'ConnectTimeout=10',
                '-o', 'ServerAliveInterval=30',
                '-p', '443',
                '-R0:localhost:3001',
                'a.pinggy.io',
            ], { shell: false });
            const checkUrl = (data) => {
                output += data;
                // Pinggy mostra a URL no formato: https://xxxx.pinggy.io
                const match = output.match(/https:\/\/[a-z0-9]+\.pinggy\.io/);
                if (match && !resolved) {
                    resolved = true;
                    tunnelProcess = proc;
                    resolve(match[0]);
                }
            };
            proc.stdout.on('data', (data) => checkUrl(data.toString()));
            proc.stderr.on('data', (data) => checkUrl(data.toString()));
            proc.on('error', () => { if (!resolved)
                resolve(null); });
            proc.on('close', () => { if (!resolved)
                resolve(null); });
            // Timeout de 15 segundos
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    try {
                        proc.kill();
                    }
                    catch { }
                    resolve(null);
                }
            }, 15000);
        }
        catch {
            resolve(null);
        }
    });
}
function getTunnelUrl() {
    return tunnelUrl;
}
function getBaseUrl() {
    if (tunnelUrl && tunnelUrl.startsWith('https://'))
        return tunnelUrl;
    return `http://${(0, network_1.getLocalIP)()}:3001`;
}
function fecharTunnel() {
    if (tunnelProcess) {
        try {
            tunnelProcess.kill();
        }
        catch { }
        tunnelProcess = null;
    }
}
//# sourceMappingURL=tunnel.js.map