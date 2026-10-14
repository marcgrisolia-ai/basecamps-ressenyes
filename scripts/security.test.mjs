import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webcrypto, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createContext, runInContext } from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const password = process.env.BASECAMPS_ACCESS_PASSWORD;
if (!password) throw new Error('La verificació necessita la contrasenya local a BASECAMPS_ACCESS_PASSWORD.');
const metadata = JSON.parse(await readFile(resolve(root, 'site/crypto.json'), 'utf8'));
const ciphertext = await readFile(resolve(root, 'site/payload.bin'));
const allowedText = /\.(html|css|json|md|txt)$/i;
async function key(value) {
  const material = await webcrypto.subtle.importKey('raw', Buffer.from(value, 'utf8'), 'PBKDF2', false, ['deriveKey']);
  return webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(metadata.salt, 'base64'), iterations: metadata.iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
async function decrypt(value, payload = ciphertext) {
  return webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(metadata.iv, 'base64'), additionalData: Buffer.from('basecamps-reviews-v1') }, await key(value), payload);
}
let bundlePromise;
const decryptedBundle = () => bundlePromise ||= decrypt(password).then(clear => JSON.parse(gunzipSync(Buffer.from(clear)).toString('utf8')));
async function namesIn(directory, prefix = '') {
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) names.push(...await namesIn(resolve(directory, entry.name), name + '/'));
    else if (entry.isFile()) names.push(name);
    else assert.fail(`Tipus de fitxer inesperat: ${name}`);
  }
  return names.sort();
}

test('La contrasenya incorrecta no permet llegir dades', async () => {
  await assert.rejects(decrypt('incorrect-test-password'), { name: 'OperationError' });
});
test('Una alteració del paquet xifrat és rebutjada', async () => {
  const changed = Buffer.from(ciphertext); changed[25] ^= 1;
  await assert.rejects(decrypt(password, changed), { name: 'OperationError' });
});
test('Tots els HTML/CSS originals i els JSON/MD/TXT privats es recuperen byte per byte', async () => {
  const bundle = await decryptedBundle(); assert.equal(bundle.version, 1);
  const sourceNames = (await namesIn(resolve(root, 'private-source'))).filter(name => allowedText.test(name));
  assert.ok(sourceNames.length > 300);
  assert.deepEqual(Object.keys(bundle.files).sort(), sourceNames);
  for (const name of sourceNames) {
    assert.equal(typeof bundle.files[name], 'string', name);
    assert.deepEqual(Buffer.from(bundle.files[name], 'utf8'), await readFile(resolve(root, 'private-source', name)), name);
  }
  assert.ok(sourceNames.some(name => name.startsWith('dashboard/') && name.endsWith('.json')));
  assert.ok(sourceNames.some(name => name.startsWith('dashboard/') && name.endsWith('.md')));
  assert.ok(Object.keys(bundle.files).every(name => allowedText.test(name)), 'Només s’empaqueten les extensions de text autoritzades');
});
test('El dashboard i el seu snapshot de comentaris només existeixen dins el paquet xifrat', async () => {
  const bundle = await decryptedBundle(); const html = bundle.files['dashboard/index.html'];
  assert.equal(typeof html, 'string');
  const snapshotMatch = html.match(/<meta\s+name="data-app-local-snapshot"\s+content="(snapshot\.([a-f0-9]{64})\.json)"/);
  assert.ok(snapshotMatch, 'El dashboard conserva la referència al snapshot separat verificat');
  const snapshotName = 'dashboard/' + snapshotMatch[1];
  const literalSnapshot = bundle.files[snapshotName]; assert.equal(typeof literalSnapshot, 'string');
  assert.equal(createHash('sha256').update(Buffer.from(literalSnapshot, 'utf8')).digest('hex'), snapshotMatch[2]);
  const snapshot = JSON.parse(literalSnapshot), rows = snapshot.queries.review_publications.rows;
  const census = JSON.parse(bundle.files['dashboard/audit/census_report.json']);
  assert.equal(rows.length, census.summary.total); assert.ok(rows.every(row => row.hasWrittenComment === true && row.customerComment.trim()));
  assert.equal(new Set(rows.map(row => row.publicationId)).size, census.summary.total);
  assert.deepEqual(rows.reduce((n, row) => { n.total++; n[row.responseStatus]++; return n; }, { total: 0, answered: 0, unanswered: 0, unknown: 0 }), census.summary);
  const publicNames = await namesIn(resolve(root, 'site'));
  assert.ok(!publicNames.some(name => name.startsWith('dashboard/snapshot.') || name.startsWith('dashboard/audit/')));
});
test('La publicació només conté sis fitxers d’accés i el redirect públic sense contrasenya ni ressenyes', async () => {
  const names = await namesIn(resolve(root, 'site'));
  assert.deepEqual(names, ['.nojekyll', 'crypto.json', 'dashboard/index.html', 'gate.js', 'index.html', 'payload.bin', 'sw.js'].sort());
  assert.equal(metadata.algorithm, 'AES-GCM'); assert.equal(metadata.kdf, 'PBKDF2-SHA256'); assert.ok(metadata.iterations >= 600000);
  const secret = Buffer.from(password, 'utf8');
  for (const name of names) {
    const bytes = await readFile(resolve(root, 'site', name));
    assert.equal(bytes.includes(secret), false, `La contrasenya no apareix al fitxer públic ${name}`);
    if (name !== 'payload.bin') assert.doesNotMatch(bytes.toString('utf8'), /"businessResponse"|"quoteOriginal"|"reviewerName"|"customerComment"|"review_publications"|Marianna Niubó|Xixmgn/, name);
  }
  const redirect = await readFile(resolve(root, 'site/dashboard/index.html'), 'utf8');
  assert.match(redirect, /__private\/dashboard\/index\.html/, 'El redirect apunta al dashboard protegit');
  assert.deepEqual(await readFile(resolve(root, 'site/index.html')), await readFile(resolve(root, 'web/index.html')));
  assert.deepEqual(await readFile(resolve(root, 'site/gate.js')), await readFile(resolve(root, 'web/gate.js')));
  assert.deepEqual(await readFile(resolve(root, 'site/sw.js')), await readFile(resolve(root, 'web/sw.js')));
});

test('El service worker entrega JSON, MD, TXT, HTML i CSS amb MIME correcte i sense memòria cau', async () => {
  const handlers = new Map(), scope = 'https://example.test/basecamps-ressenyes/';
  const context = createContext({
    self: { registration: { scope }, addEventListener: (type, callback) => handlers.set(type, callback) },
    URL, Response, TextEncoder, Uint8Array, atob, Date, Object, Promise,
  });
  runInContext(await readFile(resolve(root, 'web/sw.js'), 'utf8'), context);
  const samples = {
    'dashboard/test.json': '{"comentari":"Accents ç, ñ, à i €"}',
    'dashboard/test.md': '# Comentari\nText amb ç i ñ.\n',
    'dashboard/test.txt': 'Text literal amb accents: àéíòú.\n',
    'dashboard/test.html': '<p>Comentari íntegre</p>',
    'dashboard/test.css': 'body { color: green; }\n',
  };
  runInContext(`session = { expires: Date.now() + 60_000 }; files = ${JSON.stringify(samples)};`, context);
  async function respond(path, method = 'GET', mode = 'cors') {
    let response;
    handlers.get('fetch')({ request: { url: new URL('__private/' + path, scope).href, method, mode }, respondWith: promise => { response = promise; } });
    assert.ok(response); return response;
  }
  const mime = { json: 'application/json; charset=utf-8', md: 'text/plain; charset=utf-8', txt: 'text/plain; charset=utf-8', html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8' };
  for (const [name, literal] of Object.entries(samples)) {
    const response = await respond(name);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), mime[name.split('.').at(-1)]);
    assert.equal(response.headers.get('Cache-Control'), 'no-store, private'); assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(literal));
    const head = await respond(name, 'HEAD'); assert.equal(head.headers.get('Content-Type'), response.headers.get('Content-Type')); assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
  assert.equal((await respond('dashboard/missing.json')).status, 404);
  assert.equal((await respond('dashboard/test.json', 'POST')).status, 405);
  runInContext('loadFiles = async () => undefined;', context);
  const denied = await respond('dashboard/test.json'); assert.equal(denied.status, 401); assert.equal(await denied.text(), 'Accés restringit');
  const redirect = await respond('dashboard/index.html', 'GET', 'navigate'); assert.equal(redirect.status, 302);
  const target = new URL(redirect.headers.get('Location')); assert.equal(target.origin, new URL(scope).origin); assert.equal(target.pathname, new URL(scope).pathname); assert.equal(target.searchParams.get('next'), '/basecamps-ressenyes/__private/dashboard/index.html');
});
