// Merge freesound/catalog.json into the library catalog (catalog.json), replacing earlier
// freesound entries. Run from explainers/design/sfx after freesound-import.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
const main = JSON.parse(readFileSync('catalog.json', 'utf8')).filter((s) => s.pack !== 'freesound');
const fs = JSON.parse(readFileSync('freesound/catalog.json', 'utf8'));
writeFileSync('catalog.json', `${JSON.stringify([...main, ...fs], null, 1)}\n`);
console.log(JSON.stringify({ before: main.length, added: fs.length, total: main.length + fs.length }));
