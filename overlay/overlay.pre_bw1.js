/* Radical Red Nuzlocke Overlay - page logic. Live data comes from rr_overlay.lua (inside mGBA) through main.js. */
(function () {
'use strict';
const D = window.RR_DATA, T = window.RR_SAVE, TR = window.RR_TRAINERS;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pct = n => (Math.round(n * 10) / 10).toFixed(1) + '%';
const tc = s => String(s).toLowerCase().replace(/(^|[\s(&.\-/])([a-z])/g, (m, a, b) => a + b.toUpperCase());

/* ---------- preferences (this PC only) ---------- */
// Each game keeps its own (Radical Red's keys as they were; Unbound's get '-unbound'): stars, routes marked used, mode...
const GKEY = k => (window.RR_GAME && window.RR_GAME !== 'rr' ? k + '-' + window.RR_GAME : k);
const PREF = { ai: false, autoBattle: true, time: 'auto', intim: true };
try { Object.assign(PREF, JSON.parse(localStorage.getItem(GKEY('rro-prefs')) || '{}')); } catch (e) { /* defaults */ }
const savePrefs = () => { try { localStorage.setItem(GKEY('rro-prefs'), JSON.stringify(PREF)); } catch (e) { /* ignore */ } };

/* ---------- lookups ---------- */
const NAME_TO_ID = {}; Object.entries(T.species).forEach(([id, n]) => { if (!(n in NAME_TO_ID)) NAME_TO_ID[n] = +id; });
const family = n => { const id = NAME_TO_ID[n]; return id ? T.species[T.anc[id] || id] : n; };
const ID_TO_BOSS = {}; Object.entries(TR.bossIds).forEach(([bi, id]) => (Array.isArray(id) ? id : [id]).forEach(x => { if (!(x in ID_TO_BOSS)) ID_TO_BOSS[x] = +bi; }));
const BOSS = D.bosses;

function spr(name, size) {
  const S2 = window.RR_SPRITES; const s = size || 32;
  let b = S2 && name ? (S2[name] || S2[name.split('-')[0]]) : '';
  if (b) return `<img class="spr" src="data:image/png;base64,${b}" width="${s}" height="${s}" alt="">`;
  return `<span class="spr ph" style="width:${s}px;height:${s}px">${esc((name || '?').slice(0, 1))}</span>`;
}
const withSprites = html => String(html).replace(/<span class="pk" data-sp="([^"]*)">([^<]*)<\/span>/g, (m, sp, nm) => `<span class="pk" title="${nm}">${spr(sp.replace(/&quot;/g, '"'), 22)}</span>`);
const chip = t => `<span class="tc" style="--tc:${TYPECOL[t] || '#777'}">${esc(t)}</span>`;
const chips = n => types(n).map(chip).join('');
const moveChip = n => { const m = MOVES[n]; return `<span class="mv" style="--tc:${m ? TYPECOL[m.type] || '#777' : '#777'}">${esc(n)}</span>`; };
const hpBar = p => `<div class="hprow"><div class="hp"><em class="${p < 25 ? 'low' : p < 55 ? 'mid' : ''}" style="width:${Math.max(0, Math.min(100, p))}%"></em></div><span class="hpp ${p < 25 ? 'badtxt' : p < 55 ? 'warntxt' : ''}">${Math.max(0, Math.round(p))}%</span></div>`;

/* ---------- decoding live memory ---------- */
const bytes = hex => { const b = new Uint8Array(hex.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16); return b; };
function decodeParty(hex, count) {
  if (!hex) return [];
  const b = bytes(hex), dv = new DataView(b.buffer), out = [];
  for (let i = 0; i < Math.min(6, count || 6); i++) {
    const m = window.RRSave.readParty(dv, i * 100, T);
    if (!m) continue;
    m.slot = i; m.status1 = dv.getUint32(i * 100 + 0x50, true);
    out.push(m);
  }
  return out;
}
function decodePC(hex) {
  if (!hex) return [];
  const b = bytes(hex), dv = new DataView(b.buffer), out = [];
  for (let k = 0; k * 58 + 58 <= b.length; k++) { const m = window.RRSave.readBox(dv, k * 58, T); if (m && !m.bad) { m.box = Math.floor(k / 30) + 1; out.push(m); } }
  return out;
}
// Boxes 20-25 are the player's dead boxes. Box 25's spot may hold other data in Radical Red, so it only counts if it reads cleanly.
function decodeDead(hex) {
  if (!hex) return [];
  const b = bytes(hex), dv = new DataView(b.buffer), BB = window.RRSave.BOX_BYTES;
  return window.RRSave.extraBoxes([[20, dv, 0], [21, dv, BB], [22, dv, BB * 2], [23, dv, BB * 3], [24, dv, BB * 4], [25, dv, BB * 5, true]], T);
}
function decodeBattlers(hex) {
  if (!hex) return [];
  const b = bytes(hex), dv = new DataView(b.buffer), out = [];
  for (let i = 0; i < 4; i++) {
    const o = i * 0x58, sp = dv.getUint16(o, true);
    if (!sp || !T.species[sp]) { out.push(null); continue; }
    out.push({
      i, species: T.species[sp], level: b[o + 0x2A], pid: dv.getUint32(o + 0x48, true), hp: dv.getUint16(o + 0x28, true), maxHP: dv.getUint16(o + 0x2C, true),
      moves: window.RRSave.typedMoves([0, 1, 2, 3].map(k => T.moves[dv.getUint16(o + 0xC + k * 2, true)] || '').filter(Boolean), window.RRSave.ivsOf(dv.getUint32(o + 0x14, true))),
      stages: Array.from(b.slice(o + 0x18, o + 0x20)).map(x => x - 6),
      ability: T.abilities[b[o + 0x20]] || '', item: T.items[dv.getUint16(o + 0x2E, true)] || '',
      status1: dv.getUint32(o + 0x4C, true), status2: dv.getUint32(o + 0x50, true), spe: dv.getUint16(o + 6, true),
      // the game's own stats for this battler (level, nature, IVs and EVs already applied)
      stats: { atk: dv.getUint16(o + 2, true), def: dv.getUint16(o + 4, true), spe: dv.getUint16(o + 6, true), spa: dv.getUint16(o + 8, true), spd: dv.getUint16(o + 0xA, true) }
    });
  }
  return out;
}
/* Decoded games (Emerald Imperium, SoulGold: another engine). The app sends PokeDaisy's own decoding (state.dec):
   numbers the pack's tables (T) name; PokeDaisy's names when the pack has none. Stats come as hp, atk, def, spe,
   spa, spd; battle stats atk, def, spe, spa, spd; stages atk..evasion (-6..+6). */
const STAT6 = k => (k && k.length >= 6 ? { hp: k[0], atk: k[1], def: k[2], spe: k[3], spa: k[4], spd: k[5] } : null);
const STATUS_BITS = { SLP: 1, PSN: 8, BRN: 0x10, FRZ: 0x20, PAR: 0x40, TOX: 0x80 };
function decMon(m) {
  if (!m || m.egg || !m.sp) return null;
  const species = T.species[m.sp] || m.name, ab = (T.specAb && T.specAb[m.sp]) || [];
  return {
    pid: m.pid, speciesId: m.sp, species, baseName: T.species[T.anc && T.anc[m.sp]] || species, nick: m.name,
    item: T.items[m.item] || m.itemName || '', level: m.lv, nature: (m.nat != null && T.natures[m.nat]) || 'Hardy',
    ability: T.abilities[m.ab] || m.abName || T.abilities[ab[0]] || '',
    moves: (m.moves || []).map(x => T.moves[x.id] || x.name).filter(Boolean),
    evs: STAT6(m.evs) || {}, ivs: STAT6(m.ivs) || { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    metLoc: m.met || 0, metLevel: m.metLv || 0, hp: m.hp, maxHP: m.maxHP, exactLevel: true
  };
}
const decList = list => (list || []).map((m, i) => { const x = decMon(m); if (x) x.slot = i; return x; }).filter(Boolean);
// No trainer id in a decoded battle: the boss is the one whose team this is (every species of theirs, same count).
function bossByTeam(enemy) {
  if (!enemy.length) return undefined;
  const want = enemy.map(m => family(m.species)).sort().join('|');
  const hit = BOSS.find(b => b.mons.filter(m => !m.pool).map(m => family(m.s)).sort().join('|') === want);
  return hit ? hit.i : undefined;
}
function decBattler(m, i) {
  const x = decMon(m); if (!x) return null;
  const b = m.bstats || [], st = m.stages || [];
  return Object.assign(x, {
    i, stages: [0].concat(st.slice(0, 7)).concat([0, 0, 0, 0, 0, 0, 0]).slice(0, 8),
    status1: STATUS_BITS[m.status] || 0, status2: 0, spe: b[2] || 0,
    stats: b.length >= 5 ? { atk: b[0], def: b[1], spe: b[2], spa: b[3], spd: b[4] } : undefined
  });
}
const statusOf = s => (s & 7) ? 'slp' : (s & 0x80) ? 'tox' : (s & 8) ? 'psn' : (s & 0x10) ? 'brn' : (s & 0x20) ? 'frz' : (s & 0x40) ? 'par' : '';

/* ---------- live state ---------- */
let ST = null, PC = [], DEAD = [], CONN = false, PARTY = [], tab = 'route', mode = 'bar', focused = false;
let viewEnemy = null, swView = null, nextMon = null, nextFor = null, timeSel = null, lastPanelKey = '', lastBarKey = '';
function flagSet(f) { if (!ST || !ST.flags) return false; const i = f >> 3; return i * 2 + 2 <= ST.flags.length && (parseInt(ST.flags.substr(i * 2, 2), 16) >> (f & 7)) & 1; }
// a trainer's beaten flag is 0x500 + its id (FireRed's and Emerald's TRAINER_FLAGS_START; the expansion's more trainers
// run past FireRed's 0x400, so decoded games send flags up to 0xFFF)
function trainerBeaten(bi) { if (TR.doneFlags && TR.doneFlags[bi] != null) return flagSet(TR.doneFlags[bi]); const id = TR.bossIds[bi]; return (Array.isArray(id) ? id : [id]).some(x => x != null && x < (ST && ST.dec ? 0xB00 : 0x400) && flagSet(0x500 + x)); }
const orderBeaten = o => o.b.some(trainerBeaten);
function nextOrder() { return ST && ST.flags ? D.order.find(o => !o.opt && !orderBeaten(o)) || null : null; }
/* Mode (PREF.mode): 'nuzlocke' (default) or 'play' for a normal playthrough, which drops the nuzlocke bookkeeping:
   encounters left, used / open routes, dupes, and boxes 20-25 as a graveyard (they're just more boxes then). */
const nuz = () => PREF.mode !== 'play';
function owned() { return PARTY.concat(PC, DEAD); } // includes the dead, for used routes and dupes
function alive() { return nuz() ? PARTY.concat(PC) : PARTY.concat(PC, DEAD); }
function starterTypes() { const s = owned().find(m => window.RRSave.STARTER_BASES.includes(m.baseName) && m.metLevel === 5); return s ? types(s.species) : []; }
function pickB(o) {
  if (o.b.length < 2) return o.b[0];
  const t = starterTypes(); const has = t.includes('Water') ? 'BULBASAUR' : t.includes('Fire') ? 'SQUIRTLE' : t.includes('Grass') ? 'CHARMANDER' : '';
  const beatenV = o.b.find(trainerBeaten); if (beatenV != null) return beatenV;
  const hit = has && o.b.find(i => BOSS[i].notes.some(n => n.toUpperCase().includes('RIVAL HAS ' + has)));
  const fams = new Set(owned().map(m => family(m.species).toUpperCase()));
  const mine = o.b.find(i => BOSS[i].notes.some(n => { const c = /PLAYER CHOSE (\S+)/.exec(n.toUpperCase()); return c && fams.has(c[1]); }));
  if (mine != null) return mine;
  // Emerald Imperium names the starter's type ("STARTER WATER"): the type of the starter family you own
  const st = owned().find(m => window.RRSave.STARTER_BASES.includes(m.baseName));
  const stType = st ? (types(st.baseName)[0] || '').toUpperCase() : '';
  const byType = stType && o.b.find(i => BOSS[i].notes.includes('STARTER ' + stType));
  if (byType != null && byType !== false) return byType;
  return hit != null && hit !== false ? hit : o.b[0];
}
const topLevel = () => Math.max(1, ...PARTY.map(m => m.level));
function bossLevel(b, m) { return m.lv != null ? m.lv : Math.max(1, Math.min(100, (b.sheet === 'Postgame' ? 100 : topLevel()) + (m.rel || 0))); }
/* The guide lists a two-trainer double battle (like the S.S. Anne pairs) as one team, which can put the Pokémon in the wrong order.
   The first time you fight a boss, the real party order (and which trainer owns which Pokémon) is read from the game and remembered. */
let BOSS_SEEN = {};
try { BOSS_SEEN = JSON.parse(localStorage.getItem(GKEY('rro-boss-order')) || '{}'); } catch (e) { /* none yet */ }
const normSp = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function learnOrder(bIdx, party, twoOpp) {
  if (bIdx == null || !party.length) return;
  const rec = { o: party.map(m => [m.species, m.slot]), two: twoOpp ? 1 : 0 };
  const old = BOSS_SEEN[bIdx];
  if (old && JSON.stringify(old) === JSON.stringify(rec)) return;
  if (old && old.o.length > rec.o.length) return; // keep the fuller record
  BOSS_SEEN[bIdx] = rec;
  try { localStorage.setItem(GKEY('rro-boss-order'), JSON.stringify(BOSS_SEEN)); } catch (e) { /* ignore */ }
}
// The boss's Pokémon in real party order when it has been seen, each with its party slot (slots 4-6 = the second trainer).
function bossMons(bIdx) {
  const b = BOSS[bIdx], seen = BOSS_SEEN[bIdx];
  if (!seen) return { list: b.mons.map((m, k) => Object.assign({}, m, { slot: k })), two: false };
  const left = b.mons.slice(), list = [];
  seen.o.forEach(([sp, slot]) => {
    const n = normSp(sp);
    let k = left.findIndex(m => normSp(m.s) === n);
    if (k < 0) k = left.findIndex(m => normSp(m.s).startsWith(n.slice(0, 5)) || n.startsWith(normSp(m.s).slice(0, 5)));
    if (k >= 0) { list.push(Object.assign({}, left[k], { slot })); left.splice(k, 1); }
  });
  left.forEach((m, k) => list.push(Object.assign({}, m, { slot: 6 + k })));
  return { list, two: !!seen.two };
}
function bossOpts(b, m) { const mgm = ST && (ST.mode & 4); return { species: m.s, level: bossLevel(b, m), nature: m.nat, ability: m.ab, item: m.it, evs: mgm ? (b.name === 'PKMN TOWER GHOST' ? { hp: 252 } : {}) : m.ev, ivs: { spe: m.iv == null ? 31 : m.iv }, moves: m.mv }; }
/* ---------- Intimidate ---------- */
const INTIM_BLOCK = ['Clear Body', 'Hyper Cutter', 'White Smoke', 'Full Metal Body', 'Inner Focus', 'Oblivious', 'Own Tempo', 'Scrappy', 'Mirror Armor'];
// The stat changes Intimidate causes on the Pokémon it hits (null if it does nothing).
function intimHit(p) {
  if (!p || p.item === 'Clear Amulet' || INTIM_BLOCK.includes(p.ability)) return null;
  switch (p.ability) {
    case 'Guard Dog': case 'Contrary': case 'Defiant': return { atk: 1 };
    case 'Simple': return { atk: -2 };
    case 'Competitive': return { atk: -1, spa: 2 };
    case 'Rattled': return { atk: -1, spe: 1 };
    default: return { atk: -1 };
  }
}
function withBoosts(p, d) { const q = p.clone(); for (const k in d) q.boosts[k] = Math.max(-6, Math.min(6, (q.boosts[k] || 0) + d[k])); return q; }
const boostTxt = d => Object.entries(d).map(([k, v]) => (v > 0 ? '+' : '−') + Math.abs(v) + ' ' + ({ atk: 'Atk', spa: 'SpA', spe: 'Spe' }[k] || k)).join(', ');
// scorePair with Intimidate counted when each side comes in. how.mine / how.foe = false skips that side (already applied in battle).
function scoreIntim(me, foe, f, how) {
  const notes = [];
  if (PREF.intim !== false) {
    const mineIn = !how || how.mine !== false, foeIn = !how || how.foe !== false;
    const myP = me.p, foeP = foe.p;
    if (mineIn && myP.ability === 'Intimidate') { const d = intimHit(foeP); notes.push('your Intimidate: ' + (d ? 'their ' + boostTxt(d) : 'blocked')); if (d) foe = Object.assign({}, foe, { p: withBoosts(foeP, d) }); }
    if (foeIn && foeP.ability === 'Intimidate') { const d = intimHit(myP); notes.push('their Intimidate: ' + (d ? 'your ' + boostTxt(d) : 'blocked')); if (d) me = Object.assign({}, me, { p: withBoosts(myP, d) }); }
  }
  const r = scorePair(me, foe, f); r.intim = notes.join(' · '); return r;
}
// Best answer first; ties (several that all OHKO, say) go to the one that takes least, then the faster one, then the one that
// hits hardest, then by name, so the pick never depends on who happens to be in the party.
const ansCmp = (x, y) => (y.r.s - x.r.s) || ((x.r.worstDef ? x.r.worstDef.hiP : 0) - (y.r.worstDef ? y.r.worstDef.hiP : 0)) || ((y.r.fast ? 1 : 0) - (x.r.fast ? 1 : 0)) || ((y.r.bestOff ? y.r.bestOff.loP : 0) - (x.r.bestOff ? x.r.bestOff.loP : 0)) || String(x.me.m.nick || x.me.m.species).localeCompare(String(y.me.m.nick || y.me.m.species)) || String(x.me.m.species).localeCompare(String(y.me.m.species));
const intimTag = r => r && r.intim ? `<br><span class="small" style="color:var(--warn)">${esc(r.intim)}</span>` : '';

function bossField(b) {
  const t = (b ? b.notes : []).join(' ').toUpperCase();
  const f = { doubles: /DOUBLES/.test(t) || (b && /&/.test(b.name)), weather: '', terrain: '', my: {}, foe: {}, tr: false };
  if (/PERMANENT RAIN/.test(t)) f.weather = 'Rain'; else if (/PERMANENT SUN/.test(t)) f.weather = 'Sun'; else if (/PERMANENT SANDSTORM/.test(t)) f.weather = 'Sand'; else if (/PERMANENT SNOW/.test(t)) f.weather = 'Snow';
  const tm = t.match(/PERMANENT (ELECTRIC|GRASSY|PSYCHIC|MISTY) TERRAIN/); if (tm) f.terrain = tm[1][0] + tm[1].slice(1).toLowerCase();
  f.permW = !!f.weather; f.permT = !!f.terrain; // the fight's own weather / terrain: abilities don't replace it
  return f;
}
function monCalcOpts(m, bat) {
  const o = { species: (bat && bat.species) || m.species, level: (bat && bat.level) || m.level, nature: m.nature, ability: (bat && bat.ability) || m.ability, item: bat ? bat.item : m.item, evs: m.evs, ivs: m.ivs, moves: (bat && bat.moves.length ? bat.moves : m.moves) };
  if (bat) { o.real = bat.stats; o.boosts = { atk: bat.stages[1], def: bat.stages[2], spe: bat.stages[3], spa: bat.stages[4], spd: bat.stages[5] }; o.hp = bat.maxHP ? bat.hp / bat.maxHP * 100 : 100; o.status = statusOf(bat.status1); }
  else { o.hp = m.maxHP ? m.hp / m.maxHP * 100 : 100; o.status = statusOf(m.status1 || 0); }
  return o;
}
function locNow() {
  if (!ST) return null;
  if (ST.mapsec && T.mapsec[ST.mapsec]) return window.RRSave.mapLoc(T, D, { metLoc: ST.mapsec, metLevel: 0, baseName: '' });
  // Some Radical Red buildings carry no map section; fall back to FireRed's map list (group, number).
  const name = ST.map && T.maps ? T.maps[ST.map[0] + ',' + ST.map[1]] : '';
  return { loc: name || 'Unknown', known: !!name && D.locs.some(l => l.name === name), raw: name || '' };
}
const guideFor = b => (b.guide || []).map(id => D.guide.find(g => g.id === id)).filter(Boolean);
function guideHTML(g) {
  let h = `<h3>${esc(g.title)}</h3>`, inList = false;
  g.body.forEach(l => { if (l.startsWith('- ')) { if (!inList) { h += '<ul>'; inList = true; } h += `<li>${esc(l.slice(2))}</li>`; } else { if (inList) { h += '</ul>'; inList = false; } h += `<p>${esc(l)}</p>`; } });
  return h + (inList ? '</ul>' : '');
}

/* ---------- battle ---------- */
// Weather, Trick Room, Tailwind and screens as they are right now in the battle.
function liveField(f) {
  if (!ST || ST.weather == null) return f;
  const w = ST.weather;
  f.weather = (w & 0x1000) ? 'Heavy Rain' : (w & 0x800) ? 'Harsh Sunshine' : (w & 0x2000) ? 'Strong Winds' : (w & 0x7) ? 'Rain' : (w & 0x4018) ? 'Sand' : (w & 0x60) ? 'Sun' : (w & 0x180) ? 'Snow' : '';
  if (ST.sides && ST.sides.length >= 8) {
    const side = k => parseInt(ST.sides.substr(k * 4 + 2, 2) + ST.sides.substr(k * 4, 2), 16);
    f.my = Object.assign({}, f.my, { ref: !!(side(0) & 1), ls: !!(side(0) & 2) });
    f.foe = Object.assign({}, f.foe, { ref: !!(side(1) & 1), ls: !!(side(1) & 2) });
  }
  const fx = { all: [], my: [], foe: [] };
  if (ST.nbs && ST.nbs.length >= 0x18 * 2) {
    const b = i => parseInt(ST.nbs.substr(i * 2, 2), 16);
    const ok = (v, max) => v > 0 && v <= max; // ignore anything that doesn't look like a turn counter
    f.tr = ok(b(3), 8);
    f.my.tw = ok(b(0x13), 8); f.foe.tw = ok(b(0x14), 8);
    f.my.veil = ok(b(0x15), 8); f.foe.veil = ok(b(0x16), 8);
    if (f.tr) fx.all.push(['Trick Room', b(3)]);
    if (ok(b(2), 8)) fx.all.push(['Gravity', b(2)]);
    if (ok(b(4), 8)) fx.all.push(['Magic Room', b(4)]);
    if (ok(b(5), 8)) fx.all.push(['Wonder Room', b(5)]);
    if (ST.terrain >= 1 && ST.terrain <= 4) { f.terrain = ['Electric', 'Grassy', 'Misty', 'Psychic'][ST.terrain - 1]; fx.all.push([f.terrain + ' Terrain', ok(b(8), 8) ? b(8) : 0]); }
    if (f.my.tw) fx.my.push(['Tailwind', b(0x13)]);
    if (f.foe.tw) fx.foe.push(['Tailwind', b(0x14)]);
    if (f.my.veil) fx.my.push(['Aurora Veil', b(0x15)]);
    if (f.foe.veil) fx.foe.push(['Aurora Veil', b(0x16)]);
  }
  if (ST.timers && ST.timers.length >= 48) {
    const t = (side, i) => parseInt(ST.timers.substr((side * 12 + i) * 2, 2), 16);
    [['my', 0], ['foe', 1]].forEach(([k, side]) => {
      if (f[k].ref) fx[k].push(['Reflect', t(side, 0)]);
      if (f[k].ls) fx[k].push(['Light Screen', t(side, 2)]);
      if (t(side, 4) > 0 && t(side, 4) <= 8) fx[k].push(['Mist', t(side, 4)]);
      if (t(side, 6) > 0 && t(side, 6) <= 8) fx[k].push(['Safeguard', t(side, 6)]);
      const hz = t(side, 10);
      if (hz & 3) fx[k].push(['Spikes ×' + (hz & 3), 0]);
      if ((hz >> 2) & 3) fx[k].push(['Toxic Spikes ×' + ((hz >> 2) & 3), 0]);
      if (hz & 0x10) fx[k].push(['Stealth Rock', 0]);
      if (hz & 0x20) fx[k].push(['Sticky Web', 0]);
      if (hz & 0x40) fx[k].push(['Steelsurge', 0]);
    });
  }
  if (f.weather) fx.all.unshift([f.weather, 0]);
  f.fx = fx;
  return f;
}
// Everything active on the field, with turns left where the game counts them.
function fieldHTML(f) {
  const fx = f.fx; if (!fx) return '';
  const chip = ([n, t]) => `<span class="fx">${esc(n)}${t ? ` <small>${t}</small>` : ''}</span>`;
  const rows = [];
  if (fx.all.length) rows.push(`<div class="fxrow"><span class="small muted">Field</span>${fx.all.map(chip).join('')}</div>`);
  if (fx.my.length) rows.push(`<div class="fxrow"><span class="small goodtxt">Your side</span>${fx.my.map(chip).join('')}</div>`);
  if (fx.foe.length) rows.push(`<div class="fxrow"><span class="small badtxt">Their side</span>${fx.foe.map(chip).join('')}</div>`);
  return rows.join('');
}
// Stat changes, with Intimidate called out when a Pokémon with it is on the other side.
function stagesHTML(bat, otherSide) {
  const names = ['', 'Atk', 'Def', 'Spe', 'SpA', 'SpD', 'Acc', 'Eva'];
  const s = bat.stages;
  const parts = names.map((n, i) => (i && s[i] ? `<span class="${s[i] > 0 ? 'up' : 'down'}">${n} ${s[i] > 0 ? '+' : ''}${s[i]}</span>` : '')).join('');
  const intim = s[1] < 0 && otherSide.some(o => o && o.bat.ability === 'Intimidate');
  return parts || intim ? `<div class="stages">${parts}${intim ? '<span class="tag">Intimidated</span>' : ''}</div>` : '<div class="stages"><span class="small muted">no stat changes</span></div>';
}
// End-of-turn context for a battler on the field: status, Toxic counter, Leech Seed, Curse, Nightmare, trapping moves.
function eotCtx(bat, f) {
  const s3 = ST && ST.status3 && ST.status3.length >= 32 ? parseInt(ST.status3.substr(bat.i * 8 + 6, 2) + ST.status3.substr(bat.i * 8 + 4, 2) + ST.status3.substr(bat.i * 8 + 2, 2) + ST.status3.substr(bat.i * 8, 2), 16) : 0;
  const s2 = bat.status2 >>> 0;
  return { weather: f.weather, terrain: f.terrain, status: statusOf(bat.status1), toxicN: (bat.status1 >> 8) & 0xF, seeded: !!(s3 & 0x4), cursed: !!(s2 & 0x10000000), nightmare: !!(s2 & 0x8000000), wrapped: !!(s2 & 0xE000) };
}
function eotOf(x, f) { return window.RRLines.residual(x.p, eotCtx(x.bat, f)); }
// One line: what the end of this turn does to this Pokémon, and where that leaves it.
function eotHTML(x, f) {
  const h = window.RRLines.healItem(x.p);
  const heal = h ? `<div class="small">${esc(h.item)}: heals <b class="goodtxt">${Math.round(h.amt)}%</b> once, at ${h.at}% HP or lower</div>` : '';
  return heal + eotLine(x, f);
}
function eotLine(x, f) {
  const r = eotOf(x, f);
  if (!r.parts.length) return '';
  const now = x.bat.maxHP ? x.bat.hp / x.bat.maxHP * 100 : 0, after = now + r.net;
  const sign = r.net > 0 ? '+' : r.net < 0 ? '−' : '±';
  return `<div class="small">End of turn: <b class="${r.net < 0 ? 'badtxt' : 'goodtxt'}">${sign}${Math.round(Math.abs(r.net) * 10) / 10}%</b> <span class="muted">(${esc(window.RRLines.resTxt(r))})</span>${after <= 0 ? ' — <b class="badtxt">faints at the end of the turn</b>' : ` → about ${Math.round(Math.min(100, after))}% left`}</div>`;
}
// Ability / item warnings for one of your moves into a target, as tags (compact) or full lines.
function moveWarns(n, att, def, ctx) { return n && n[0] !== '*' ? window.RRLines.moveWarnings(n, att, def, ctx) : []; }
function warnTags(ws) { return ws.map(w => ` <span class="wtag ${w.lvl}" title="${esc(w.text)}">${esc(w.tag)}</span>`).join(''); }
function warnLines(ws) { return ws.length ? `<div class="wlines">${ws.map(w => `<div class="${w.lvl === 'bad' ? 'badtxt' : w.lvl === 'warn' ? 'warntxt' : 'muted'}">${w.lvl === 'bad' ? '✖' : w.lvl === 'warn' ? '!' : 'i'} ${esc(w.tag)}: ${esc(w.text)}</div>`).join('')}</div>` : ''; }
// KO text from the calc: a guaranteed OHKO on you is red, a chance to OHKO you is yellow; your guaranteed OHKOs are green.
function koHTML(ko, mine) {
  if (/guaranteed OHKO/i.test(ko)) return `<b class="${mine ? 'goodtxt' : 'badtxt'} kobig">${esc(ko)}</b>`;
  if (/chance to OHKO/i.test(ko) && !mine) return `<b class="warntxt">${esc(ko)}</b>`;
  return esc(ko);
}
// "Dead to a crit" tag for a move aimed at your Pokémon.
function critTag(a, d, n, fl) {
  const c = window.RRLines.deadToCrit(a, d, n, fl);
  return c ? ` <b class="warntxt">${esc(window.RRLines.critTxt(c))}</b>` : '';
}
// Who moves first between two speeds (Trick Room reverses it).
const speedWord = (a, b, tr) => a === b ? 'speed tie' : ((a > b) !== !!tr) ? 'you move first' : 'they move first';
function battleInfo() {
  if (!ST || !ST.inBattle || !ST.battleMons) return null;
  const bats = ST.dec ? (ST.battlersDec || []).map((m, i) => (m ? decBattler(m, i) : null)) : decodeBattlers(ST.battleMons);
  const enemyParty = ST.dec ? decList(ST.enemyDec) : decodeParty(ST.enemy, 6);
  const idx0 = ST.partyIdx ? [0, 1, 2, 3].map(i => parseInt(ST.partyIdx.substr(i * 4 + 2, 2) + ST.partyIdx.substr(i * 4, 2), 16)) : [0, 0, 0, 0];
  // which party slot each battler is: the game reorders the party when you switch (doubles especially), so the battle's
  // own slot numbers can point at someone else; match by the Pokémon's personality value, the slot number as a fallback
  const idx = idx0.map((k, b) => { const bat = bats[b]; if (!bat || bat.pid == null) return k; const list = b % 2 ? enemyParty : PARTY; const m = list.find(x => x.pid === bat.pid); return m ? m.slot : k; });
  const doubles = (ST.battleType & 1) === 1;
  const tId = ST.trainerA, bi = !(ST.battleType & 8) ? undefined : ST.dec ? bossByTeam(enemyParty) : ID_TO_BOSS[tId];
  const boss = bi != null ? BOSS[bi] : null;
  const ord = bi != null ? D.order.find(o => o.b.includes(bi)) : null;
  const fld = liveField(bossField(boss)); fld.doubles = doubles;
  if (bi != null && (ST.battleType & 8)) learnOrder(bi, enemyParty, !!(ST.battleType & 0x8000) && !!ST.trainerB);
  const side = (b, list) => { const bat = bats[b]; if (!bat) return null; const m = list.find(x => x.slot === idx[b]) || list[0] || (ST.dec ? bat : null); if (!m) return null; /* decoded wild battles: no foe party, the battler is the Pokémon */ return { bat, m, p: mk(monCalcOpts(m, bat)) }; };
  const mine = [side(0, PARTY), doubles ? side(2, PARTY) : null].filter(x => x && x.p);
  // in doubles the opponent's 'left' Pokémon (battler 1) stands on the right of the screen, so list battler 3 first to match what you see
  const foes = (doubles ? [side(3, enemyParty), side(1, enemyParty)] : [side(1, enemyParty)]).filter(x => x && x.p);
  // two trainers at once (BATTLE_TYPE_TWO_OPPONENTS): the second trainer's team is in party slots 4-6 and only replaces its own Pokémon
  const twoOpp = !!(ST.battleType & 0x8000) && !!ST.trainerB;
  const tName = id => TR.names[id] || 'Trainer #' + id;
  const trainer = (ST.battleType & 8) ? tName(tId) + (twoOpp ? ' & ' + tName(ST.trainerB) : '') : 'Wild battle';
  return { bats, enemyParty, idx, doubles, twoOpp, trainer, boss, ord, fld, mine, foes };
}

/* ---------- render: top bar ---------- */
// The dofile(...) line for mGBA's Scripting window, with a Copy button wherever the overlay is waiting for it.
let SCRIPT_LINE = '';
if (window.rr.scriptLine) window.rr.scriptLine().then(l => { SCRIPT_LINE = l || ''; renderBar(); lastPanelKey = ''; renderPanel(true); });
function copyScriptLine(btn) {
  if (!SCRIPT_LINE) return;
  window.rr.copy(SCRIPT_LINE);
  if (btn) { const t = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = t; }, 1500); }
}
function scriptHelpHTML() {
  return `<div class="card"><h3>Connect to mGBA</h3>
    <ol class="abl small"><li>In mGBA open <b>Tools → Scripting</b>.</li><li>Click <b>Copy</b> below, paste into the long box at the bottom of the Scripting window, and press <b>Run</b>.</li><li>Close the Scripting window. The dot turns green.</li></ol>
    <div class="codeline"><code>${esc(SCRIPT_LINE || 'dofile("…/RR Nuzlocke Overlay/rr_overlay.lua")')}</code><button id="pCopy">Copy</button></div>
    <p class="small muted">Do this each time you open mGBA. (Or File → Load script and pick rr_overlay.lua from the overlay folder.)</p></div>`;
}
function renderBar() {
  const cp = $('#bCopy'); if (cp) cp.hidden = CONN || !!window.rr.web || !SCRIPT_LINE;
  const dot = $('#dot'), sum = $('#summary');
  dot.className = 'dot' + (!CONN ? ' off' : ST && ST.inBattle ? ' battle' : '');
  dot.title = CONN ? 'Connected to mGBA' : 'Not connected to mGBA';
  let b = '', s = '';
  if (!CONN) { b = window.rr.embedded ? 'Waiting for the game…' : window.rr.web ? 'Waiting for RetroArch…' : 'Waiting for mGBA…'; s = window.rr.web ? 'RetroArch: Settings → Network → Network Commands ON' : 'Click Copy line, paste it in mGBA: Tools → Scripting, Run'; }
  else if (ST && ST.inBattle) {
    const bi = battleInfo();
    const me = bi && bi.mine[0], foe = bi && bi.foes[0];
    if (me && foe) {
      const best = movesOf(me.p, me.m.moves).map(n => hit(me.p, foe.p, n, field(bi.fld, true))).filter(h => !h.status && !moveWarns(h.name, me.p, foe.p, { terrain: bi.fld.terrain }).some(w => w.lvl === 'bad')).sort((x, y) => y.hiP - x.hiP)[0];
      b = 'VS ' + bi.foes.map(x => `${x.bat.species} ${Math.round(x.bat.hp / x.bat.maxHP * 100)}%`).join(' & ');
      const sMe = speedOf(me.p, bi.fld, true), sFoe = speedOf(foe.p, bi.fld, false);
      s = (best ? `${best.label} ${Math.round(best.loP)}–${Math.round(best.hiP)}%${best.hi >= foe.p.curHP() ? ' (KO)' : ''}` : '') + ` · ${speedWord(sMe, sFoe, bi.fld.tr)}${bi.fld.tr ? ' (Trick Room)' : ''}` + (bi.boss ? ` · ${tc(bi.ord ? bi.ord.name : bi.boss.name)}` : '');
    } else { b = 'In battle'; s = ''; }
  } else if (ST) {
    const L = locNow(), nx = nextOrder();
    b = L ? (L.loc === 'Unknown' ? 'Somewhere new' : L.loc) : '—';
    const l = L && D.locs.find(x => x.name === L.loc);
    const used = l && owned().find(m => window.RRSave.mapLoc(T, D, m).loc === l.name);
    const parts = [];
    if (l) parts.push(used && nuz() ? `Used: ${used.nick || used.species}` : l.adv && l.adv.k === 'skip' ? 'Guide: skip this one' : l.adv && l.adv.k === 'later' ? 'Guide: save for later' : l.pick ? `Go for ${l.pick.top.join(', ')}` : 'Encounter available');
    const left = nuz() ? encLeft().open.length : 0;
    if (left) parts.push(left + ' encounter' + (left > 1 ? 's' : '') + ' left');
    if (nx) parts.push(`Next: ${tc(nx.name)} (cap ${nx.cap})`);
    s = parts.join(' · ');
  }
  const key = b + '|' + s + '|' + PARTY.map(m => m.species + m.hp).join(',');
  if (key === lastBarKey) return; lastBarKey = key;
  sum.innerHTML = `<b>${esc(b)}</b><small>${esc(s)}</small>`;
  $('#partyMini').innerHTML = PARTY.map(m => { const p = m.maxHP ? m.hp / m.maxHP * 100 : 0; return `<span class="pm${m.hp === 0 ? ' dead' : ''}" data-todex="${esc(m.species)}" title="${esc((m.nick || m.species) + ' Lv' + m.level + ' · ' + Math.round(p) + '% HP · click for its Dex page')}">${spr(m.species, 26)}<i><em style="width:${p}%;background:${p < 25 ? 'var(--bad)' : p < 55 ? 'var(--warn)' : 'var(--good)'}"></em></i><small class="pmp">${Math.round(p)}%</small></span>`; }).join('');
}

/* ---------- render: panel tabs ---------- */
/* ---------- Dex tab (Radical Red Pokédex data, as on the website) ---------- */
let dexQ = '', dexType = '', dexSel = null, dexMoveTab = 'lv', dexLoading = false, ENC_INDEX = null, BOSS_INDEX = null;
const RR = (window.RR_GAME || 'rr') === 'rr'; // Radical Red; other games come as packs (Unbound: ?game=unbound)
function loadDex() {
  if (window.RR_DEX || dexLoading || !RR) return;
  dexLoading = true;
  const sc = document.createElement('script'); sc.src = 'dex.js';
  sc.onload = () => { dexLoading = false; if (window.RR_MOVES) window.RR_MOVES.patchDex(window.RR_DEX); abilDesc.map = null; lastPanelKey = ''; renderPanel(true); };
  sc.onerror = () => { dexLoading = false; };
  document.body.appendChild(sc);
}
function encIndex() {
  if (ENC_INDEX) return ENC_INDEX;
  ENC_INDEX = {};
  D.locs.forEach(l => l.areas.forEach(a => (D.tables[a] || []).forEach(t => t.mons.forEach(x => {
    const list = ENC_INDEX[x[0]] = ENC_INDEX[x[0]] || [];
    const key = l.name + '|' + a + '|' + (t.m || t.k), ex = list.find(y => y.key === key);
    if (ex) ex.r += x[1]; else list.push({ key, loc: l.name, area: a, m: t.m || t.k, r: x[1], lv: x[2] });
  }))));
  return ENC_INDEX;
}
function bossIndex() {
  if (BOSS_INDEX) return BOSS_INDEX;
  BOSS_INDEX = {};
  BOSS.forEach((b, i) => b.mons.forEach(m => { const l = BOSS_INDEX[m.s] = BOSS_INDEX[m.s] || []; if (!l.includes(i)) l.push(i); }));
  return BOSS_INDEX;
}
function dexKey(n) {
  const X = window.RR_DEX, keys = Object.keys(X.species), lo = n.toLowerCase();
  return keys.find(k => k.toLowerCase() === lo) || keys.find(k => k.toLowerCase() === lo.split('-')[0]) || null;
}
// Jump to a Pokémon's Dex page from anywhere (opens the panel if only the bar is showing).
function openDex(n) {
  dexSel = n; tab = 'dex';
  if (mode !== 'panel') setMode('panel', true); else renderPanel(true);
  $('#panel').scrollTop = 0;
}
document.addEventListener('click', e => { const t = e.target.closest('[data-todex]'); if (t) { e.preventDefault(); openDex(t.dataset.todex); } });
function dexAll() { const X = window.RR_DEX; return Object.keys(X.species).filter(n => SPEC[n]).sort((a, b) => X.species[a].d - X.species[b].d || X.species[a].i - X.species[b].i); }
// An ability name you can hover (title) or tap (a small pinned note) to see what it does, from the game's own text.
function abilDesc(n) {
  const X = window.RR_DEX; if (!n) return '';
  if (!X) { loadDex(); return ''; }
  if (!abilDesc.map) { abilDesc.map = {}; Object.values(X.abilities).forEach(a => { if (a && a[0]) abilDesc.map[a[0].toLowerCase()] = a[1]; }); }
  return abilDesc.map[String(n).toLowerCase()] || '';
}
const abil = n => (n ? `<span class="abil" tabindex="0" data-abil="${esc(n)}" title="${esc(abilDesc(n) || 'Tap for what it does')}">${esc(n)}</span>` : '');
function dexAbilities(n) { const X = window.RR_DEX, s = X.species[n]; return s.ab.filter(Boolean).map(id => (X.abilities[id] || [''])[0]).filter(Boolean); }
function dexListHTML() {
  const q = dexQ.trim().toLowerCase();
  const hits = dexAll().filter(n => (!q || n.toLowerCase().includes(q) || dexAbilities(n).some(a => a.toLowerCase().includes(q))) && (!dexType || types(n).includes(dexType)));
  return `<p class="small muted">${hits.length} Pokémon${hits.length > 60 ? ' · showing 60, search to narrow it down' : ''}</p>` +
    hits.slice(0, 60).map(n => `<button class="dexrow" data-dex="${esc(n)}">${spr(n, 28)}<span class="dn">${esc(n)}</span><span>${chips(n)}</span></button>`).join('');
}
function dexHTML() {
  if (!window.RR_DEX) { loadDex(); return '<div class="empty">Loading the Pokédex…</div>'; }
  if (dexSel && !window.RR_DEX.species[dexSel]) dexSel = dexKey(dexSel);
  if (dexSel && window.RR_DEX.species[dexSel]) return dexDetail(dexSel);
  const typesAll = Object.keys(TYPECOL).filter(t => !['???', 'Stellar'].includes(t));
  return `<div class="card"><div class="row"><input id="dq" type="search" placeholder="Search Pokémon or ability" value="${esc(dexQ)}" style="flex:1;min-width:0">
      <select id="dtype" aria-label="Type"><option value="">All types</option>${typesAll.map(t => `<option${t === dexType ? ' selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <div id="dxList">${dexListHTML()}</div>`;
}
function dexDetail(n) {
  const X = window.RR_DEX, s = X.species[n], sp = SPEC[n];
  const stats = [['HP', sp.bs.hp], ['Atk', sp.bs.at], ['Def', sp.bs.df], ['SpA', sp.bs.sa], ['SpD', sp.bs.sd], ['Spe', sp.bs.sp]];
  const ab = s.ab.map((id, i) => id && X.abilities[id] ? `<li><b>${esc(X.abilities[id][0])}</b>${i === 2 ? ' <span class="tag">hidden</span>' : ''} <span class="muted">— ${esc(X.abilities[id][1])}</span></li>` : '').join('');
  const fam = [];
  const walk = (name, depth, how) => { const e = X.species[name]; if (!e || fam.some(f => f.name === name) || depth > 4) return; fam.push({ name, depth, how }); e.ev.forEach(([t, txt]) => walk(t, depth + 1, txt)); };
  walk(s.an, 0, '');
  const where = (encIndex()[n] || []).slice().sort((a, b) => b.r - a.r);
  // gifts, trades, statics, roamers, raid dens, fossils, the Celadon egg vendor and Game Corner, Mystery Gifts (where.js)
  const extra = window.RR_WHERE ? window.RR_WHERE.rows(n, X, where.length > 0) : [];
  const usedBy = bossIndex()[n] || [];
  const own = owned().filter(m => m.species === n);
  // each move is a tappable row; tapping opens what it does (hover tooltips don't exist on a phone)
  const row = (id, lead) => { const m = X.moves[id]; if (!m) return ''; return `<tr class="mvrow" data-mvid="${id}"><td class="num muted">${lead}</td><td>${moveChip(m[0])}</td><td class="small">${esc(X.splits[m[5]] || '')}</td><td class="r num">${m[2] > 1 ? m[2] : '—'}</td><td class="r num">${m[3] || '—'}</td></tr><tr class="mvinfo" hidden><td colspan="5">${moveInfoHTML(m)}</td></tr>`; };
  const tabs = { lv: ['Level', s.lv.length], tm: ['TM', s.tm.length], tu: ['Tutor', s.tu.length], em: ['Egg', s.em.length] };
  let rows = '';
  if (dexMoveTab === 'lv') rows = s.lv.slice().sort((a, b) => a[1] - b[1]).map(([id, lv]) => row(id, lv === 0 ? 'Evo' : lv)).join('');
  if (dexMoveTab === 'tm') rows = s.tm.map(i => row(X.tm[i], 'TM' + String(i + 1).padStart(2, '0'))).join('');
  if (dexMoveTab === 'tu') rows = s.tu.map(i => row(X.tu[i], '')).join('');
  if (dexMoveTab === 'em') rows = s.em.map(id => row(id, '')).join('');
  const total = stats.reduce((a, x) => a + x[1], 0);
  return `<button class="back" id="dBack">← All Pokémon</button>
  <div class="card"><div class="row">${spr(n, 56)}<div style="flex:1;min-width:0"><span class="small muted">#${String(s.d).padStart(4, '0')}</span><h2>${esc(n)}</h2><div>${chips(n)}</div>
    ${own.length ? `<p class="small" style="color:var(--good)">In your run: ${own.map(m => esc(m.nick || m.species) + (DEAD.includes(m) ? ' (dead)' : '')).join(', ')}</p>` : ''}</div></div></div>
  <div class="card"><h3>Base stats <span class="muted small">total ${total}</span></h3>
    <div class="sbars">${stats.map(([k, v]) => `<span>${k}</span><b class="num">${v}</b><i><em style="width:${Math.min(100, v / 2)}%;background:${v >= 120 ? 'var(--good)' : v >= 80 ? 'var(--warn)' : 'var(--bad)'}"></em></i>`).join('')}</div>
    <h3>Abilities</h3><ul class="small abl">${ab}</ul></div>
  <div class="card"><h3>Evolution</h3>
    ${fam.map(f => `<button class="dexrow${f.name === n ? ' on' : ''}" data-dex="${esc(f.name)}" style="margin-left:${f.depth * 14}px">${spr(f.name, 28)}<span class="dn">${esc(f.name)}</span>${f.how ? `<small class="muted">${esc(f.how)}</small>` : ''}</button>`).join('')}
    <h3>Where to find it</h3>
    ${extra.length ? `<ul class="small abl where">${extra.map(r => `<li><span class="tag">${esc(r.tag)}</span> ${r.place ? `<b>${esc(r.place)}</b> ` : ''}<span class="muted">${r.from ? `from <button class="link" data-dex="${esc(r.from)}">${esc(r.from)}</button>${esc(r.text.slice(('from ' + r.from).length))}` : esc(r.text)}${r.post ? ' · postgame' : ''}</span></li>`).join('')}</ul>` : ''}
    ${where.length ? `<ul class="small abl">${where.slice(0, 12).map(w => `<li><b>${esc(w.loc)}</b> <span class="muted">${esc(w.area !== w.loc ? w.area + ' · ' : '')}${esc(w.m)} · ${w.r}% · Lv ${esc(w.lv)}</span></li>`).join('')}</ul>` : extra.length ? '' : '<p class="small muted">Not in the wild tables, and no gift, trade, raid or other source is listed for it.</p>'}
    ${usedBy.length ? `<h3>Used by bosses</h3><p class="small">${usedBy.slice(0, 12).map(i => esc(tc(BOSS[i].name))).join(', ')}${usedBy.length > 12 ? ` and ${usedBy.length - 12} more` : ''}</p>` : ''}</div>
  <div class="card"><div class="row between"><h3>Moves</h3><div class="seg">${Object.entries(tabs).map(([k, [t, c]]) => `<button class="${k === dexMoveTab ? 'on' : ''}" data-mt="${k}">${t} <small>${c}</small></button>`).join('')}</div></div>
    <table><thead><tr><th></th><th>Move</th><th>Cat.</th><th class="r">Pow</th><th class="r">Acc</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">None.</td></tr>'}</tbody></table>
    <p class="small muted">Tap a move to see what it does.</p></div>`;
}
// What a move does: effect text from the Pokédex plus the details that matter in battle.
function moveInfoHTML(m) {
  const X = window.RR_DEX, mv = MOVES[m[0]] || {};
  const flags = [];
  if (m[6]) flags.push(`priority ${m[6] > 0 ? '+' : ''}${m[6]}`);
  if (mv.makesContact) flags.push('contact');
  if (mv.target === 'allAdjacentFoes') flags.push('hits both foes (doubles)'); else if (mv.target === 'allAdjacent') flags.push('hits everyone else, partner too (doubles)');
  if (mv.isSound) flags.push('sound'); if (mv.isPunch) flags.push('punch (Iron Fist)'); if (mv.isBite) flags.push('bite (Strong Jaw)');
  if (mv.isBullet) flags.push('ball/bomb'); if (mv.isPulse) flags.push('pulse (Mega Launcher)'); if (mv.isSlicing) flags.push('slicing (Sharpness)'); if (mv.isWind) flags.push('wind');
  if (mv.drain) flags.push('heals ' + Math.round(mv.drain[0] / mv.drain[1] * 100) + '% of damage'); if (mv.recoil) flags.push('recoil ' + Math.round(mv.recoil[0] / mv.recoil[1] * 100) + '%');
  if (mv.multihit) flags.push(Array.isArray(mv.multihit) ? 'hits ' + mv.multihit.join('–') + ' times' : 'hits ' + mv.multihit + ' times');
  if (mv.willCrit) flags.push('always crits');
  return `<div class="mvcard"><div class="row between"><b>${esc(m[0])}</b><span>${m[1] ? chip(m[1]) : ''}</span></div>
    <div class="small muted">${esc(X.splits[m[5]] || '')} · Power ${m[2] > 1 ? m[2] : '—'} · Accuracy ${m[3] ? m[3] + '%' : '—'} · ${m[4]} PP</div>
    ${flags.length ? `<div class="small">${flags.map(f => `<span class="tag">${esc(f)}</span>`).join(' ')}</div>` : ''}
    <p class="small" style="margin:5px 0 2px">${esc(m[7] || 'No description.')}</p></div>`;
}
function bindDex(el) {
  $$('.mvrow', el).forEach(r => r.onclick = () => { const info = r.nextElementSibling; if (info && info.classList.contains('mvinfo')) { info.hidden = !info.hidden; r.classList.toggle('open', !info.hidden); } });
  const dq = $('#dq', el);
  if (dq) dq.oninput = () => { dexQ = dq.value; $('#dxList', el).innerHTML = dexListHTML(); bindDexRows(el); };
  if ($('#dtype', el)) $('#dtype', el).onchange = e => { dexType = e.target.value; $('#dxList', el).innerHTML = dexListHTML(); bindDexRows(el); };
  if ($('#dBack', el)) $('#dBack', el).onclick = () => { dexSel = null; renderPanel(true); };
  $$('[data-mt]', el).forEach(b => b.onclick = () => { dexMoveTab = b.dataset.mt; renderPanel(true); });
  bindDexRows(el);
}
function bindDexRows(el) { $$('[data-dex]', el).forEach(b => b.onclick = () => { dexSel = b.dataset.dex; renderPanel(true); $('#panel').scrollTop = 0; }); }

/* ---------- Lines tab: a full battle line, and live steering in trainer battles (opt-in help) ---------- */
window.RRLines.use({ hit, movesOf, speedOf, goesFirst, eff, field, MOVES, scorePair });
if (window.RRBuild) window.RRBuild.use({ mk, hit, movesOf, speedOf, field, MOVES, SPEC });
let linesShown = new Set(), steerOn = false, steerCache = { key: '', html: '' };
/* ---------- planner thread ----------
   Lines, steering and item ideas run in planner-worker.js so the page (and the game on the phone) never waits on them.
   planAsync(job) returns the cached result, or undefined while it is being worked out (the panel redraws when it lands). */
const withOpts = o => ({ opts: o, p: mk(o) });
const packMons = list => list.map(x => ({ name: x.name, star: !!x.star, moves: x.moves, res: x.res || null, hp: x.hp, m: { slot: x.m ? x.m.slot : null }, opts: x.opts }));
let PW = null, pwBusy = null, pwNext = null;
const planCache = new Map();
function pwSend(job) {
  pwBusy = job.key;
  const o = Object.assign({}, job.opt, { foes: packMons(job.opt.foes) });
  if (o.mine) o.mine = packMons(o.mine);
  PW.postMessage({ key: job.key, kind: job.kind, base: job.base, avail: job.avail, opt: o });
}
function planner() {
  if (PW === null) {
    try {
      PW = new Worker('planner-worker.js');
      PW.onmessage = e => {
        planCache.set(e.data.key, e.data.res);
        if (planCache.size > 16) planCache.delete(planCache.keys().next().value);
        pwBusy = null;
        if (pwNext) { const n = pwNext; pwNext = null; pwSend(n); }
        if (tab === 'lines' || tab === 'battle') renderPanel(true);
      };
      PW.onerror = () => { PW = false; pwBusy = null; if (tab === 'lines') renderPanel(true); };
    } catch (e) { PW = false; }
  }
  return PW;
}
function planLocal(job) {
  const R = window.RRLines;
  const run = () => (job.kind === 'built' || job.opt.pool ? window.RRLineBuild.planBuilt(job.opt) : { res: job.kind === 'six' ? R.bestSix(job.opt) : R.plan(job.opt), opt: job.opt });
  if (job.kind === 'ideas') { const b = planLocal.full && planLocal.full.key === job.base ? planLocal.full.r : run(); return b.res ? R.itemIdeas(b.opt, b.res, n => (n in job.avail ? job.avail[n] : null)) : []; }
  const r = run();
  planLocal.full = { key: job.key, r };
  if (r.res) r.res.names = r.opt.mine.map(x => x.name);
  return r.res;
}
function planAsync(job) {
  if (planCache.has(job.key)) return planCache.get(job.key);
  if (!planner()) { const r = planLocal(job); planCache.set(job.key, r); return r; }
  if (pwBusy === job.key || (pwNext && pwNext.key === job.key)) return undefined;
  if (pwBusy) pwNext = job; else pwSend(job); // only the newest waiting job is kept
  return undefined;
}
const workingHTML = what => `<div class="card"><p class="muted"><span class="spin"></span> ${what}…</p><p class="small muted">This runs in the background, so the game and menus stay smooth.</p></div>`;
/* ---------- items: where everything is, and what you can get by now ----------
   RR_ITEMS.all rows: [name, kind, where, section index, post-game, note]. "By now" = anything at or before the next required fight's area. */
const ITEM_KIND = { item: 'Item', shop: 'Shop', care: 'Care package', tm: 'TM', hm: 'HM', tutor: 'Tutor', mega: 'Mega Stone', z: 'Z-Crystal' };
function splitSec() {
  const I = window.RR_ITEMS; if (!I || !ST || !ST.flags) return null; // not linked to the game: unknown
  const nx = nextOrder();
  if (!nx) return I.sections.length;
  // the furthest walkthrough area of any required fight up to the next one (Giovanni's gym is in early Viridian, but late)
  const ks = D.order.filter(o => o.n <= nx.n).map(o => window.RRBuild.sectionOf(o.loc)).filter(k => k < 999);
  return ks.length ? Math.max(...ks) : 999;
}
// Can you get it now? At or before your next fight's area, not post-game, and the fight that gives it (a gym TM, a trainer's reward) is beaten.
const beatenSet = () => new Set(D.order.filter(o => orderBeaten(o)).map(o => o.n));
function rowNow(r, sec, done) { if (r[4] || sec == null || r[3] > sec) return false; if (!r[6]) return true; const o = D.order.find(x => x.n === r[6]); return o ? orderBeaten(o) : true; }
// Where you can get a held item by your current split, or null if not yet.
function itemAvail(name) {
  const I = window.RR_ITEMS; if (!I) return '';
  const sec = splitSec(); if (sec == null) return '';
  const rows = I.all.filter(r => r[0] === name && ['item', 'shop', 'care'].includes(r[1]) && rowNow(r, sec));
  return rows.length ? rows.sort((a, b) => a[3] - b[3])[0][2] : null;
}
// Starred Pokémon are the ones you most want to keep: the planner counts losing one as three losses.
const isStar = m => (PREF.stars || []).includes(m.pid);
function starsHTML() {
  const list = alive().filter(m => m.level && PARTY.includes(m));
  if (!list.length) return '';
  return `<div class="card"><h3>Keep these alive</h3><div class="strip">${list.map(m => `<button data-star="${m.pid}" class="${isStar(m) ? 'on' : ''}" title="${esc(m.nick || m.species)}">${spr(m.species, 28)}<small>${isStar(m) ? '★' : '☆'} ${esc(m.nick || m.species)}</small></button>`).join('')}</div><p class="small muted">Star your important Pokémon: lines avoid losing them even if it costs a less important one.</p></div>`;
}
// The six to bring, each trained to the cap: evolution, moves to teach (and where), and which IVs matter here.
function buildsHTML(res, nx) {
  const ivTxt = iv => ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(k => iv[k]).join('/');
  return `<div class="card"><h3>Bring these six</h3><p class="small muted">Picked from ${res.pool} Pokémon (party and boxes), each played out one-on-one against their team, then as a team. Train them to Lv ${nx.cap} first.</p>
    ${res.builds.map(b => `<div class="build"><div class="row"><span class="todex" data-todex="${esc(b.species)}">${spr(b.species, 36)}</span><div style="flex:1;min-width:0">
      <div class="row between"><b>${esc(b.name)}</b><span class="num">Lv ${b.wasLevel} → ${b.level}</span></div>
      ${b.was !== b.species ? `<div class="small goodtxt">Evolve: ${esc(b.was)} → ${esc(b.species)}</div>` : ''}
      <div class="small muted">${abil(b.ability || '')} · ${esc(b.item || 'no item')} · ${esc(b.nature || '')}</div>
      <div class="small">Moves: ${b.moves.map(n => b.newMoves.some(x => x.name === n) ? `<b class="goodtxt">${esc(n)}</b>` : esc(n)).join(', ')}</div>
      ${b.newMoves.length ? `<ul class="abl small">${b.newMoves.map(x => `<li><b>${esc(x.name)}</b>: ${x.how === 'level-up' ? 'learns it by levelling (or the Move Reminder)' : esc(x.how)}</li>`).join('')}</ul>` : ''}
      <div class="small muted">IVs ${ivTxt(b.iv.ivs)} (HP/Atk/Def/SpA/SpD/Spe)${b.iv.notes.length ? '' : ': nothing here depends on them'}</div>
      ${b.iv.notes.length ? `<ul class="abl small">${b.iv.notes.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div></div></div>`).join('')}</div>`;
}
function ideasHTML(ideas) {
  if (!ideas) return `<div class="card"><h3>Item ideas</h3><p class="small muted">Tests held items (Lum, Chesto, Pecha, Rawst, Cheri, Sitrus, Leftovers, Focus Sash) on your Pokémon and keeps the ones that save a Pokémon or cut the risk, using only items you can get by now.</p><button class="back" id="lIdeas">Find item ideas</button></div>`;
  if (!ideas.length) return `<div class="card"><h3>Item ideas</h3><p class="small muted">No held item you can get by now changes this fight.</p></div>`;
  const deaths = x => (Math.round(x * 10) / 10).toString().replace(/\.0$/, '');
  return `<div class="card"><h3>Item ideas</h3><ul class="abl">${ideas.map(x => `<li>Give <b>${esc(x.name)}</b> a <b>${esc(x.item)}</b>${x.replaces ? ` (instead of ${esc(x.replaces)})` : ''}: ${esc(x.why)}. Expected losses ${deaths(x.from)} → <b>${deaths(x.to)}</b>.
      <span class="small muted">${esc(x.where)}</span>${x.alts.length ? `<br><span class="small">Also works: ${x.alts.map(a => `${esc(a.item)} (→ ${deaths(a.to)})`).join(', ')}</span>` : ''}</li>`).join('')}</ul>
    <p class="small muted">Only items you can already get (at or before ${esc(tc(nextOrder() ? nextOrder().loc : ''))}). When a Lum Berry isn't available yet, the berry for the exact status steps in: Pecha for poison, Rawst for burn, Cheri for paralysis, Chesto for sleep (and Chesto + Rest is a full heal without sleeping).</p></div>`;
}
let ideasWant = new Set();
let itemQ = '', itemKind = '';
function itemsHTML() {
  const I = window.RR_ITEMS;
  if (!I) return '<div class="empty">Item data is missing.</div>';
  const sec = splitSec();
  return `<div class="card"><input id="itQ" type="search" placeholder="Search items, TMs, tutor moves, Mega Stones…" value="${esc(itemQ)}" autocomplete="off" style="width:100%">
    <div class="seg" style="margin-top:6px">${[['', 'All'], ['item', 'Items'], ['tm', 'TMs'], ['tutor', 'Tutors'], ['mega', 'Mega'], ['z', 'Z']].map(([k, n]) => `<button data-ikind="${k}" class="${itemKind === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <p class="small muted">${sec != null && sec < 999 && nextOrder() ? `Green = you can get it by now (before ${esc(tc(nextOrder().loc))}).` : ''}</p></div><div id="itList">${itemRows()}</div>`;
}
function itemRows() {
  const I = window.RR_ITEMS, q = itemQ.trim().toLowerCase(), sec = splitSec();
  if (q.length < 2) return '<div class="empty">Type at least two letters.</div>';
  const kindOK = r => !itemKind || (itemKind === 'item' ? ['item', 'shop', 'care'].includes(r[1]) : itemKind === 'tm' ? ['tm', 'hm'].includes(r[1]) : r[1] === itemKind);
  const rows = I.all.filter(r => r[0].toLowerCase().includes(q) && kindOK(r));
  if (!rows.length) return '<div class="empty">Nothing found.</div>';
  const by = new Map(); rows.forEach(r => { if (!by.has(r[0])) by.set(r[0], []); by.get(r[0]).push(r); });
  const names = [...by.keys()].sort((a, b) => (a.toLowerCase().startsWith(q) ? 0 : 1) - (b.toLowerCase().startsWith(q) ? 0 : 1) || a.localeCompare(b)).slice(0, 40);
  return names.map(n => {
    const rs = by.get(n).slice().sort((a, b) => a[4] - b[4] || a[3] - b[3]);
    const known = sec != null, now = known && rs.some(r => rowNow(r, sec));
    return `<div class="card"><div class="row between"><b>${esc(n)}</b>${rs.every(r => r[4]) ? '<span class="tag">post-game</span>' : !known ? '' : now ? '<span class="tag good">by now</span>' : '<span class="tag own">later</span>'}</div>
      <ul class="abl small">${rs.map(r => `<li class="${known && rowNow(r, sec) ? 'goodtxt' : r[4] ? 'muted' : ''}"><span class="tag">${ITEM_KIND[r[1]] || r[1]}</span> ${esc(r[2])}${r[5] ? ` <i class="warntxt">(${esc(r[5])})</i>` : ''}</li>`).join('')}</ul></div>`;
  }).join('') + (by.size > 40 ? `<p class="small muted">${by.size - 40} more: keep typing to narrow it down.</p>` : '');
}
const ADV_LABEL = { skip: 'Skip', later: 'Save for later', first: 'Do first', note: 'Tip' };
function advOv(l) { return l && l.adv ? `<p class="adv ${l.adv.k}"><b>${ADV_LABEL[l.adv.k]}</b> ${esc(l.adv.t)}</p>` : ''; }
function lineHTML(res, dbl) {
  return `<div class="card"><div class="row between"><h3>The line</h3></div><p class="${res.won && !res.lost.length ? 'goodtxt' : res.won ? 'warntxt' : 'badtxt'}">${res.verdict}</p>
    <ol class="line">${res.steps.map(s => `<li class="${s.k}">${withSprites(s.text)}</li>`).join('')}</ol>
    <p class="small muted">Fast kill: the AI can KO before you move and will almost always click it (+9). Slow kill: it can KO but moves second (+6). A KO counts when it's at least 50% likely (damage rolls × accuracy); the chance it goes wrong (a high roll, a crit, a miss, full paralysis) is shown as risk. Setup, speed drops and status moves are tried every turn.</p></div>
    ${res.winCons.length ? `<div class="card"><h3>Win conditions</h3><ul class="abl">${res.winCons.map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''}
    ${res.dangers.length ? `<div class="card"><h3>Watch out for</h3><ul class="abl">${res.dangers.map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''}
    ${res.tips.length ? `<div class="card"><h3>Ways to manipulate the AI</h3><ul class="abl">${res.tips.map(x => `<li>${x}</li>`).join('')}</ul></div>` : ''}
    ${dbl ? `<details class="card"><summary>How the doubles AI picks its moves</summary><ul class="abl small">${window.RRLines.DOUBLES_AI_NOTES.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}`;
}
// Live steering: plan from the battle as it stands (HP left on both sides, who is out, real stat changes).
function steerHTML(bi) {
  const idx = bi.idx, dbl = bi.doubles;
  const key = [ST.battleMons, ST.enemy, ST.party, ST.partyIdx, (PREF.stars || []).join(',')].join('|');
  if (steerCache.key === key) return steerCache.html;
  const myBat = slot => [0, 2].map(b => (bi.bats[b] && idx[b] === slot ? bi.bats[b] : null)).find(Boolean) || null;
  const foeBat = slot => [1, 3].map(b => (bi.bats[b] && idx[b] === slot ? bi.bats[b] : null)).find(Boolean) || null;
  const mine = PARTY.map(m => { const bat = myBat(m.slot); return { name: m.nick || m.species, m, star: isStar(m), moves: m.moves, ...withOpts(monCalcOpts(m, bat)), res: bat ? eotCtx(bat, bi.fld) : null, hp: m.maxHP ? (bat ? bat.hp / bat.maxHP : m.hp / m.maxHP) * 100 : 0 }; }).filter(x => x.p);
  const foes = bi.enemyParty.map(m => { const bat = foeBat(m.slot); return { name: m.species, m, moves: m.moves, ...withOpts(monCalcOpts(m, bat)), res: bat ? eotCtx(bat, bi.fld) : null, hp: m.maxHP ? (bat ? bat.hp / bat.maxHP : m.hp / m.maxHP) * 100 : 0 }; }).filter(x => x.p);
  const at = (list, b) => (bi.bats[b] ? list.findIndex(x => x.m.slot === idx[b] && x.hp > 0) : -1);
  const opt = { mine, foes, f: Object.assign({}, bi.fld, { doubles: dbl, twoOpp: bi.twoOpp }), myActive: at(mine, 0), foeActive: at(foes, 1) };
  if (dbl) { opt.myActive2 = at(mine, 2); opt.foeActive2 = at(foes, 3); if (opt.myActive < 0) opt.myActive = opt.myActive2, opt.myActive2 = -1; }
  if (opt.myActive < 0) delete opt.myActive;
  const res = planAsync({ key: 'steer|' + key, kind: 'plan', opt });
  if (res === undefined) return workingHTML('Calculating the line from here');
  let html;
  if (!res || res.error) html = '<div class="empty">No line could be worked out from here.</div>';
  else {
    let now = '', sees = '';
    if (dbl) {
      const t = res.log.find(e => e.t === 'turn');
      if (t) {
        now = t.acts.filter(a => a.side === 'my' && !a.flinch).map(a => `<b>${esc(mine[a.i].name)}</b>: ${esc(a.name)}${a.spread ? ' (spread)' : ' → ' + a.targets.map(k => esc(foes[k].name)).join(', ')}`).join('<br>');
        sees = t.acts.filter(a => a.side === 'foe' && !a.flinch).map(a => `${esc(foes[a.j].name)} will use ${esc(a.name)}${a.spread ? ' on both' : ' on ' + a.targets.map(i => esc(mine[i].name)).join(', ')}${(a.sees || []).map(x => x.kind === 'fast' ? ` — <b class="badtxt">sees a fast kill on ${esc(mine[x.i].name)}</b>` : ` — <b class="warntxt">sees a slow kill on ${esc(mine[x.i].name)}</b>`).join('')}`).join('<br>');
      }
    } else {
      const first = res.log.find(e => e.t === 'stay' || e.t === 'switch' || e.t === 'pivot' || e.t === 'in' || e.t === 'lead');
      const fightEv = res.log.find(e => e.t === 'fight');
      now = !first ? '' : first.t === 'switch' ? `Switch to <b>${esc(mine[first.k].name)}</b>${first.move ? ` (it takes ${esc(first.move)}, up to ${Math.round(first.dmg)}%)` : ''}.`
        : first.t === 'pivot' ? `Use <b>${esc(first.move)}</b> and bring in <b>${esc(mine[first.k].name)}</b>${first.first ? (first.fm ? ` (it takes ${esc(first.fm)} on the way in)` : '') : ' (your Pokémon takes their hit first, the one coming in is safe this turn)'}.`
        : `Stay in with <b>${esc(mine[first.i].name)}</b>${fightEv && fightEv.i === first.i && fightEv.mm ? ` and use <b>${esc(fightEv.mm)}</b>` : ''}.`;
      sees = fightEv ? (fightEv.aiKill === 'fast' ? `<b class="badtxt">${esc(foes[fightEv.j].name)} sees a fast kill</b> on ${esc(mine[fightEv.i].name)} (${esc(fightEv.fm)}).` : fightEv.aiKill === 'slow' ? `<b class="warntxt">${esc(foes[fightEv.j].name)} sees a slow kill</b> on ${esc(mine[fightEv.i].name)} (${esc(fightEv.fm)}).` : `${esc(foes[fightEv.j].name)} sees no kill on ${esc(mine[fightEv.i].name)}; it uses ${esc(fightEv.fm || 'nothing that hurts')}.`) : '';
    }
    const nextIn = res.log.find(e => e.t === 'send');
    html = `<div class="card"><span class="small muted">${dbl ? 'This turn' : 'Right now'}</span><p class="now">${now || 'Nothing to do but attack.'}</p>${sees ? `<p class="small">${sees}</p>` : ''}
      ${nextIn ? `<p class="small">Their next Pokémon: <b>${esc(foes[nextIn.k].name)}</b>${nextIn.why.length ? ' (' + esc(nextIn.why.join(', ')) + ')' : ''}.</p>` : ''}
      <p class="small ${res.won && !res.lost.length ? 'goodtxt' : res.won ? 'warntxt' : 'badtxt'}">${res.verdict}</p>
      <div class="strip">${foes.map(x => `<button class="${x.hp <= 0 ? 'fainted' : ''}" title="${esc(x.name)}">${spr(x.name, 28)}<small>${x.hp <= 0 ? 'KO' : Math.round(x.hp) + '%'}</small></button>`).join('')}</div></div>
      <details><summary>Rest of the line</summary>${lineHTML(res, dbl)}</details>`;
  }
  steerCache = { key, html };
  return html;
}
function linesHTML() {
  if (!window.RR_DEX) loadDex();
  if (ST && ST.inBattle) {
    const bi = battleInfo();
    if (!bi || !(ST.battleType & 8)) return '<div class="empty">Lines are for trainer battles.</div>';
    if (!steerOn) return `<div class="card spoil"><h2>Struggling?</h2><p class="muted">Steer this battle: what to do right now, what the AI sees, who it sends next and how to finish with the fewest losses.</p><button class="back" id="lSteer">Steer me through this battle</button></div>`;
    return `<div class="row between"><h2>${esc(bi.trainer)}</h2><button class="back" id="lSteerOff">Hide</button></div>` + steerHTML(bi) + starsHTML();
  }
  const nx = nextOrder();
  if (!nx) return '<div class="empty">No fights left.</div>';
  const bi = pickB(nx), b = BOSS[bi], f = bossField(b);
  if (!linesShown.has(bi)) return `<div class="card spoil"><span class="small muted">Next required fight</span><h2>${esc(tc(nx.name))}</h2><p class="muted">A full line for this fight: your lead, who it baits in, when to switch, and what each side sees as a fast or slow kill. For when you're really stuck.</p><button class="back" id="lShow">Show me a line</button></div>`;
  const bm = bossMons(bi);
  const foes = bm.list.map(m => ({ name: m.s, m, moves: m.mv, ...withOpts(bossOpts(b, m)) })).filter(x => x.p);
  // every living Pokémon you have (party and boxes 1-19), assumed trained to the cap with the moves you can teach by now
  const sec = splitSec();
  const pool = alive().filter(m => m.level && m.species).map(m => ({ name: m.nick || m.species, star: isStar(m), m: { species: m.species, level: m.level, nature: m.nature, ability: m.ability, item: m.item, moves: m.moves, evs: m.evs || {}, ivs: m.ivs || {}, slot: m.pid } }));
  const lopt = { pool, foes, f: Object.assign({}, f, { twoOpp: bm.two }), cap: nx.cap, sec: sec == null ? 999 : sec, beaten: [...beatenSet()], nextN: nx.n };
  const lkey = 'built|' + bi + '|' + ST.flags + '|' + ST.party + '|' + PC.length + '|' + (PREF.stars || []).join(',') + '|' + bm.two + '|' + sec;
  const res = planAsync({ key: lkey, kind: 'built', opt: lopt });
  const head = `<div class="row between"><h2>${esc(tc(nx.name))}</h2><span class="tag">cap ${nx.cap}</span></div>`;
  if (res === undefined) return head + starsHTML() + workingHTML('Calculating the line');
  let ideas = null;
  if (res && !res.error && !f.doubles && ideasWant.has(bi)) {
    const avail = {};
    ['Lum Berry', 'Chesto Berry', 'Rawst Berry', 'Cheri Berry', 'Pecha Berry', 'Sitrus Berry', 'Leftovers', 'Focus Sash', 'Oran Berry'].forEach(n => { const w = itemAvail(n); if (w != null) avail[n] = w; });
    ideas = planAsync({ key: 'ideas|' + lkey, kind: 'ideas', base: lkey, opt: lopt, avail });
    if (ideas === undefined) ideas = 'working';
  }
  const bring = res && !res.error && res.builds ? buildsHTML(res, nx) : '';
  return `${head}<p class="small muted">${f.doubles ? 'Double battle. ' : ''}Every Pokémon you have (party and boxes) trained to Lv ${nx.cap}, with the moves it can learn or be taught by now.${bm.two ? ' Two trainers: each replaces only its own Pokémon (order read from your last attempt).' : ''}</p>` + starsHTML() + bring + (res && !res.error ? lineHTML(res, f.doubles) + (f.doubles ? '' : ideas === 'working' ? workingHTML('Calculating item ideas') : ideasHTML(ideas)) : '<div class="empty">No line could be worked out.</div>');
}

function renderPanel(force) {
  if (mode !== 'panel') return;
  // In the app, the first time the tab opens it asks how you're playing; the pick stays until changed in its settings.
  if (window.rr.android && !PREF.mode) {
    const el = $('#panel');
    el.innerHTML = `<div class="card"><h2>How are you playing this run?</h2><p class="small muted">You can change it any time in this tab's settings (the gear).</p>
      <p><button class="back" data-mode="nuzlocke" style="width:100%;padding:12px;font-size:15px"><b>Nuzlocke</b><br><span class="small muted">Tracks routes used, encounters left, dupes and the graveyard (boxes 20 to 25)</span></button></p>
      <p><button class="back" data-mode="play" style="width:100%;padding:12px;font-size:15px"><b>Playthrough</b><br><span class="small muted">Everything else, without the nuzlocke bookkeeping</span></button></p></div>` + diffCardHTML();
    bindDiff(el);
    $$('[data-mode]', el).forEach(btn => btn.onclick = () => { PREF.mode = btn.dataset.mode; savePrefs(); tellMode(); capCache.key = ''; lastPanelKey = ''; lastBarKey = ''; renderBar(); renderPanel(true); });
    return;
  }
  $$('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
  $('#tabs [data-tab="battle"]').classList.toggle('flash', !!(ST && ST.inBattle) && tab !== 'battle');
  let key = tab + '|' + CONN + '|' + PREF.ai + '|' + timeSel + '|' + viewEnemy + '|' + swView;
  if (tab === 'lines') key = 'lines|' + !!window.RR_DEX + '|' + steerOn + '|' + [...linesShown].join(',') + '|' + (ST ? [ST.inBattle, ST.flags, ST.party, ST.battleMons, ST.enemy, ST.partyIdx].join('|') : '');
  if (tab === 'dex') key = 'dex|' + dexSel + '|' + dexMoveTab + '|' + !!window.RR_DEX; // the Dex doesn't follow the game, so typing isn't interrupted
  if (tab === 'opts') key = 'opts|' + JSON.stringify(CLOUD || {}) + cloudMsg + cloudBusy;
  if (tab === 'items') key = 'items|' + itemKind + '|' + (ST ? ST.flags : ''); // typing only refreshes the list, so the box keeps focus
  if (tab === 'lines') key += '|' + (PREF.stars || []).join(',') + '|' + [...ideasWant].join(',');
  if (ST) {
    if (tab === 'battle') key += battleView === 'bosses' ? '|bosses|' + bossSel + '|' + bossMonSel + '|' + bossAtCap + '|' + [...bossLineShown].join(',') + '|' + ST.flags + ST.party + PC.length + '|' + ST.inBattle : ST.inBattle + ST.battleMons + ST.enemy + ST.party + ST.partyIdx;
    else if (tab === 'route') key += ST.mapsec + '|' + (ST.map || '') + '|' + allFloors + ST.party + PC.length + DEAD.length + '|' + window.__gameHour + '|' + (PREF.failed || []).join(',') + encOpen + (ST.flags || '');
    else if (tab === 'next') key += ST.flags + ST.party + PC.length + '|' + nextAtCap + '|' + !!window.RR_DEX;
    else if (tab === 'team') key += ST.party + PC.length + DEAD.length;
  }
  if (!force && key === lastPanelKey) return;
  lastPanelKey = key;
  const el = $('#panel'), top = el.scrollTop;
  el.innerHTML = !CONN && tab !== 'opts' && tab !== 'dex' && tab !== 'items' ? (window.rr.embedded || window.rr.android ? '<div class="empty">Waiting for the game. Continue your save; the overlay links up once you are in the game.</div>' : window.rr.web ? '<div class="empty">Not connected to the game. In RetroArch turn on <b>Settings → Network → Network Commands</b>, load Radical Red, and keep <b>thor/bridge.js</b> running.</div>' : scriptHelpHTML())
    : ({ route: routeHTML, battle: battleHTML, next: nextHTML, team: teamHTML, dex: dexHTML, lines: linesHTML, items: itemsHTML, opts: optsHTML })[tab]();
  el.scrollTop = top;
  bindPanel(el);
}
// The tables list some species in several slots; show each species once with its total rate.
function merge(mons) {
  const out = [];
  mons.forEach(x => { const e = out.find(y => y[0] === x[0]); if (e) e[1] = Math.round((e[1] + x[1]) * 100) / 100; else out.push([x[0], x[1], x[2]]); });
  return out.sort((a, b) => b[1] - a[1]);
}
/* ---------- encounters left ----------
   Every encounter location you can reach by now (up to the furthest of where you are and your next required fight)
   that nothing of yours comes from: party, PC and the dead boxes all count. The game can't see an encounter that fled or
   fainted before you caught it, so those can be marked used by hand (PREF.failed). */
const LOC_SEC = { "Oak's Lab": 0, 'Underground Path': 15 };
function locSec(name) { if (name in LOC_SEC) return LOC_SEC[name]; return window.RRBuild ? window.RRBuild.sectionOf(name) : 999; }
function encLeft() {
  const usedBy = {};
  owned().forEach(m => { const n = window.RRSave.mapLoc(T, D, m).loc; if (!usedBy[n]) usedBy[n] = m; });
  const failed = new Set(PREF.failed || []);
  const L = locNow(), here = L ? locSec(L.loc) : 999, nxs = splitSec();
  const reach = Math.max(nxs == null || nxs >= 999 ? -1 : nxs, here >= 999 ? -1 : here);
  const rows = D.locs.map(l => ({ l, sec: locSec(l.name) })).filter(x => x.sec < 999 && x.sec <= reach).sort((a, b) => a.sec - b.sec);
  return {
    reach, here: L && L.loc,
    open: rows.filter(x => !usedBy[x.l.name] && !failed.has(x.l.name)),
    used: rows.filter(x => usedBy[x.l.name] || failed.has(x.l.name)).map(x => Object.assign(x, { by: usedBy[x.l.name], failed: !usedBy[x.l.name] }))
  };
}
let encOpen = false;
/* Which floor you're on: the game's map (group, number) -> that floor's encounter tables. FireRed's map numbers, checked
   against Radical Red's own wild tables in the ROM (which also showed the B2F surf / fishing table is really on B3F).
   [area] = every table of that area; [area, kind] = only its land / water / fish tables. Maps not listed show every floor. */
const FLOORS = {
  '1,0': [['Viridian Forest']], '1,1': [['Mt Moon 1F']], '1,2': [['Mt Moon B1F']], '1,3': [['Mt Moon B2F']],
  '1,36': [['Diglett Cave']], '1,37': [['Diglett Cave B1F']], '1,38': [['Diglett Cave']],
  '1,39': [['Victory Road 1F']], '1,40': [['Victory Road 2F']], '1,41': [['Victory Road 3F']],
  '1,59': [['Mansion 1F']], '1,60': [['Mansion 2F']], '1,61': [['Mansion 3F']], '1,62': [['Mansion B1F']],
  '1,63': [['Center (Zone 1)']], '1,64': [['East (Zone 2)']], '1,65': [['North (Zone 3)']], '1,66': [['West (Zone 4)']],
  '1,72': [['Cerulean Cave 1F']], '1,73': [['Cerulean Cave 2F']], '1,74': [['Cerulean Cave B1F']],
  '1,81': [['Rock Tunnel 1F']], '1,82': [['Rock Tunnel B1F']],
  '1,83': [['Seafoam 1F']], '1,84': [['Seafoam B1F']], '1,85': [['Seafoam B2F', 'land']],
  '1,86': [['Seafoam B3F'], ['Seafoam B2F', 'water'], ['Seafoam B2F', 'fish']], '1,87': [['Seafoam B4F'], ['Seafoam B3F-B4F']],
  '1,90': [['Pkmn Tower 3&5F']], '1,91': [['Pkmn Tower 4F']], '1,92': [['Pkmn Tower 3&5F']], '1,93': [['Pkmn Tower 6F']], '1,94': [['Pkmn Tower 7F']],
  '1,96': [['Mt. Ember Exterior']], '3,39': [['Route 21A']], '3,40': [['Route 21B']]
};
const tKind = t => /Rod/.test(t.m) ? 'fish' : /Surf/.test(t.m) ? 'water' : /Rock/.test(t.m + ' ' + t.k) ? 'rock' : 'land';
let allFloors = false;
// The floor you're standing on in this location, or null (not a multi-floor place, or a map we don't know).
function floorNow(l) {
  if (!ST || !ST.map || l.areas.length < 2) return null;
  const f = FLOORS[ST.map[0] + ',' + ST.map[1]];
  if (!f || !f.every(x => l.areas.includes(x[0]))) return null;
  return { keep: (a, t) => f.some(x => x[0] === a && (!x[1] || x[1] === tKind(t))), name: f[0][0] };
}
function encRowHTML(x, here) {
  const l = x.l;
  const adv = l.adv && l.adv.k === 'skip' ? ' <span class="tag avoid">guide: skip</span>' : l.adv && l.adv.k === 'later' ? ' <span class="tag own">guide: later</span>' : '';
  const pick = l.pick ? ' <span class="small">go for ' + l.pick.top.map(esc).join(', ') + (l.pick.when ? ' (' + esc(l.pick.when) + ')' : '') + '</span>' : '';
  const note = l.note ? ' <span class="small muted">· ' + esc(l.note) + '</span>' : '';
  return '<li><b>' + esc(l.name) + '</b>' + (l.name === here ? ' <span class="tag top">you are here</span>' : '') + adv + pick + note +
    ' <button class="mini" data-fail="' + esc(l.name) + '">mark used</button></li>';
}
function encLeftHTML() {
  const e = encLeft(); if (e.reach < 0) return '';
  const hand = e.used.filter(x => x.failed);
  let body = '';
  if (encOpen) {
    body = '<ul class="abl enc">' + e.open.map(x => encRowHTML(x, e.here)).join('') + '</ul>' +
      (hand.length ? '<p class="small muted">Marked used by hand: ' + hand.map(x => esc(x.l.name) + ' <button class="mini" data-fail="' + esc(x.l.name) + '">undo</button>').join(' ') + '</p>' : '') +
      '<p class="small muted">An encounter that ran away or fainted before you caught it doesn\'t show in the game, so tap <b>mark used</b> for those.</p>';
  }
  return '<div class="card"><div class="row between"><h3>Encounters left: ' + e.open.length + '</h3><button class="back" id="encToggle">' + (encOpen ? 'Hide' : 'Show') + '</button></div>' +
    '<p class="small muted">Places you can reach by now with no Pokémon of yours from them (party, PC or dead boxes).' + (e.open.length ? '' : ' None: every encounter so far is used.') + '</p>' + body + '</div>';
}
function routeHTML() {
  const L = locNow();
  if (!L) return '<div class="empty">Reading the game…</div>';
  return (nuz() ? encLeftHTML() : '') + routeHTML0(L);
}
function routeHTML0(L) {
  const l = D.locs.find(x => x.name === L.loc);
  if (!l) return `<div class="card"><h2>${esc(L.raw ? tc(L.raw) : 'Unknown area')}</h2><p class="muted">No wild encounter table for this area. Head to a route, cave or water to see what you can catch.</p></div>`;
  const own = owned();
  const used = own.filter(m => window.RRSave.mapLoc(T, D, m).loc === l.name);
  const fams = new Set(own.map(m => family(m.species)));
  const top = new Set(l.pick ? l.pick.top : []), good = new Set(l.pick ? l.pick.good : []), avoid = new Set(l.pick ? l.pick.avoid : []);
  const fl = floorNow(l), all = l.areas.flatMap(a => (D.tables[a] || []).map(t => ({ a, t })));
  const mine = fl ? all.filter(g => fl.keep(g.a, g.t)) : all;
  const groups = fl && !allFloors && mine.length ? mine : all;
  const floorBar = fl && mine.length ? `<p class="small">${allFloors ? `Showing every floor. <button class="mini" id="floorOnly">only ${esc(fl.name)}</button>` : `You're on <b>${esc(fl.name)}</b>: showing only this floor. <button class="mini" id="floorAll">all floors</button>`}</p>` : '';
  const N = nuz();
  if (!groups.length) return `<div class="card"><div class="row between"><h2>${esc(l.name)}</h2>${!N ? '' : used.length ? '<span class="tag good">used</span>' : '<span class="tag top">open</span>'}</div>
    ${used.length && N ? '' : advOv(l)}
    ${used.length && N ? `<p>Your encounter here: ${used.map(m => spr(m.species, 24) + ' <b>' + esc(m.nick || m.species) + '</b>').join(', ')}</p>` : ''}
    <p class="muted">No wild table here. ${esc(l.note || 'This encounter is a gift, egg or static Pokémon.')}${l.pick ? ' Go for <b>' + l.pick.top.map(esc).join(', ') + '</b>.' : ''}</p></div>`;
  const hr = window.__gameHour != null ? window.__gameHour : new Date().getHours(), autoTime = hr >= 20 || hr < 4 ? 'Night' : 'Day';
  const methods = [...new Set(groups.map(g => /Night/i.test(g.t.m) ? 'Night' : /Day/i.test(g.t.m) ? 'Day' : g.t.m || g.t.k))];
  const sel = timeSel && methods.includes(timeSel) ? timeSel : methods.includes(autoTime) ? autoTime : methods[0];
  const shown = groups.filter(g => (/Night/i.test(g.t.m) ? 'Night' : /Day/i.test(g.t.m) ? 'Day' : g.t.m || g.t.k) === sel);
  return `<div class="card">
    <div class="row between"><h2>${esc(l.name)}</h2>${!N ? '' : used.length ? '<span class="tag good">used</span>' : '<span class="tag top">open</span>'}</div>
    ${used.length && N ? '' : advOv(l)}
    ${!N ? '' : used.length ? `<p>Your encounter here: ${used.map(m => spr(m.species, 24) + ' <b>' + esc(m.nick || m.species) + '</b>').join(', ')}</p>` : ((PREF.failed || []).includes(l.name) ? '<p class="small">Marked used (it got away). <button class="mini" data-fail="' + esc(l.name) + '">undo</button></p>' : '<p class="muted small">No Pokémon from here in your party, PC or dead boxes. Ran away or fainted before you caught it? <button class="mini" data-fail="' + esc(l.name) + '">mark used</button></p>')}
    ${l.pick ? `<p>Go for <b>${l.pick.top.map(esc).join(', ')}</b>${l.pick.when ? ' <span class="muted">· ' + esc(l.pick.when) + '</span>' : ''}</p>${l.pick.good.length ? `<p class="small muted">Also good: ${l.pick.good.map(esc).join(', ')}</p>` : ''}` : ''}
    ${floorBar}
  </div>
  ${methods.length > 1 ? `<div class="seg">${methods.map(m => `<button data-time="${esc(m)}" class="${m === sel ? 'on' : ''}">${esc(m)}</button>`).join('')}</div>` : ''}
  ${shown.map(g => `<h3>${esc(g.a)}${g.t.m && !/^(Day|Night)$/.test(g.t.m) ? ' · ' + esc(g.t.m) : ''}</h3>
    <table><tbody>${merge(g.t.mons).map(x => `<tr class="${top.has(x[0]) ? 'hl' : ''}"><td>${spr(x[0], 26)}</td><td>${esc(x[0])}${top.has(x[0]) ? '<span class="tag top">pick</span>' : good.has(x[0]) ? '<span class="tag good">good</span>' : avoid.has(x[0]) ? '<span class="tag avoid">skip</span>' : ''}${N && fams.has(family(x[0])) ? '<span class="tag own">dupe</span>' : ''}</td><td class="r num">${x[1]}%</td><td class="r num muted">${esc(x[2])}</td></tr>`).join('')}</tbody></table>`).join('') || '<p class="muted">No table for this time of day.</p>'}`;
}
// Double battles: every attacker against every target on the field, turn order, and the AI's likely picks.
/* "If both attack it": for each of your Pokémon on the field, their two strongest hits into it added up (high rolls).
   rows: [{ name, hp, parts: [{ name, move, loP, hiP }], lo, hi, ko, sure, alone, pred }] */
function doubledHTML(rows, compact) {
  if (!rows || !rows.length) return '';
  const P = x => Math.round(x) + '%';
  const li = r => {
    if (r.alone) { const k = r.parts.filter(x => x.hiP >= r.hp).map(x => `${esc(x.name)}'s ${esc(x.move)} (up to ${P(x.hiP)})`).join(' or '); return `<li><b class="badtxt">${esc(r.name)} can be KO'd by one attack alone:</b> ${k}.</li>`; }
    const sum = r.parts.filter(x => x.hiP > 0).map(x => `${esc(x.name)}'s ${esc(x.move)} ${P(x.loP)}–${P(x.hiP)}`).join(' + ') || 'nothing that hurts';
    const head = r.ko ? `<b class="badtxt">${esc(r.name)} ${r.sure ? 'dies' : 'can die'} if both attack it</b>` : `<span class="goodtxt">${esc(r.name)} survives both attacking it</span>`;
    const note = r.ko ? (r.alone ? ' <span class="muted">(one of them can KO it alone anyway)</span>' : r.pred ? ' <b class="warntxt">The AI is already set to do this.</b>' : '') : '';
    return `<li>${head}: ${sum} = <b class="num">${P(r.lo)}–${P(r.hi)}</b> of its ${P(r.hp)}.${note}</li>`;
  };
  const body = `<ul class="abl small">${rows.map(li).join('')}</ul>`;
  return compact ? body : `<div class="card"><h3>If both attack one of yours</h3>${body}<p class="small muted">Their strongest hit from each into the same Pokémon, high rolls, spread moves at their doubles strength. The AI doesn't plan combined KOs: each of its Pokémon scores its own moves, so it doubles up when both rate the same target highest (a slower one skips a target its partner already KOs alone).</p></div>`;
}
function doublesBattleHTML(bi) {
  const f = bi.fld;
  // fainted Pokémon still sit in their slot until replaced: leave them out so the tables only show who can act
  const mineOut = bi.mine.filter(x => x.bat.hp > 0), foesOut = bi.foes.filter(x => x.bat.hp > 0);
  const nameOf = x => x.m.nick || x.bat.species;
  const isSpreadMove = n => MOVES[n] && (MOVES[n].target === 'allAdjacentFoes' || MOVES[n].target === 'allAdjacent');
  const hitsAllyMove = n => MOVES[n] && MOVES[n].target === 'allAdjacent';
  const cellW = (a, d, n, mine) => mine ? warnTags(moveWarns(n, a.p, d.p, { doubles: true, terrain: f.terrain, defFull: d.p.curHP() >= d.p.maxHP(), others: foesOut.filter(x => x !== d).map(x => x.p), ally: (mineOut.find(x => x !== a) || {}).p })) : '';
  const cell = (a, d, n, mine) => { const h = hit(a.p, d.p, n, field(f, mine)); if (h.err) return '<td class="muted">—</td>'; if (h.status) return `<td class="muted small">status${cellW(a, d, n, mine)}</td>`; const net = eotOf(d, f).net; const cur = d.p.curHP() / d.p.maxHP() * 100; const ko = h.hi >= d.p.curHP() ? (h.lo >= d.p.curHP() ? ' <b class="goodtxt">KO</b>' : ' <span class="warntxt">KO?</span>') : (net < 0 && h.hiP - net >= cur ? ' <span class="warntxt" title="KO with end-of-turn damage">KO+</span>' : ''); const crit = !mine && !ko ? window.RRLines.deadToCrit(a.p, d.p, n, field(f, false)) : null; return `<td class="num">${pct(h.loP)}–${pct(h.hiP)}${ko}${crit ? ` <span class="warntxt" title="${esc(window.RRLines.critTxt(crit))}">crit!</span>` : ''}${cellW(a, d, n, mine)}</td>`; };
  const table = (att, defs, mine, partner) => {
    const moves = mine ? movesOf(att.p, att.bat.moves) : att.bat.moves;
    if (partner && !moves.some(hitsAllyMove)) partner = null; // only show the partner column for Earthquake-style moves
    const cols = defs.concat(partner ? [partner] : []);
    return `<table class="dtab"><thead><tr><th></th>${cols.map((d, k) => `<th class="small">${k >= defs.length ? 'partner ' : ''}${esc(mine ? (k >= defs.length ? nameOf(d) : d.bat.species) : (k >= defs.length ? d.bat.species : nameOf(d)))}</th>`).join('')}</tr></thead><tbody>
      ${moves.map(n => `<tr><td>${moveChip(label(n))}${isSpreadMove(n) ? ' <span class="tag">spread</span>' : ''}</td>${defs.map(d => cell(att, d, n, mine)).join('')}${partner ? (hitsAllyMove(n) ? cell(att, partner, n, mine) : '<td class="muted small">—</td>') : ''}</tr>`).join('')}</tbody></table>`;
  };
  // turn order (Trick Room reverses it)
  const all = mineOut.map(x => ({ n: nameOf(x), s: speedOf(x.p, f, true), mine: true })).concat(foesOut.map(x => ({ n: x.bat.species, s: speedOf(x.p, f, false), mine: false })));
  all.sort((a, b) => f.tr ? a.s - b.s : b.s - a.s);
  // what the AI is likely to pick (only with the AI prediction turned on)
  let ai = '';
  if (PREF.ai) {
    try {
      const mine = PARTY.map(m => { const a = mineOut.find(x => x.m.slot === m.slot); return { name: m.nick || m.species, m, moves: m.moves, p: a ? a.p : mk(monCalcOpts(m)), hp: a ? a.bat.hp / a.bat.maxHP * 100 : (m.maxHP ? m.hp / m.maxHP * 100 : 0) }; }).filter(x => x.p);
      const foes = bi.enemyParty.map(m => { const a = foesOut.find(x => x.m.slot === m.slot); return { name: m.species, m, moves: m.moves, p: a ? a.p : mk(monCalcOpts(m)), hp: a ? a.bat.hp / a.bat.maxHP * 100 : (m.maxHP ? m.hp / m.maxHP * 100 : 0) }; }).filter(x => x.p);
      const ix = (list, x) => (x ? list.findIndex(y => y.m.slot === x.m.slot) : -1);
      const pr = window.RRLines.predictDoubles({ mine, foes, f, myActive: ix(mine, mineOut[0]), myActive2: ix(mine, mineOut[1]), foeActive: ix(foes, foesOut[0]), foeActive2: ix(foes, foesOut[1]) });
      ai = `<div class="card"><h3>AI prediction</h3>${pr.map(c => `<p><b>${esc(foes[c.j].name)}</b>: ${esc(c.name)}${c.spread ? ' (spread)' : ' → ' + c.targets.map(i => esc(mine[i].name)).join(', ')}${(c.sees || []).map(x => x.kind === 'fast' ? ` — <b class="badtxt">sees a fast kill on ${esc(mine[x.i].name)}</b>` : ` — <b class="warntxt">sees a slow kill on ${esc(mine[x.i].name)}</b>`).join('')}</p>`).join('') || '<p class="muted">No damaging move stands out.</p>'}
        <p class="small muted">From its doubles scoring: +4 per Pokémon hit, +2 per KO, +1 strongest move, −3 if it hits its partner. Ties are random.</p></div>`;
    } catch (e) { ai = ''; }
  }
  const team = bi.enemyParty, g = bi.boss ? guideFor(bi.boss) : [];
  const stg = s => ['', 'Atk', 'Def', 'Spe', 'SpA', 'SpD', 'Acc', 'Eva'].map((n, i) => i && s[i] ? `<span class="${s[i] > 0 ? 'up' : 'down'}">${n} ${s[i] > 0 ? '+' : ''}${s[i]}</span>` : '').join('');
  const foeCard = x => `<div class="card"><div class="row"><span class="todex" data-todex="${esc(x.bat.species)}">${spr(x.bat.species, 40)}</span><div style="flex:1;min-width:0"><div class="row between"><b>${esc(x.bat.species)}</b><span class="num">Lv ${x.bat.level}</span></div>${chips(x.bat.species)}${hpBar(x.bat.hp / x.bat.maxHP * 100)}
      <div class="small muted">${abil(x.bat.ability || x.m.ability)} · ${esc(x.bat.item || x.m.item || 'no item')}</div>${stagesHTML(x.bat, mineOut)}${eotHTML(x, f)}</div></div></div>`;
  const myCard = x => `<div class="card"><div class="row"><span class="todex" data-todex="${esc(x.bat.species)}">${spr(x.bat.species, 32)}</span><div style="flex:1;min-width:0"><div class="row between"><b>Your ${esc(nameOf(x))}</b><span class="num">${x.bat.hp}/${x.bat.maxHP}</span></div>${hpBar(x.bat.hp / x.bat.maxHP * 100)}${stagesHTML(x.bat, foesOut)}${eotHTML(x, f)}</div></div></div>`;
  return `<div class="card"><div class="row between"><b>${esc(bi.trainer)}</b>${bi.ord ? `<span class="tag">#${bi.ord.n} · cap ${bi.ord.cap}</span>` : ''}</div>
      <p class="small muted">Double battle</p>${fieldHTML(f)}
      ${team.length > 2 ? `<div class="strip">${team.map(t => `<button class="${swView === t.slot ? 'on' : ''}${t.hp === 0 ? ' fainted' : ''}" title="${esc(t.species)}: switch-in damage" data-sw="${t.slot}">${spr(t.species, 32)}<small>${t.hp === 0 ? 'KO' : Math.round(t.hp / t.maxHP * 100) + '%'}</small></button>`).join('')}</div>` : ''}
      <p class="small">Turn order: ${all.map(x => `<span class="${x.mine ? 'goodtxt' : 'badtxt'}">${esc(x.n)} <span class="num">${x.s}</span></span>`).join(' › ')}</p></div>
    ${foesOut.map(foeCard).join('')}
    ${mineOut.map(myCard).join('')}
    ${foesOut.length >= 2 ? doubledHTML(mineOut.map(me => {
      const hp = me.bat.hp / me.bat.maxHP * 100;
      const parts = foesOut.map(fo => { const hs = fo.bat.moves.filter(n => n !== 'Fake Out').map(n => hit(fo.p, me.p, n, field(f, false))).filter(h => !h.err && !h.status && h.hiP > 0); const h = hs.reduce((a, x) => (!a || x.hiP > a.hiP ? x : a), null); return h ? { name: fo.bat.species, move: h.label, loP: h.loP, hiP: h.hiP } : { name: fo.bat.species, move: '', loP: 0, hiP: 0 }; });
      const lo = parts.reduce((a, x) => a + x.loP, 0), hi = parts.reduce((a, x) => a + x.hiP, 0);
      return { name: nameOf(me), hp, parts, lo, hi, ko: hi >= hp, sure: lo >= hp, alone: parts.some(x => x.hiP >= hp), pred: false };
    })) : ''}
    ${mineOut.map(me => `<h3>Your ${esc(nameOf(me))} →</h3>${table(me, foesOut, true, mineOut.find(x => x !== me))}`).join('')}
    ${foesOut.map(fo => `<h3>${esc(fo.bat.species)} →</h3>${table(fo, mineOut, false, foesOut.find(x => x !== fo))}`).join('')}
    <p class="small muted">Spread moves already have the 0.75× doubles cut. "KO?" means only on a high roll; "KO+" means the end-of-turn damage finishes it; "crit!" means it survives unless it crits (hover for the chance). The partner column shows Earthquake-style moves hitting your own side.</p>
    ${ai}
    ${switchFor(bi)}
    ${g.length ? `<details><summary>Guide strategy for this fight</summary><div class="guide">${g.map(guideHTML).join('')}</div></details>` : ''}`;
}
// The switch-in table for the opponent you clicked (defaults to the one on the field).
function switchFor(bi) {
  const slot = swView != null ? swView : (bi.foes[0] ? bi.foes[0].m.slot : null);
  const t = bi.enemyParty.find(x => x.slot === slot);
  if (!t || t.hp === 0) return '';
  const act = bi.foes.find(x => x.m.slot === t.slot);
  const p = act ? act.p : mk(monCalcOpts(t));
  return p ? switchTableHTML({ name: t.species, p, moves: t.moves }, partySwitchList(bi), bi.fld) : '';
}
let battleView = 'live', bossSel = null, bossMonSel = null, bossAtCap = (window.RR_GAME || 'rr') === 'rr';
const bossLineShown = new Set();
function battleHTML() {
  const inB = !!(ST && ST.inBattle);
  const seg = `<div class="seg" style="margin-bottom:8px"><button data-bview="live" class="${battleView === 'live' ? 'on' : ''}">${inB ? 'Live battle' : 'Battle'}</button><button data-bview="bosses" class="${battleView === 'bosses' ? 'on' : ''}">Future bosses</button></div>`;
  if (battleView === 'bosses') return seg + bossesHTML();
  if (!inB) return seg + '<div class="empty">Not in a battle. This tab fills in automatically when one starts.<br><span class="small">Open <b>Future bosses</b> to look ahead and plan.</span></div>';
  return seg + battleHTML0();
}
function battleHTML0() {
  const bi = battleInfo();
  if (!bi) return '<div class="empty">Not in a battle. This tab fills in automatically when one starts.</div>';
  if (!bi.mine.length || !bi.foes.length) return '<div class="empty">Battle starting…</div>';
  if (bi.doubles && (bi.mine.length > 1 || bi.foes.length > 1)) return doublesBattleHTML(bi);
  const foe = bi.foes.find(f => f.bat.i === viewEnemy) || bi.foes[0];
  const me = bi.mine[0];
  const f = bi.fld;
  const sMe = speedOf(me.p, f, true), sFoe = speedOf(foe.p, f, false);
  const stg = s => ['', 'Atk', 'Def', 'Spe', 'SpA', 'SpD', 'Acc', 'Eva'].map((n, i) => i && s[i] ? `<span class="${s[i] > 0 ? 'up' : 'down'}">${n} ${s[i] > 0 ? '+' : ''}${s[i]}</span>` : '').join('');
  const meEot = eotOf(me, f), foeEot = eotOf(foe, f);
  const bench = partySwitchList(bi).filter(x => x.m.slot !== me.m.slot);
  const swin = (n, mine, a) => (mine ? '' : `<details class="swin" data-swm="${esc(n)}"${swOpen.has(n) ? ' open' : ''}><summary>switch-ins</summary><div>${swinHTML(a, n, bench, f)}</div></details>`);
  // a hit that leaves them alive can still finish them with the end-of-turn damage
  const eotKO = (h, d, net) => net < 0 && h.hi < d.curHP() && h.hiP - net >= d.curHP() / d.maxHP() * 100;
  const wctx = { terrain: f.terrain, defFull: foe.p.curHP() >= foe.p.maxHP() };
  // what a move gives its user back (drain, Shell Bell, Recover & co., Liquid Ooze, Triage)
  const rec = (a, d, n, h) => { try { const t = RRLines.recText(RRLines.recovery(a, d, n, h, f)); return t && t.text ? ` <span class="small ${t.bad ? 'badtxt' : 'goodtxt'}">${esc(t.text)}</span>` : ''; } catch (e) { return ''; } };
  const list = (a, d, moves, mine) => moves.map(n => { const h = hit(a, d, n, field(f, mine)); const net = mine ? foeEot.net : meEot.net; const ws = mine ? moveWarns(n, a, d, wctx) : []; return h.err ? '' : h.status ? `<li>${moveChip(h.label)}<span class="muted small">status</span>${rec(a, d, n, null)}${warnLines(ws)}${swin(n, mine, a)}</li>` : `<li>${moveChip(h.label)}<b class="num">${pct(h.loP)}–${pct(h.hiP)}</b><span class="ko">${koHTML(h.ko, mine)}${eotKO(h, d, net) ? ' <b class="badtxt">KO with end-of-turn damage</b>' : ''}${!mine ? critTag(a, d, n, field(f, false)) : ''}</span>${rec(a, d, n, h)}${warnLines(ws)}${swin(n, mine, a)}</li>`; }).join('');
  // a straight exchange: you keep using one move, it uses its strongest hit every turn (drain healing, recoil and end-of-turn damage counted)
  let tradeLine = '';
  try {
    const t = RRLines.tradeText(RRLines.trade({ me: { name: me.m.nick || me.bat.species, p: me.p, moves: movesOf(me.p, me.bat.moves), hp: me.bat.hp / me.bat.maxHP * 100 }, foe: { name: foe.bat.species, p: foe.p, moves: foe.bat.moves, hp: foe.bat.hp / foe.bat.maxHP * 100 }, f }));
    if (t) tradeLine = `<p class="small"><b>Trading hits</b> <span class="muted">(you repeat one move, it uses its strongest hit)</span>: <span class="${t.good ? 'goodtxt' : 'badtxt'}">${esc(t.text)}</span>.</p>`;
  } catch (e) { tradeLine = ''; }
  let ai = '';
  if (PREF.ai) {
    try {
      const sc = aiScoreMoves(foe.p, me.p, foe.bat.moves, me.bat.moves, f, { first: false, hazards: false, last: '', lock: '', aiProtectedLast: false });
      const best = sc.rows.filter(r => r.prob > 0);
      ai = `<div class="card"><h3>AI prediction</h3><p>Most likely: <b>${best.map(r => esc(r.name)).join(' or ')}</b>${best.length > 1 ? ' <span class="muted small">(tied, random)</span>' : ''}</p>
        ${sc.pred ? `<p class="small muted">It expects you to use ${esc(sc.pred.label)}.</p>` : ''}
        <table><tbody>${sc.rows.map(r => `<tr${r.prob ? ' class="hl"' : ''}><td>${esc(r.name)}</td><td class="r num">${r.score} pts</td><td class="small muted">${esc(r.why.map(w => w.replace(/^([+−-]\d+)/, '$1 pts')).join('; '))}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (e) { ai = ''; }
  }
  // best of your party against this opponent
  const answers = PARTY.filter(m => m.hp > 0).map(m => { const p = mk(monCalcOpts(m, m.slot === me.m.slot ? me.bat : null)); return p ? { m, r: scoreIntim({ m, moves: m.moves, p }, { moves: foe.bat.moves, p: foe.p }, f, { mine: m.slot !== me.m.slot, foe: false }) } : null; }).filter(Boolean).sort((a, b) => b.r.s - a.r.s);
  const team = bi.enemyParty;
  const g = bi.boss ? guideFor(bi.boss) : [];
  return `<div class="card"><div class="row between"><b>${esc(bi.trainer)}</b>${bi.ord ? `<span class="tag">#${bi.ord.n} · cap ${bi.ord.cap}</span>` : ''}</div>
      ${fieldHTML(f)}
      ${team.length > 1 ? `<div class="strip">${team.map(t => { const act = bi.foes.find(x => x.m.slot === t.slot); return `<button class="${swView === t.slot || (swView == null && act && act === foe) ? 'on' : ''}${t.hp === 0 ? ' fainted' : ''}" data-sw="${t.slot}" ${act ? `data-enemy="${act.bat.i}"` : ''} title="${esc(t.species)}: switch-in damage">${spr(t.species, 32)}<small>${t.hp === 0 ? 'KO' : Math.round(t.hp / t.maxHP * 100) + '%'}</small></button>`; }).join('')}</div>` : ''}
    </div>
    <div class="card"><div class="row"><span class="todex" data-todex="${esc(foe.bat.species)}" title="Open in the Dex">${spr(foe.bat.species, 48)}</span><div style="flex:1;min-width:0"><div class="row between"><b>${esc(foe.bat.species)}</b><span class="num">Lv ${foe.bat.level}</span></div>${chips(foe.bat.species)}${hpBar(foe.bat.hp / foe.bat.maxHP * 100)}
      <div class="small muted">${abil(foe.bat.ability || foe.m.ability)} · ${esc(foe.bat.item || foe.m.item || 'no item')} · ${esc(foe.m.nature)}</div>${stagesHTML(foe.bat, bi.mine)}${eotHTML(foe, f)}</div></div></div>
    <div class="card"><div class="row"><span class="todex" data-todex="${esc(me.bat.species)}">${spr(me.bat.species, 36)}</span><div style="flex:1;min-width:0"><div class="row between"><b>Your ${esc(me.m.nick || me.bat.species)}</b><span class="num">${me.bat.hp}/${me.bat.maxHP}</span></div>${hpBar(me.bat.hp / me.bat.maxHP * 100)}<div class="small muted">${abil(me.bat.ability || me.m.ability)} · ${esc(me.bat.item || 'no item')}</div>${stagesHTML(me.bat, bi.foes)}${eotHTML(me, f)}</div></div></div>
    <p class="small">Speed <b class="num">${sMe}</b> vs <b class="num">${sFoe}</b>: ${speedWord(sMe, sFoe, f.tr) === 'you move first' ? '<span class="good">you move first</span>' : speedWord(sMe, sFoe, f.tr) === 'they move first' ? '<span class="bad">they move first</span>' : 'speed tie'}${f.tr ? ' (Trick Room)' : ''}${f.weather ? ' · ' + esc(f.weather) : ''}${f.my.tw ? ' · your Tailwind' : ''}${f.foe.tw ? ' · their Tailwind' : ''}</p>
    <h3>Your ${esc(me.m.nick || me.bat.species)} → ${esc(foe.bat.species)}</h3><ul class="dmg">${list(me.p, foe.p, movesOf(me.p, me.bat.moves), true)}</ul>
    <h3>${esc(foe.bat.species)} → your ${esc(me.m.nick || me.bat.species)}</h3><ul class="dmg">${list(foe.p, me.p, foe.bat.moves, false)}</ul>
    ${tradeLine}
    ${ai}
    ${switchFor(bi)}
    <h3>Best answers in your party</h3>
    <table><tbody>${answers.slice(0, 4).map(a => `<tr><td>${spr(a.m.species, 24)}</td><td>${esc(a.m.nick || a.m.species)}</td><td class="small">${esc(a.r.bestOff.label)} ${Math.round(a.r.bestOff.loP)}–${Math.round(a.r.bestOff.hiP)}%</td><td class="small muted">takes ${Math.round(a.r.worstDef.hiP)}%${intimTag(a.r)}</td></tr>`).join('')}</tbody></table>
    ${g.length ? `<details><summary>Guide strategy for this fight</summary><div class="guide">${g.map(guideHTML).join('')}</div></details>` : ''}`;
}
/* Future bosses: every fight you haven't beaten yet (optional ones too). Pick one to see its team at their levels, the
   field, what each of their Pokémon does to yours and your best answer, who on their team is the biggest threat, the
   guide, and (behind a button) a full line for it. "At the cap" trains your Pokémon to that fight's level cap. */
const capOf = o => (o && o.cap) || 100;
function bossMine(o) {
  return alive().filter(m => m.level && m.species).map(m => {
    const op = Object.assign(monCalcOpts(m), { hp: 100, status: '' });
    if (bossAtCap) op.level = Math.max(op.level, capOf(o));
    const p = mk(op);
    return p ? { name: m.nick || m.species, species: m.species, m, p, moves: op.moves, hp: 100, party: PARTY.includes(m) } : null;
  }).filter(Boolean);
}
function bossesHTML() {
  const left = D.order.filter(o => !orderBeaten(o));
  if (!left.length) return '<div class="empty">Every fight is beaten. Champion!</div>';
  const nx = nextOrder();
  const o = left.find(x => x.n === bossSel) || nx || left[0];
  const bi = pickB(o), b = BOSS[bi], f = bossField(b);
  const foes = b.mons.map(m => ({ m, moves: m.mv, p: mk(bossOpts(b, m)) })).filter(x => x.p);
  // at the cap: the same fully evolved, cap-trained Pokémon as the Next tab's best answers
  const built = bossAtCap ? capTeam(o, foes, f) : null;
  const all = built && built.length ? built.map(x => Object.assign({}, x, { name: x.from.nick || x.from.species, species: x.m.species, hp: 100, party: PARTY.includes(x.from) })) : bossMine(o);
  const party = all.filter(x => x.party), mine = party.length ? party : all;
  if (bossMonSel != null && !b.mons[bossMonSel]) bossMonSel = null;
  const top = topLevel(), gap = capOf(o) - top;
  // per opponent: your best answer, and how many of yours it can KO from full
  const rows = foes.map(fo => {
    const sc = mine.map(me => ({ me, r: scoreIntim(me, fo, f) })).sort(ansCmp);
    const kos = sc.filter(x => x.r.worstDef.hiP >= 100).length, walled = sc.filter(x => x.r.bestOff.hiP < 34).length;
    return { fo, best: sc[0], kos, walled };
  });
  const threat = rows.slice().sort((a, b) => b.kos - a.kos || b.walled - a.walled)[0];
  const sel = `<select id="bossSel" aria-label="Fight">${left.map(x => `<option value="${x.n}"${x === o ? ' selected' : ''}>#${x.n} ${esc(tc(x.name))} · cap ${x.cap}${x.opt ? ' (optional)' : ''}${x === nx ? ' · next' : ''}</option>`).join('')}</select>`;
  const lineBtn = bossLineShown.has(bi) ? bossLineHTML(o, bi, b, f) : `<div class="card spoil"><p class="small muted">A full line for this fight (lead, switches, what the AI sees), with your Pokémon trained to Lv ${capOf(o)}.</p><button class="back" id="bossLine">Show me a line</button></div>`;
  return `<div class="card"><div class="row between"><h3>Plan ahead</h3>${sel}</div>
      <div class="row between"><h2>${esc(tc(o.name))}</h2><span class="tag">cap ${o.cap}</span></div>
      <p class="muted small">${esc(tc(o.loc))}${f.doubles ? ' · double battle' : ''}${f.weather ? ' · ' + esc(f.weather) : ''}${f.terrain ? ' · ' + esc(f.terrain) + ' Terrain' : ''}${o.opt ? ' · optional' : ''}${nx && o.n > nx.n ? ` · ${left.filter(x => !x.opt && x.n < o.n).length} required fight${left.filter(x => !x.opt && x.n < o.n).length === 1 ? '' : 's'} before it` : ''}</p>
      <div class="strip">${b.mons.map((m, k) => `<button data-bmon="${k}" class="${k === bossMonSel ? 'on' : ''}" title="${esc(m.s)}${m.it ? ' @ ' + esc(m.it) : ''}">${spr(m.s, 32)}<small>Lv${bossLevel(b, m)}</small></button>`).join('')}</div>
      <p class="small muted">${bossMonSel == null ? 'Click one of their Pokémon for its set, stats and switch-in damage.' : ''}</p>
      <label class="chk small"><input type="checkbox" id="bossCap"${bossAtCap ? ' checked' : ''}> Your Pokémon at the level cap (Lv ${capOf(o)}), fully evolved</label>
      <p class="small ${gap > 0 ? 'warntxt' : 'goodtxt'}">Your highest level is ${top}: ${gap > 0 ? `${gap} level${gap === 1 ? '' : 's'} under the cap` : 'at the cap'}.</p>
      <p><button class="back" id="bossTC">Theory craft this fight</button></p></div>
    ${bossMonSel != null ? bossMonHTML(b, b.mons[bossMonSel], f, mine, all) : ''}
    <h3>Their team vs ${party.length ? 'your party' : 'your Pokémon'}</h3>
    <table><tbody>${rows.map(r => `<tr${r === threat && r.kos ? ' class="hl"' : ''}><td>${spr(r.fo.m.s, 24)}</td><td>${esc(r.fo.m.s)}${r.fo.m.it ? `<br><small class="muted">${esc(r.fo.m.it)}</small>` : ''}</td>
      <td class="small">${r.kos ? `<b class="badtxt">KOs ${r.kos}</b>` : '<span class="muted">KOs none</span>'}${r.walled ? `<br><span class="warntxt">walls ${r.walled}</span>` : ''}</td>
      <td>${r.best ? spr(r.best.me.species, 24) + ' ' + esc(r.best.me.name) : '—'}</td><td class="small muted">${r.best ? Math.round(r.best.r.bestOff.loP) + '–' + Math.round(r.best.r.bestOff.hiP) + '%, takes ' + Math.round(r.best.r.worstDef.hiP) + '%' + intimTag(r.best.r) : ''}</td></tr>`).join('')}</tbody></table>
    <p class="small muted">KOs = how many of ${party.length ? 'your party' : 'yours'} it can KO from full HP; walls = how many of yours can't do a third to it. Then your best answer to it.${threat && threat.kos ? ` Biggest threat: <b>${esc(threat.fo.m.s)}</b>.` : ''}</p>
    ${party.length && all.length > party.length ? bossBoxHTML(rows, all.filter(x => !x.party), f) : ''}
    ${guideFor(b).length ? `<details><summary>Guide strategy</summary><div class="guide">${guideFor(b).map(guideHTML).join('')}</div></details>` : ''}
    ${lineBtn}
    <h3>Coming up</h3>
    <table><tbody>${left.slice(0, 40).map(x => `<tr class="${x === o ? 'hl' : ''}" data-bsel="${x.n}" style="cursor:pointer"><td class="num muted">${x.n}</td><td>${esc(tc(x.name))}${x.opt ? ' <span class="tag">optional</span>' : ''}</td><td class="small muted">${esc(tc(x.loc))}</td><td class="r num">${x.cap}</td></tr>`).join('')}</tbody></table>`;
}
// Box Pokémon that answer something on their team better than anything in your party.
function bossBoxHTML(rows, box, f) {
  const picks = rows.map(r => {
    const b = box.map(me => ({ me, r: scoreIntim(me, r.fo, f) })).sort(ansCmp)[0];
    return b && r.best && b.r.s > r.best.r.s + 0.5 ? { fo: r.fo, b } : null;
  }).filter(Boolean);
  if (!picks.length) return '';
  return `<div class="card"><h3>From your boxes</h3><ul class="abl small">${picks.map(x => `<li>${spr(x.b.me.species, 20)} <b>${esc(x.b.me.name)}</b> handles ${spr(x.fo.m.s, 20)} ${esc(x.fo.m.s)} better than your party: ${Math.round(x.b.r.bestOff.loP)}–${Math.round(x.b.r.bestOff.hiP)}%, takes ${Math.round(x.b.r.worstDef.hiP)}%.</li>`).join('')}</ul></div>`;
}
// The full line for a future fight (same planner as the Lines tab, with what you can get by that fight).
function bossLineHTML(o, bi, b, f) {
  if (!window.RR_DEX) loadDex();
  const bm = bossMons(bi);
  const foes = bm.list.map(m => ({ name: m.s, m, moves: m.mv, ...withOpts(bossOpts(b, m)) })).filter(x => x.p);
  const ks = window.RRBuild ? D.order.filter(x => x.n <= o.n).map(x => window.RRBuild.sectionOf(x.loc)).filter(k => k < 999) : [];
  const sec = ks.length ? Math.max(...ks) : 999;
  const pool = alive().filter(m => m.level && m.species).map(m => ({ name: m.nick || m.species, star: isStar(m), m: { species: m.species, level: m.level, nature: m.nature, ability: m.ability, item: m.item, moves: m.moves, evs: m.evs || {}, ivs: m.ivs || {}, slot: m.pid } }));
  const lopt = { pool, foes, f: Object.assign({}, f, { twoOpp: bm.two }), cap: o.cap, sec, beaten: [...beatenSet()], nextN: o.n };
  const lkey = 'built|' + bi + '|' + ST.flags + '|' + ST.party + '|' + PC.length + '|' + (PREF.stars || []).join(',') + '|' + bm.two + '|' + sec;
  const res = planAsync({ key: lkey, kind: 'built', opt: lopt });
  if (res === undefined) return workingHTML('Calculating the line');
  if (!res || res.error) return '<div class="empty">No line could be worked out.</div>';
  return `<div class="row between"><h3>Line for ${esc(tc(o.name))}</h3><button class="mini" id="bossLineOff">hide</button></div>` + (res.builds ? buildsHTML(res, o) : '') + lineHTML(res, f.doubles);
}
let nextView = 'fight', tcMine = null, tcFight = null, tcHp = false, tcOpen = null;
function nextHTML() {
  const nx = nextOrder();
  if (!nx) return '<div class="empty">Every required fight is beaten. Champion!</div>';
  const seg = `<div class="seg" style="margin-bottom:8px"><button data-nview="fight" class="${nextView === 'fight' ? 'on' : ''}">Fight</button><button data-nview="tc" class="${nextView === 'tc' ? 'on' : ''}">Theory craft</button></div>`;
  return seg + (nextView === 'tc' ? theoryHTML(nx) : nextFightHTML(nx));
}
/* Theory craft: tap through your Pokémon, craft any of them (species, level, nature, ability, item, moves, HP: saved per
   Pokémon in PREF.tcSets until you reset it), see against each Pokémon of an upcoming fight what it takes, what it deals,
   who moves first, a played-safe 1v1 and who it baits in; then play the fight out yourself in the battle sandbox. */
let tcSB = null, tcTeam = null, tcLead = null, tcClearing = false, tcOddsOpen = true, tcPeek = null, tcPartner = null, tcLead2 = null, tcPick = {};
const tcSet = m => (PREF.tcSets || {})[m.pid] || null;
// calc options for one of your Pokémon with its crafted set (full HP unless "use current HP")
function tcOpts(m) {
  const o = monCalcOpts(m), s = tcSet(m);
  if (!tcHp) { o.hp = 100; o.status = ''; }
  if (s) {
    ['species', 'nature', 'ability', 'item'].forEach(k => { if (s[k] != null) o[k] = s[k]; });
    if (s.level) o.level = Math.max(1, Math.min(100, +s.level));
    if (s.moves) o.moves = s.moves.filter(n => n && MOVES[n]);
    if (s.hp != null && s.hp !== '') o.hp = Math.max(1, Math.min(100, +s.hp));
  }
  return o;
}
const tcName = m => m.nick || m.species;
function tcLists() {
  if (tcLists.html) return tcLists.html;
  const sp = Object.keys(SPEC).sort(), mv = Object.keys(MOVES).filter(n => !MOVES[n].isMax && !MOVES[n].isZ).sort();
  const it = window.RR_ITEMS ? [...new Set(window.RR_ITEMS.all.filter(r => ['item', 'mega', 'z', 'shop', 'care'].includes(r[1])).map(r => r[0]))].sort() : [];
  tcLists.html = `<datalist id="dlSp">${sp.map(n => `<option value="${esc(n)}">`).join('')}</datalist><datalist id="dlMv">${mv.map(n => `<option value="${esc(n)}">`).join('')}</datalist><datalist id="dlIt">${it.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
  return tcLists.html;
}
// "Rash (+Sp. Atk, −Sp. Def)": the game's nature order is raised stat (row) by lowered stat (column) over Atk, Def, Speed, Sp. Atk, Sp. Def
const NATURE_ORDER = ['Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax', 'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive', 'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash', 'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky'];
function natureTxt(n) {
  const i = NATURE_ORDER.indexOf(n); if (i < 0) return n;
  const S = ['Atk', 'Def', 'Speed', 'Sp. Atk', 'Sp. Def'], up = Math.floor(i / 5), down = i % 5;
  return up === down ? n + ' (neutral)' : `${n} (+${S[up]}, −${S[down]})`;
}
function tcCraftHTML(cur, opts) {
  const s = tcSet(cur), sp = opts.species;
  if (!window.RR_DEX) loadDex();
  const abl = [...new Set((window.RR_DEX && window.RR_DEX.species[sp] ? dexAbilities(sp) : []).concat(Object.values((SPEC[sp] || {}).abilities || {})).concat([opts.ability]).filter(Boolean))];
  const natures = Object.values((window.RR_SAVE && window.RR_SAVE.natures) || {});
  const mv = (opts.moves || []).concat(['', '', '', '']).slice(0, 4);
  return `<div class="card"><div class="row between"><h3>Craft ${esc(tcName(cur))}</h3>${s ? '<button class="mini" id="tcReset">reset to its real set</button>' : '<span class="small muted">its real set</span>'}</div>
    ${tcLists()}
    <div class="tcform">
      <label>Species<input data-tcf="species" list="dlSp" value="${esc(sp)}"></label>
      <label>Level<input data-tcf="level" type="number" min="1" max="100" value="${esc(opts.level)}"></label>
      <label>Nature<select data-tcf="nature">${natures.map(n => `<option value="${esc(n)}"${n === opts.nature ? ' selected' : ''}>${esc(natureTxt(n))}</option>`).join('')}</select></label>
      <label>Ability<select data-tcf="ability">${abl.map(a => `<option${a === opts.ability ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      <label>Item<input data-tcf="item" list="dlIt" value="${esc(opts.item || '')}" placeholder="none"></label>
      <label>HP %<input data-tcf="hp" type="number" min="1" max="100" value="${Math.round(opts.hp)}"></label>
      ${mv.map((n, i) => `<label>Move ${i + 1}<input data-tcf="move${i}" list="dlMv" value="${esc(n)}" placeholder="—"></label>`).join('')}
    </div>
    ${abilDesc(opts.ability) ? `<p class="small"><b>${esc(opts.ability)}:</b> ${esc(abilDesc(opts.ability))}</p>` : ''}
    <p class="small muted">Changes are kept for this Pokémon (and used in the sandbox) until you reset it.</p></div>`;
}
// The AI's options against you: each move's damage and the chance it picks it (CFRU scoring: the top score wins, ties are random).
function oddsHTML(odds) {
  if (!odds || !odds.length) return '';
  const P = x => Math.round(x) + '%';
  return `<table class="odds small"><thead><tr><th>Their move</th><th class="r">Damage to you</th><th class="r">Picks it</th></tr></thead><tbody>${odds.slice().sort((a, b) => b.p - a.p || b.score - a.score).map(o => `<tr${o.p > 0 ? ' class="hl"' : ''}><td>${esc(o.label)}</td><td class="r num">${o.status ? '<span class="muted">status</span>' : o.hiP > 0 ? `${P(o.loP)}–${P(o.hiP)}${o.ko ? ' <b class="badtxt">KO</b>' : ''}` : '<span class="muted">no effect</span>'}</td><td class="r num">${o.p > 0 ? `<b>${P(o.p * 100)}</b>` : '0%'}</td></tr>`).join('')}</tbody></table>`;
}
const tcUpcoming = nx => { const u = D.order.filter(o => o.n >= nx.n && !orderBeaten(o)).slice(0, 8), x = D.order.find(o => o.n === tcFight && !orderBeaten(o)); return x && !u.includes(x) ? u.concat([x]).sort((a, b) => a.n - b.n) : u; };
function theoryHTML(nx) {
  const upcoming = tcUpcoming(nx);
  const o = upcoming.find(x => x.n === tcFight) || nx;
  const b = BOSS[pickB(o)], f = bossField(b);
  const pool = alive().filter(m => m.level && m.species);
  if (!pool.length) return '<div class="empty">No Pokémon to try yet.</div>';
  const cur = pool.find(m => m.pid === tcMine) || pool[0];
  const opts = tcOpts(cur);
  const me = { name: tcName(cur), moves: opts.moves, p: mk(opts), hp: opts.hp };
  const foes = b.mons.map(m => ({ name: m.s, m, moves: m.mv, p: mk(bossOpts(b, m)) })).filter(x => x.p);
  let r = null; try { r = me.p ? RRLines.theory({ me, foes, f }) : null; } catch (e) { r = null; }
  const P = x => Math.round(x) + '%';
  const head = `<div class="card"><div class="row between"><h3>Theory craft</h3><select id="tcFight" aria-label="Fight">${upcoming.map(x => `<option value="${x.n}"${x === o ? ' selected' : ''}>${esc(tc(x.name))} · cap ${x.cap}</option>`).join('')}</select></div>
    <div class="strip">${pool.map(m => `<button data-tcm="${m.pid}" class="${m === cur ? 'on' : ''}" title="${esc(tcName(m))}">${spr(tcSet(m) && tcSet(m).species || m.species, 32)}<small>${esc(tcName(m).slice(0, 8))}${tcSet(m) ? '*' : ''}</small></button>`).join('')}</div>
    <label class="chk small"><input type="checkbox" id="tcHp"${tcHp ? ' checked' : ''}> Use current HP (otherwise full HP)</label>
    <p class="small muted">* = crafted.${f.doubles ? ' Double battle: pick a partner below for the doubles view; the one-on-one numbers further down are for single matchups.' : ''}</p></div>`;
  const craft = tcCraftHTML(cur, opts);
  if (!me.p) return head + craft + '<div class="card"><p class="badtxt small">That species isn\'t one the calc knows.</p></div>';
  let analysis = '';
  if (r && r.rows.length) {
    const lead = foes[0] ? foes[0].name : '';
    const bait = r.bait.filter(x => x.name !== lead || r.bait.length === 1);
    analysis = `<div class="card"><h3>Who ${esc(me.name)} baits in</h3>
      <p class="small muted">Their lead is always ${esc(lead)}. When one of theirs faints while ${esc(me.name)} is out, the AI sends the highest score.</p>
      <ol class="small abl">${bait.map((x, i) => `<li>${spr(x.name, 24)} <b>${esc(x.name)}</b> <span class="num">${x.bait}</span> <span class="muted">${esc(x.why.join(', ') || 'no special reason')}</span>${i === 0 ? ' <span class="tag top">most likely</span>' : ''}</li>`).join('')}</ol></div>`;
    const tt = t => { const w = t && RRLines.tradeText(t); return w ? `<span class="${w.good ? 'goodtxt' : 'badtxt'}">${w.good ? 'wins' : 'loses'}</span>` : '<span class="muted">?</span>'; };
    analysis += `<div class="card"><h3>${esc(me.name)} one-on-one</h3><p class="small muted">Takes = its strongest hit on a high roll. 1v1 = you repeat one move, it uses its strongest hit, played safe. Tap a row for every move.</p>${r.rows.map(x => {
      const w = x.worst, bt = x.best, cls = w && w.hiP >= 100 ? 'badtxt' : w && w.hiP >= 50 ? 'warntxt' : '';
      const sp = x.first > 0 ? '<span class="goodtxt">you first</span>' : x.first < 0 ? '<span class="badtxt">it first</span>' : 'speed tie';
      return `<details class="tcrow" data-tco="${esc(x.name)}"${tcOpen === x.name ? ' open' : ''}><summary>${spr(x.name, 28)} <b>${esc(x.name)}</b> · takes <b class="${cls}">${w ? P(w.hiP) : '0%'}</b> · deals <b>${bt ? P(bt.loP) + '–' + P(bt.hiP) : '0%'}</b> · ${sp} · 1v1 ${tt(x.trade)}</summary>
        <div class="small"><p>${x.trade ? esc(RRLines.tradeText(x.trade).text) + '.' : ''} <span class="muted">Speed ${x.sMe} vs ${x.sFoe}.</span></p>
        ${oddsHTML(x.odds)}<p class="muted">Odds for its first turn against ${esc(me.name)} at full HP: it picks the highest-scoring move, and ties are a coin flip.</p>
        <p><b>You hit it:</b> ${x.mine.length ? x.mine.slice().sort((a, c) => c.hiP - a.hiP).map(h => `${esc(h.label)} ${P(h.loP)}–${P(h.hiP)}`).join(' · ') : 'nothing that hurts'}</p></div></details>`;
    }).join('')}</div>`;
  }
  return head + craft + (f.doubles ? tcDoublesHTML(o, cur, me, pool) : '') + analysis + sandboxHTML(o, b, f, foes, pool);
}
/* Doubles in theory craft: the crafted Pokémon on your left, a partner on your right, against their two leads. What each
   lead goes for on turn 1, every matchup both ways, and the diagonal bait: when one of their slots empties, the AI picks
   the replacement against your Pokémon diagonal to that slot (their left faces your left). */
function tcBossFoes(o) {
  const bi = pickB(o), b = BOSS[bi], bm = bossMons(bi);
  const foes = bm.list.map(m => ({ name: m.s, m, moves: m.mv, p: mk(bossOpts(b, m)) })).filter(x => x.p);
  const second = bm.two ? foes.findIndex(x => x.m.slot >= 3) : -1;
  return { b, foes, two: bm.two, lead: [0, second > 0 ? second : (foes.length > 1 ? 1 : -1)] };
}
function tcDoublesHTML(o, cur, me, pool) {
  const pc = pool.find(m => m.pid === tcPartner && m !== cur) || pool.find(m => m !== cur && PARTY.includes(m)) || pool.find(m => m !== cur);
  const strip = `<div class="strip">${pool.filter(m => m !== cur).map(m => `<button data-tcp="${m.pid}" class="${m === pc ? 'on' : ''}" title="${esc(tcName(m))}">${spr(tcSet(m) && tcSet(m).species || m.species, 28)}<small>${esc(tcName(m).slice(0, 8))}</small></button>`).join('')}</div>`;
  const headD = `<div class="card"><div class="row between"><h3>Double battle</h3>${pc ? '<button class="mini" id="tcSwap">swap sides</button>' : ''}</div>
    <p class="small">Left: <b>${esc(me.name)}</b> · Right: <b>${pc ? esc(tcName(pc)) : '—'}</b>. Partner:</p>${strip}`;
  if (!pc) return headD + '<p class="small muted">You need a second Pokémon for a double battle.</p></div>';
  const po = tcOpts(pc), partner = { name: tcName(pc), moves: po.moves, p: mk(po), hp: po.hp };
  if (!partner.p) return headD + '</div>';
  const bf = tcBossFoes(o), f = Object.assign({}, bossField(bf.b), { doubles: true, twoOpp: bf.two });
  let t = null; try { t = RRLines.theoryDoubles({ pair: [me, partner], foes: bf.foes, f, lead: bf.lead }); } catch (e) { t = null; }
  if (!t) return headD + '<p class="small badtxt">Couldn\'t work this pair out.</p></div>';
  const P = x => Math.round(x) + '%', my = [me.name, partner.name], their = k => (bf.foes[k] ? bf.foes[k].name : '?');
  const ai = t.ai.map(a => `<li>${spr(their(a.j), 22)} <b>${esc(their(a.j))}</b>: ${esc(a.name)}${a.spread ? ' (hits both)' : ''} ${a.dmg.map(d => `→ ${esc(my[d.i])} <span class="num">${P(d.loP)}–${P(d.hiP)}</span>${d.ko ? ' <b class="badtxt">KO</b>' : ''}`).join(', ')}${a.sees.map(x => x.kind === 'fast' ? ` <b class="badtxt">fast kill on ${esc(my[x.i])}</b>` : ` <b class="warntxt">slow kill on ${esc(my[x.i])}</b>`).join('')}</li>`).join('');
  const grid = `<div class="tscroll"><table class="dtab small"><thead><tr><th>Theirs</th>${t.grid.map(g => `<th>${spr(g.name === me.name ? (me.p.name) : partner.p.name, 22)} ${esc(g.name)}<br><small class="muted">you deal / it deals</small></th>`).join('')}</tr></thead><tbody>
    ${bf.foes.map((fo, k) => `<tr${t.lead.includes(k) ? ' class="hl"' : ''}><td>${spr(fo.name, 22)} ${esc(fo.name)}${t.lead.includes(k) ? ' <small class="tag">lead</small>' : ''}</td>${t.grid.map(g => { const v = g.vs[k]; return `<td class="num">${v.best ? P(v.best.loP) + '–' + P(v.best.hiP) : '0%'}${v.koIt ? ' <b class="goodtxt">KO</b>' : ''} / <span class="${v.koYou ? 'badtxt' : v.worst && v.worst.hiP >= 50 ? 'warntxt' : ''}">${v.worst ? P(v.worst.hiP) : '0%'}${v.koYou ? ' KO' : ''}</span><br><small class="${v.first > 0 ? 'goodtxt' : v.first < 0 ? 'badtxt' : 'muted'}">${v.first > 0 ? 'you first' : v.first < 0 ? 'it first' : 'tie'}</small></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  const side = s => (s ? 'right' : 'left');
  const bait = t.bait.filter(x => x.out >= 0).map(x => {
    const top = x.list[0], alt = x.swap[0];
    return `<li>Their <b>${side(x.slot)}</b> (${spr(x.outName, 20)} ${esc(x.outName)}) is diagonal to your <b>${side(x.slot)}</b>, ${esc(x.diagName)}. If it goes down, the AI picks against ${esc(x.diagName)}: ${top ? `${spr(top.name, 20)} <b>${esc(top.name)}</b>${top.why.length ? ' <span class="muted">(' + esc(top.why.join(', ')) + ')</span>' : ''}${x.list[1] ? `, then ${esc(x.list[1].name)}` : ''}` : 'nothing left to send'}.
      ${alt && x.swapName ? `<br><span class="small muted">Swap sides and it's picked against ${esc(x.swapName)} instead: <b>${esc(alt.name)}</b>${alt.k === (top && top.k) ? ' (the same)' : ''}.</span>` : ''}</li>`;
  }).join('');
  return headD + `${t.entry && t.entry.length ? `<p class="small muted">${t.entry.join(" ")}</p>` : ''}</div>
    <div class="card"><h3>Turn 1: what their leads go for</h3><ul class="abl small">${ai || '<li class="muted">Nothing that hurts.</li>'}</ul>
      <p class="small muted">Doubles AI: each of theirs scores every attack against both of yours; spread moves that hit both score high, and the slower one ignores a target its partner already KOs.</p></div>
    ${doubledHTML(t.doubled)}
    <div class="card"><h3>Diagonal bait</h3><ul class="abl small">${bait}</ul>
      <p class="small muted">When one of their slots empties, the AI scores its replacements against your Pokémon diagonal to that slot (their left faces your left across the field); your other Pokémon only breaks ties. So the side you put a Pokémon on decides who it baits in.</p></div>
    <div class="card"><h3>Every matchup</h3>${grid}<p class="small muted">Your best hit on a low–high roll / its strongest hit on a high roll, after Intimidate and weather on entry.</p></div>`;
}
// ---- battle sandbox ----
// a peek at one of theirs: its moves into your Pokémon on the field, and who is faster
function peekTxt(x, op) {
  const P = v => Math.round(v) + '%', me = op.me ? op.me.name : 'you';
  if (x.vs) return `${x.name}: tap to see its moves into each Pokémon you could send in`;
  return `${x.name}${x.item ? ' @ ' + x.item : ''}${x.ability ? ' (' + x.ability + ')' : ''}, ${x.faster ? 'faster than' : 'slower than'} ${me}\n` +
    (x.moves || []).map(m => m.status ? `${m.label}: status` : m.hiP > 0 ? `${m.label}: ${P(m.loP)}-${P(m.hiP)}${m.ko ? ' KO' : ''}` : `${m.label}: no effect`).join('\n');
}
function peekHTML(x, op) {
  const P = v => Math.round(v) + '%';
  if (x.vs) { // choosing a replacement: its moves into each Pokémon you could send in
    const S = tcSB && tcSB.S, mon = k => S ? S.M.mine[k] : { name: '?', p: { name: '?' } };
    const cell = m => m.status ? '<span class="muted">status</span>' : m.hiP > 0 ? `${P(m.loP)}–${P(m.hiP)}${m.ko ? ' <b class="badtxt">KO</b>' : ''}` : '<span class="muted">—</span>';
    const names = (x.vs[0] ? x.vs[0].moves : []).map(m => m.label);
    return `${spr(x.species || x.name, 32)} <b>${esc(x.name)}</b> <span class="muted">${[esc(x.item || ''), abil(x.ability)].filter(Boolean).join(' · ')} · into each Pokémon you could send in</span>
      <div class="tscroll"><table class="odds"><thead><tr><th></th>${x.vs.map(v => `<th class="r" title="${esc(mon(v.k).name)}">${spr(mon(v.k).p.name, 22)}${v.faster ? '<br><small class="badtxt">slower</small>' : '<br><small class="goodtxt">faster</small>'}</th>`).join('')}</tr></thead>
      <tbody>${names.map((n, mi) => `<tr><td>${esc(n)}</td>${x.vs.map(v => `<td class="r num">${cell(v.moves[mi])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  return `${spr(x.species || x.name, 32)} <b>${esc(x.name)}</b> <span class="muted">${[esc(x.item || ''), abil(x.ability)].filter(Boolean).join(' · ')} · ${x.faster ? '<span class="badtxt">faster</span>' : '<span class="goodtxt">slower</span>'} than ${esc(op.me ? op.me.name : 'you')}</span>
    <table class="odds"><tbody>${(x.moves || []).map(m => `<tr><td>${esc(m.label)}</td><td class="r num">${m.status ? '<span class="muted">status</span>' : m.hiP > 0 ? `${P(m.loP)}–${P(m.hiP)}${m.ko ? ' <b class="badtxt">KO</b>' : ''}` : '<span class="muted">no effect</span>'}</td></tr>`).join('')}</tbody></table>`;
}
function sandboxHTML(o, b, f, foes, pool) {
  // only Pokémon you still have count (a different save, a release, a death): otherwise old picks fill the six slots
  tcTeam = (tcTeam || []).filter(pid => pool.some(m => m.pid === pid));
  if (!tcTeam.length && !tcClearing) tcTeam = PARTY.filter(m => pool.includes(m)).map(m => m.pid).slice(0, 6);
  if (tcTeam.length) tcClearing = false;
  const team = tcTeam.map(pid => pool.find(m => m.pid === pid)).filter(Boolean);
  const key = o.n + '|' + team.map(m => m.pid).join(',') + '|' + JSON.stringify(PREF.tcSets || {}) + tcHp;
  if (tcSB && tcSB.key !== key) tcSB = null; // the fight, the team or a set changed: start again
  const S = tcSB && tcSB.S;
  if (f.doubles && (!S || S.dbl)) return sandboxDblHTML(o, team, pool, S);
  if (!S) {
    const lead = team.find(m => m.pid === tcLead) || team[0];
    return `<div class="card"><h3>Battle sandbox</h3>
      <p class="small muted">Play ${esc(tc(o.name))} yourself, turn by turn. You pick every move or switch; the AI answers by the game's rules (CFRU), the same way the line planner does. Crafted sets are used.</p>
      <p class="small">Your team: <b>${team.length} of 6</b> picked. Tap to add or remove${team.length >= 6 ? ' (full: remove one to add another)' : ''}. <button class="mini" id="tcClear">clear</button></p>
      <div class="strip">${pool.map(m => `<button data-tct="${m.pid}" class="${tcTeam.includes(m.pid) ? 'on' : ''}" title="${esc(tcName(m))}">${spr(tcSet(m) && tcSet(m).species || m.species, 28)}<small>${esc(tcName(m).slice(0, 8))}</small></button>`).join('')}</div>
      ${team.length ? `<p class="small">Lead <select id="tcLead">${team.map(m => `<option value="${m.pid}"${m === lead ? ' selected' : ''}>${esc(tcName(m))}</option>`).join('')}</select>
        <button class="back" id="tcStart">Start the battle</button></p>` : '<p class="small warntxt">Pick at least one Pokémon.</p>'}</div>`;
  }
  const op = RRLines.sbOptions(S), P = x => Math.round(Math.max(0, x)) + '%';
  const side = (x, mine) => x ? `<div class="sbside">${spr(x.species, 40)}<div style="flex:1;min-width:0"><b>${esc(x.name)}</b> <span class="small muted">${esc(x.z ? ({ par: 'PAR', brn: 'BRN', psn: 'PSN', tox: 'TOX', slp: 'SLP', frz: 'FRB' }[x.z] || x.z) : '')} Spe ${x.spe}</span>${hpBar(x.hp)}<span class="small">${esc(Object.entries(x.st).filter(([k, v]) => v && k.length === 3).map(([k, v]) => (v > 0 ? '+' : '') + v + ' ' + k).join(' · '))}</span></div></div>` : '';
  let ctrl = '';
  if (op.done) ctrl = `<p class="${op.won ? 'goodtxt' : 'badtxt'}"><b>${op.won ? 'You win.' : 'You lose.'}</b> Lost: ${S.st.lost.length ? [...new Set(S.st.lost)].map(i => esc(S.M.mine[i].name)).join(', ') : 'nobody'}.</p>`;
  else if (op.need === 'replace') ctrl = `<p class="small"><b>Send in:</b></p><div class="sbbtns">${op.switches.map(x => `<button class="back sbmon" data-sbr="${x.k}" title="${esc(x.name)}">${spr(S.M.mine[x.k].p.name, 26)}<small class="num">${P(x.hp)}</small></button>`).join('')}</div>`;
  else ctrl = `<div class="sbbtns">${op.moves.map(m => `<button class="back" data-sbm="${esc(m.name)}"${m.usable === false ? ' disabled' : ''}>${esc(m.label)}${m.hiP > 0 ? ` <small class="num">${P(m.loP)}–${P(m.hiP)}</small>${m.ko ? ' <small class="badtxt">KO</small>' : ''}` : m.status ? ' <small class="muted">status</small>' : ' <small class="muted">no effect</small>'}</button>`).join('')}</div>
      ${op.switches.length ? `<p class="small" style="margin:6px 0 2px">Switch to:</p><div class="sbbtns">${op.switches.map(x => `<button class="mini sbmon" data-sbs="${x.k}" title="${esc(x.name)}">${spr(S.M.mine[x.k].p.name, 26)}<small class="num">${P(x.hp)}</small></button>`).join('')}</div>` : ''}
      <details class="small"${tcOddsOpen ? ' open' : ''} id="tcOdds"><summary>${esc(op.foe ? op.foe.name : 'Their')} this turn: damage and odds</summary>${oddsHTML(op.odds)}</details>`;
  return `<div class="card"><div class="row between"><h3>Battle sandbox · turn ${S.turn}</h3><span><button class="mini" id="tcUndo"${S.hist.length ? '' : ' disabled'}>undo</button> <button class="mini" id="tcStop">new battle</button></span></div>
    ${op.foe ? `<div class="sbfield">${side(op.me, true)}${side(op.foe, false)}</div>` : ''}
    <div class="sbteam">${(op.foes || S.M.foes.map((x, k) => ({ k, name: x.name, hp: S.st.fh[k] }))).map(x => `<button class="sbmon${x.hp <= 0 ? ' down' : ''}${tcPeek === x.k ? ' on' : ''}" data-peek="${x.k}" title="${esc(peekTxt(x, op))}">${spr(x.species || x.name, 26)}<small class="num">${P(x.hp)}</small></button>`).join('')}</div>
    ${(() => { const x = (op.foes || []).find(f => f.k === tcPeek); return x ? `<div class="peek small">${peekHTML(x, op)}</div>` : ''; })()}
    ${op.wx && (op.wx.w || op.wx.t) ? `<p class="small muted">${esc([op.wx.w, op.wx.t && op.wx.t + ' Terrain'].filter(Boolean).join(' · '))}</p>` : ''}
    ${ctrl}
    <ol class="sblog small">${S.lines.map(l => `<li>${withSprites(l)}</li>`).join('')}</ol></div>`;
}
function sandboxDblHTML(o, team, pool, S) {
  const P = x => Math.round(Math.max(0, x)) + '%';
  if (!S) {
    const l1 = team.find(m => m.pid === tcLead) || team[0], l2 = team.find(m => m.pid === tcLead2 && m !== l1) || team.find(m => m !== l1);
    const opts = sel => team.map(m => `<option value="${m.pid}"${m === sel ? ' selected' : ''}>${esc(tcName(m))}</option>`).join('');
    return `<div class="card"><h3>Battle sandbox (doubles)</h3>
      <p class="small muted">Play ${esc(tc(o.name))} yourself as a double battle. Each turn pick a move and a target for both of yours; the AI answers with the doubles rules and replaces a fainted Pokémon with the best answer to your Pokémon diagonal to that slot.</p>
      <p class="small">Your team: <b>${team.length} of 6</b> picked. Tap to add or remove${team.length >= 6 ? ' (full: remove one to add another)' : ''}. <button class="mini" id="tcClear">clear</button></p>
      <div class="strip">${pool.map(m => `<button data-tct="${m.pid}" class="${tcTeam.includes(m.pid) ? 'on' : ''}" title="${esc(tcName(m))}">${spr(tcSet(m) && tcSet(m).species || m.species, 28)}<small>${esc(tcName(m).slice(0, 8))}</small></button>`).join('')}</div>
      ${team.length ? `<p class="small">Left <select id="tcLead">${opts(l1)}</select> Right <select id="tcLead2">${opts(l2)}</select>
        <button class="back" id="tcStart">Start the battle</button></p>` : '<p class="small warntxt">Pick at least one Pokémon.</p>'}</div>`;
  }
  const op = RRLines.sbOptions(S), side = s => (s ? 'right' : 'left');
  const mon = (x, mine) => (x ? `<div class="sbside">${spr(x.species, 34)}<div style="flex:1;min-width:0"><b>${esc(x.name)}</b> <span class="small muted">${esc(x.z ? ({ par: 'PAR', brn: 'BRN', psn: 'PSN', tox: 'TOX', slp: 'SLP', frz: 'FRB' }[x.z] || x.z) : '')} Spe ${x.spe}</span>${hpBar(x.hp)}<span class="small">${esc(Object.entries(x.st).filter(([k, v]) => v && k.length === 3).map(([k, v]) => (v > 0 ? '+' : '') + v + ' ' + k).join(' · '))}</span></div></div>` : '<div class="sbside muted small">—</div>');
  let ctrl = '';
  if (op.done) ctrl = `<p class="${op.won ? 'goodtxt' : 'badtxt'}"><b>${op.won ? 'You win.' : 'You lose.'}</b> Lost: ${S.st.lost.length ? [...new Set(S.st.lost)].map(i => esc(S.M.mine[i].name)).join(', ') : 'nobody'}.</p>`;
  else if (op.need === 'replace') {
    const fk = op.diagOf, fo = fk != null && fk >= 0 && S.st.fh[fk] > 0 ? S.M.foes[fk].name : '';
    ctrl = `<p class="small"><b>Send in to your ${side(op.slot)}:</b>${fo ? ` <span class="muted">(diagonal to their ${esc(fo)}: their next replacement in that slot is picked against it)</span>` : ''}</p><div class="sbbtns">${op.switches.map(x => `<button class="back sbmon" data-sbr="${x.k}" title="${esc(x.name)}">${spr(S.M.mine[x.k].p.name, 26)}<small>${esc(x.name.slice(0, 9))} <span class="num">${P(x.hp)}</span></small></button>`).join('')}</div>`;
  } else {
    // one small table per Pokémon: its moves down the side, their two across the top; tap a damage cell to pick that move on that target
    const fo = (op.foe || []).filter(Boolean), cut = n => esc(n.length > 11 ? n.slice(0, 10) + '…' : n);
    const taken = Object.entries(tcPick).filter(([, p]) => p.switch != null).map(([i, p]) => [+i, p.switch]);
    ctrl = op.mons.map(m => {
      const pk = tcPick[m.i];
      const picked = !pk ? '' : pk.switch != null ? 'switch to ' + S.M.mine[pk.switch].name : pk.move + (pk.spread || fo.length < 2 ? '' : ' → ' + S.M.foes[pk.target].name);
      const dmg = v => (v ? `${P(v.loP)}–${P(v.hiP)}${v.ko ? ' <b class="badtxt">KO</b>' : ''}` : '—');
      const rows = m.moves.map(mv => {
        if (mv.status || mv.fake) return `<tr class="muted"><td>${esc(mv.label)}</td><td colspan="${fo.length}" class="small">${mv.status ? 'status move (not played in doubles)' : 'only on its first turn out'}</td></tr>`;
        if (mv.spread) return `<tr><td>${esc(mv.label)} <small class="muted">both</small></td><td colspan="${fo.length}"><button class="mini${pk && pk.move === mv.name ? ' on' : ''}" data-sbd="${m.i}|${esc(mv.name)}|-1">${mv.vs.map(dmg).join(' · ')}</button></td></tr>`;
        return `<tr><td>${esc(mv.label)}</td>${fo.map(f => `<td><button class="mini${pk && pk.move === mv.name && pk.target === f.k ? ' on' : ''}" data-sbd="${m.i}|${esc(mv.name)}|${f.k}">${dmg(mv.vs.find(x => x.k === f.k))}</button></td>`).join('')}</tr>`;
      }).join('');
      const sw = (op.bench || []).filter(b => !taken.some(([i, k]) => k === b.k && i !== m.i)).map(b => `<button class="mini${pk && pk.switch === b.k ? ' on' : ''}" data-sbx="${m.i}|${b.k}">${esc(b.name)} <span class="num">${P(b.hp)}</span></button>`).join(' ');
      return `<div class="sbpick"><p class="small"><b>${esc(m.name)}</b> <span class="muted">(${side(m.slot)})</span>${picked ? ` → <b class="goodtxt">${esc(picked)}</b>` : ''}</p>
        <table class="odds sbmoves"><thead><tr><th></th>${fo.map(f => `<th>${cut(f.name)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
        ${sw ? `<p class="small sbsw">Switch to: ${sw}</p>` : ''}</div>`;
    }).join('') + `<p class="small muted">Pick a move (tap the damage on the target) or a switch for each; the turn plays once both are picked. Switches go first.</p>
      ${(op.doubled || []).some(r => r.ko && !r.alone) ? `<p class="small">${(op.doubled || []).filter(r => r.ko && !r.alone).map(r => `<b class="badtxt">⚠ ${esc(r.name)} ${r.sure ? 'dies' : 'can die'} if both attack it</b> (up to ${Math.round(r.hi)}% of its ${Math.round(r.hp)}%)${r.pred ? ' <b class="warntxt">and the AI is set to</b>' : ''}`).join('<br>')}</p>` : ''}
      <details class="small"${tcOddsOpen ? ' open' : ''} id="tcOdds"><summary>What the AI is about to do</summary><ul class="abl">${(op.aiNext || []).map(a => `<li><b>${esc(a.name)}</b>: ${esc(a.move)}${a.spread ? ' (hits both)' : ''} ${a.dmg.map(d => `→ ${esc(d.name)} ${P(d.loP)}–${P(d.hiP)}${d.ko ? ' <b class="badtxt">KO</b>' : ''}`).join(', ')}</li>`).join('')}</ul>
      <p class="small" style="margin:6px 0 0"><b>If both attack one of yours:</b></p>${doubledHTML(op.doubled, true)}</details>`;
  }
  return `<div class="card"><div class="row between"><h3>Battle sandbox · turn ${S.turn}</h3><span><button class="mini" id="tcUndo"${S.hist.length ? '' : ' disabled'}>undo</button> <button class="mini" id="tcStop">new battle</button></span></div>
    <div class="sbfield"><div>${op.me ? op.me.map(x => mon(x, true)).join('') : ''}</div><div>${op.foe ? op.foe.map(x => mon(x, false)).join('') : ''}</div></div>
    <div class="sbteam">${(op.foes || []).map(x => `<button class="sbmon${x.hp <= 0 ? ' down' : ''}${tcPeek === x.k ? ' on' : ''}" data-peek="${x.k}" title="${esc(x.name)}">${spr(x.species || x.name, 26)}<small class="num">${P(x.hp)}</small></button>`).join('')}</div>
    ${(() => { const x = (op.foes || []).find(f => f.k === tcPeek); return x ? `<div class="peek small">${peekHTML(x, op)}</div>` : ''; })()}
    ${op.wx && (op.wx.w || op.wx.t) ? `<p class="small muted">${esc([op.wx.w, op.wx.t && op.wx.t + ' Terrain'].filter(Boolean).join(' · '))}</p>` : ''}
    ${ctrl}
    <ol class="sblog small">${S.lines.map(l => `<li>${l}</li>`).join('')}</ol></div>`;
}
function tcStartBattle() {
  const nx = nextOrder(); if (!nx) return;
  const upcoming = tcUpcoming(nx);
  const o = upcoming.find(x => x.n === tcFight) || nx, b = BOSS[pickB(o)], f0 = bossField(b);
  const pool = alive().filter(m => m.level && m.species);
  const team = tcTeam.map(pid => pool.find(m => m.pid === pid)).filter(Boolean);
  const mine = team.map(m => { const op = tcOpts(m); return { name: tcName(m), m, moves: op.moves, p: mk(op), hp: op.hp }; }).filter(x => x.p);
  const lead = Math.max(0, team.findIndex(m => m.pid === tcLead));
  tcPick = {};
  let S;
  if (f0.doubles) {
    const bf = tcBossFoes(o), f = Object.assign({}, f0, { doubles: true, twoOpp: bf.two });
    let l2 = team.findIndex(m => m.pid === tcLead2); if (l2 < 0 || l2 === lead) l2 = team.findIndex((m, k) => k !== lead);
    S = RRLines.sbStart({ mine, foes: bf.foes, f, lead: [lead, l2 >= 0 ? l2 : null] });
  } else {
    const foes = b.mons.map(m => ({ name: m.s, m, moves: m.mv, p: mk(bossOpts(b, m)) })).filter(x => x.p);
    S = RRLines.sbStart({ mine, foes, f: Object.assign({}, f0, { doubles: false }), lead });
  }
  tcSB = S ? { S, key: o.n + '|' + team.map(m => m.pid).join(',') + '|' + JSON.stringify(PREF.tcSets || {}) + tcHp } : null;
}
/* Your Pokémon as they'd be for a fight: every one you have (party and boxes 1-19, so who's in the party doesn't matter),
   at full HP, trained to the cap, and in every fully evolved form it can reach by then (each branch tried), with the
   best moves it can learn or be taught by that point. Cached per fight and save. */
let nextAtCap = RR; // trained to the cap needs the game's Dex (learnsets): Radical Red only for now
const capCache = { key: '', list: null };
function capTeam(o, foes, f) {
  if (!window.RR_DEX) { loadDex(); return null; }
  const key = [o.n, ST && ST.flags, ST && ST.party, PC.map(m => m.pid + ':' + m.level + ':' + m.species).join(','), JSON.stringify(f)].join('|');
  if (capCache.key === key) return capCache.list;
  const sec = splitSec(), beaten = [...beatenSet()], list = [];
  alive().filter(m => m.level && m.species).forEach(m => {
    const seen = new Set();
    RRBuild.fullForms(m.species, Math.max(o.cap, m.level)).forEach(form => {
      // a step that needs a stone, Link Cable or held item you can't get by now: it stops at the stage before
      let path = form.path.map(x => Object.assign({}, x, { item: evoItem(x.how) }));
      const stop = path.findIndex(x => x.item && x.item.where === null);
      if (stop >= 0) path = path.slice(0, stop);
      const species = path.length ? path[path.length - 1].to : m.species;
      if (seen.has(species)) return; seen.add(species);
      form = { species, path };
      let b = null; try { b = RRBuild.buildAtCap({ m, foes, f, cap: o.cap, sec: sec == null ? 999 : sec, beaten, nextN: o.n, form }); } catch (e) { b = null; }
      if (!b) return;
      const p = mk(Object.assign({}, b.opts, { hp: 100, status: '' }));
      if (p) list.push({ m: Object.assign({}, m, { species: b.species }), from: m, moves: b.moves, p, build: b });
    });
  });
  capCache.key = key; capCache.list = list;
  return list;
}
// The item an evolution step needs ("with a ThunderStone" -> Thunder Stone) and where you can get it by now
// (where: text, '' = not linked to the game so unknown, null = not until later).
function evoItem(how) {
  const mt = /^with an? (.+)$/i.exec(how || ''); if (!mt || !window.RR_ITEMS) return null;
  const want = mt[1].replace(/\s/g, '').toLowerCase();
  if (!evoItem.names) evoItem.names = [...new Set(window.RR_ITEMS.all.map(r => r[0]))];
  const name = evoItem.names.find(n => n.replace(/\s/g, '').toLowerCase() === want) || mt[1];
  return { name, where: itemAvail(name) };
}
// "needs" for a built answer: how it evolves (non-level steps) and any new move its best hit uses
function capNeeds(me, r) {
  if (!me.build) return '';
  const ev = (me.build.evolved || []).map(x => (x.lv ? `evolves to ${x.to} at Lv ${x.lv}` : x.item ? `${x.to}: ${x.item.name}${x.item.where ? ' (' + x.item.where + ')' : ''}` : `${x.to}: ${x.how.replace(/^on Level Up with /, 'level up with ')}`));
  const mv = r && r.bestOff && me.build.newMoves.find(x => x.name === r.bestOff.name);
  const teach = mv ? `${mv.name}: ${mv.how === 'level-up' ? 'by level-up' : mv.how}` : '';
  const all = ev.concat(teach ? [teach] : []);
  return all.length ? `<br><span class="small muted" title="${esc(all.join(' · '))}">${esc(all.join(' · ').slice(0, 90))}${all.join(' · ').length > 90 ? '…' : ''}</span>` : '';
}
function nextFightHTML(nx) {
  const bi = pickB(nx), b = BOSS[bi], f = bossField(b);
  const upcoming = D.order.filter(o => o.n >= nx.n && !orderBeaten(o)).slice(0, 6);
  const foes = b.mons.map(m => ({ m, moves: m.mv, p: mk(bossOpts(b, m)) })).filter(x => x.p);
  const now = alive().filter(m => m.level).map(m => ({ m, moves: m.moves, p: mk(Object.assign(monCalcOpts(m), { hp: 100, status: '' })) })).filter(x => x.p);
  const built = nextAtCap ? capTeam(nx, foes, f) : null;
  const mine = built && built.length ? built : now;
  if (nextFor !== bi) { nextFor = bi; nextMon = null; } // a new fight starts with nothing picked
  const sel = nextMon;
  return `<div class="card"><span class="muted small">Next required fight</span><div class="row between"><h2>${esc(tc(nx.name))}</h2><span class="tag">cap ${nx.cap}</span></div>
      <p class="muted small">${esc(tc(nx.loc))}${f.doubles ? ' · double battle' : ''}${f.weather ? ' · ' + esc(f.weather) : ''}</p>
      <div class="strip">${b.mons.map((m, k) => `<button data-nmon="${k}" class="${k === sel ? 'on' : ''}" title="${esc(m.s)}">${spr(m.s, 32)}<small>Lv${bossLevel(b, m)}</small></button>`).join('')}</div>
      <p class="small muted">${sel == null ? 'Click a Pokémon to see its moves, stats and your best answers.' : ''}</p>
      <label class="chk small"><input type="checkbox" id="nIntim"${PREF.intim !== false ? ' checked' : ''}> Count Intimidate when a Pokémon comes in</label>
      <label class="chk small"><input type="checkbox" id="nCap"${nextAtCap ? ' checked' : ''}> Answers trained to the cap (Lv ${nx.cap}), fully evolved</label></div>
    ${sel != null && b.mons[sel] ? bossMonHTML(b, b.mons[sel], f, mine) : ''}
    <h3>Your best answer to each</h3>
    ${nextAtCap && !built ? '<p class="small muted">Loading the Pokédex to evolve and train your Pokémon…</p>' : ''}
    <table><tbody>${foes.map(fo => { const r = mine.map(me => ({ me, r: scoreIntim(me, fo, f) })).sort(ansCmp)[0]; const nm = r ? (r.me.from && r.me.from.species !== r.me.m.species ? `${esc(r.me.m.nick || r.me.from.species)} <span class="muted">→ ${esc(r.me.m.species)}</span>` : esc(r.me.m.nick || r.me.m.species)) : '—'; return `<tr><td>${spr(fo.m.s, 24)}</td><td>${esc(fo.m.s)}</td><td>${r ? spr(r.me.m.species, 24) + ' ' + nm + capNeeds(r.me, r.r) : '—'}</td><td class="small muted">${r ? esc(r.r.bestOff.label || '') + ' ' + Math.round(r.r.bestOff.loP) + '–' + Math.round(r.r.bestOff.hiP) + '%, takes ' + Math.round(r.r.worstDef.hiP) + '%' + intimTag(r.r) : ''}</td></tr>`; }).join('')}</tbody></table>
    <p class="small muted">${built && built.length ? `Every Pokémon you have (party and boxes) at full HP, trained to Lv ${nx.cap} in each fully evolved form it can reach by then, with the best moves it can learn or be taught by now. So it doesn't change with who's in your party.` : 'Every Pokémon you have (party and boxes) as it is now, at full HP.'}</p>
    ${guideFor(b).length ? `<details open><summary>Guide strategy</summary><div class="guide">${guideFor(b).map(guideHTML).join('')}</div></details>` : '<p class="small muted">The guide doesn\'t cover this fight.</p>'}
    <h3>Coming up</h3>
    <table><tbody>${upcoming.map(o => `<tr${o === nx ? ' class="hl"' : ''}><td class="num muted">${o.n}</td><td>${esc(tc(o.name))}${o.opt ? ' <span class="tag">optional</span>' : ''}</td><td class="small muted">${esc(tc(o.loc))}</td><td class="r num">${o.cap}</td></tr>`).join('')}</tbody></table>`;
}
const STATK = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'], STATL = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
// One boss Pokémon in full: set, real stats at this level, IVs/EVs, and your three best answers with damage both ways.
/* Switch-in damage: every move this opponent has against each of your Pokémon, what you hit back with, and who moves
   first. foe = { name, p, moves }; mine = [{ name, species, p, moves, hp (% now) }]. Intimidate on switch-in is counted. */
/* Switch-ins for one of their moves: what each of your other Pokémon takes if it comes in on that move (your Intimidate on
   the way in counted), the HP it would have left on a high roll, KO / KO? / crit! warnings. Safest first. */
const swOpen = new Set();
function swinHTML(foeP, moveName, mons, f) {
  const rows = mons.map(me => {
    let fp = foeP;
    if (me.p.ability === 'Intimidate') { const d = window.RRLines.intimDelta(foeP); if (d && d.atk) { fp = foeP.clone(); fp.boosts.atk = Math.max(-6, Math.min(6, (fp.boosts.atk || 0) + d.atk)); } }
    const h = hit(fp, me.p, moveName, field(f, false));
    if (h.err) return null;
    if (h.status) return { me, status: true, rank: 0 };
    const cur = me.p.curHP(), ko = h.lo >= cur ? 'KO' : h.hi >= cur ? 'KO?' : '';
    const crit = !ko ? window.RRLines.deadToCrit(fp, me.p, moveName, field(f, false)) : null;
    return { me, h, ko, crit, left: Math.max(0, cur - h.hi) / me.p.maxHP() * 100, rank: ko === 'KO' ? 1e4 : ko ? 5e3 + h.hiP : h.hiP / Math.max(1, me.hp) * 100 };
  }).filter(Boolean).sort((a, b) => a.rank - b.rank);
  if (!rows.length) return '<span class="muted">No other Pokémon to switch in.</span>';
  return rows.map(r => r.status ? `<span class="swr">${esc(r.me.name)}: status move</span>`
    : `<span class="swr ${r.ko === 'KO' ? 'badtxt' : r.ko ? 'warntxt' : ''}"><b>${esc(r.me.name)}</b> ${Math.round(r.h.loP)}–${Math.round(r.h.hiP)}%${r.ko ? ' ' + r.ko : ` → ${Math.round(r.left)}% left`}${r.crit ? ` <span class="warntxt" title="${esc(window.RRLines.critTxt(r.crit))}">crit!</span>` : ''}</span>`).join('');
}
function switchTableHTML(foe, mine, f) {
  const moves = (foe.moves || []).filter(n => n && MOVES[n]);
  if (!moves.length || !mine.length) return '';
  const rows = mine.map(me => {
    let fp = foe.p, intim = '';
    if (me.p.ability === 'Intimidate') { const d = window.RRLines.intimDelta(foe.p); if (d && d.atk) { fp = foe.p.clone(); fp.boosts.atk = Math.max(-6, Math.min(6, (fp.boosts.atk || 0) + d.atk)); intim = d.atk < 0 ? 'its Atk −' + -d.atk + ' from your Intimidate' : 'its Atk +' + d.atk + ' from your Intimidate'; } }
    const cells = moves.map(n => { const h = hit(fp, me.p, n, field(f, false)); if (!h.err) h.att = fp; return h.err ? null : h; });
    const worst = Math.max(0, ...cells.filter(h => h && !h.status).map(h => h.hiP));
    const back = movesOf(me.p, me.moves).map(n => hit(me.p, foe.p, n, field(f, true))).filter(h => !h.status && !h.err).reduce((a, h) => (h.loP > a.loP ? h : a), { loP: 0, hiP: 0, label: '—' });
    const sMe = speedOf(me.p, f, true), sFoe = speedOf(foe.p, f, false);
    return { me, cells, worst, back, first: speedWord(sMe, sFoe, f.tr), intim };
  });
  // safest switch-ins first: least damage taken compared with the HP it has now
  rows.sort((a, b) => (a.worst / Math.max(1, a.me.hp)) - (b.worst / Math.max(1, b.me.hp)));
  const foeHP = foe.p.curHP() / foe.p.maxHP() * 100;
  const cell = (h, me) => {
    if (!h) return '<td class="muted">—</td>';
    if (h.status) return '<td class="muted small">status</td>';
    const ko = h.lo >= me.p.curHP() ? ' <b class="badtxt">KO</b>' : h.hi >= me.p.curHP() ? ' <span class="warntxt">KO?</span>' : '';
    const crit = !ko && h.name ? window.RRLines.deadToCrit(h.att || foe.p, me.p, h.name, field(f, false)) : null;
    return `<td class="num ${h.hiP >= 50 ? 'warntxt' : ''}">${Math.round(h.loP)}–${Math.round(h.hiP)}%${ko}${crit ? ` <span class="warntxt" title="${esc(window.RRLines.critTxt(crit))}">crit!</span>` : ''}</td>`;
  };
  return `<div class="card"><h3>Switching in on ${esc(foe.name)}</h3>
    <div class="tscroll"><table class="dtab"><thead><tr><th>Yours</th>${moves.map(n => `<th class="small">${esc(n)}</th>`).join('')}<th class="small">You hit back</th></tr></thead><tbody>
    ${rows.map((r, k) => `<tr${k === 0 ? ' class="hl"' : ''}><td>${spr(r.me.species, 24)} ${esc(r.me.name)}<br><small class="muted">${Math.round(r.me.hp)}% · ${r.first === 'you move first' ? 'faster' : r.first === 'they move first' ? 'slower' : 'tie'}</small>${r.intim ? `<br><small class="warntxt">${esc(r.intim)}</small>` : ''}</td>${r.cells.map(h => cell(h, r.me)).join('')}
      <td class="small">${esc(r.back.label)}<br><b class="num">${Math.round(r.back.loP)}–${Math.round(r.back.hiP)}%</b>${r.back.loP >= foeHP ? ' <b class="goodtxt">KO</b>' : r.back.hiP >= foeHP ? ' <span class="warntxt">KO?</span>' : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">Damage each of its moves does to each of your Pokémon at its HP right now (red KO = guaranteed, KO? = on a high roll, crit! = survives unless it crits; hover for the chance). Safest switch-in first.</p></div>`;
}
// Your party as switch-in candidates: in a battle with live HP and stat changes, otherwise at full HP.
function partySwitchList(bi) {
  return PARTY.filter(m => m.hp > 0).map(m => {
    const a = bi ? bi.mine.find(x => x.m.slot === m.slot) : null;
    const p = a ? a.p : mk(bi ? monCalcOpts(m) : Object.assign(monCalcOpts(m), { hp: 100, status: '' }));
    const hp = a ? a.bat.hp / a.bat.maxHP * 100 : bi ? (m.maxHP ? m.hp / m.maxHP * 100 : 0) : 100;
    return p ? { name: m.nick || m.species, species: m.species, m, p, moves: m.moves, hp } : null;
  }).filter(Boolean);
}
function bossMonHTML(b, m, f, mine, swList) {
  const o = bossOpts(b, m), p = mk(o), sp = SPEC[m.s];
  const st = p ? p.stats : null, bs = sp ? [sp.bs.hp, sp.bs.at, sp.bs.df, sp.bs.sa, sp.bs.sd, sp.bs.sp] : [];
  const ev = o.evs || {}, evTxt = STATK.filter(s => ev[s]).map(s => ev[s] + ' ' + STATL[s]).join(', ');
  const ivTxt = m.iv == null || m.iv === 31 ? '31 in every stat' : '31, except ' + m.iv + ' Speed';
  const foe = p ? { m, moves: m.mv, p } : null;
  const ans = foe ? mine.map(me => ({ me, r: scoreIntim(me, foe, f) })).sort(ansCmp).slice(0, 3) : [];
  return `<div class="card"><div class="row"><span class="todex" data-todex="${esc(m.s)}" title="Open in the Dex">${spr(m.s, 48)}</span><div style="flex:1;min-width:0"><div class="row between"><b>${esc(m.s)}</b><span class="num">Lv ${o.level}</span></div><div>${chips(m.s)}</div></div></div>
    <dl class="kv"><dt>Nature</dt><dd>${esc(m.nat || '—')}</dd><dt>Ability</dt><dd>${m.ab ? abil(m.ab) : '—'}${m.abM && m.abM !== m.ab ? ` <small class="muted">(Mega: ${abil(m.abM)})</small>` : ''}${m.ab && abilDesc(m.ab) ? `<br><small class="muted">${esc(abilDesc(m.ab))}</small>` : ''}</dd>
      <dt>Item</dt><dd>${esc(m.it || 'None')}</dd><dt>IVs</dt><dd>${ivTxt}</dd><dt>EVs</dt><dd>${evTxt ? esc(evTxt) : 'None'}${ST && (ST.mode & 4) ? ' <small class="muted">(Minimum Grinding)</small>' : ''}</dd></dl>
    <div class="small" style="margin:4px 0">${m.mv.map(moveChip).join(' ')}</div>
    ${st ? `<div class="stats">${STATK.map((s, i) => `<span><small>${STATL[s]}</small><b class="num">${st[s]}</b><small class="muted num">${bs[i] != null ? bs[i] : ''}</small></span>`).join('')}</div>` : ''}
    ${p ? switchTableHTML({ name: m.s, p, moves: m.mv }, swList || partySwitchList(null), f) : ''}
    ${ans.length ? `<h3>Your best answers</h3><table><tbody>${ans.map(a => `<tr><td>${spr(a.me.m.species, 24)} ${esc(a.me.m.nick || a.me.m.species)}</td><td class="small">deals ${Math.round(a.r.bestOff.loP)}–${Math.round(a.r.bestOff.hiP)}%<br><span class="muted">${esc(a.r.bestOff.label || '')}</span></td><td class="small">takes up to ${Math.round(a.r.worstDef.hiP)}%<br><span class="muted">${esc(a.r.worstDef.label || '')}</span>${intimTag(a.r)}</td><td class="small ${a.r.fast ? 'good' : 'muted'}">${a.r.fast ? 'faster' : 'slower'}</td></tr>`).join('')}</tbody></table>` : ''}
  </div>`;
}
/* ---------- team helper (Team tab, both modes) ----------
   Pick up to 3 Pokémon you want to use (PREF.core). teamHelper() trains every other candidate to the level cap (your other
   Pokémon in every evolved form you can reach by now, plus species you can still catch: in a nuzlocke only from routes
   you haven't used) and ranks them by what they add: Pokémon of your next required fights that they handle and your three
   don't (scorePair, the Next tab's matchup score), and attacking types your three are weak to that they resist. */
let thRes = null, thBusy = false;
function tellMode() { try { if (window.RRAndroid && window.RRAndroid.setMode) window.RRAndroid.setMode(nuz() ? 'nuzlocke' : 'play'); } catch (e) { /* not in the app */ } }
const ALL_TYPES = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
function bst(sp) { const b = SPEC[sp] && SPEC[sp].bs; return b ? b.hp + b.at + b.df + b.sa + b.sd + b.sp : 0; }
function catchableNow() {
  // species on the routes you can reach by now (nuzlocke: only routes you haven't used yet), with where
  const e = encLeft(), rows = nuz() ? e.open : e.open.concat(e.used), out = new Map();
  rows.forEach(x => x.l.areas.forEach(a => (D.tables[a] || []).forEach(t => t.mons.forEach(mn => { if (isSpecies(mn[0]) && !out.has(mn[0])) out.set(mn[0], x.l.name); }))));
  return out;
}
function teamHelper() {
  if (!window.RR_DEX) { loadDex(); return { err: 'Still loading the Pokédex, try again in a moment.' }; }
  const nx = nextOrder(); if (!nx) return { err: 'No upcoming fight found.' };
  const fights = D.order.filter(o => !o.opt && !orderBeaten(o)).slice(0, 3);
  const sets = fights.map(o => { const bf = tcBossFoes(o); return { o, foes: bf.foes, f: bossField(bf.b) }; }).filter(x => x.foes.length);
  if (!sets.length) return { err: 'No upcoming fights to plan for.' };
  const first = sets[0];
  const built = capTeam(nx, first.foes, first.f) || [];
  const core = (PREF.core || []).map(pid => {
    const forms = built.filter(x => x.from.pid === pid);
    return forms.length ? forms.reduce((a, x) => (bst(x.m.species) > bst(a.m.species) ? x : a)) : null;
  }).filter(Boolean);
  if (!core.length) return { err: 'Pick at least one Pokémon first.' };
  const corePids = new Set(core.map(c => c.from.pid));
  // your other Pokémon: their best form each
  const cands = [], seenFrom = new Set();
  built.filter(x => !corePids.has(x.from.pid)).sort((a, b) => bst(b.m.species) - bst(a.m.species)).forEach(x => {
    if (seenFrom.has(x.from.pid)) return; seenFrom.add(x.from.pid);
    cands.push({ x, mine: true, where: PARTY.includes(x.from) ? 'in your party' : 'in your PC' });
  });
  // species you can still catch, trained to the cap the same way
  const ownFam = new Set(owned().map(m => family(m.species)));
  const sec = splitSec(), beaten = [...beatenSet()];
  [...catchableNow()].filter(([sp]) => !ownFam.has(family(sp))).slice(0, 45).forEach(([sp, where]) => {
    const ab = Object.values((SPEC[sp] && SPEC[sp].abilities) || {})[0] || '';
    const m = { species: sp, level: nx.cap, nature: 'Hardy', ability: ab, item: '', moves: [], evs: {}, ivs: {}, pid: -1 };
    let best = null;
    (RRBuild.fullForms(sp, nx.cap) || []).concat([{ species: sp, path: [] }]).forEach(form => {
      let path = (form.path || []).map(y => Object.assign({}, y, { item: evoItem(y.how) }));
      const stop = path.findIndex(y => y.item && y.item.where === null); if (stop >= 0) path = path.slice(0, stop);
      const spF = path.length ? path[path.length - 1].to : sp;
      let b = null; try { b = RRBuild.buildAtCap({ m, foes: first.foes, f: first.f, cap: nx.cap, sec: sec == null ? 999 : sec, beaten, nextN: nx.n, form: { species: spF, path } }); } catch (e) { b = null; }
      const p = b && mk(Object.assign({}, b.opts, { hp: 100, status: '' }));
      if (p && (!best || bst(b.species) > bst(best.m.species))) best = { m: Object.assign({}, m, { species: b.species }), from: m, moves: b.moves, p, build: b };
    });
    if (best) cands.push({ x: best, mine: false, where: 'catch on ' + where });
  });
  // defence: how many of your three each attacking type hits super effectively
  const weak = {}; ALL_TYPES.forEach(t => { weak[t] = core.filter(c => eff(t, types(c.m.species)) >= 2).length; });
  const coreScore = sets.map(st => st.foes.map(fo => Math.max(...core.map(c => scorePair(c, fo, st.f).s))));
  const rows = cands.map(c => {
    const why = [], beats = [];
    let s = 0;
    sets.forEach((st, k) => st.foes.forEach((fo, j) => {
      const mine = scorePair(c.x, fo, st.f).s, have = coreScore[k][j];
      const w = k === 0 ? 1 : 0.5; // the next fight counts most
      if (mine > have && mine >= 2) { s += w * (mine - Math.max(have, 0)); if (have < 2) beats.push(fo.name); }
    }));
    const t = types(c.x.m.species), cover = [], adds = [];
    ALL_TYPES.forEach(a => { const e = eff(a, t); if (weak[a] && e <= 0.5) { s += weak[a] * (e === 0 ? 1.5 : 1); cover.push(a); } if (weak[a] >= 2 && e >= 2) { s -= 1.5; adds.push(a); } });
    if (beats.length) why.push('handles ' + [...new Set(beats)].slice(0, 4).map(esc).join(', ') + ' where your picks struggle');
    if (cover.length) why.push('resists ' + cover.slice(0, 4).join(', ') + (cover.length > 4 ? '…' : '') + ' (your picks are weak to it)');
    if (adds.length) why.push('<span class="warntxt">shares the weakness to ' + adds.join(', ') + '</span>');
    return { c, s, why };
  }).filter(r => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 6);
  return { rows, fights: sets.map(st => tc(st.o.name)), cap: nx.cap };
}
function teamHelperHTML() {
  const pool = alive().filter(m => m.level && m.species), core = (PREF.core || []).filter(pid => pool.some(m => m.pid === pid));
  const strip = `<div class="strip">${pool.map(m => `<button data-core="${m.pid}" class="${core.includes(m.pid) ? 'on' : ''}" title="${esc((m.nick && m.nick !== m.species ? m.nick + ' (' + m.species + ')' : m.species) + ' Lv' + m.level)}">${spr(m.species, 32)}<small>${esc((m.nick || m.species).slice(0, 8))}</small></button>`).join('')}</div>`;
  let res = '';
  if (thBusy) res = '<p class="small muted">Training everyone to the cap and checking your next fights…</p>';
  else if (thRes && thRes.err) res = `<p class="small">${esc(thRes.err)}</p>`;
  else if (thRes) res = `<p class="small muted">At the level cap (Lv ${thRes.cap}), against ${thRes.fights.map(esc).join(', ')}:</p>` +
    (thRes.rows.length ? thRes.rows.map((r, i) => `<div class="row" style="gap:8px;margin:6px 0">${spr(r.c.x.m.species, 36)}<div style="flex:1;min-width:0"><b>${i + 1}. ${esc(r.c.x.m.species)}</b>${r.c.mine ? ' <span class="tag good">yours' + (r.c.x.from.nick && r.c.x.from.nick !== r.c.x.from.species ? ': ' + esc(r.c.x.from.nick) : '') + '</span>' : ''} <span class="small muted">${esc(r.c.where)}${r.c.x.m.species !== r.c.x.from.species ? ' · evolve from ' + esc(r.c.x.from.species) : ''}</span><div class="small">${r.why.join(' · ') || 'a solid all-round partner'}</div></div></div>`).join('')
      : '<p class="small">Your picks already cover these fights well: no one adds much.</p>');
  return `<div class="card"><div class="row between"><h3>Team helper</h3>${core.length ? '<button class="mini" id="thClear">clear</button>' : ''}</div>
    <p class="small muted">Tap up to 3 Pokémon you want to use, then find the best partners for them${nuz() ? ' (your Pokémon, and what you can still catch on unused routes)' : ' (your Pokémon, and what you can catch by now)'}.</p>${strip}
    ${core.length ? `<p><button class="back" id="thGo"${thBusy ? ' disabled' : ''}>Find partners</button></p>` : ''}${res}</div>`;
}
function teamHTML() {
  const card = m => `<div class="card todex" data-todex="${esc(m.species)}" title="Open ${esc(m.species)} in the Dex"><div class="row">${spr(m.species, 40)}<div style="flex:1;min-width:0"><div class="row between"><b>${esc(m.nick || m.species)}</b><span class="num">Lv ${m.level}</span></div>
    <div class="small muted">${esc(m.species)} · ${abil(m.ability)} · ${esc(m.nature)}${m.item ? ' · ' + esc(m.item) : ''}</div>${m.maxHP ? hpBar(m.hp / m.maxHP * 100) : ''}
    <div class="small">${m.moves.map(moveChip).join(' ')}</div></div></div></div>`;
  return teamHelperHTML() + `<h3>Party</h3>${PARTY.map(card).join('') || '<p class="muted">No party read yet.</p>'}
    <h3>PC boxes 1–19 <span class="muted">(${PC.length})</span></h3>
    <div class="strip">${PC.map(m => `<button data-todex="${esc(m.species)}" title="${esc((m.nick || m.species) + ' Lv' + m.level)}">${spr(m.species, 32)}<small>Lv${m.level}</small></button>`).join('') || '<p class="muted">Reading the PC…</p>'}</div>
    <h3>${nuz() ? 'Graveyard' : 'PC boxes'} <span class="muted">(boxes 20–25 · ${DEAD.length})</span></h3>
    <div class="strip${nuz() ? ' dead' : ''}">${DEAD.map(m => `<button data-todex="${esc(m.species)}" title="${esc((m.nick || m.species) + ' Lv' + m.level + ' · box ' + m.box)}">${spr(m.species, 32)}<small>${esc(m.nick || m.species)}</small></button>`).join('') || `<p class="muted">${nuz() ? 'Nobody yet.' : 'Empty.'}</p>`}</div>`;
}
/* ---------- cloud saves (PC overlay; the phone app has its own copy of this in its menu) ----------
   main.js keeps the PC save and the cloud save in step every 30 s. When the phone has saved something newer, a banner
   asks whether to play it here; when both changed, you pick which one to keep. */
let CLOUD = null, cloudMsg = '', cloudBusy = false;
const cloudSaveTxt = m => (m ? `${esc(m.trainer || '?')} · ${m.badges} badge${m.badges === 1 ? '' : 's'} · ${m.playTime ? m.playTime.h + ':' + String(m.playTime.m).padStart(2, '0') : '?'} played${m.party && m.party.length ? ' · ' + m.party.map(esc).join(', ') : ''}` : '');
const agoTxt = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString(); };
function cloudBannerHTML() {
  const p = CLOUD && CLOUD.pending; if (!p) return '';
  const c = p.cloud, from = c.device === 'PC' ? 'another PC' : 'your phone';
  if (p.kind === 'conflict' || p.kind === 'first') return `<div class="cloudbar"><b>☁ ${p.kind === 'first' ? 'The cloud already has a save. Which one do you want to play?' : 'Your PC save and the cloud save both changed.'}</b>
    <div class="small">Cloud (from ${from}, ${esc(agoTxt(c.uploadedAt))}): ${cloudSaveTxt(c)}<br>This PC: ${cloudSaveTxt(p.local)}</div>
    <button class="back" data-cl="load"${cloudBusy ? ' disabled' : ''}>Play the cloud save</button> <button class="back" data-cl="keep"${cloudBusy ? ' disabled' : ''}>Keep this PC's save</button></div>`;
  return `<div class="cloudbar"><b>☁ Newer save from ${from}</b> <span class="small muted">${esc(agoTxt(c.uploadedAt))}</span>
    <div class="small">${cloudSaveTxt(c)}</div>
    <button class="back" data-cl="load"${cloudBusy ? ' disabled' : ''}>Play it on PC</button> <button class="back" data-cl="dismiss">Not now</button></div>`;
}
function cloudCardHTML() {
  if (!window.rr.cloud) return '';
  const on = CLOUD && CLOUD.code;
  return `<div class="card"><h3>Cloud saves</h3>
    ${on ? `<p class="small">Sync code: <b class="num">${esc(CLOUD.code)}</b> <button class="mini" id="clCopy">copy</button></p>
      <p class="small muted">${CLOUD.error === 'not set up' ? '<span class="warntxt">Cloud saves are not on your Netlify site yet: double-click <b>Deploy to Netlify.cmd</b> in the RR Nuzlocke Web folder once.</span>' : CLOUD.error ? '<span class="warntxt">Can\'t reach the cloud right now (' + esc(CLOUD.error) + '); it keeps trying.</span>' : CLOUD.checked ? 'Checked ' + esc(agoTxt(CLOUD.checked)) + (CLOUD.lastUp ? ' · last upload ' + esc(agoTxt(CLOUD.lastUp)) : '') : 'Connecting…'}</p>
      ${CLOUD.unreadable ? '<p class="small warntxt">The PC save could not be read, so it is not being sent. Save in the game again.</p>' : ''}
      <p class="small">On your phone: ☰ → <b>Cloud saves</b> → enter this code. From then on, whenever you save in the game on one, the other offers the newer save.</p>
      <p><button class="back" id="clCheck">Check now</button> <button class="back" id="clOff">Turn off</button></p>`
    : `<p class="small muted">Play one run on PC and phone: every save you make in the game goes to your own Netlify site, and the other device asks if you want to continue from it.</p>
      <p><button class="back" id="clNew">Turn on (new code)</button></p>
      <p class="small">Already have a code from your phone? <input id="clCode" placeholder="ABCD-EFGH-JKLM-NPQR" style="width:170px"> <button class="back" id="clUse">Use it</button></p>`}
    ${cloudMsg ? `<p class="small">${cloudMsg}</p>` : ''}</div>`;
}
function bindCloud(el) {
  if (!window.rr.cloud) return;
  const act = async (fn, after) => { cloudBusy = true; renderCloud(); const r = await fn().catch(e => ({ error: String(e) })); cloudBusy = false; if (after) after(r); renderCloud(); renderPanel(true); };
  $$('[data-cl]', document).forEach(b => b.onclick = () => {
    const k = b.dataset.cl;
    if (k === 'dismiss') return act(() => window.rr.cloud.dismiss(), r => { CLOUD = r; });
    if (k === 'keep') { if (!confirm("Keep this PC's save? It replaces the cloud save (the cloud keeps the last 10, so the phone's save can still be found).")) return; return act(() => window.rr.cloud.keep(), r => { CLOUD = r; }); }
    if (k === 'load') {
      const c = CLOUD.pending.cloud;
      if (!confirm(`Play the cloud save on PC?\n\n${c.trainer} · ${c.badges} badges · ${c.playTime ? c.playTime.h + ':' + String(c.playTime.m).padStart(2, '0') : '?'} played\n\nSave in the game first if mGBA has progress you want to keep: your PC save is backed up, then mGBA restarts with the cloud save.`)) return;
      return act(() => window.rr.cloud.load(), r => { cloudMsg = r.ok ? 'Done: mGBA is reopening with the cloud save. Load the overlay script in mGBA again (Tools → Scripting).' : '<b class="badtxt">' + esc(r.msg || 'That did not work.') + '</b>'; });
    }
  });
  if (!el) return;
  if ($('#clNew', el)) $('#clNew', el).onclick = () => act(() => window.rr.cloud.setCode('new'), r => { if (r.error) cloudMsg = esc(r.error); else { CLOUD = r; cloudMsg = 'Cloud saves are on. Enter the code on your phone.'; } });
  if ($('#clUse', el)) $('#clUse', el).onclick = () => act(() => window.rr.cloud.setCode($('#clCode', el).value), r => { if (r.error) cloudMsg = '<b class="badtxt">' + esc(r.error) + '</b>'; else { CLOUD = r; cloudMsg = 'Linked to that code.'; } });
  if ($('#clOff', el)) $('#clOff', el).onclick = () => { if (confirm('Turn cloud saves off on this PC? (Nothing is deleted.)')) act(() => window.rr.cloud.setCode('off'), r => { CLOUD = null; cloudMsg = 'Cloud saves are off on this PC.'; }); };
  if ($('#clCheck', el)) $('#clCheck', el).onclick = () => act(() => window.rr.cloud.check(), r => { CLOUD = r; });
  if ($('#clCopy', el)) $('#clCopy', el).onclick = () => { window.rr.copy(CLOUD.code); cloudMsg = 'Code copied.'; renderPanel(true); };
}
// the banner sits above every tab (and shows in the slim bar too), so a newer save is never missed
function renderCloud() {
  const el = $('#cloudBar'); if (!el) return;
  const h = cloudBannerHTML();
  el.innerHTML = h; el.hidden = !h;
  bindCloud(null);
}
if (window.rr.cloud) {
  window.rr.cloud.state().then(s => { CLOUD = s; renderCloud(); }).catch(() => {});
  window.rr.on('cloud', s => { CLOUD = s; renderCloud(); if (tab === 'opts') renderPanel(true); });
}
/* Unbound's difficulty: which boss teams to show (the game picks them by the difficulty you started with). Changing it
   reloads the page, since the teams are loaded with it (ub-select.js). */
function diffCardHTML() {
  if (!window.RR_PACKS || Object.keys(window.RR_PACKS).length < 2) return '';
  const cur = window.RR_DIFF, names = { difficult: 'Difficult', expert: 'Expert', insane: 'Insane', normal: 'Normal', hard: 'Hard' };
  const GAME_NAME = { unbound: 'Unbound', soulgold: 'SoulGold', imperium: 'Emerald Imperium', swsh: 'Sword and Shield', bb2r: 'Blaze Black 2 Redux', b2: 'Black 2', pt: 'Platinum', rp: 'Renegade Platinum', hgss: 'HeartGold and SoulSilver' }[window.RR_GAME] || 'the game';
  return `<div class="card"><h3>Difficulty</h3><div class="seg">${Object.keys(names).filter(d => window.RR_PACKS[d]).map(d => `<button data-diff="${d}" class="${d === cur ? 'on' : ''}">${names[d]}</button>`).join('')}</div>
    <p class="small muted">The one you picked when you started ${GAME_NAME}: boss teams differ for each.${window.RR_GAME === 'unbound' ? " (Vanilla isn't covered.)" : ''}</p></div>`;
}
function bindDiff(el) {
  $$('[data-diff]', el).forEach(b => b.onclick = () => { try { localStorage.setItem('rro-diff-' + window.RR_GAME, b.dataset.diff); } catch (e) { /* ignore */ } location.reload(); });
}
function optsHTML() {
  return diffCardHTML() + `<div class="card"><h3>Mode</h3><div class="seg"><button data-mode="nuzlocke" class="${nuz() ? 'on' : ''}">Nuzlocke</button><button data-mode="play" class="${nuz() ? '' : 'on'}">Playthrough</button></div>
    <p class="small muted">${nuz() ? 'Tracks your encounters: routes used, encounters left, dupes, and boxes 20–25 as the graveyard.' : 'A normal playthrough: everything else stays, without routes used, dead Pokémon or a graveyard (boxes 20–25 count as normal boxes).'}</p></div>` + cloudCardHTML() + (window.RRTheme ? `<div class="card"><h3>Theme</h3><div id="thmBox">${window.RRTheme.pickerHTML()}</div><p class="small muted">${window.rr.embedded ? 'Shared with the app around it.' : 'Colours for the overlay.'}</p></div>` : '') + `<div class="card"><h2>Overlay settings</h2>
    <label class="pconly">Transparency<input type="range" id="oOpacity" min="0.35" max="1" step="0.05"></label>
    <label class="chk"><input type="checkbox" id="oAuto"${PREF.autoBattle ? ' checked' : ''}> Jump to the Battle tab when a battle starts</label>
    <label class="chk"><input type="checkbox" id="oAI"${PREF.ai ? ' checked' : ''}> Show the AI prediction in battles</label></div>
    <div class="card pconly"><h3>Hotkeys</h3><p><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> open the panel and click in (the game pauses)</p><p><kbd>Esc</kbd> back to the game</p><p><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> hide or show the overlay</p></div>
    <div class="card pconly"><h3>Pausing</h3><p class="small">The game pauses while you click in here because mGBA's <b>Settings → Interface → Pause when inactive</b> is on. Turn that off in mGBA if you'd rather it keep running.</p></div>
    <div class="card pconly"><button id="oQuit" style="border:1px solid var(--line);background:none;border-radius:7px;padding:5px 10px">Close the overlay</button></div>`;
}
function bindPanel(el) {
  $$('[data-time]', el).forEach(b => b.onclick = () => { timeSel = b.dataset.time; renderPanel(true); });
  bindDiff(el);
  $$('[data-mode]', el).forEach(b => b.onclick = () => { PREF.mode = b.dataset.mode; savePrefs(); tellMode(); capCache.key = ''; thRes = null; lastBarKey = ''; renderBar(); renderPanel(true); });
  $$('[data-core]', el).forEach(b => b.onclick = () => { const pid = +b.dataset.core, c = (PREF.core || []).filter(x => alive().some(m => m.pid === x)); PREF.core = c.includes(pid) ? c.filter(x => x !== pid) : c.length < 3 ? c.concat(pid) : c; savePrefs(); thRes = null; renderPanel(true); });
  if ($('#thGo', el)) $('#thGo', el).onclick = () => { thBusy = true; renderPanel(true); setTimeout(() => { try { thRes = teamHelper(); } catch (e) { console.error(e); thRes = { err: String(e) }; } thBusy = false; renderPanel(true); }, 30); };
  if ($('#thClear', el)) $('#thClear', el).onclick = () => { PREF.core = []; savePrefs(); thRes = null; renderPanel(true); };
  $$('[data-sw]', el).forEach(b => b.onclick = () => { swView = +b.dataset.sw; if (b.dataset.enemy) viewEnemy = +b.dataset.enemy; renderPanel(true); });
  if (tab === 'dex') bindDex(el);
  if ($('#pCopy', el)) $('#pCopy', el).onclick = e => copyScriptLine(e.currentTarget);
  if ($('#lShow', el)) $('#lShow', el).onclick = () => { const nx = nextOrder(); if (nx) linesShown.add(pickB(nx)); renderPanel(true); };
  if ($('#lSteer', el)) $('#lSteer', el).onclick = () => { steerOn = true; renderPanel(true); };
  if ($('#lSteerOff', el)) $('#lSteerOff', el).onclick = () => { steerOn = false; renderPanel(true); };
  $$('details[data-swm]', el).forEach(d => d.addEventListener('toggle', () => { if (d.open) swOpen.add(d.dataset.swm); else swOpen.delete(d.dataset.swm); }));
  $$('[data-fail]', el).forEach(b => b.onclick = () => { const n = b.dataset.fail, f = new Set(PREF.failed || []); if (f.has(n)) f.delete(n); else f.add(n); PREF.failed = [...f]; savePrefs(); lastBarKey = ''; renderBar(); renderPanel(true); });
  if ($('#floorAll', el)) $('#floorAll', el).onclick = () => { allFloors = true; renderPanel(true); };
  if ($('#floorOnly', el)) $('#floorOnly', el).onclick = () => { allFloors = false; renderPanel(true); };
  if ($('#encToggle', el)) $('#encToggle', el).onclick = () => { encOpen = !encOpen; renderPanel(true); };
  $$('[data-star]', el).forEach(b => b.onclick = () => { const pid = +b.dataset.star, s = new Set(PREF.stars || []); s.has(pid) ? s.delete(pid) : s.add(pid); PREF.stars = [...s]; savePrefs(); renderPanel(true); });
  if ($('#lIdeas', el)) $('#lIdeas', el).onclick = () => { const nx = nextOrder(); if (nx) ideasWant.add(pickB(nx)); renderPanel(true); };
  const iq = $('#itQ', el);
  if (iq) { iq.oninput = () => { itemQ = iq.value; $('#itList', el).innerHTML = itemRows(); }; if (itemQ) { iq.focus(); iq.setSelectionRange(itemQ.length, itemQ.length); } }
  $$('[data-ikind]', el).forEach(b => b.onclick = () => { itemKind = b.dataset.ikind; renderPanel(true); });
  if ($('#nCap', el)) $('#nCap', el).onchange = e => { nextAtCap = e.target.checked; renderPanel(true); };
  if ($('#nIntim', el)) $('#nIntim', el).onchange = e => { PREF.intim = e.target.checked; savePrefs(); renderPanel(true); };
  $$('[data-nmon]', el).forEach(b => b.onclick = () => { const k = +b.dataset.nmon; nextMon = nextMon === k ? null : k; renderPanel(true); });
  $$('[data-nview]', el).forEach(b => b.onclick = () => { nextView = b.dataset.nview; renderPanel(true); });
  $$('[data-bview]', el).forEach(b => b.onclick = () => { battleView = b.dataset.bview; renderPanel(true); $('#panel').scrollTop = 0; });
  $$('[data-bmon]', el).forEach(b => b.onclick = () => { const k = +b.dataset.bmon; bossMonSel = bossMonSel === k ? null : k; renderPanel(true); });
  $$('[data-bsel]', el).forEach(b => b.onclick = () => { bossSel = +b.dataset.bsel; bossMonSel = null; renderPanel(true); $('#panel').scrollTop = 0; });
  if ($('#bossSel', el)) $('#bossSel', el).onchange = e => { bossSel = +e.target.value; bossMonSel = null; renderPanel(true); };
  if ($('#bossCap', el)) $('#bossCap', el).onchange = e => { bossAtCap = e.target.checked; renderPanel(true); };
  if ($('#bossLine', el)) $('#bossLine', el).onclick = () => { const o = D.order.find(x => x.n === bossSel) || nextOrder(); if (o) bossLineShown.add(pickB(o)); renderPanel(true); };
  if ($('#bossLineOff', el)) $('#bossLineOff', el).onclick = () => { bossLineShown.clear(); renderPanel(true); };
  if ($('#bossTC', el)) $('#bossTC', el).onclick = () => { const o = D.order.find(x => x.n === bossSel) || nextOrder(); if (!o) return; tcFight = o.n; tcOpen = null; nextView = 'tc'; tab = 'next'; renderPanel(true); $('#panel').scrollTop = 0; };
  $$('[data-tcm]', el).forEach(b => b.onclick = () => { tcMine = +b.dataset.tcm; tcOpen = null; renderPanel(true); });
  if ($('#tcFight', el)) $('#tcFight', el).onchange = e => { tcFight = +e.target.value; tcOpen = null; renderPanel(true); };
  if ($('#tcHp', el)) $('#tcHp', el).onchange = e => { tcHp = e.target.checked; renderPanel(true); };
  $$('[data-tco]', el).forEach(d => d.ontoggle = () => { if (d.open) tcOpen = d.dataset.tco; else if (tcOpen === d.dataset.tco) tcOpen = null; });
  // theory craft: the set editor
  $$('[data-tcf]', el).forEach(inp => inp.onchange = () => {
    const pool = alive().filter(m => m.level && m.species), cur = pool.find(m => m.pid === tcMine) || pool[0]; if (!cur) return;
    const o = tcOpts(cur), sets = PREF.tcSets = PREF.tcSets || {};
    const s0 = sets[cur.pid] || { species: o.species, level: o.level, nature: o.nature, ability: o.ability, item: o.item || '', moves: (o.moves || []).slice(), hp: Math.round(o.hp) };
    const k = inp.dataset.tcf, v = inp.value.trim();
    if (/^move\d$/.test(k)) { const mv = (s0.moves || []).concat(['', '', '', '']).slice(0, 4); mv[+k.slice(4)] = MOVES[v] ? v : ''; s0.moves = mv; }
    else if (k === 'species') { if (SPEC[v]) { s0.species = v; s0.ability = Object.values(SPEC[v].abilities || {})[0] || s0.ability; } }
    else if (k === 'level' || k === 'hp') s0[k] = Math.max(1, Math.min(100, +v || 1));
    else s0[k] = v;
    sets[cur.pid] = s0; savePrefs(); renderPanel(true);
  });
  if ($('#tcReset', el)) $('#tcReset', el).onclick = () => { const pool = alive(), cur = pool.find(m => m.pid === tcMine) || pool[0]; if (cur && PREF.tcSets) { delete PREF.tcSets[cur.pid]; savePrefs(); } renderPanel(true); };
  // theory craft: the battle sandbox
  $$('[data-tct]', el).forEach(b => b.onclick = () => { const pid = +b.dataset.tct, have = new Set(alive().map(m => m.pid)), t = (tcTeam || []).filter(x => have.has(x)); tcTeam = t.includes(pid) ? t.filter(x => x !== pid) : t.length < 6 ? t.concat(pid) : t; renderPanel(true); });
  if ($('#tcClear', el)) $('#tcClear', el).onclick = () => { tcTeam = []; tcClearing = true; renderPanel(true); };
  if ($('#tcLead', el)) $('#tcLead', el).onchange = e => { tcLead = +e.target.value; };
  if ($('#tcLead2', el)) $('#tcLead2', el).onchange = e => { tcLead2 = +e.target.value; };
  if ($('#tcStart', el)) $('#tcStart', el).onclick = () => { if ($('#tcLead', el)) tcLead = +$('#tcLead', el).value; if ($('#tcLead2', el)) tcLead2 = +$('#tcLead2', el).value; tcStartBattle(); renderPanel(true); };
  $$('[data-tcp]', el).forEach(b => b.onclick = () => { tcPartner = +b.dataset.tcp; renderPanel(true); });
  if ($('#tcSwap', el)) $('#tcSwap', el).onclick = () => { const p = $('[data-tcp].on', el); if (!p) return; const was = tcMine; tcMine = +p.dataset.tcp; tcPartner = was != null ? was : null; if (tcPartner == null) { const c = $('[data-tcm].on', el); if (c) tcPartner = +c.dataset.tcm; } renderPanel(true); };
  const dblGo = () => {
    const op = RRLines.sbOptions(tcSB.S);
    if (op.mons && op.mons.every(m => tcPick[m.i])) { RRLines.sbStep(tcSB.S, { acts: op.mons.map(m => (tcPick[m.i].switch != null ? { i: m.i, switch: tcPick[m.i].switch } : { i: m.i, move: tcPick[m.i].move, target: tcPick[m.i].target })) }); tcPick = {}; }
    renderPanel(true);
  };
  $$('[data-sbd]', el).forEach(b => b.onclick = () => {
    if (!tcSB) return;
    const [i, move, t] = b.dataset.sbd.split('|'), op = RRLines.sbOptions(tcSB.S), mv = op.mons && op.mons.find(m => m.i === +i);
    tcPick[+i] = { move, target: +t, spread: !!(mv && (mv.moves.find(x => x.name === move) || {}).spread) };
    dblGo();
  });
  $$('[data-sbx]', el).forEach(b => b.onclick = () => { if (!tcSB) return; const [i, k] = b.dataset.sbx.split('|').map(Number); tcPick[i] = { switch: k }; dblGo(); });
  if ($('#tcStop', el)) $('#tcStop', el).onclick = () => { tcSB = null; tcPeek = null; renderPanel(true); };
  if ($('#tcUndo', el)) $('#tcUndo', el).onclick = () => { if (tcSB) RRLines.sbUndo(tcSB.S); tcPick = {}; renderPanel(true); };
  $$('[data-sbm]', el).forEach(b => b.onclick = () => { if (tcSB) RRLines.sbStep(tcSB.S, { move: b.dataset.sbm }); renderPanel(true); });
  $$('[data-sbs]', el).forEach(b => b.onclick = () => { if (tcSB) RRLines.sbStep(tcSB.S, { switch: +b.dataset.sbs }); renderPanel(true); });
  $$('[data-sbr]', el).forEach(b => b.onclick = () => { if (tcSB) RRLines.sbReplace(tcSB.S, +b.dataset.sbr); renderPanel(true); });
  const sbl = $('.sblog', el); if (sbl) sbl.scrollTop = sbl.scrollHeight;
  if ($('#tcOdds', el)) $('#tcOdds', el).ontoggle = e => { tcOddsOpen = e.target.open; };
  $$('[data-peek]', el).forEach(b => b.onclick = () => { const k = +b.dataset.peek; tcPeek = tcPeek === k ? null : k; renderPanel(true); });
  const op = $('#oOpacity', el); if (op) { window.rr.settings().then(s => { op.value = s.opacity; }); op.oninput = () => window.rr.opacity(+op.value); }
  if ($('#oAuto', el)) $('#oAuto', el).onchange = e => { PREF.autoBattle = e.target.checked; savePrefs(); };
  if ($('#oAI', el)) $('#oAI', el).onchange = e => { PREF.ai = e.target.checked; savePrefs(); };
  if ($('#oQuit', el)) $('#oQuit', el).onclick = () => window.rr.quit();
  bindCloud(el);
  if ($('#thmBox', el) && window.RRTheme) window.RRTheme.bind($('#thmBox', el), () => renderPanel(true));
}

/* ---------- wiring ---------- */
function setMode(m, tellMain) {
  mode = m; document.body.className = m + (focused ? ' focused' : '');
  if (tellMain) window.rr.mode(m);
  lastPanelKey = ''; renderPanel(true);
}
let wasBattle = false;
/* Never freeze on a bad frame: if drawing fails, keep the last good screen, show the error in one line and try again with
   the next update. lastState tells the bar how fresh the game data is (orange after 6 s without an update). */
let lastState = 0, drawErr = '';
function safeDraw() {
  try { renderBar(); renderPanel(); drawErr = ''; }
  catch (e) { drawErr = String(e && e.message || e); lastPanelKey = ''; console.error(e); }
  const el = $('#drawErr');
  if (el) { el.hidden = !drawErr; el.textContent = drawErr ? 'Overlay error (it keeps trying): ' + drawErr : ''; }
}
setInterval(() => {
  const dot = $('#dot'); if (!dot || !CONN) return;
  const age = Date.now() - lastState, stale = lastState && age > 6000;
  dot.classList.toggle('stale', !!stale);
  dot.title = stale ? 'No game update for ' + Math.round(age / 1000) + ' s' : 'Connected';
}, 1000);
window.rr.on('state', s => {
  lastState = Date.now();
  if (s.dec) {
    // DS games send their zone; the pack knows each zone's place
    if (s.zone != null && window.RR_SAVE && window.RR_SAVE.zones) s.mapsec = window.RR_SAVE.zones[s.zone] || 0;
    // the render cache watches these strings: give it the decoded data to compare
    s.party = JSON.stringify(s.partyDec || []); s.enemy = JSON.stringify(s.enemyDec || []); s.battleMons = JSON.stringify(s.battlersDec || []);
  }
  ST = s; CONN = true; PARTY = s.dec ? decList(s.partyDec) : decodeParty(s.party, s.partyCount);
  const inB = !!s.inBattle;
  if (!inB && wasBattle) steerOn = false;
  if (inB && !wasBattle) { viewEnemy = null; swView = null; if (PREF.autoBattle) tab = 'battle'; }
  if (!inB && wasBattle && tab === 'battle') tab = 'route';
  wasBattle = inB;
  safeDraw();
});
window.rr.on('pc', (hex, x) => { PC = decodePC(hex); DEAD = decodeDead(x); lastPanelKey = ''; renderPanel(); });
window.rr.on('conn', v => { CONN = v; if (!v) { ST = null; PARTY = []; } lastBarKey = ''; renderBar(); renderPanel(true); });
window.rr.on('focus', v => { focused = v; document.body.classList.toggle('focused', v); });
window.rr.on('mode', m => setMode(m, false));
if (window.rr.on) window.rr.on('clock', () => { if (tab === 'route') renderPanel(true); });
$('#bExpand').onclick = () => setMode(mode === 'panel' ? 'bar' : 'panel', true);
$('#bHide').onclick = () => window.rr.hide();
if ($('#bCopy')) $('#bCopy').onclick = e => copyScriptLine(e.currentTarget);
$('#bBack').onclick = () => window.rr.backToGame();
$$('#tabs button').forEach(b => b.onclick = () => { if (b.dataset.tab === 'dex' && tab === 'dex') dexSel = null; tab = b.dataset.tab; renderPanel(true); });
// tap / click an ability name: a small note with what it does (hovering shows the same as a tooltip)
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('.abil'), old = document.getElementById('abilTip');
  if (old) old.remove();
  if (!a) return;
  e.stopPropagation(); e.preventDefault();
  const d = abilDesc(a.dataset.abil), tip = document.createElement('div');
  tip.id = 'abilTip'; tip.innerHTML = `<b>${esc(a.dataset.abil)}</b><br>${esc(d || 'Loading the description… tap again in a moment.')}`;
  document.body.appendChild(tip);
  const r = a.getBoundingClientRect(), w = Math.min(260, window.innerWidth - 16);
  tip.style.width = w + 'px'; tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
  const below = r.bottom + 6, h = tip.offsetHeight;
  tip.style.top = (below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below) + 'px';
}, true);
document.addEventListener('scroll', () => { const t = document.getElementById('abilTip'); if (t) t.remove(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.rr.backToGame(); });
window.addEventListener('load', () => { lastBarKey = ''; renderBar(); renderPanel(true); });
window.rr.settings().then(s => setMode(s.mode || 'bar', false));
renderBar();
tellMode();
if (!RR) $$('#tabs [data-tab="dex"], #tabs [data-tab="items"]').forEach(b => { b.style.display = 'none'; });
})();
