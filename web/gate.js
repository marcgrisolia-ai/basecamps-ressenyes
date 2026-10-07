const base = new URL('./', location.href);
const gate = document.getElementById('gate');
const viewer = document.getElementById('viewer');
const frame = document.getElementById('frame');
const form = document.getElementById('login');
const password = document.getElementById('password');
const submit = document.getElementById('submit');
const error = document.getElementById('error');
const show = document.getElementById('show');
let controller;
const fromBase64 = (value) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

function request(message) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => reject(new Error('timeout')), 60000);
    channel.port1.onmessage = ({ data }) => { clearTimeout(timeout); channel.port1.close(); resolve(data); };
    controller.postMessage(message, [channel.port2]);
  });
}
function showLogin(message = '') {
  frame.removeAttribute('src'); viewer.hidden = true; gate.hidden = false; submit.disabled = false; error.textContent = message; password.value = ''; password.focus();
}
function openViewer() {
  const candidate = new URLSearchParams(location.search).get('next');
  const target = candidate ? new URL(candidate, base) : new URL('__private/index.html', base);
  const valid = target.origin === base.origin && target.pathname.startsWith(base.pathname + '__private/');
  frame.src = valid ? target.href : new URL('__private/index.html', base).href;
  gate.hidden = true; viewer.hidden = false; password.value = '';
}
show.addEventListener('click', () => {
  const visible = password.type === 'password'; password.type = visible ? 'text' : 'password'; show.textContent = visible ? 'Amaga' : 'Mostra'; show.setAttribute('aria-label', visible ? 'Amaga la contrasenya' : 'Mostra la contrasenya'); show.setAttribute('aria-pressed', String(visible)); password.focus();
});
form.addEventListener('submit', async event => {
  event.preventDefault(); submit.disabled = true; error.textContent = 'Obrint el visor…';
  try {
    const response = await fetch(new URL('crypto.json', base), { cache: 'no-store' });
    if (!response.ok) throw new Error('config');
    const config = await response.json();
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.value), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: fromBase64(config.salt), iterations: config.iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    password.value = '';
    const result = await request({ type: 'UNLOCK', key });
    if (!result.ok) { showLogin(result.reason === 'invalid' ? 'Contrasenya incorrecta. Torna-ho a provar.' : 'No s’ha pogut obrir el visor. Torna-ho a provar.'); return; }
    openViewer();
  } catch { showLogin('No s’ha pogut preparar l’accés. Recarrega la pàgina i torna-ho a provar.'); }
});
document.getElementById('logout').addEventListener('click', async () => { await request({ type: 'LOCK' }); showLogin(); });
navigator.serviceWorker?.addEventListener('message', event => { if (event.data?.type === 'LOCKED') showLogin('La sessió s’ha tancat. Introdueix la contrasenya per tornar a entrar.'); });

async function initialize() {
  if (window.top !== window.self) { window.top.location.href = base.href; return; }
  if (!window.isSecureContext || !navigator.serviceWorker || !crypto.subtle || !window.DecompressionStream) throw new Error('unsupported');
  await navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.pathname });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  controller = navigator.serviceWorker.controller;
  const status = await request({ type: 'STATUS' });
  if (status.ok) openViewer(); else showLogin();
}
initialize().catch(() => { error.textContent = 'Cal obrir aquest enllaç amb HTTPS i un navegador actual (Chrome, Safari, Edge o Firefox).'; submit.disabled = true; });
