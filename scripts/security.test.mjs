import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
const root = resolve(import.meta.dirname, '..');
const metadata = JSON.parse(await readFile(resolve(root, 'site/crypto.json'), 'utf8'));
const ciphertext = await readFile(resolve(root, 'site/payload.bin'));
async function key(password) {
  const material = await webcrypto.subtle.importKey('raw', Buffer.from(password, 'utf8'), 'PBKDF2', false, ['deriveKey']);
  return webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(metadata.salt, 'base64'), iterations: metadata.iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
async function decrypt(password, payload = ciphertext) {
  return webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(metadata.iv, 'base64'), additionalData: Buffer.from('basecamps-reviews-v1') }, await key(password), payload);
}
test('La contrasenya incorrecta no permet llegir dades', async () => { await assert.rejects(decrypt('incorrect-test-password'), { name: 'OperationError' }); });
test('Una alteració del paquet xifrat és rebutjada', async () => { const changed = Buffer.from(ciphertext); changed[25] ^= 1; await assert.rejects(decrypt(process.env.BASECAMPS_ACCESS_PASSWORD, changed), { name: 'OperationError' }); });
test('Tots els comentaris i les evidències es recuperen exactament', async () => {
  const bundle = JSON.parse(gunzipSync(Buffer.from(await decrypt(process.env.BASECAMPS_ACCESS_PASSWORD))).toString('utf8'));
  let count = 0;
  async function compare(directory) {
    for (const entry of await readdir(resolve(root, 'private-source', directory), { withFileTypes: true })) {
      const name = directory ? directory + '/' + entry.name : entry.name;
      if (entry.isDirectory()) await compare(name);
      else if (/\.(html|css)$/.test(entry.name)) { assert.equal(bundle.files[name], await readFile(resolve(root, 'private-source', name), 'utf8'), name); count++; }
    }
  }
  await compare(''); assert.equal(Object.keys(bundle.files).length, count); assert.ok(count > 300);
});
