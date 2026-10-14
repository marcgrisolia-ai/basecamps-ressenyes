import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
async function collect(directory, prefix = '') {
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) names.push(...await collect(resolve(directory, entry.name), name + '/'));
    else if (entry.isFile()) names.push(name);
    else throw new Error('Tipus de fitxer inesperat a la publicació.');
  }
  return names.sort();
}
const files = await collect(resolve(root, 'site'));
const expected = ['.nojekyll', 'crypto.json', 'dashboard/index.html', 'gate.js', 'index.html', 'payload.bin', 'sw.js'].sort();
if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error('Fitxers inesperats a la publicació.');
const metadata = JSON.parse(await readFile(resolve(root, 'site/crypto.json'), 'utf8'));
if (metadata.iterations < 600000 || metadata.algorithm !== 'AES-GCM' || metadata.kdf !== 'PBKDF2-SHA256') throw new Error('Configuració de xifrat invàlida.');
const password = process.env.BASECAMPS_ACCESS_PASSWORD;
for (const filename of files) {
  const bytes = await readFile(resolve(root, 'site', filename));
  if (password && bytes.includes(Buffer.from(password, 'utf8'))) throw new Error('La contrasenya apareix a la publicació.');
  if (filename === 'payload.bin') continue;
  const text = bytes.toString('utf8');
  if (/"businessResponse"|"quoteOriginal"|"reviewerName"|"customerComment"|"review_publications"|Marianna Niubó|Xixmgn/.test(text)) throw new Error('S’ha trobat contingut privat sense xifrar.');
}
console.log('Publicació verificada: pantalla d’accés, redirect al dashboard privat i dades xifrades; cap ressenya o snapshot públic.');
