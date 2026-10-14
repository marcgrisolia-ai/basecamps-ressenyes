const base = new URL(self.registration.scope);
const prefix = base.pathname + '__private/';
const SESSION_MS = 8 * 60 * 60 * 1000;
let session;
let files;
let loading;
let generation = 0;
const fromBase64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const contentType = path => ({
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
})[path.split('.').at(-1).toLowerCase()] || 'application/octet-stream';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function database() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('basecamps-session-' + base.pathname, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('session');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
async function readSession() {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const read = db.transaction('session').objectStore('session').get('active');
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
  } finally { db.close(); }
}
async function saveSession(value) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('session', 'readwrite');
      const store = transaction.objectStore('session');
      if (value) store.put(value, 'active'); else store.delete('active');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
async function decrypt(key) {
  const [meta, payload] = await Promise.all([fetch(new URL('crypto.json', base), { cache: 'no-store' }), fetch(new URL('payload.bin', base), { cache: 'no-store' })]);
  if (!meta.ok || !payload.ok) throw new Error('download');
  const config = await meta.json();
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(config.iv), additionalData: new TextEncoder().encode('basecamps-reviews-v1') }, key, await payload.arrayBuffer());
  const expanded = await new Response(new Blob([clear]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const bundle = JSON.parse(expanded);
  if (bundle.version !== 1 || typeof bundle.files?.['index.html'] !== 'string') throw new Error('bundle');
  return bundle.files;
}
async function loadFiles() {
  if (!session) session = await readSession();
  if (!session || session.expires <= Date.now()) { session = undefined; files = undefined; await saveSession(undefined); return undefined; }
  if (files) return files;
  if (!loading) {
    const version = generation;
    loading = decrypt(session.key).then(result => {
      if (version !== generation || !session || session.expires <= Date.now()) return undefined;
      files = result; return result;
    }).catch(async () => { if (version === generation) { session = undefined; files = undefined; await saveSession(undefined); } return undefined; }).finally(() => { loading = undefined; });
  }
  return loading;
}
async function lock() {
  generation++; session = undefined; files = undefined;
  await saveSession(undefined);
  for (const client of await self.clients.matchAll({ type: 'window' })) {
    if (!client.url.startsWith(base.href)) continue;
    client.postMessage({ type: 'LOCKED' });
    if (new URL(client.url).pathname.startsWith(prefix) && client.frameType === 'top-level') await client.navigate(base.href);
  }
}
self.addEventListener('message', event => {
  event.waitUntil((async () => {
    const client = event.source;
    if (!client?.url?.startsWith(base.href) || !event.ports[0]) return;
    const reply = value => event.ports[0].postMessage(value);
    if (event.data?.type === 'STATUS') { reply({ ok: Boolean(await loadFiles()) }); return; }
    if (event.data?.type === 'LOCK') { await lock(); reply({ ok: true }); return; }
    if (event.data?.type === 'UNLOCK') {
      const key = event.data.key;
      if (!(key instanceof CryptoKey) || key.extractable || key.algorithm.name !== 'AES-GCM') { reply({ ok: false, reason: 'invalid' }); return; }
      try {
        const version = generation;
        const unlocked = await decrypt(key);
        if (version !== generation) { reply({ ok: false, reason: 'cancelled' }); return; }
        session = { key, expires: Date.now() + SESSION_MS };
        await saveSession(session); files = unlocked;
        reply({ ok: true });
      } catch (error) { reply({ ok: false, reason: error.name === 'OperationError' ? 'invalid' : 'unavailable' }); }
    }
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) return;
  event.respondWith((async () => {
    const available = await loadFiles();
    if (!available) {
      if (event.request.mode === 'navigate') {
        const target = new URL(base.href); target.searchParams.set('next', url.pathname + url.search + url.hash);
        return Response.redirect(target.href, 302);
      }
      return new Response('Accés restringit', { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    let path;
    try { path = decodeURIComponent(url.pathname.slice(prefix.length)); } catch { return new Response('Ruta invàlida', { status: 400 }); }
    if (!path || path.endsWith('/')) path += 'index.html';
    if (event.request.method !== 'GET' && event.request.method !== 'HEAD') return new Response('Mètode no permès', { status: 405 });
    if (!Object.hasOwn(available, path)) return new Response('No s’ha trobat', { status: 404 });
    return new Response(event.request.method === 'HEAD' ? null : available[path], { headers: { 'Content-Type': contentType(path), 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive' } });
  })());
});
