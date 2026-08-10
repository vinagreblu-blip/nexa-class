/**
 * Gera hash bcrypt da senha master — mesma senha em todas as máquinas.
 *
 * Uso:
 *   node scripts/gerar-senha-master.js
 *
 * Resultado:
 *   - Imprime a senha escolhida (NÃO commitar)
 *   - Imprime o hash bcrypt para setar via env SENHA_EXCLUSAO_DECLARACAO_HASH
 *
 * Em seguida, em CADA máquina Windows:
 *   setx SENHA_EXCLUSAO_DECLARACAO_HASH "hash-gerado-acima"
 *   (reiniciar o app)
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const readline = require('readline');

function perguntar(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (resp) => {
      rl.close();
      resolve(resp);
    });
  });
}

async function main() {
  console.log('=== Gerador de senha master NEXA CLASS ===\n');
  console.log('A senha master é exigida para:');
  console.log('  - Excluir declarações');
  console.log('  - Resetar senhas de usuários');
  console.log('  - Editar docentes/disciplinas');
  console.log('  - Acessar cursos livres');
  console.log('  - Excluir/resetar diplomas\n');

  const senha = await perguntar('Digite a senha master (mín. 10 chars): ');
  if (!senha || senha.length < 10) {
    console.error('✗ Senha muito curta. Mínimo 10 caracteres.');
    process.exit(1);
  }

  const confirma = await perguntar('Confirme a senha: ');
  if (senha !== confirma) {
    console.error('✗ Senhas não conferem.');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(senha, 10);

  console.log('\n=== CONFIGURAÇÃO PRONTA ===\n');
  console.log('Senha master (guarde em local seguro, NÃO commite):');
  console.log(`  ${senha}\n`);
  console.log('Hash bcrypt para configurar via env (pode commitar/revelar):');
  console.log(`  ${hash}\n`);
  console.log('=== COMO APLICAR EM CADA MÁQUINA WINDOWS ===\n');
  console.log('Opção A — via Environment Variable (recomendado, persiste entre logins):');
  console.log(`  setx SENHA_EXCLUSAO_DECLARACAO_HASH "${hash}"`);
  console.log('  (depois fechar e reabrir o app)\n');
  console.log('Opção B — via atalho do app:');
  console.log('  Editar atalho → propriedades → adicionar no início:');
  console.log('  cmd /c "set SENHA_EXCLUSAO_DECLARACAO_HASH=' + hash + ' && NEXA CLASS.exe"\n');
  console.log('✓ Configuração única — TODAS as 6 máquinas usarão a mesma senha master.');
}

main().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
