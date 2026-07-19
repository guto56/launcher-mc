import { compareMods, pendingMods } from './src/js/mods.js';
import { fetchServerMods, setApiBase } from './src/js/api.js';
setApiBase('http://127.0.0.1:8099');
// Simula pingmod LOCAL com versão MENOR que a do servidor (outdated)
const localMods = [
  { file: 'pingmod-0.9.0.jar', name: 'pingmod', version: '0.9.0', size: 1 },
];
const server = await fetchServerMods();
const c = compareMods(server, localMods);
for (const m of c) console.log(`${m.file.padEnd(34)} -> ${m.state} (local=${m.localVersion} server=${m.version})`);
console.log('Pendentes:', pendingMods(c).map(p=>p.file).join(', '));
