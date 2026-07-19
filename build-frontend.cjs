// Script auxiliar: roda o build do frontend (vite) a partir da raiz do repo,
// independente de onde o Tauri o invoca (src-tauri/ ou outra pasta).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let dir = __dirname;
// Sobe até achar o package.json (raiz do projeto).
while (!fs.existsSync(path.join(dir, 'package.json')) && dir !== path.dirname(dir)) {
  dir = path.dirname(dir);
}
if (!fs.existsSync(path.join(dir, 'package.json'))) {
  console.error('Erro: package.json não encontrado subindo a partir de', __dirname);
  process.exit(1);
}
console.log('Build do frontend em:', dir);
execSync('npm run build', { cwd: dir, stdio: 'inherit' });
