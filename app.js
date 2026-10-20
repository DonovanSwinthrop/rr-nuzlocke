/* RR Nuzlocke Web: mGBA in the browser (iPhone / any browser) with the Radical Red overlay fed straight from emulator memory. */
import mGBA from './mgba/mgba.js';
import { locateRam, makeReader, stillValid, buildState, buildPC, FRAME_COUNTER } from './memstate.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const ROM_NAME = 'RadicalRed.gba', SAV_NAME = 'RadicalRed.sav';
const PREF_KEY = 'rrweb-prefs';
const pref = Object.assign({ ff: 3, vol: 1 }, (() => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch (e) { return {}; } })());
const savePref = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch (e) { /* private mode */ } };
const status = t => { $('#status').textContent = t; };

let Module = null, P = null, loaded = false, running = false, view = 'pad', ffOn = false;
let mem = null, loc = null, read = null, frame = 0, lastPC = 0, ovReady = false;

/* ---------- start-up ---------- */
async function init() {
  if (!window.crossOriginIsolated) { status('Setting up… (the page reloads once)'); return; } // coi-serviceworker reloads us
  status('Starting emulator…');
  Module = await mGBA({ canvas: $('#canvas') });
  await Module.FSInit();
  P = Module.filePaths();
  coreSettings(); clearAutoSaves(); syncSoon();
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* ignore */ }
  Module.addCoreCallbacks({
    saveDataUpdatedCallback: () => syncSoon(),
    coreCrashedCallback: () => showFrozen('The emulator crashed.')
  });
  applyPrefs();
  if (hasFile(P.gamePath + '/' + ROM_NAME)) startGame();
  else { $('#welcome').hidden = false; status('Choose your ROM to start'); }
}
const hasFile = p => { try { Module.FS.stat(p); return true; } catch (e) { return false; } };
let syncTimer = null;
/* One storage write at a time: overlapping writes pile up on long sessions. A request made while one is running is
   folded into a single follow-up write. */
let syncing = null, syncAgain = false;
function fsSync() {
  if (!Module) return Promise.resolve();
  if (syncing) { syncAgain = true; return syncing; }
  syncing = Module.FSSync().catch(() => {}).then(() => { syncing = null; if (syncAgain) { syncAgain = false; return fsSync(); } });
  return syncing;
}
function syncSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(fsSync, 1500); }

/* Always boot fresh: no rewind, and no auto save states (the core snapshots every 30 s and restores the last one on
   load, which made reopening the app or loading the ROM again drop you back mid-game). Your in-game save is kept. */
function coreSettings() {
  try { Module.setCoreSettings({ rewindEnable: false, autoSaveStateEnable: false, restoreAutoSaveStateOnLoad: false }); } catch (e) { /* older core */ }
}
function clearAutoSaves() {
  try { for (const f of Module.FS.readdir(P.autosave)) if (f !== '.' && f !== '..') Module.FS.unlink(P.autosave + '/' + f); } catch (e) { /* none */ }
}
function startGame() {
  $('#welcome').hidden = true;
  coreSettings(); clearAutoSaves();
  const ok = Module.loadGame(P.gamePath + '/' + ROM_NAME, P.savePath + '/' + SAV_NAME);
  if (!ok) { status('Could not load the ROM'); $('#welcome').hidden = false; return; }
  loaded = true; running = true; userPaused = false; updatePauseBtn(); loc = null; read = null; $('#pausedNote').hidden = true;
  try { Module.toggleRewind(false); } catch (e) { /* older core */ }
  Module.setVolume(pref.vol);
  applySaver();
  setTimeout(() => cloudTick(), 6000);
  status('Playing' + verTxt());
  // coming back from "Game froze → Recover": load the newest auto state once the game is up
  let rec = null; try { rec = localStorage.getItem('rrweb-recover'); localStorage.removeItem('rrweb-recover'); } catch (e) { /* ignore */ }
  if (rec && newestAuto()) {
    let tries = 0;
    const attempt = () => {
      let ok = false; try { ok = Module.loadState(newestAuto()); } catch (e) { ok = false; }
      // the core needs a moment after booting; the load "works" too early but the game then boots over it, so check the game is in
      setTimeout(() => { if (ok && inGameNow()) { status('Recovered from the auto state'); return; } if (++tries < 8) attempt(); else status('Recover: load the newest auto state from ☰'); }, 1500);
    };
    setTimeout(attempt, 2000);
  }
}
const verTxt = () => (window.APP_VERSION ? ' · v' + window.APP_VERSION.n : '');
// a new version was downloaded in the background: say so (it is used the next time the app opens)
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('controllerchange', async () => {
  try {
    const t = await (await fetch('version.js', { cache: 'no-store' })).text(), m = t.match(/"n":(\d+)/);
    if (m && window.APP_VERSION && +m[1] !== window.APP_VERSION.n) { status('Update v' + m[1] + ' downloaded: close the app and open it again'); const v = $('#verTag'); if (v) v.textContent += ' (v' + m[1] + ' ready: reopen the app)'; }
  } catch (e) { /* offline */ }
});
function applySaver() { try { Module.setCoreSettings({ frameSkip: pref.saver ? 1 : 0 }); } catch (e) { /* older core */ } }
// Is a save loaded (party in RAM)? Looks the RAM up directly, since the overlay reader may not be set up yet.
function inGameNow() {
  try {
    const m = window.__mems.find(x => x.buffer.byteLength >= 0x1000000); if (!m) return false;
    const u = new Uint32Array(m.buffer), b = new Uint8Array(m.buffer);
    for (let i = 2; i < u.length; i++) {
      const off = u[i] - 0x02029314; // the save blocks can sit 0-124 bytes further on
      if (off < 0 || off > 0x7C || (off & 3) || u[i - 2] !== 0x0202552C + off || u[i - 1] !== 0x02024588 + off) continue;
      const ew = i * 4 - 0x5010 - 0x40000;
      if (ew >= 0 && b[ew + 0x24029] > 0) return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}
// the newest auto state whose file really is on the phone (one written as the app was closing may not have made it)
function newestAuto() { return AUTO.filter(n => slotMeta[n] && hasFile(slotFile(n))).sort((a, b) => slotMeta[b] - slotMeta[a])[0] || null; }

/* ---------- freeze watchdog ----------
   The game counts its own frames (gMain.vblankCounter2, 0x03003114, +60 a second). If the game is meant to be running but
   that counter hasn't moved for 6 seconds, show a Recover button: it saves nothing
   (a frozen core can't), reloads the app and puts you back at the newest auto state (at most a few minutes back). */
const frameCount = r => { const b = r(FRAME_COUNTER, 4); return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0; };
let lastCnt = -1, lastLiveAt = 0;
function showFrozen(why) {
  const el = $('#frozen'); if (!el || !el.hidden) return;
  $('#frozenWhy').textContent = (why || 'The game stopped drawing frames.') + (newestAuto() ? ' Recover reloads and puts you back at your newest auto state.' : ' Recover reloads the app; load your in-game save.');
  el.hidden = false;
}
// The feed (below) notes when the game's frame counter last moved (lastLiveAt) and re-finds the live memory when it stalls;
// only if the counter stays still for 8 s even after that is the game itself frozen.
setInterval(() => {
  if (!loaded || !running || userPaused || document.hidden || !lastLiveAt) return;
  const stale = Date.now() - lastLiveAt;
  if (stale > 8000) showFrozen();
  else if (stale < 2000 && !$('#frozen').hidden) $('#frozen').hidden = true; // it came back by itself
}, 1000);
// after a pause or the app was in the background, the counter hasn't moved: don't count that time
const freshLive = () => { if (lastLiveAt) lastLiveAt = Date.now(); };

async function writeFile(file, path) {
  const data = new Uint8Array(await file.arrayBuffer());
  Module.FS.writeFile(path, data);
  await fsSync();
  return data.length;
}
async function onRom(e) {
  const input = e.target, f = input.files[0]; input.value = ''; if (!f) return;
  closeMenu(true);
  busy('Loading ROM…');
  try {
    if (loaded) { try { Module.quitGame(); } catch (err) { /* ignore */ } loaded = false; }
    await writeFile(f, P.gamePath + '/' + ROM_NAME);
    busy(null); startGame();
  } catch (err) { busy(null); alert('Could not load that ROM: ' + (err.message || err)); status('Choose your ROM to start'); $('#welcome').hidden = false; }
}
// A full-screen "working…" note (copying a 32 MB ROM into the phone's storage takes a few seconds).
function busy(text) { const b = $('#busy'); if (!text) { b.hidden = true; return; } b.textContent = text; b.hidden = false; status(text); }
/* ---------- moving the save between this phone and the PC ----------
   The save reader from the overlay says what's in a save (trainer, badges, play time, party), so importing can warn
   about an older save or a different run. The save it replaces is kept so Undo can put it back. */
let readerP = null;
function loadReader() {
  if (window.RRSave && window.RR_SAVE) return Promise.resolve();
  const add = src => new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc); });
  if (!readerP) readerP = add('overlay/savedata.js').then(() => add('overlay/savereader.js')).catch(err => { readerP = null; throw err; });
  return readerP;
}
function describeSave(bytes) {
  try { return window.RRSave.readSave(new Uint8Array(bytes).slice().buffer, window.RR_SAVE); } catch (e) { return null; }
}
const playMins = r => (r && r.playTime ? r.playTime.h * 60 + r.playTime.m + r.playTime.s / 60 : 0);
const saveTxt = r => (r ? `${r.trainer} · ${r.badges.length} badge${r.badges.length === 1 ? '' : 's'} · ${r.playTime.h}:${String(r.playTime.m).padStart(2, '0')} played\n${r.party.map(m => (m.nick || m.species) + ' ' + m.level).join(', ')}` : "can't be read");
const savePath = () => P.savePath + '/' + SAV_NAME, prevPath = () => P.savePath + '/RadicalRed.prev.sav';
function currentSave() { try { return loaded ? Module.getSave() : (hasFile(savePath()) ? Module.FS.readFile(savePath()) : null); } catch (e) { return null; } }
async function onSav(e) {
  const input = e.target, f = input.files[0]; input.value = ''; if (!f) return;
  const data = new Uint8Array(await f.arrayBuffer());
  const cur = currentSave();
  let q = 'Replace the save on this phone with ' + f.name + '?';
  try {
    await loadReader();
    const inc = describeSave(data), now = cur ? describeSave(cur) : null;
    if (!inc) q = f.name + " doesn't look like a Radical Red save. Import it anyway?";
    else {
      q = `Load this save?\n\n${f.name}\n${saveTxt(inc)}`;
      if (now) {
        q += `\n\nThe save on this phone now:\n${saveTxt(now)}`;
        if (now.trainerId !== inc.trainerId) q += '\n\nThese are different runs.';
        else if (playMins(inc) < playMins(now) - 0.02) q += '\n\nCareful: the save you picked is OLDER than the one on this phone.';
      }
    }
  } catch (err) { /* reader missing: plain question */ }
  q += '\n\n(The save on this phone is kept: ☰ → Undo last import puts it back.)';
  if (!confirm(q)) return;
  await importBytes(data, f.name);
}
// Put a save in place of this phone's one: the old one is kept for Undo, the auto states (old save) are cleared.
async function importBytes(data, name) {
  const cur = currentSave();
  closeMenu(true); busy('Loading save…');
  try {
    if (loaded) { try { Module.quitGame(); } catch (err) { /* ignore */ } loaded = false; }
    if (cur) { Module.FS.writeFile(prevPath(), cur); try { localStorage.setItem('rrweb-prev', JSON.stringify({ when: Date.now(), name })); } catch (err) { /* ignore */ } }
    Module.FS.writeFile(savePath(), data);
    // the auto states belong to the old save: "Recover" must not bring it back
    AUTO.forEach(n => { try { if (hasFile(slotFile(n))) Module.FS.unlink(slotFile(n)); } catch (err) { /* ignore */ } delete slotMeta[n]; }); saveMeta();
    await fsSync();
    busy(null);
    if (hasFile(P.gamePath + '/' + ROM_NAME)) startGame();
    undoNote();
    return true;
  } catch (err) { busy(null); alert('Could not load that save: ' + (err.message || err)); return false; }
}

/* ---------- cloud saves: one run on phone and PC ----------
   The Netlify site keeps one save per sync code (/api/saves). Every 30 s, and when you come back to the app, this
   compares the phone's save, the cloud save and the last save both agreed on (cloud.synced): only the phone changed ->
   upload it; only the cloud changed (the PC saved) -> a banner offers it; both changed -> you pick. */
// Cloud saves live in the Netlify Function. On Netlify it's the same site; anywhere else (GitHub Pages) the app calls it directly
// (the function allows cross-site calls), so moving the app never needs a Netlify deploy.
const CLOUD_HOME = 'https://harmonious-fox-f97681.netlify.app/api/saves';
const CLOUD_API = (() => { const def = /netlify\.app$/.test(location.hostname) ? '/api/saves' : CLOUD_HOME; try { return localStorage.getItem('rrweb-cloud-api') || def; } catch (e) { return def; } })();
let cloud = (() => { try { return JSON.parse(localStorage.getItem('rrweb-cloud') || 'null'); } catch (e) { return null; } })();
const saveCloud = () => { try { localStorage.setItem('rrweb-cloud', JSON.stringify(cloud)); } catch (e) { /* ignore */ } };
let cloudPending = null, cloudBusy = false, cloudErr = '', cloudMsg = '', cloudUnreadable = false;
// the game data only (the last 16 bytes are the emulator's clock, which changes without any saving)
const hash128 = b => { let h = 0x811c9dc5; for (let i = 0, n = Math.min(b.length, 131072); i < n; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
// `settled`: the save has looked the same for 4 s, so the game is not in the middle of writing it
let seen = { hash: '', at: 0 }, desc = { hash: '', meta: null };
async function localSaveInfo() {
  const bytes = currentSave(); if (!bytes || !bytes.length) return null;
  const hash = hash128(bytes);
  if (hash !== seen.hash) seen = { hash, at: Date.now() };
  if (desc.hash !== hash) {
    await loadReader();
    const r = describeSave(bytes);
    desc = { hash, meta: r ? { trainer: r.trainer, trainerId: r.trainerId, playTime: r.playTime, saveCount: r.saveCount, badges: r.badges.length, party: r.party.map(m => (m.nick || m.species) + ' ' + m.level), hash } : null };
  }
  cloudUnreadable = !desc.meta;
  return desc.meta ? { bytes: bytes.slice(0), meta: desc.meta, settled: Date.now() - seen.at >= 4000 } : null;
}
const cloudUrl = what => CLOUD_API + '?code=' + encodeURIComponent(cloud.code) + (what ? '&what=' + what : '');
const fetchT = (url, opt, ms) => { const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms || 15000); return fetch(url, Object.assign({}, opt, { signal: ac.signal })).finally(() => clearTimeout(t)); };
const withTimeout = (p, ms) => Promise.race([p, new Promise(ok => setTimeout(() => ok(null), ms))]);
let cloudBusyAt = 0;
async function cloudTick(force) {
  if (cloudBusy && Date.now() - cloudBusyAt > 30000) cloudBusy = false; // an earlier check got stuck
  if (!cloud || !cloud.code || cloudBusy) return;
  if (!navigator.onLine) { cloudErr = 'offline'; renderCloudMenu(); return; }
  cloudBusy = true; cloudBusyAt = Date.now();
  let again = 0;
  try {
    const local = loaded ? await withTimeout(localSaveInfo(), 8000) : null;
    if (local && !local.settled && local.meta.hash !== cloud.synced) { again = 5000; return; } // just saved: look again once the game has finished
    const res = await fetchT(cloudUrl('meta'), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'not set up' : 'cloud ' + res.status);
    const cm = await res.json(), ch = cm.empty ? null : cm.hash;
    const localNew = !!local && local.meta.hash !== cloud.synced, cloudNew = !!ch && ch !== cloud.synced;
    cloudPending = null;
    if (local && ch === local.meta.hash) cloud.synced = ch;
    else if (local && (!ch || (localNew && !cloudNew) || force === 'keep')) {
      const up = await fetchT(cloudUrl(), { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-meta': JSON.stringify(Object.assign({}, local.meta, { device: 'Phone', savedAt: Date.now() })) }, body: local.bytes.slice(0) });
      if (!up.ok) throw new Error('upload ' + up.status);
      cloud.synced = local.meta.hash; cloud.lastUp = Date.now();
    } else if (cloudNew && loaded) {
      cloudPending = { kind: !cloud.synced ? 'first' : localNew ? 'conflict' : 'newer', cloud: cm, local: local && local.meta };
      if (cloudPending.kind === 'newer' && cm.hash === cloud.dismissed) cloudPending = null;
    }
    cloud.checked = Date.now(); cloudErr = '';
  } catch (e) { cloudErr = String(e.message || e); }
  finally { cloudBusy = false; saveCloud(); renderCloudBanner(); renderCloudMenu(); if (again) setTimeout(() => cloudTick(force), again); }
}
const cloudTxt = m => (m ? `${m.trainer || '?'} · ${m.badges} badge${m.badges === 1 ? '' : 's'} · ${m.playTime ? m.playTime.h + ':' + String(m.playTime.m).padStart(2, '0') : '?'} played${m.party && m.party.length ? ' · ' + m.party.join(', ') : ''}` : '');
const escH = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderCloudBanner() {
  const el = $('#cloudBanner'); if (!el) return;
  const p = cloudPending;
  if (!p) { el.hidden = true; el.innerHTML = ''; return; }
  const c = p.cloud, from = c.device === 'Phone' ? 'another phone' : 'your PC';
  el.innerHTML = p.kind === 'conflict' || p.kind === 'first'
    ? `<b>☁ ${p.kind === 'first' ? 'The cloud already has a save. Which one do you want to play?' : "This phone's save and the cloud save both changed."}</b><div class="small">Cloud (from ${from}, ${ago(c.uploadedAt)}): ${escH(cloudTxt(c))}<br>This phone: ${escH(cloudTxt(p.local))}</div>
       <button class="btn" data-cb="load">Use the cloud save</button> <button class="btn" data-cb="keep">Keep this phone's</button>`
    : `<b>☁ Newer save from ${from}</b> <span class="small muted">${ago(c.uploadedAt)}</span><div class="small">${escH(cloudTxt(c))}</div>
       <button class="btn" data-cb="load">Continue from it</button> <button class="btn" data-cb="later">Not now</button>`;
  el.hidden = false;
  el.querySelectorAll('[data-cb]').forEach(b => b.onclick = () => cloudAction(b.dataset.cb));
}
async function cloudAction(k) {
  if (!cloudPending) return;
  const c = cloudPending.cloud;
  if (k === 'later') { cloud.dismissed = c.hash; cloudPending = null; saveCloud(); renderCloudBanner(); return; }
  if (k === 'keep') { if (!confirm("Keep this phone's save? It replaces the cloud save (the cloud keeps the last 10, so the PC's save can still be found).")) return; await cloudTick('keep'); return; }
  if (!confirm(`Continue from the cloud save?

${cloudTxt(c)}

The save on this phone is kept: ☰ → Undo last import puts it back.`)) return;
  try {
    busy('Downloading save…');
    const res = await fetch(cloudUrl('data'), { cache: 'no-store' });
    if (!res.ok) throw new Error('download ' + res.status);
    const data = new Uint8Array(await res.arrayBuffer());
    busy(null);
    if (await importBytes(data, 'the cloud save (' + (c.device || '?') + ')')) { cloud.synced = hash128(data); cloudPending = null; saveCloud(); renderCloudBanner(); status('Loaded the cloud save'); }
  } catch (e) { busy(null); alert('Could not get the cloud save: ' + (e.message || e)); }
}
function renderCloudMenu() {
  const el = $('#cloudMenu'); if (!el) return;
  if (!cloud || !cloud.code) {
    el.innerHTML = `<p class="muted small">Play one run on this phone and your PC: every save you make in the game goes to your own Netlify site, and the other device asks if you want to continue from it.</p>
      <p class="small">Have a code from the PC overlay? Enter it:</p>
      <div class="row"><input id="cloudCode" placeholder="ABCD-EFGH-JKLM-NPQR" autocapitalize="characters" autocomplete="off" spellcheck="false"> <button class="btn" id="cloudUse">Use code</button></div>
      <p class="small">No code yet?</p>
      <button class="btn" id="cloudNew">Turn on with a new code</button>${cloudMsg ? `<p class="small">${cloudMsg}</p>` : ''}`;
  } else {
    el.innerHTML = `<p class="small">Sync code <b>${escH(cloud.code)}</b> <button class="btn small-btn" id="cloudCopy">Copy</button></p>
      <p class="muted small">${cloudErr === 'not set up' ? `<span style="color:var(--warn)">Cloud saves are not on the app's site yet: on the PC, double-click Deploy to Netlify.cmd in the RR Nuzlocke Web folder once.</span>` : cloudErr ? `<span style="color:var(--warn)">Can't reach the cloud (${escH(cloudErr)}); it keeps trying.</span>` : cloud.checked ? 'Checked ' + ago(cloud.checked) + (cloud.lastUp ? ' · last upload ' + ago(cloud.lastUp) : '') : 'Connecting…'}</p>
      ${cloudUnreadable ? '<p class="small" style="color:var(--warn)">The save on this phone could not be read, so it is not being sent. Save in the game again.</p>' : ''}
      <p class="muted small">On the PC: overlay ⚙ → Cloud saves → enter this code.</p>
      <button class="btn" id="cloudCheck">Check now</button> <button class="btn" id="cloudOff">Turn off</button>${cloudMsg ? `<p class="small">${cloudMsg}</p>` : ''}`;
  }
  const on = (id, fn) => { const b = $('#' + id); if (b) b.onclick = fn; };
  const fmt = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');
  on('cloudUse', () => { const c = fmt($('#cloudCode').value); if (!/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(c)) { cloudMsg = 'That code should look like ABCD-EFGH-JKLM-NPQR.'; renderCloudMenu(); return; } cloud = { code: c }; cloudMsg = 'Linked to ' + c + '. Checking the cloud…'; saveCloud(); renderCloudMenu(); cloudTick(); });
  on('cloudNew', () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(16)); let c = ''; for (let i = 0; i < 16; i++) c += A[b[i] % 32] + (i % 4 === 3 && i < 15 ? '-' : ''); cloud = { code: c }; cloudMsg = 'Cloud saves are on. Enter this code on the PC.'; saveCloud(); renderCloudMenu(); cloudTick(); });
  on('cloudCopy', () => { try { navigator.clipboard.writeText(cloud.code); cloudMsg = 'Copied.'; } catch (e) { /* ignore */ } renderCloudMenu(); });
  on('cloudCheck', () => cloudTick());
  on('cloudOff', () => { if (!confirm('Turn cloud saves off on this phone? (Nothing is deleted.)')) return; cloud = null; cloudPending = null; cloudMsg = 'Cloud saves are off on this phone.'; saveCloud(); renderCloudBanner(); renderCloudMenu(); });
}
setInterval(() => { if (!document.hidden) cloudTick(); }, 30000);

function undoImport() {
  if (!hasFile(prevPath())) return;
  if (!confirm('Put back the save this phone had before the last import? (The current one is swapped out, so you can undo this too.)')) return;
  closeMenu(true); busy('Restoring…');
  try {
    if (loaded) { try { Module.quitGame(); } catch (err) { /* ignore */ } loaded = false; }
    const prev = Module.FS.readFile(prevPath()), cur = hasFile(savePath()) ? Module.FS.readFile(savePath()) : null;
    Module.FS.writeFile(savePath(), prev);
    if (cur) Module.FS.writeFile(prevPath(), cur);
    AUTO.forEach(n => { try { if (hasFile(slotFile(n))) Module.FS.unlink(slotFile(n)); } catch (err) { /* ignore */ } delete slotMeta[n]; }); saveMeta();
    fsSync().then(() => { busy(null); if (hasFile(P.gamePath + '/' + ROM_NAME)) startGame(); undoNote(); });
  } catch (err) { busy(null); alert('Could not restore: ' + (err.message || err)); }
}
function undoNote() {
  const b = $('#undoImport'); if (!b) return;
  let m = null; try { m = JSON.parse(localStorage.getItem('rrweb-prev') || 'null'); } catch (e) { /* ignore */ }
  b.hidden = !(P && hasFile(prevPath()));
  if (m) b.textContent = 'Undo last import (' + new Date(m.when).toLocaleDateString() + ')';
}
// "Send save to PC": the share sheet (Save to Files → OneDrive / iCloud, Mail...), or a normal download elsewhere.

/* ---------- pause / resume ---------- */
/* Pausing happens only when you press Pause (userPaused). Nothing else pauses the game. */
let userPaused = false;
function pause() { if (!loaded || !running) return; Module.pauseGame(); running = false; $('#pausedNote').hidden = false; status('Paused'); updatePauseBtn(); }
function resume() { freshLive(); if (!loaded) return; if (!running) { Module.resumeGame(); running = true; } $('#pausedNote').hidden = true; status('Playing'); unlockAudio(true); updatePauseBtn(); }
function togglePause() { userPaused = !userPaused; if (userPaused) pause(); else resume(); }
function updatePauseBtn() { const b = $('#pauseBtn'); if (b) { b.textContent = userPaused ? '▶ Play' : '⏸ Pause'; b.classList.toggle('on', userPaused); } }
function setView(v) {
  view = v;
  $$('#switch button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('#pad').hidden = v !== 'pad'; $('#overlay').hidden = v !== 'overlay';

}

/* ---------- controls ---------- */
const held = new Set();
function press(k) { if (!loaded || held.has(k)) return; held.add(k); Module.buttonPress(k); }
function release(k) { if (!held.has(k)) return; held.delete(k); if (loaded) Module.buttonUnpress(k); }
function bindButtons() {
  $$('[data-key]').forEach(b => {
    const k = b.dataset.key;
    const down = e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) { /* not capturable: fine */ } b.classList.add('pressed'); press(k); unlockAudio(); };
    const up = e => { e.preventDefault(); b.classList.remove('pressed'); release(k); };
    b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  });
  // D-pad: the direction comes from where the thumb is relative to the centre (diagonals work, slide between directions)
  const pad = $('#dpad'), parts = { Up: pad.querySelector('.u'), Down: pad.querySelector('.d'), Left: pad.querySelector('.l'), Right: pad.querySelector('.r') };
  let padPointer = null;
  const setDirs = dirs => ['Up', 'Down', 'Left', 'Right'].forEach(d => { if (dirs.includes(d)) { press(d); parts[d].classList.add('pressed'); } else { release(d); parts[d].classList.remove('pressed'); } });
  const fromEvent = e => {
    const r = pad.getBoundingClientRect(), x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2), dz = r.width * 0.12, out = [];
    if (Math.hypot(x, y) < dz) return out;
    const a = Math.atan2(y, x) * 180 / Math.PI; // -180..180, 0 = right, 90 = down
    if (a > -67.5 && a < 67.5) out.push('Right'); if (a > 112.5 || a < -112.5) out.push('Left');
    if (a > 22.5 && a < 157.5) out.push('Down'); if (a < -22.5 && a > -157.5) out.push('Up');
    return out;
  };
  pad.addEventListener('pointerdown', e => { e.preventDefault(); padPointer = e.pointerId; try { pad.setPointerCapture(e.pointerId); } catch (err) { /* fine */ } setDirs(fromEvent(e)); unlockAudio(); });
  pad.addEventListener('pointermove', e => { if (e.pointerId === padPointer) setDirs(fromEvent(e)); });
  const end = e => { if (e.pointerId === padPointer) { padPointer = null; setDirs([]); } };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end); pad.addEventListener('lostpointercapture', end);
  // keyboard (desktop / iPad keyboard)
  const KEYS = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', z: 'A', x: 'B', a: 'L', s: 'R', Enter: 'Start', Backspace: 'Select' };
  const typing = e => !!(e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable]'));
addEventListener('keydown', e => { if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return; if (e.key === 'p' || e.key === 'P') { e.preventDefault(); if (!e.repeat) togglePause(); return; } const k = KEYS[e.key] || KEYS[e.key.toLowerCase()]; if (k) { e.preventDefault(); press(k); } if (e.key === ' ') { e.preventDefault(); toggleFF(); } });
  addEventListener('keyup', e => { const k = KEYS[e.key] || KEYS[e.key.toLowerCase()]; if (k) release(k); });
  // never leave a button stuck down when the page loses focus
  addEventListener('blur', () => [...held].forEach(release));
}
/* ---------- game controller (Bluetooth / MFi: Xbox, PlayStation, Switch Pro...) ----------
   Standard mapping: A/Cross = A, B/Circle = B (swap in the menu), LB/L1 = L, RB/R1 = R, Start/Options = Start,
   Back/Share = Select, d-pad or left stick = d-pad, RT/R2 held = fast forward, LT/L2 = toggle the overlay. */
const padHeld = new Set(); let ffByPad = false, ovBtnWas = false;
function pollPads() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const want = new Set();
  let ffBtn = false, ovBtn = false;
  for (const g of pads) {
    const b = i => g.buttons[i] && (g.buttons[i].pressed || g.buttons[i].value > 0.5);
    const ax = (i, s) => g.axes[i] != null && g.axes[i] * s > 0.5;
    if (b(pref.swapAB ? 1 : 0)) want.add('A'); if (b(pref.swapAB ? 0 : 1)) want.add('B');
    if (b(4)) want.add('L'); if (b(5)) want.add('R');
    if (b(9)) want.add('Start'); if (b(8)) want.add('Select');
    if (b(12) || ax(1, -1)) want.add('Up'); if (b(13) || ax(1, 1)) want.add('Down');
    if (b(14) || ax(0, -1)) want.add('Left'); if (b(15) || ax(0, 1)) want.add('Right');
    if (b(7)) ffBtn = true; if (b(6)) ovBtn = true;
  }
  want.forEach(k => { if (!padHeld.has(k)) { padHeld.add(k); press(k); } });
  [...padHeld].forEach(k => { if (!want.has(k)) { padHeld.delete(k); release(k); } });
  if (ffBtn !== ffByPad) { ffByPad = ffBtn; if (loaded) Module.setFastForwardMultiplier(ffBtn || ffOn ? pref.ff : 1); }
  if (ovBtn && !ovBtnWas && !landscape()) setView(view === 'pad' ? 'overlay' : 'pad');
  ovBtnWas = ovBtn;
  if (pads.length) { if (!$('#padNote').textContent) $('#padNote').textContent = 'Controller connected'; unlockAudio(); }
  requestAnimationFrame(pollPads);
}
addEventListener('gamepadconnected', () => { $('#padNote').textContent = 'Controller connected'; status('Controller connected'); });
addEventListener('gamepaddisconnected', () => { $('#padNote').textContent = ''; });
requestAnimationFrame(pollPads);
function toggleFF() { ffOn = !ffOn; if (loaded) Module.setFastForwardMultiplier(ffOn ? pref.ff : 1); $('#ff').classList.toggle('on', ffOn); }
let audioUnlocked = false;
function unlockAudio(force) {
  if ((audioUnlocked && !force) || !Module) return;
  audioUnlocked = true;
  try { Module.resumeAudio(); } catch (e) { /* ignore */ }
  try { const ctx = Module.SDL2 && Module.SDL2.audioContext; if (ctx && ctx.state !== 'running') ctx.resume(); } catch (e) { /* ignore */ }
}

/* ---------- save states: 6 manual slots + 3 rotating auto slots ----------
   Slots 1-6 are yours; 7-9 are filled in turn by the auto save (every few minutes and whenever you leave the app).
   Every state is written straight to the phone's storage, so a freeze or iOS closing the app can't lose it. */
const MANUAL = [1, 2, 3, 4, 5, 6], AUTO = [7, 8, 9];
let slotMeta = (() => { try { return JSON.parse(localStorage.getItem('rrweb-slots') || '{}'); } catch (e) { return {}; } })();
const saveMeta = () => { try { localStorage.setItem('rrweb-slots', JSON.stringify(slotMeta)); } catch (e) { /* ignore */ } };
const slotFile = n => P && (P.saveStatePath + '/' + ROM_NAME.replace(/\.gba$/, '') + '.ss' + n);
function inGame() { try { return !!(read && stillValid(read) && read(0x02024029, 1)[0] > 0); } catch (e) { return false; } } // past the title screen with a party
async function saveSlot(n, quiet) {
  if (!loaded) return false;
  let ok = false;
  try { ok = Module.saveState(n); } catch (e) { ok = false; }
  if (!ok) { if (!quiet) alert('Could not save the state.'); return false; }
  slotMeta[n] = Date.now(); saveMeta();
  await fsSync();
  renderSlots();
  if (!quiet) status('Saved state ' + (AUTO.includes(n) ? 'auto' : n));
  return true;
}
function loadSlot(n) {
  if (!loaded || !slotMeta[n]) return;
  if (!confirm('Load this state? Anything since then is lost (your in-game save is not touched).')) return;
  let ok = false;
  try { ok = Module.loadState(n); } catch (e) { ok = false; }
  if (!ok) { alert('That state could not be loaded.'); return; }
  loc = null; closeMenu(); status('Loaded state');
}
async function autoSave(reason) {
  if (!loaded || !inGame()) return;
  const next = AUTO.reduce((a, b) => ((slotMeta[a] || 0) <= (slotMeta[b] || 0) ? a : b));
  await saveSlot(next, true);
  status('Auto-saved' + (reason ? ' (' + reason + ')' : ''));
}
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString(); };
function renderSlots() {
  [...MANUAL, ...AUTO].forEach(n => { if (slotMeta[n] && P && !hasFile(slotFile(n))) { delete slotMeta[n]; saveMeta(); } }); // never list a state that didn't get written
  const el = $('#slots'); if (!el) return;
  const row = (n, label) => `<div class="slot"><span><b>${label}</b> <small class="muted">${slotMeta[n] ? ago(slotMeta[n]) : 'empty'}</small></span>
    ${MANUAL.includes(n) ? `<button class="btn" data-ss="${n}">Save</button>` : ''}<button class="btn" data-sl="${n}" ${slotMeta[n] ? '' : 'disabled'}>Load</button></div>`;
  const autos = AUTO.slice().sort((a, b) => (slotMeta[b] || 0) - (slotMeta[a] || 0));
  el.innerHTML = MANUAL.map(n => row(n, 'Slot ' + n)).join('') + autos.map((n, k) => row(n, k === 0 ? 'Auto (newest)' : 'Auto (older)')).join('');
  el.querySelectorAll('[data-ss]').forEach(b => b.onclick = () => { const n = +b.dataset.ss; if (!slotMeta[n] || confirm('Overwrite slot ' + n + '?')) saveSlot(n); });
  el.querySelectorAll('[data-sl]').forEach(b => b.onclick = () => loadSlot(+b.dataset.sl));
}
let autoTimer = null;
function scheduleAuto() {
  clearInterval(autoTimer);
  autoTimer = setInterval(() => { const mins = pref.autoMins == null ? 3 : pref.autoMins; if (!mins) return; const last = Math.max(0, ...AUTO.map(n => slotMeta[n] || 0)); if (Date.now() - last >= mins * 60000 && running) autoSave(); }, 20000);
}
// keep the in-game save safe too: write storage every minute while playing
setInterval(() => { if (loaded) fsSync(); }, 60000);

/* ---------- time of day (game clock only) ---------- */
const TIME_ORDER = ['real', 'morning', 'day', 'dusk', 'night'];
const TIME_LABEL = { real: 'Real', morning: 'Morning', day: 'Day', dusk: 'Dusk', night: 'Night' };
function gameHour() { return new Date(Date.now()).getHours(); }
function setTime(mode) {
  window.__timeMode = mode; pref.time = mode; savePref();
  try { Atomics.store(window.__rrClock, 0, window.TIME_CODES[mode] || 0); } catch (e) { window.__rrClock[0] = window.TIME_CODES[mode] || 0; }
  $('#timeBtn').textContent = TIME_LABEL[mode]; $('#timeBtn').classList.toggle('on', mode !== 'real');
  $$('#timeSeg button').forEach(b => b.classList.toggle('on', b.dataset.time === mode));
  post({ type: 'clock', hour: gameHour() });
  status(mode === 'real' ? 'Game clock: real time' : 'Game clock: ' + TIME_LABEL[mode].toLowerCase());
}

/* ---------- menu ---------- */
function openMenu() { $('#menu').hidden = false; renderSlots(); undoNote(); renderThemes(); renderCloudMenu(); }
// colour themes (overlay/themes.js); the overlay inside the app follows along
function renderThemes() { const el = $('#themePick'); if (!el || !window.RRTheme) return; el.innerHTML = window.RRTheme.pickerHTML(); window.RRTheme.bind(el, renderThemes); }
function closeMenu() { $('#menu').hidden = true; }
// the game and the overlay side by side: a phone held sideways, or a Mac / desktop window (see app.css)
const DESKTOP_MQ = '(hover: hover) and (pointer: fine) and (min-width: 900px)';
const desktop = () => matchMedia(DESKTOP_MQ).matches;
const landscape = () => desktop() || matchMedia('(orientation: landscape) and (max-height: 600px)').matches;
function applyPrefs() {
  if (window.APP_VERSION && $('#verTag')) $('#verTag').textContent = 'version ' + window.APP_VERSION.n + ' · ' + window.APP_VERSION.date;
  if ($('#autoMins')) $('#autoMins').value = String(pref.autoMins == null ? 3 : pref.autoMins);
  $('#swapAB').checked = !!pref.swapAB;
  $('#saver').checked = !!pref.saver;
  if (Module) { try { Module.setVolume(pref.vol); } catch (e) { /* ignore */ } }
}

/* ---------- live feed to the overlay ---------- */
const ov = () => $('#ov').contentWindow;
const post = msg => { if (ovReady) ov().postMessage(Object.assign({ rr: true }, msg), location.origin); };
async function feed() {
  if (!loaded) { setConn(false); return; }
  mem = mem || window.__mems.find(m => m.buffer.byteLength >= 0x1000000) || null;
  if (!mem) return;
  if (!loc) {
    loc = await locateRam(mem, () => running);
    if (!loc) { if (!locateRam.found) lastLiveAt = 0; setConn(false); return; } // title screen: nothing to watch yet
    read = makeReader(mem, loc);
  }
  if (!stillValid(read)) { loc = null; read = null; setConn(false); return; }
  // still reading the live game? Its frame counter must keep ticking while it runs; if not, we're on an old copy of
  // its memory (a save state), so look for the live one again (this is what froze the overlay on an old route)
  const cnt = frameCount(read);
  if (cnt !== lastCnt) { lastCnt = cnt; lastLiveAt = Date.now(); }
  else if (running && !userPaused && !document.hidden && Date.now() - lastLiveAt > 2000) { loc = null; read = null; lastCnt = -1; return; }
  setConn(true);
  const st = buildState(read, frame + 1), sig = JSON.stringify(Object.assign({}, st, { frame: 0 }));
  if (sig === lastSig && Date.now() - lastPost < 3000) return; // nothing new: skip the overlay's work (and the heat)
  lastSig = sig; lastPost = Date.now(); frame++;
  post({ type: 'state', state: st });
  if (Date.now() - lastPC > 8000) { lastPC = Date.now(); const pc = buildPC(read); post({ type: 'pc', pc: pc.pc, x: pc.x }); }
}
let connected = null;
function setConn(v) {
  if (v === connected) return; connected = v;
  $('#dot').classList.toggle('on', v); $('#odot').classList.toggle('on', v);
  post({ type: 'conn', value: v });
}
let feeding = false, lastSig = '', lastPost = 0, lastFeed = 0;
const ovVisible = () => view === 'overlay' || landscape();
// every 300 ms while you can see the overlay, every 1.5 s while it is hidden behind the controls
setInterval(async () => {
  if (feeding || Date.now() - lastFeed < (ovVisible() ? 280 : 1500)) return;
  feeding = true; lastFeed = Date.now();
  try { await feed(); } catch (e) { console.warn(e); loc = null; }
  feeding = false;
}, 300);
addEventListener('message', e => {
  if (e.origin !== location.origin || !e.data || !e.data.rr) return;
  if (e.data.type === 'ready') { ovReady = true; connected = null; lastPC = 0; post({ type: 'clock', hour: gameHour() }); }
  else if (e.data.type === 'back') { if (!landscape()) setView('pad'); }
  if (e.data.type === 'ready') lastSig = '';
});

/* ---------- wire up ---------- */
$('#romInput').addEventListener('change', onRom); $('#romInput2').addEventListener('change', onRom);
$('#savInput').addEventListener('change', onSav);
$('#undoImport').onclick = undoImport;
$('#autoMins').onchange = e => { pref.autoMins = +e.target.value; savePref(); };
$('#reset').onclick = () => { if (loaded && confirm('Reset the game? Unsaved progress is lost.')) { Module.quickReload(); loc = null; closeMenu(); } };
$('#menuBtn').onclick = openMenu;
// the overlay page starts over (the game keeps running); it reconnects by itself
$('#reloadOv').onclick = () => { ovReady = false; lastSig = ''; loc = null; read = null; $('#ov').contentWindow.location.reload(); closeMenu(); status('Overlay reloaded'); };
// the bar button cycles real → morning → day → dusk → night
$('#timeBtn').onclick = () => setTime(TIME_ORDER[(TIME_ORDER.indexOf(pref.time || 'real') + 1) % TIME_ORDER.length]);
$$('#timeSeg button').forEach(b => b.onclick = () => setTime(b.dataset.time));
setInterval(() => post({ type: 'clock', hour: gameHour() }), 60000); $('#closeMenu').onclick = closeMenu;
$('#ff').onclick = toggleFF;
$('#swapAB').onchange = e => { pref.swapAB = e.target.checked; savePref(); };
$('#saver').onchange = e => { pref.saver = e.target.checked; savePref(); if (loaded) applySaver(); };
$('#frozenGo').onclick = () => { try { localStorage.setItem('rrweb-recover', '1'); } catch (e) { /* ignore */ } location.reload(); };
$('#frozenWait').onclick = () => { $('#frozen').hidden = true; freshLive(); };
$('#pauseBtn').onclick = togglePause;
// switching orientation: in landscape both panes are visible, so start playing again
matchMedia('(orientation: landscape) and (max-height: 600px)').addEventListener('change', e => { if (e.matches) { $('#pad').hidden = false; $('#overlay').hidden = false; } else setView(view); });
if (landscape()) { $('#pad').hidden = false; $('#overlay').hidden = false; }
// on a Mac the welcome sheet talks about this computer, not a phone
if (desktop()) {
  $('#welcome h2').textContent = 'Radical Red on your Mac';
  $('#welcome p').textContent = 'Pick your Radical Red ROM (.gba). It stays in this browser and is never uploaded.';
}
$('#ffSpeed').onchange = e => { pref.ff = +e.target.value; savePref(); if (ffOn && loaded) Module.setFastForwardMultiplier(pref.ff); };
$('#vol').oninput = e => { pref.vol = +e.target.value; savePref(); if (Module) Module.setVolume(pref.vol); };
$$('#switch button').forEach(b => b.onclick = () => setView(b.dataset.view));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (loaded && inGame()) autoSave('left the app'); else fsSync(); return; }
  if (loaded && !userPaused) resume(); // iPhone may have frozen the page and its sound while it was in the background
  cloudTick();
});
addEventListener('pageshow', () => { if (loaded && !userPaused) resume(); });
// iPhone: holding a button would start the long-press text magnifier / callout. Cancelling the touch gesture on the
// controls and the game screen stops it; the buttons still work because they listen to pointer events.
['#pad', '#screenWrap'].forEach(sel => {
  const el = $(sel);
  ['touchstart', 'touchmove', 'touchend'].forEach(t => el.addEventListener(t, e => { if (!e.target.closest('input, label, select')) e.preventDefault(); }, { passive: false }));
});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('selectstart', e => { if (!typing(e)) e.preventDefault(); }); // text boxes still get a cursor and selection
document.addEventListener('gesturestart', e => e.preventDefault()); // pinch-zoom
bindButtons();
setTime(pref.time || 'real');
scheduleAuto();
addEventListener('pagehide', () => { if (loaded && inGame()) { try { const n = AUTO.reduce((a, b) => ((slotMeta[a] || 0) <= (slotMeta[b] || 0) ? a : b)); if (Module.saveState(n)) { slotMeta[n] = Date.now(); saveMeta(); fsSync(); } } catch (e) { /* ignore */ } } });
init().catch(e => { console.error(e); status('Error: ' + (e.message || e)); });
