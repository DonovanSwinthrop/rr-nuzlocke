/* Radical Red Nuzlocke Kit - team builder optimizer.
   Takes one of your Pokémon to the fight's level cap (evolving it if it evolves by level before then and adding the
   level-up moves it will know), then tries natures, abilities (Ability Capsule / Dream Capsule) and held items you can
   get before that fight, and keeps the build that does best against the boss's team.
   The page hands over its helpers with RRBuild.use({ mk, hit, movesOf, speedOf, field, MOVES, SPEC }); data comes from
   window.RR_DEX, window.RR_SAVE and window.RR_ITEMS. */
(function (root) {
'use strict';
let mk, hit, movesOf, speedOf, field, MOVES, SPEC;
function use(d) { ({ mk, hit, movesOf, speedOf, field, MOVES, SPEC } = d); }
const NATURES = ['Adamant', 'Jolly', 'Modest', 'Timid', 'Brave', 'Quiet', 'Impish', 'Bold', 'Careful', 'Calm', 'Naughty', 'Lonely', 'Mild', 'Rash', 'Hasty', 'Naive'];
const BOOSTER = { Normal: 'Silk Scarf', Fire: 'Charcoal', Water: 'Mystic Water', Electric: 'Magnet', Grass: 'Miracle Seed', Ice: 'Never-Melt Ice', Fighting: 'Black Belt', Poison: 'Poison Barb', Ground: 'Soft Sand', Flying: 'Sharp Beak', Psychic: 'Twisted Spoon', Bug: 'Silver Powder', Rock: 'Hard Stone', Ghost: 'Spell Tag', Dragon: 'Dragon Fang', Dark: 'Black Glasses', Steel: 'Metal Coat', Fairy: 'Fairy Feather' };
const BERRY = { Fire: 'Occa Berry', Water: 'Passho Berry', Electric: 'Wacan Berry', Grass: 'Rindo Berry', Ice: 'Yache Berry', Fighting: 'Chople Berry', Poison: 'Kebia Berry', Ground: 'Shuca Berry', Flying: 'Coba Berry', Psychic: 'Payapa Berry', Bug: 'Tanga Berry', Rock: 'Charti Berry', Ghost: 'Kasib Berry', Dragon: 'Haban Berry', Dark: 'Colbur Berry', Steel: 'Babiri Berry', Fairy: 'Roseli Berry', Normal: 'Chilan Berry' };

function dex() { return root.RR_DEX; }
// Evolve by level up to the cap (follows the first level-based branch).
function evolveTo(species, cap) {
  const X = dex(); let s = species; const path = [];
  for (let n = 0; n < 4; n++) {
    const e = X && X.species[s]; if (!e) break;
    const step = e.ev.map(([to, how]) => ({ to, lv: +((how.match(/Level (\d+)/i) || [])[1] || 0) })).find(x => x.lv && x.lv <= cap && SPEC[x.to]);
    if (!step) break;
    path.push(step); s = step.to;
  }
  return { species: s, path };
}
// Level-up moves known by the cap (this species and the ones it evolved from).
function learnable(chain, cap) {
  const X = dex(), out = [];
  chain.forEach(sp => { const e = X && X.species[sp]; if (!e) return; e.lv.forEach(([id, lv]) => { const mv = X.moves[id]; if (mv && lv <= cap && MOVES[mv[0]] && !out.includes(mv[0])) out.push(mv[0]); }); });
  return out;
}
// Moves that lock you in, need a charge turn, recharge, faint the user or only work in odd cases.
const AWKWARD = ['Thrash', 'Outrage', 'Petal Dance', 'Raging Fury', 'Sky Attack', 'Solar Beam', 'Solar Blade', 'Skull Bash', 'Razor Wind', 'Meteor Beam', 'Freeze Shock', 'Ice Burn', 'Hyper Beam', 'Giga Impact', 'Explosion', 'Self-Destruct', 'Misty Explosion', 'Focus Punch', 'Dream Eater', 'Belch', 'Last Resort', 'Synchronoise', 'Fling', 'Natural Gift', 'Steel Beam', 'Mind Blown', 'Future Sight', 'Doom Desire', 'Snore', 'Uproar', 'Spit Up', 'Bide', 'Counter', 'Mirror Coat', 'Metal Burst', 'Endeavor', 'Final Gambit', 'Struggle'];
// Status moves worth keeping over a fourth attack that adds little.
const KEEP = ['Protect', 'Detect', 'Swords Dance', 'Nasty Plot', 'Calm Mind', 'Dragon Dance', 'Bulk Up', 'Quiver Dance', 'Shell Smash', 'Shift Gear', 'Coil', 'Thunder Wave', 'Will-O-Wisp', 'Toxic', 'Spore', 'Sleep Powder', 'Yawn', 'Encore', 'Taunt', 'Roost', 'Recover', 'Slack Off', 'Soft-Boiled', 'Synthesis', 'Wish', 'Stealth Rock', 'Light Screen', 'Reflect', 'Trick Room', 'Tailwind', 'Leech Seed', 'Substitute', 'Parting Shot', 'Obstruct', 'Baneful Bunker', 'Iron Defense', 'Agility', 'Rock Polish', 'Belly Drum', 'Fake Out'];
function moveScore(name, types) {
  const m = MOVES[name]; if (!m || m.category === 'Status' || !m.bp || AWKWARD.includes(name)) return 0;
  return m.bp * (types.includes(m.type) ? 1.5 : 1) * ((m.acc || 100) >= 100 || m.acc === true ? 1 : (m.acc || 100) / 100) * (m.multihit ? 2.5 : 1);
}
// The strongest move of each type, up to 8, from what it has plus what it learns.
function candidateMoves(known, learn, species) {
  const ts = (SPEC[species] || {}).types || [];
  const all = [...new Set(known.concat(learn))].filter(n => MOVES[n]);
  const dmg = all.filter(n => moveScore(n, ts) > 0).sort((a, b) => moveScore(b, ts) - moveScore(a, ts));
  const byType = {}, pick = [];
  dmg.forEach(n => { const t = MOVES[n].type; if ((byType[t] || 0) < 2 && pick.length < 8) { byType[t] = (byType[t] || 0) + 1; pick.push(n); } });
  return pick;
}
function abilitiesOf(species) {
  const T = root.RR_SAVE; if (!T) return [];
  const id = Object.keys(T.species).find(k => T.species[k] === species); if (!id) return [];
  const ab = T.specAb[id] || [];
  return ab.map((a, i) => a ? { name: T.abilities[a], hidden: i === 2 } : null).filter(x => x && x.name).filter((x, i, arr) => arr.findIndex(y => y.name === x.name) === i);
}
// The walkthrough section (index into RR_ITEMS.sections) of a fight's location, e.g. "VERMILLION CITY" -> Vermilion City.
const LOC_ALIAS = { 'nugget bridge': 'route 24', 'dig house': 'cerulean city', 'vermillion city': 'vermilion city', 'game corner': 'celadon city', 'celadon city hotel': 'celadon city',
  'elite four': 'indigo plateau', 'champion': 'indigo plateau', 'cerulea cave': 'cerulean cave' };
const normLoc = t => String(t || '').toLowerCase().replace(/é/g, 'e').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function sectionOf(loc) {
  const I = root.RR_ITEMS; if (!I || !loc) return 999;
  let l = normLoc(loc);
  Object.keys(LOC_ALIAS).forEach(k => { if (l === k || l.startsWith(k + ' ')) l = LOC_ALIAS[k]; });
  let best = -1, bl = 0;
  I.sections.forEach((s, k) => {
    const full = normLoc(s), base = normLoc(s.replace(/\s*\(.*\)\s*/g, ' '));
    [full, base].forEach(n => { if (n && (l === n || l.startsWith(n + ' ')) && n.length > bl) { best = k; bl = n.length; } });
  });
  return best < 0 ? 999 : best;
}
function itemInfo(name, sec) {
  const I = root.RR_ITEMS, r = I && I.items[name];
  if (!r) return { known: false, ok: false, where: '' }; // not in the item spreadsheet, so don't count on it
  return { known: true, ok: !r.post && r.idx <= sec, where: r.where, post: r.post };
}

// How good a build is against the boss team (higher is better), plus per-foe details.
function evaluate(o, foes, f, extra) {
  const p = mk(o); if (!p) return { v: -1e9 };
  const fm = field(f, true), ff = field(f, false);
  let v = 0; const rows = [];
  foes.forEach(fo => {
    const offs = o.moves.map(n => hit(p, fo.p, n, fm)).filter(h => !h.status && !h.err);
    const best = offs.reduce((a, h) => (h.loP > a.loP ? h : a), { loP: 0, hiP: 0, name: '' });
    const defs = movesOf(fo.p, fo.moves).map(n => hit(fo.p, p, n, ff)).filter(h => !h.status && !h.err);
    const worst = defs.reduce((a, h) => (h.hiP > a.hiP ? h : a), { hiP: 0, name: '' });
    const fast = speedOf(p, f, true) > speedOf(fo.p, f, false);
    const off = best.loP, def = worst.hiP, sash = extra.item === 'Focus Sash' && def >= 100;
    let x = Math.min(off, 100) / 100 + (off >= 100 ? 0.6 : 0) + (off >= 50 ? 0.2 : 0) - Math.min(def, 100) / 100 * 0.8 - (def >= 100 && !sash ? 0.7 : 0) + (fast ? 0.25 : 0) + (fast && off >= 100 ? 0.4 : 0);
    if (sash) x += 0.2;
    rows.push({ foe: fo.name, move: best.name, off, def, by: worst.name, fast });
    v += x;
  });
  const n = foes.length, it = extra.item;
  if (it === 'Leftovers' || (it === 'Black Sludge' && p.types.includes('Poison'))) v += 0.1 * n;
  if (it === 'Black Sludge' && !p.types.includes('Poison')) v -= 1 * n;
  if (it === 'Sitrus Berry') v += 0.08 * n;
  if (/^Choice /.test(it || '')) v -= 0.15 * n;
  return { v, rows };
}

/* optimize({ m, foes, f, cap, loc, statusMoves }) -> best build */
function optimize(opt) {
  const { m, foes, f } = opt;
  const cap = Math.max(opt.cap, +m.level || 1); // never level a Pokémon down
  const sec = sectionOf(opt.loc);
  const ev = evolveTo(m.species, cap);
  const chain = [m.species].concat(ev.path.map(x => x.to));
  const known = (m.moves || []).filter(Boolean);
  const learn = learnable(chain, cap);
  const cands = candidateMoves(known, learn, ev.species);
  if (!cands.length) return null;
  const abil = abilitiesOf(ev.species);
  const base = { species: ev.species, level: cap, nature: m.nature || 'Hardy', ability: m.ability && abil.some(a => a.name === m.ability) ? m.ability : (abil[0] || {}).name, item: m.item || '', evs: m.evs || {}, ivs: m.ivs || {}, moves: cands };
  const score = o => evaluate(o, foes, f, o).v;
  let best = Object.assign({}, base, { item: '' }), bv = score(best);
  // natures
  [...new Set([base.nature].concat(NATURES))].forEach(n => { const o = Object.assign({}, best, { nature: n }), v = score(o); if (v > bv + 1e-9) { best = o; bv = v; } });
  // abilities
  abil.forEach(a => { const o = Object.assign({}, best, { ability: a.name }), v = score(o); if (v > bv + 1e-9) { best = o; bv = v; } });
  // items you can have by this fight
  const p0 = mk(best), phys = p0 && p0.rawStats.atk >= p0.rawStats.spa;
  const types = [...new Set(cands.map(n => MOVES[n].type))].filter(t => p0 && p0.types.includes(t)).concat(cands.map(n => MOVES[n].type)).slice(0, 3);
  const threats = {}; foes.forEach(fo => movesOf(fo.p, fo.moves).forEach(n => { const h = hit(fo.p, p0, n, field(f, false)); if (!h.status && !h.err && h.hiP > 0) threats[h.type] = Math.max(threats[h.type] || 0, h.hiP); }));
  const topThreats = Object.entries(threats).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
  const X = dex(), canEvolve = X && X.species[ev.species] && X.species[ev.species].ev.length > 0;
  let items = ['Life Orb', phys ? 'Choice Band' : 'Choice Specs', 'Choice Scarf', 'Expert Belt', phys ? 'Muscle Band' : 'Wise Glasses', 'Leftovers', 'Sitrus Berry', 'Focus Sash', 'Assault Vest', 'Black Sludge']
    .concat(types.map(t => BOOSTER[t]), topThreats.map(t => BERRY[t]), canEvolve ? ['Eviolite'] : [], /Pikachu/.test(ev.species) ? ['Light Ball'] : [], /Cubone|Marowak/.test(ev.species) ? ['Thick Club'] : []);
  items = [...new Set(items.filter(Boolean))];
  if (m.item) items.unshift(m.item);
  const hasStatus = known.some(n => MOVES[n] && MOVES[n].category === 'Status');
  let bestItem = '', biv = -1e9, later = null;
  items.forEach(it => {
    if (it === 'Assault Vest' && hasStatus) return;
    const info = itemInfo(it, sec);
    const o = Object.assign({}, best, { item: it }), v = score(o);
    if (info.ok) { if (v > biv) { biv = v; bestItem = it; } }
    else if (!info.post && (!later || v > later.v)) later = { item: it, v, where: info.where };
  });
  if (bestItem) { best = Object.assign({}, best, { item: bestItem }); bv = biv; }
  // final four moves: cover as many of their Pokémon as possible
  const p = mk(best), fm = field(f, true);
  const grid = cands.map(n => foes.map(fo => { const h = hit(p, fo.p, n, fm); return h.status || h.err ? 0 : Math.min(h.loP, 100); }));
  const chosen = [];
  while (chosen.length < Math.min(4, cands.length)) {
    let bi = -1, bg = -1;
    cands.forEach((n, i) => { if (chosen.includes(i)) return; const g = foes.reduce((a, _, j) => a + Math.max(grid[i][j], ...chosen.map(c => grid[c][j]), 0) - Math.max(0, ...chosen.map(c => grid[c][j])), 0) + grid[i].reduce((a, x) => a + x, 0) * 0.01; if (g > bg) { bg = g; bi = i; } });
    chosen.push(bi);
  }
  let moves = chosen.map(i => cands[i]);
  // swap the last attack for a status move it already knows when that attack adds little coverage
  if (moves.length === 4) {
    const last = chosen[3], before = chosen.slice(0, 3);
    const gain = foes.reduce((a, _, j) => a + Math.max(0, grid[last][j] - Math.max(0, ...before.map(c => grid[c][j]))), 0);
    const util = known.find(n => KEEP.includes(n) && MOVES[n] && !moves.includes(n));
    if (util && gain < 15 * foes.length / 4) moves = moves.slice(0, 3).concat(util);
  } else {
    known.filter(n => KEEP.includes(n) && MOVES[n] && !moves.includes(n)).slice(0, 4 - moves.length).forEach(n => moves.push(n));
  }
  const final = Object.assign({}, best, { moves });
  const res = evaluate(final, foes, f, final);
  const abInfo = abil.find(a => a.name === final.ability);
  return {
    species: final.species, evolved: ev.path, level: cap, nature: final.nature, ability: final.ability,
    abilityNote: abInfo && abInfo.hidden ? 'hidden ability: needs a Dream Capsule' : (final.ability !== m.ability && m.ability ? 'switch with an Ability Capsule' : ''),
    item: final.item, itemWhere: final.item ? itemInfo(final.item, sec).where : '', laterItem: later && later.v > bv + 0.3 ? later : null,
    moves, newMoves: moves.filter(n => !known.includes(n)), rows: res.rows, value: res.v
  };
}
/* ---- quick build at the level cap, for the battle-line planner ----
   buildAtCap({ m, foes, f, cap, sec }): evolves by level, takes it to the cap, and picks four moves from what it knows, its
   level-up moves and the TMs / tutors you can get by now (sec = walkthrough section of your next fight). Keeps its nature,
   ability and item. Returns { opts (mk() input), species, evolved, level, moves, newMoves: [{ name, how }] }. */
const SETUP_MOVES = { 'Swords Dance': 'atk', 'Dragon Dance': 'atk', 'Bulk Up': 'atk', 'Shift Gear': 'atk', 'Coil': 'atk', 'Howl': 'atk', 'Hone Claws': 'atk', 'Victory Dance': 'atk', 'Tidy Up': 'atk', 'Belly Drum': 'atk',
  'Nasty Plot': 'spa', 'Calm Mind': 'spa', 'Quiver Dance': 'spa', 'Tail Glow': 'spa', 'Shell Smash': 'both', 'Work Up': 'both', 'Growth': 'both', 'No Retreat': 'both', 'Clangorous Soul': 'both' };
// done(n): has required fight n been beaten? (a gym TM only counts once you've beaten that gym)
function teachable(chain, sec, done) {
  const X = dex(), I = root.RR_ITEMS; if (!X || !I || !I.all) return [];
  const where = (name, kinds) => { const r = I.all.filter(x => x[0] === name && kinds.includes(x[1]) && !x[4] && x[3] <= sec && (!x[6] || !done || done(x[6]))).sort((a, b) => a[3] - b[3])[0]; return r ? r[2] : null; };
  const out = [], seen = new Set();
  chain.forEach(sp => {
    const e = X.species[sp]; if (!e) return;
    [['tm', ['tm', 'hm']], ['tu', ['tutor']]].forEach(([key, kinds]) => (e[key] || []).forEach(i => {
      const id = X[key][i], mv = id ? X.moves[id] : null; if (!mv || seen.has(mv[0]) || !MOVES[mv[0]]) return;
      const w = where(mv[0], kinds); if (w) { seen.add(mv[0]); out.push({ name: mv[0], how: w }); }
    }));
  });
  return out;
}
function buildAtCap(opt) {
  const { m, foes, f } = opt;
  const cap = Math.max(opt.cap || 1, +m.level || 1);
  const sec = opt.sec != null ? opt.sec : sectionOf(opt.loc);
  const ev = evolveTo(m.species, cap);
  const chain = [m.species].concat(ev.path.map(x => x.to));
  const known = (m.moves || []).filter(n => n && MOVES[n]);
  const beaten = opt.beaten ? new Set(opt.beaten) : null;
  const done = beaten ? n => beaten.has(n) : opt.nextN ? n => n < opt.nextN : null;
  const lvl = learnable(chain, cap), teach = teachable(chain, sec, done);
  const src = {};
  known.forEach(n => { src[n] = 'known'; }); lvl.forEach(n => { src[n] = src[n] || 'level-up'; }); teach.forEach(t => { src[t.name] = src[t.name] || t.how; });
  const all = [...new Set(known.concat(lvl, teach.map(t => t.name)))];
  const cands = candidateMoves(known, all, ev.species);
  // its ability carries over by slot when it evolves
  let ability = m.ability;
  if (ev.path.length) { const a0 = abilitiesOf(m.species), a1 = abilitiesOf(ev.species), k = a0.findIndex(a => a.name === m.ability); if (a1.length && !a1.some(a => a.name === m.ability)) ability = (a1[k] || a1[0]).name; }
  const o = { species: ev.species, level: cap, nature: m.nature || 'Hardy', ability, item: m.item || '', evs: m.evs || {}, ivs: m.ivs || {}, moves: cands.length ? cands : known };
  const p = mk(o); if (!p) return null;
  let moves = known.slice(0, 4);
  if (cands.length) {
    const fm = field(f, true);
    const grid = cands.map(n => foes.map(fo => { const h = hit(p, fo.p, n, fm); return h.status || h.err ? 0 : Math.min(h.loP * ((MOVES[n].acc || 100) === true ? 1 : Math.min(100, MOVES[n].acc || 100) / 100), 100); }));
    const chosen = [];
    while (chosen.length < Math.min(4, cands.length)) {
      let bi = -1, bg = -1;
      cands.forEach((n, i) => { if (chosen.includes(i)) return; const g = foes.reduce((a, _, j) => a + Math.max(0, grid[i][j] - Math.max(0, ...chosen.map(c => grid[c][j]))), 0) + grid[i].reduce((a, x) => a + x, 0) * 0.01; if (g > bg) { bg = g; bi = i; } });
      chosen.push(bi);
    }
    moves = chosen.map(i => cands[i]);
    // a setup move (for its better attacking stat) or a status move it already uses beats a fourth attack that adds little
    const phys = p.rawStats.atk >= p.rawStats.spa;
    const setup = all.find(n => SETUP_MOVES[n] && (SETUP_MOVES[n] === 'both' || (SETUP_MOVES[n] === 'atk') === phys) && MOVES[n]);
    const util = setup || known.find(n => KEEP.includes(n) && MOVES[n]);
    if (util && !moves.includes(util)) {
      if (moves.length < 4) moves.push(util);
      else { const last = chosen[3], before = chosen.slice(0, 3), gain = foes.reduce((a, _, j) => a + Math.max(0, grid[last][j] - Math.max(0, ...before.map(c => grid[c][j]))), 0); if (gain < 15 * foes.length / 4) moves = moves.slice(0, 3).concat(util); }
    }
  }
  return { opts: Object.assign({}, o, { moves }), species: ev.species, evolved: ev.path, level: cap, moves, newMoves: moves.filter(n => !known.includes(n)).map(n => ({ name: n, how: src[n] || '' })) };
}
root.RRBuild = { use, optimize, evolveTo, sectionOf, buildAtCap };
})(typeof window !== 'undefined' ? window : globalThis);
