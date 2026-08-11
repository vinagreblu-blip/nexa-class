// Gera API_KEY forte para deploy do serviço web NEXA CLASS.
// Uso: node scripts/gerar-deploy-keys.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const apiKey = crypto.randomBytes(32).toString('hex');
const dataGeracao = new Date().toISOString();

const conteudo = `NEXA CLASS — Deploy Keys
============================
GERADO EM: ${dataGeracao}

API_KEY (servico web + 6 maquinas desktop):
${apiKey}

INSTRUCOES:
1. Deploy do servico web em https://render.com (ver DEPLOY-MULTI-MAQUINA.md)
   - New + > Blueprint > selecionar o repo vinagreblu-blip/nexa-class
   - Em Environment Variables, setar API_KEY com o valor acima
   - Setar NODE_ENV=production
   - Anotar a URL publica gerada (ex: https://nexa-verificacao.onrender.com)

2. Em CADA maquina desktop Windows, abrir PowerShell como Administrador e rodar:
   setx VERIFICACAO_API_KEY "${apiKey}" /M
   setx VERIFICACAO_BASE_URL "https://SUA-URL-DO-RENDER.onrender.com" /M
   (depois reiniciar o PC)

3. Gerar senha master unica com:
   node scripts/gerar-senha-master.js
   (setar o hash em SENHA_EXCLUSAO_DECLARACAO_HASH em todas as maquinas)

NAO COMMITAR este arquivo. Adicione ao .gitignore se ainda nao estiver.
`;

const outPath = path.join(__dirname, '..', 'deploy-keys.txt');
fs.writeFileSync(outPath, conteudo, 'utf8');

console.log('=== API_KEY gerada para deploy ===');
console.log(apiKey);
console.log('');
console.log('Arquivo completo salvo em: deploy-keys.txt');
console.log('');
console.log('PROXIMO PASSO:');
console.log('  1. Acesse https://render.com');
console.log('  2. New + > Blueprint > repo vinagreblu-blip/nexa-class');
console.log('  3. Configure API_KEY (acima) e NODE_ENV=production');
console.log('  4. Deploy → anote a URL pública gerada');
