/* Radical Red Nuzlocke Kit - reads a Radical Red .sav file (FireRed save layout with the Complete FireRed Upgrade engine).
   Party: SaveBlock1 + 0x34 count, + 0x38 six 100-byte Pokémon (CFRU stores them unencrypted).
   Boxes 1-19: PC storage sectors 5-13, 4-byte header then 58-byte "compressed" Pokémon.
   Boxes 20-25 (CFRU pokemon_storage_system.c): 20-22 in flash sectors 30-31 at +0xB0C, 23-24 in SaveBlock1 + 0x1F08,
   25 in SaveBlock2 + 0x10C. Radical Red seems to use that box 25 spot for other data, so box 25 only counts if every slot reads cleanly.
   Badges: SaveBlock1 flags 0x820-0x827. Game mode flags: sector 4 + 0xDB2 (as read by dex.radicalred.net). */
(function (root) {
'use strict';
const CHARS = [ " ", "À", "Á", "Â", "Ç", "È", "É", "Ê", "Ë", "Ì", "", "Î", "Ï", "Ò", "Ó", "Ô", "Œ", "Ù", "Ú", "Û", "Ñ", "ß", "à", "á", "", "ç", "è", "é", "ê", "ë", "ì", "", "î", "ï", "ò", "ó", "ô", "œ", "ù", "ú", "û", "ñ", "º", "ª", "ᵉʳ", "&", "+", "", "", "", "", "", "Lv", "=", ";", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "▯", "¿", "¡", "PK", "MN", "PO", "Ké", "", "", "", "Í", "%", "(", ")", " ", " ", " ", " ", " ", " ", " ", "", "", "", "â", "", "", "", "", "", "", "í", "", "", "", "", "", "", "", "", "", "↑", "↓", "←", "→", "*", "*", "*", "*", "*", "*", "*", "ᵉ", "<", ">", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "ʳᵉ", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "!", "?", ".", "-", "･", "…", "“", "”", "‘", "’", "♂", "♀", "$", ",", "×", "/", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "►", ":", "Ä", "Ö", "Ü", "ä", "ö", "ü", "", "", "", "", "", "", "", "", "" ];
const SECTOR = 0x1000, DATA = 0xFF0, SIG = 0x08012025;
const STARTER_BASES = ['Bulbasaur', 'Charmander', 'Squirtle', 'Chikorita', 'Cyndaquil', 'Totodile', 'Treecko', 'Torchic', 'Mudkip', 'Turtwig', 'Chimchar', 'Piplup', 'Snivy', 'Tepig', 'Oshawott', 'Chespin', 'Fennekin', 'Froakie', 'Rowlet', 'Litten', 'Popplio', 'Grookey', 'Scorbunny', 'Sobble', 'Sprigatito', 'Fuecoco', 'Quaxly'];
const MAP_ALIAS = { 'POKéMON TOWER': 'Pokémon Tower', 'POKéMON MANSION': 'Pokémon Mansion', "DIGLETT'S CAVE": "Diglett's Cave", 'S.S. ANNE': 'S.S. Anne', 'MT. MOON': 'Mt. Moon', 'MT. EMBER': 'Mt. Ember', 'SEAFOAM ISLANDS': 'Seafoam Islands', 'SAFARI ZONE': 'Safari Zone', 'VERMILION CITY': 'Vermilion City', 'THREE ISLE PORT': 'Three Island', 'THREE ISLAND': 'Three Island' };

function text(bytes) { let s = ''; for (const b of bytes) { if (b === 0xFF) break; s += CHARS[b] || ''; } return s.trim(); }
function tcase(s) { return s.toLowerCase().replace(/(^|[\s.\-'])([a-z])/g, (m, a, b) => a + b.toUpperCase()); }

function sectors(v) {
  const n = Math.min(32, Math.floor(v.byteLength / SECTOR));
  const best = {};
  for (let i = 0; i < n; i++) {
    const x = i * SECTOR;
    const id = v.getUint16(x + 0xFF4, true), sig = v.getUint32(x + 0xFF8, true), idx = v.getUint32(x + 0xFFC, true);
    if (id > 13) continue;
    const ok = sig === SIG;
    const cur = best[id];
    if (!cur || (ok && !cur.ok) || (ok === cur.ok && idx >= cur.idx)) best[id] = { x, idx, ok };
  }
  return best;
}
function block(v, sec, ids, sizes) {
  const total = sizes.reduce((a, b) => a + b, 0);
  const out = new Uint8Array(total); let o = 0;
  ids.forEach((id, k) => { const s = sec[id]; if (s) out.set(new Uint8Array(v.buffer, v.byteOffset + s.x, sizes[k]), o); o += sizes[k]; });
  return new DataView(out.buffer);
}
function u8s(dv, off, len) { return new Uint8Array(dv.buffer, dv.byteOffset + off, len); }

function nameOf(T, id) { return T.species[id] || ''; }
function abilityOf(T, speciesId, pid, hidden) {
  const ab = T.specAb[speciesId] || [];
  let a = hidden && ab[2] ? ab[2] : ab[pid & 1] || ab[0];
  if (!a) a = ab[0];
  return T.abilities[a] || '';
}
// Hidden Power's type from the IVs (Gen 3+ formula), so the move reads e.g. "Hidden Power Ice".
const HP_TYPES = ['Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark'];
function hpType(iv) {
  const bits = [iv.hp, iv.atk, iv.def, iv.spe, iv.spa, iv.spd].reduce((a, v, k) => a + ((v & 1) << k), 0);
  return HP_TYPES[Math.floor(bits * 15 / 63)];
}
const typedMoves = (moves, iv) => moves.map(n => (n === 'Hidden Power' ? 'Hidden Power ' + hpType(iv) : n));
function ivsOf(w) { return { hp: w & 31, atk: (w >>> 5) & 31, def: (w >>> 10) & 31, spe: (w >>> 15) & 31, spa: (w >>> 20) & 31, spd: (w >>> 25) & 31, egg: (w >>> 30) & 1, hidden: (w >>> 31) & 1 }; }
// Experience needed for level n in each Gen 3 growth group (1 slow, 2 medium fast, 3 fast, 4 medium slow, 5 erratic, 6 fluctuating)
function expAt(n, g) {
  const c = n * n * n;
  switch (g) {
    case 1: return Math.floor(5 * c / 4);
    case 3: return Math.floor(4 * c / 5);
    case 4: return Math.floor(6 * c / 5) - 15 * n * n + 100 * n - 140;
    case 5: return n <= 50 ? Math.floor(c * (100 - n) / 50) : n <= 68 ? Math.floor(c * (150 - n) / 100) : n <= 98 ? Math.floor(c * Math.floor((1911 - 10 * n) / 3) / 500) : Math.floor(c * (160 - n) / 100);
    case 6: return n <= 15 ? Math.floor(c * (Math.floor((n + 1) / 3) + 24) / 50) : n <= 36 ? Math.floor(c * (n + 14) / 50) : Math.floor(c * (Math.floor(n / 2) + 32) / 50);
    default: return c;
  }
}
function levelFromExp(exp, g) { let l = 1; while (l < 100 && expAt(l + 1, g) <= exp) l++; return l; }

// 100-byte party Pokémon (unencrypted in CFRU)
function readParty(dv, off, T) {
  const pid = dv.getUint32(off, true);
  const species = dv.getUint16(off + 0x20, true);
  if (!species || !T.species[species]) return null;
  const level = dv.getUint8(off + 0x54);
  if (level < 1 || level > 100) return null;
  const iv = ivsOf(dv.getUint32(off + 0x48, true));
  if (iv.egg) return null;
  const moves = [0, 1, 2, 3].map(i => dv.getUint16(off + 0x2C + i * 2, true)).filter(Boolean).map(id => T.moves[id] || '');
  return {
    pid, speciesId: species, species: nameOf(T, species), baseName: nameOf(T, T.anc[species] || species), nick: text(u8s(dv, off + 8, 10)),
    item: T.items[dv.getUint16(off + 0x22, true)] || '', level,
    nature: T.natures[pid % 25] || 'Hardy', ability: abilityOf(T, species, pid, iv.hidden),
    moves: typedMoves(moves, iv), evs: { hp: dv.getUint8(off + 0x38), atk: dv.getUint8(off + 0x39), def: dv.getUint8(off + 0x3A), spe: dv.getUint8(off + 0x3B), spa: dv.getUint8(off + 0x3C), spd: dv.getUint8(off + 0x3D) },
    ivs: { hp: iv.hp, atk: iv.atk, def: iv.def, spa: iv.spa, spd: iv.spd, spe: iv.spe },
    metLoc: dv.getUint8(off + 0x45), metLevel: dv.getUint16(off + 0x46, true) & 0x7F,
    hp: dv.getUint16(off + 0x56, true), maxHP: dv.getUint16(off + 0x58, true), exactLevel: true
  };
}
// 58-byte compressed box Pokémon
function readBox(dv, off, T) {
  const species = dv.getUint16(off + 0x1C, true);
  if (!species) return null;
  if (!T.species[species]) return { bad: true };
  const pid = dv.getUint32(off, true);
  const lo = dv.getUint32(off + 0x27, true), hi = dv.getUint8(off + 0x2B);
  const big = lo + hi * 4294967296;
  const iv = ivsOf(dv.getUint32(off + 0x36, true));
  const moves = typedMoves([0, 1, 2, 3].map(i => Math.floor(big / Math.pow(2, 10 * i)) % 1024).filter(Boolean).map(id => T.moves[id] || ''), iv);
  if (iv.egg) return null;
  const exp = dv.getUint32(off + 0x20, true);
  return {
    pid, speciesId: species, species: nameOf(T, species), baseName: nameOf(T, T.anc[species] || species), nick: text(u8s(dv, off + 8, 10)),
    item: T.items[dv.getUint16(off + 0x1E, true)] || '', level: levelFromExp(exp, (T.growth || {})[species] || 2), exactLevel: !!(T.growth || {})[species],
    nature: T.natures[pid % 25] || 'Hardy', ability: abilityOf(T, species, pid, iv.hidden), moves,
    evs: { hp: dv.getUint8(off + 0x2C), atk: dv.getUint8(off + 0x2D), def: dv.getUint8(off + 0x2E), spe: dv.getUint8(off + 0x2F), spa: dv.getUint8(off + 0x30), spd: dv.getUint8(off + 0x31) },
    ivs: { hp: iv.hp, atk: iv.atk, def: iv.def, spa: iv.spa, spd: iv.spd, spe: iv.spe },
    metLoc: dv.getUint8(off + 0x33), metLevel: dv.getUint16(off + 0x34, true) & 0x7F
  };
}

// Boxes 20-25. Each source is [box number, DataView, offset, strict]; a strict box is dropped unless all 30 slots read cleanly.
const BOX_BYTES = 30 * 58;
function extraBoxes(srcs, T) {
  const out = [];
  for (const [box, dv, off, strict] of srcs) {
    if (off + BOX_BYTES > dv.byteLength) continue;
    const got = []; let bad = 0;
    for (let s = 0; s < 30; s++) {
      const m = readBox(dv, off + s * 58, T);
      if (!m) continue;
      if (m.bad) { bad++; continue; }
      m.where = 'box'; m.box = box; m.slot = s + 1; got.push(m);
    }
    if (strict && bad) continue;
    got.forEach(m => out.push(m));
  }
  return out;
}

function readSave(buf, T) {
  const v = new DataView(buf);
  if (v.byteLength < 14 * SECTOR) throw new Error('too-small');
  const sec = sectors(v);
  for (let i = 0; i < 14; i++) if (!sec[i]) throw new Error('not-a-save');
  const out = { trainer: '', flags: {}, badges: [], party: [], boxes: [], warnings: [] };
  const s0 = sec[0].x;
  out.trainer = text(u8s(v, s0, 8));
  // SaveBlock2: trainer ID at +0x0A (tells two runs apart), play time at +0x0E; the sector's save counter goes up by
  // one every time you save in the game, so within one run the higher counter is the newer save
  out.trainerId = v.getUint32(s0 + 0x0A, true);
  out.playTime = { h: v.getUint16(s0 + 0x0E, true), m: v.getUint8(s0 + 0x10), s: v.getUint8(s0 + 0x11) };
  out.saveCount = sec[0].idx;
  const s4 = sec[4].x;
  const mode = v.getUint8(s4 + 0xDB2);
  out.flags.hardcore = (mode & 0x10) > 0;
  out.flags.mgm = (mode & 0x04) > 0;
  const sb1 = block(v, sec, [1, 2, 3, 4], [DATA, DATA, DATA, 0xD98]);
  const badgeByte = sb1.getUint8(0xEE0 + (0x820 >> 3));
  for (let b = 0; b < 8; b++) if (badgeByte & (1 << b)) out.badges.push(b);
  const count = sb1.getUint32(0x34, true);
  if (count > 6) out.warnings.push('The party count looks wrong (' + count + '), so the party may be incomplete.');
  for (let i = 0; i < Math.min(6, count || 6); i++) {
    const m = readParty(sb1, 0x38 + i * 100, T);
    if (m) { m.where = 'party'; m.slot = i + 1; out.party.push(m); }
  }
  if (count && out.party.length < Math.min(6, count)) out.warnings.push('Some party Pokémon could not be read.');
  const pc = block(v, sec, [5, 6, 7, 8, 9, 10, 11, 12, 13], [DATA, DATA, DATA, DATA, DATA, DATA, DATA, DATA, 0x450]);
  let bad = 0;
  for (let k = 0; k < 19 * 30; k++) {
    const off = 4 + k * 58;
    if (off + 58 > pc.byteLength) break;
    const m = readBox(pc, off, T);
    if (!m) continue;
    if (m.bad) { bad++; continue; }
    m.where = 'box'; m.box = Math.floor(k / 30) + 1; m.slot = (k % 30) + 1;
    out.boxes.push(m);
  }
  const D2 = DATA * 2;
  const s3031 = new Uint8Array(D2);
  if (v.byteLength >= 32 * SECTOR) { s3031.set(new Uint8Array(v.buffer, v.byteOffset + 30 * SECTOR, DATA), 0); s3031.set(new Uint8Array(v.buffer, v.byteOffset + 31 * SECTOR, DATA), DATA); }
  const ex = new DataView(s3031.buffer), sb2 = block(v, sec, [0], [0xF24]);
  extraBoxes([[20, ex, 0xB0C], [21, ex, 0xB0C + BOX_BYTES], [22, ex, 0xB0C + BOX_BYTES * 2], [23, sb1, 0x1F08], [24, sb1, 0x1F08 + BOX_BYTES], [25, sb2, 0x10C, true]], T)
    .forEach(m => out.boxes.push(m));
  if (bad > 3) out.warnings.push(bad + ' PC slots held data that does not look like a Pokémon. If your boxes look wrong, tell Claude; Radical Red may store them differently in your version.');
  return out;
}

function mapLoc(T, D, m) {
  const raw = T.mapsec[m.metLoc] || '';
  let name = MAP_ALIAS[raw] || tcase(raw);
  // the Oak's Lab starter is met at level 5 (Radical Red files it under an unused map section)
  if (STARTER_BASES.includes(m.baseName || '') && m.metLevel === 5) name = "Oak's Lab";
  const known = D.locs.some(l => l.name === name);
  return { loc: name || 'Unknown', known, raw };
}

root.RRSave = { hpType, typedMoves, readSave, extraBoxes, BOX_BYTES, mapLoc, STARTER_BASES, readParty, readBox, text, abilityOf, ivsOf };
})(typeof window !== 'undefined' ? window : globalThis);
