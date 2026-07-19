import { compareMods, pendingMods } from './src/js/mods.js';
import { fetchServerMods, setApiBase } from './src/js/api.js';
setApiBase('http://127.0.0.1:8099');
const server = await fetchServerMods();

function run(localMods, label){
  const c = compareMods(server, localMods);
  console.log(`\n[${label}]`);
  for (const m of c) console.log(`  ${m.file.padEnd(34)} -> ${m.state} (local=${m.localVersion||'-'} server=${m.version})`);
  console.log('  Pendentes:', pendingMods(c).map(p=>p.file).join(', '));
}

// Caso 1: pingmod local mais antigo (outdated) + fabric-api ausente (missing)
run([
  { file:'pingmod-0.9.0.jar', name:'pingmod', version:'0.9.0', size:1 },
], 'pingmod antigo + fabric ausente');

// Caso 2: tudo em dia
run([
  { file:'pingmod-1.0.0.jar', name:'pingmod', version:'1.0.0', size:1 },
  { file:'fabric-api-0.155.2+26.2.jar', name:'fabric api', version:'0.155.2+26.2', size:1 },
], 'tudo em dia');
