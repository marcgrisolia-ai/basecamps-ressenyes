import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const files = (await readdir(resolve(root, 'site'))).sort();
const expected = ['.nojekyll', 'crypto.json', 'gate.js', 'index.html', 'payload.bin', 'sw.js'].sort();
if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error('Fitxers inesperats a la publicació.');
const metadata = JSON.parse(await readFile(resolve(root, 'site/crypto.json'), 'utf8'));
if (metadata.iterations < 600000 || metadata.algorithm !== 'AES-GCM') throw new Error('Configuració de xifrat invàlida.');
for (const filename of files.filter(name => name !== 'payload.bin')) {
  const text = await readFile(resolve(root, 'site', filename), 'utf8');
  if (/"businessResponse"|"quoteOriginal"|"reviewerName"|Marianna Niubó|Xixmgn/.test(text)) throw new Error('S’ha trobat contingut privat sense xifrar.');
}
console.log('Publicació verificada: pantalla d’accés i dades xifrades; cap HTML original públic.');
