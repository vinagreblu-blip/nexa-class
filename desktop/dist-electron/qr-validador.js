"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gerarUrlValidacao = gerarUrlValidacao;
const node_crypto_1 = require("node:crypto");
// URL pública no GitHub Pages — funciona de qualquer rede
const VALIDADOR_URL = 'https://vinagreblu-blip.github.io/nexa-validador/';
/** Gera a URL do QR Code com dados de validação embutidos (base64 + hash SHA-256) */
function gerarUrlValidacao(dados) {
    const dadosParaHash = { ...dados };
    const dadosStr = JSON.stringify(dadosParaHash);
    const hash = (0, node_crypto_1.createHash)('sha256').update(dadosStr, 'utf8').digest('hex');
    const dadosComHash = { ...dados, h: hash };
    const encoded = Buffer.from(JSON.stringify(dadosComHash)).toString('base64');
    return `${VALIDADOR_URL}?d=${encoded}`;
}
//# sourceMappingURL=qr-validador.js.map