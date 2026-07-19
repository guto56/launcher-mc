import { compareMods, pendingMods } from './src/js/mods.js';
import { fetchServerMods, setApiBase } from './src/js/api.js';
import { writeFileSync, mkdirSync } from 'fs';

setApiBase('http://127.0.0.1:8099');

const localMods = [
  { file: 'pingmod-1.0.0.jar', name: 'pingmod', version: '1.0.0', size: 7152 },
];
const server = await fetchServerMods();
console.log('Servidor exige:', server.map(m=>m.file).join(', '));

const comparison = compareMods(server, localMods);
console.log('\nComparação:');
for (const m of comparison) {
  console.log(`  ${m.file.padEnd(34)} -> ${m.state} (local=${m.localVersion||'-'} server=${m.version})`);
}
const pending = pendingMods(comparison);
console.log(`\nPendentes (${pending.length}):`, pending.map(p=>p.file).join(', '));

const DIR = '/tmp/launcher-test';
mkdirSync(DIR, { recursive: true });
async function downloadMod(filename){
  const res = await fetch(`http://127.0.0.1:8099/api/mods/file/${encodeURIComponent(filename)}`);
  if(!res.ok) throw new Error('HTTP '+res.status);
  return Array.from(Buffer.from(await res.arrayBuffer()));
}
let done=0;
for (const m of pending){
  const bytes = await downloadMod(m.file);
  writeFileSync(DIR+'/'+m.file, Buffer.from(bytes));
  done++;
  console.log(`  baixado ${m.file} (${bytes.length} bytes)`);
}
console.log(`\nOK ${done} mod(s) baixados para ${DIR}`);
