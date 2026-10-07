import { readFile, writeFile, mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { randomBytes, webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const input = join(root, 'private-source');
const output = join(root, 'site');
const password = process.env.BASECAMPS_ACCESS_PASSWORD;
if (!password) throw new Error('Falta BASECAMPS_ACCESS_PASSWORD al fitxer local .env.');
const files = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile() && /\.(html|css)$/.test(entry.name)) {
      const name = relative(input, path).replaceAll('\\', '/');
      files[name] = await readFile(path, 'utf8');
    }
  }
}
await collect(input);
if (!files['index.html'] || !files['evidencies/index.html']) throw new Error('Falta el visor o l’índex d’evidències.');
const salt = randomBytes(32);
const iv = randomBytes(12);
const iterations = 600_000;
const material = await webcrypto.subtle.importKey('raw', Buffer.from(password, 'utf8'), 'PBKDF2', false, ['deriveKey']);
const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const clear = gzipSync(Buffer.from(JSON.stringify({ version: 1, files })), { level: 9 });
const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: Buffer.from('basecamps-reviews-v1') }, key, clear);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'gate.js', 'sw.js']) await copyFile(join(root, 'web', name), join(output, name));
await writeFile(join(output, 'payload.bin'), Buffer.from(encrypted));
await writeFile(join(output, 'crypto.json'), JSON.stringify({ version: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations, salt: salt.toString('base64'), iv: iv.toString('base64') }) + '\n');
await writeFile(join(output, '.nojekyll'), '');
console.log(`Publicació xifrada preparada: ${Object.keys(files).length} fitxers, ${Buffer.byteLength(encrypted)} bytes. Els originals no es publiquen.`);
