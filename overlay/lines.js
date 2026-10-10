/* Radical Red Nuzlocke Kit - battle line planner (shared by the website and the overlay).
   Plays a battle out turn by turn with the AI rules of the Complete FireRed Upgrade engine that Radical Red runs on.

   Singles:
   - the AI attacks with a move that KOs if it has one (a "fast kill" if it moves first, a "slow kill" if not), otherwise its strongest hit;
   - when one of its Pokémon faints it sends whichever teammate scores best against YOUR Pokémon on the field
     (+31 can KO you, +17 resists all your moves, +14 outspeeds, +8 revenge kill, +2 walls, +2 2HKO, -39/-15 you KO it);
   - it switches out mid-fight if a teammate's ability absorbs your attack.
   Doubles (CFRU UpdateBestDoubleKillingMoveScore / ChooseTarget_Doubles):
   - each damaging move is scored per target: +4 for each of your Pokémon it hits (less if it does under a third / a quarter),
     +2 for each it KOs, +1 if it is its strongest move into that target, -3 if it also hits its own partner;
     so a spread move that hits both of you (8) beats a single-target KO (6);
   - ties go to the move that KOs more, then to the target that can KO the AI, then to more damage;
   - the faster AI Pokémon picks first and its partner ignores a target it will already KO;
   - Fake Out on its first turn outranks everything except a double KO.
   Intimidate is applied whenever a Pokémon with it comes in, on either side (blocked by Clear Body, Inner Focus, Own Tempo,
   Oblivious, Scrappy, Hyper Cutter, White Smoke, Full Metal Body, Mirror Armor, Clear Amulet; Defiant/Guard Dog/Contrary
   raise Attack instead, Competitive raises Sp. Atk by 2, Simple doubles it).
   Your choices: the lead(s), staying in or switching when its next Pokémon comes out (singles), and who replaces a fainted Pokémon.
   A beam search keeps the plans that lose the fewest Pokémon, then the least HP. Damage is played safe: your low roll, its high roll.
   The page hands over its helpers with RRLines.use({ hit, movesOf, speedOf, goesFirst, eff, field, MOVES, scorePair }). */
(function (root) {
'use strict';
let hit, movesOf, speedOf, goesFirst, eff, field, MOVES, scorePair;
function use(d) { ({ hit, movesOf, speedOf, goesFirst, eff, field, MOVES, scorePair } = d); }

const BEAM = 120, MAX_TURNS = 12;
const SASH = p => p && (p.item === 'Focus Sash' || p.ability === 'Sturdy');
const INTIM_BLOCK = ['Clear Body', 'Hyper Cutter', 'White Smoke', 'Full Metal Body', 'Inner Focus', 'Oblivious', 'Own Tempo', 'Scrappy', 'Mirror Armor'];
function intimDelta(p) {
  if (!p || p.item === 'Clear Amulet' || INTIM_BLOCK.includes(p.ability)) return null;
  switch (p.ability) {
    case 'Guard Dog': case 'Contrary': case 'Defiant': return { atk: 1 };
    case 'Simple': return { atk: -2 };
    case 'Competitive': return { atk: -1, spa: 2 };
    default: return { atk: -1 };
  }
}
const STATS = ['atk', 'def', 'spa', 'spd', 'spe'];
const ZERO = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const clamp6 = v => Math.max(-6, Math.min(6, v));
const addSt = (a, d) => { const o = {}; STATS.forEach(k => { o[k] = clamp6(((a && a[k]) || 0) + ((d && d[k]) || 0)); }); return o; };
// stage objects are never changed once made (addSt makes new ones), so each one's key is worked out once
const stKey = s => {
  if (!s) return '0,0,0,0,0';
  if (s._k) return s._k;
  const k = STATS.map(x => s[x] || 0).join(',');
  try { Object.defineProperty(s, '_k', { value: k }); } catch (e) { /* frozen */ }
  return k;
};
const STAT_NAME = { atk: 'Atk', def: 'Def', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };
const stTxt = d => Object.entries(d).filter(([k, v]) => v && STAT_NAME[k]).map(([k, v]) => (v > 0 ? '+' : '−') + Math.abs(v) + ' ' + STAT_NAME[k]).join(', ');
// A status move? The move data leaves the category out for many of them (Nasty Plot, Roost, Trick Room...): no power = status.
const isStatus = n => { const m = MOVES[n]; return !!m && (m.category === 'Status' || (!m.category && !m.bp)); };
const isSpread = n => { const m = MOVES[n]; return !!m && (m.target === 'allAdjacentFoes' || m.target === 'allAdjacent'); };
const hitsAlly = n => { const m = MOVES[n]; return !!m && m.target === 'allAdjacent'; };

/* End-of-turn HP change for one Pokémon, in % of its max HP (negative = damage).
   c: { weather, terrain, status: 'brn'|'psn'|'tox'|'slp'|..., toxicN, seeded, cursed, nightmare, wrapped }
   Modern rules: burn 1/16, poison 1/8, Toxic n/16, sandstorm/hail 1/16, Leech Seed 1/8, Curse 1/4, Nightmare 1/4,
   trapping moves 1/8; Leftovers 1/16, Black Sludge 1/16 (or -1/8 if not Poison), Grassy Terrain 1/16. */
const SAND_SAFE = ['Rock', 'Ground', 'Steel'];
function residual(p, c) {
  const parts = [], add = (name, v) => { if (v) parts.push([name, v]); };
  if (!p) return { net: 0, parts };
  const ab = p.ability, it = p.item, t = p.types || [], mg = ab === 'Magic Guard';
  const st = c.status || (p.status || '');
  const w = c.weather || '';
  const weatherProof = it === 'Safety Goggles' || ab === 'Overcoat' || mg;
  if (!weatherProof && w === 'Sand' && !t.some(x => SAND_SAFE.includes(x)) && !['Sand Veil', 'Sand Rush', 'Sand Force'].includes(ab)) add('Sandstorm', -6.25);
  if (!weatherProof && w === 'Hail' && !t.includes('Ice') && !['Ice Body', 'Snow Cloak', 'Slush Rush'].includes(ab)) add('Hail', -6.25);
  if (/Rain/.test(w)) { if (ab === 'Rain Dish') add('Rain Dish', 6.25); if (ab === 'Dry Skin') add('Dry Skin', 12.5); }
  if (/Sun/.test(w)) { if (ab === 'Dry Skin') add('Dry Skin', mg ? 0 : -12.5); if (ab === 'Solar Power') add('Solar Power', mg ? 0 : -12.5); }
  if ((w === 'Hail' || w === 'Snow') && ab === 'Ice Body') add('Ice Body', 6.25);
  if (!mg) {
    if (st === 'brn') add('Burn', ab === 'Heatproof' ? -3.125 : -6.25);
    if (st === 'frz') add('Frostbite', -6.25); // Radical Red: frostbite instead of freezing
    if (st === 'psn') add(ab === 'Poison Heal' ? 'Poison Heal' : 'Poison', ab === 'Poison Heal' ? 12.5 : -12.5);
    if (st === 'tox') add(ab === 'Poison Heal' ? 'Poison Heal' : 'Toxic', ab === 'Poison Heal' ? 12.5 : -6.25 * Math.max(1, c.toxicN || 1));
    if (c.seeded) add('Leech Seed', -12.5);
    if (c.cursed) add('Curse', -25);
    if (c.nightmare && st === 'slp') add('Nightmare', -25);
    if (c.wrapped) add('Trapped', -12.5);
    if (it === 'Black Sludge' && !t.includes('Poison')) add('Black Sludge', -12.5);
    if (it === 'Sticky Barb') add('Sticky Barb', -12.5);
  } else if ((st === 'psn' || st === 'tox') && ab === 'Poison Heal') add('Poison Heal', 12.5);
  if (it === 'Leftovers') add('Leftovers', 6.25);
  if (it === 'Black Sludge' && t.includes('Poison')) add('Black Sludge', 6.25);
  if (c.terrain === 'Grassy' && !t.includes('Flying') && ab !== 'Levitate' && it !== 'Air Balloon') add('Grassy Terrain', 6.25);
  return { net: parts.reduce((a, x) => a + x[1], 0), parts };
}
/* One-time healing items: { at: HP% that triggers it, amt: HP% healed }.
   Sitrus 1/4 at half HP, Oran 10 HP and Berry Juice 20 HP at half HP, Figy/Wiki/Mago/Aguav/Iapapa 1/3 at a quarter
   (Gluttony: at half). Ripen doubles berries. */
const PINCH = ['Figy Berry', 'Wiki Berry', 'Mago Berry', 'Aguav Berry', 'Iapapa Berry'];
function healItem(p) {
  if (!p || !p.item) return null;
  const it = p.item, ripen = p.ability === 'Ripen' ? 2 : 1, max = p.maxHP ? p.maxHP() : 100;
  if (it === 'Sitrus Berry') return { item: it, at: 50, amt: 25 * ripen };
  if (it === 'Oran Berry') return { item: it, at: 50, amt: 10 * ripen / max * 100 };
  if (it === 'Berry Juice') return { item: it, at: 50, amt: 20 / max * 100 };
  if (PINCH.includes(it)) return { item: it, at: p.ability === 'Gluttony' ? 50 : 25, amt: 100 / 3 * ripen };
  return null;
}
// Fire any healing item whose HP threshold has been crossed (each works once).
function berries(M, st) {
  if (!st.bm) st.bm = M.mine.map(() => false);
  if (!st.bf) st.bf = M.foes.map(() => false);
  const check = (list, hp, used, side) => list.forEach((x, k) => {
    if (used[k] || hp[k] <= 0) return;
    const h = M.heal[side][k]; if (!h || hp[k] > h.at) return;
    hp[k] = Math.min(100, hp[k] + h.amt); used[k] = true;
    if (st.log) st.log.push({ t: 'berry', side, k, item: h.item, amt: h.amt });
  });
  check(M.mine, st.mh, st.bm, 'my');
  check(M.foes, st.fh, st.bf, 'foe');
}
/* Critical hits: chance by crit stage (1/24, 1/8, 1/2, always), modern rules. */
const HIGH_CRIT = ['Slash', 'Night Slash', 'Leaf Blade', 'Stone Edge', 'Cross Chop', 'Crabhammer', 'Razor Leaf', 'Karate Chop', 'Air Cutter', 'Attack Order',
  'Blaze Kick', 'Cross Poison', 'Drill Run', 'Esper Wing', 'Poison Tail', 'Psycho Cut', 'Razor Wind', 'Shadow Claw', 'Sky Attack', 'Spacial Rend',
  'Stone Axe', 'Aqua Cutter', 'Snipe Shot', 'Triple Arrows', 'Ivy Cudgel', 'Aeroblast'];
function critChance(att, def, name) {
  if (!att || !def || ['Battle Armor', 'Shell Armor'].includes(def.ability)) return 0;
  const mv = MOVES[name]; if (!mv || isStatus(name)) return 0;
  if (mv.willCrit) return 1;
  let stage = HIGH_CRIT.includes(name) ? 1 : 0;
  if (['Scope Lens', 'Razor Claw'].includes(att.item)) stage++;
  if (att.ability === 'Super Luck') stage++;
  if ((att.item === 'Leek' || att.item === 'Stick') && /Farfetch|Sirfetch/.test(att.name)) stage += 2;
  if (att.item === 'Lucky Punch' && att.name === 'Chansey') stage += 2;
  if (att.ability === 'Merciless' && ['psn', 'tox'].includes(def.status)) return 1;
  return [1 / 24, 1 / 8, 1 / 2, 1][Math.min(3, stage)];
}
// A hit that leaves def alive normally but KOs on a crit: { chance (0-1), critLoP, critHiP } or null.
function deadToCrit(att, def, name, fld) {
  const h = hit(att, def, name, fld);
  if (h.err || h.status || h.hi >= def.curHP()) return null;
  const c = hit(att, def, name, fld, true);
  if (c.err || c.hi < def.curHP()) return null;
  const chance = critChance(att, def, name);
  return chance ? { chance, critLoP: c.loP, critHiP: c.hiP, sure: c.lo >= def.curHP() } : null;
}
const critTxt = d => `dead to a crit (${Math.round(d.chance * 1000) / 10}%${d.sure ? '' : ', on a high roll'})`;
/* Move warnings: what the target's (or, in doubles, anyone's) ability or item does to a move before you click it.
   moveWarnings(name, att, def, { ally, others, terrain, doubles }) -> [{ lvl: 'bad'|'warn'|'info', tag, text }]
   lvl bad = the move fails, is absorbed or is redirected; warn = it backfires on you or helps them; info = good to know. */
const POWDER = ['Spore', 'Sleep Powder', 'Stun Spore', 'Poison Powder', 'Rage Powder', 'Cotton Spore', 'Magic Powder'];
const ABSORB_ABIL = {
  Water: [['Storm Drain', 'absorbs Water moves and gets +1 Sp. Atk', true], ['Water Absorb', 'absorbs Water moves and heals 25%'], ['Dry Skin', 'absorbs Water moves and heals 25%']],
  Electric: [['Lightning Rod', 'absorbs Electric moves and gets +1 Sp. Atk', true], ['Volt Absorb', 'absorbs Electric moves and heals 25%'], ['Motor Drive', 'absorbs Electric moves and gets +1 Speed']],
  Fire: [['Flash Fire', 'absorbs Fire moves and powers up its own Fire moves'], ['Well-Baked Body', 'is immune to Fire moves and gets +2 Defense']],
  Grass: [['Sap Sipper', 'absorbs Grass moves and gets +1 Attack']],
  Ground: [['Levitate', 'is immune to Ground moves'], ['Earth Eater', 'absorbs Ground moves and heals 25%']]
};
function moveWarnings(name, att, def, ctx) {
  ctx = ctx || {};
  const out = [], mv = MOVES[name];
  if (!mv || !def) return out;
  const W = (lvl, tag, text) => out.push({ lvl, tag, text });
  const ab = def.ability || '', it = def.item || '', nm = def.name, status = isStatus(name);
  const breaker = att && ['Mold Breaker', 'Teravolt', 'Turboblaze'].includes(att.ability);
  // redirection in doubles: a Storm Drain / Lightning Rod anywhere else on the field pulls single-target moves
  if (ctx.doubles && !(mv.target === 'allAdjacentFoes' || mv.target === 'allAdjacent')) {
    [].concat(ctx.others || [], ctx.ally ? [ctx.ally] : []).forEach(o => {
      if (!o) return;
      const r = (ABSORB_ABIL[mv.type] || []).find(x => x[2] && x[0] === o.ability);
      if (r && o !== def) W('bad', r[0], `goes to ${o === ctx.ally ? 'your own ' : ''}${o.name}'s ${r[0]} instead (it ${r[1]})`);
    });
  }
  if (!breaker) {
    const a = (ABSORB_ABIL[mv.type] || []).find(x => x[0] === ab);
    if (a && !(status && mv.type !== 'Electric')) W('bad', ab, `${nm} ${a[1]}`);
    if (mv.isWind && ab === 'Wind Rider') W('bad', ab, `${nm} absorbs wind moves and gets +1 Attack`);
    if (mv.isBullet && ab === 'Bulletproof') W('bad', ab, `${nm} is immune to ball and bomb moves`);
    if (mv.isSound && ab === 'Soundproof') W('bad', ab, `${nm} is immune to sound moves`);
    if (POWDER.includes(name) && (ab === 'Overcoat' || def.types.includes('Grass') || it === 'Safety Goggles')) W('bad', ab === 'Overcoat' ? ab : it === 'Safety Goggles' ? it : 'Grass type', `${nm} is immune to powder moves`);
    if (status && ab === 'Good as Gold') W('bad', ab, `${nm} is immune to status moves`);
    if (status && ab === 'Magic Bounce' && !['Protect', 'Detect'].includes(name)) W('bad', ab, `${nm} bounces status moves back at you`);
    if ((mv.priority || 0) > 0 && ['Dazzling', 'Queenly Majesty', 'Armor Tail'].includes(ab)) W('bad', ab, `${nm} blocks priority moves`);
    if (ab === 'Wonder Guard' && !status) W('warn', ab, `${nm} only takes super-effective hits`);
    if (ab === 'Sturdy' && ctx.defFull && !status) W('warn', ab, `${nm} survives any single hit from full HP`);
    if (['Disguise', 'Ice Face'].includes(ab) && !status) W('warn', ab, `${nm}'s first hit is blocked`);
    if (ab === 'Justified' && mv.type === 'Dark' && !status) W('warn', ab, `hitting ${nm} with Dark moves gives it +1 Attack`);
    if (ab === 'Steam Engine' && ['Fire', 'Water'].includes(mv.type) && !status) W('warn', ab, `hitting ${nm} with Fire or Water moves gives it +6 Speed`);
    if (ab === 'Thermal Exchange' && mv.type === 'Fire' && !status) W('warn', ab, `hitting ${nm} with Fire moves gives it +1 Attack`);
    if (ab === 'Water Compaction' && mv.type === 'Water' && !status) W('warn', ab, `hitting ${nm} with Water moves gives it +2 Defense`);
    if (ab === 'Rattled' && ['Bug', 'Dark', 'Ghost'].includes(mv.type) && !status) W('info', ab, `${nm} gets +1 Speed from Bug, Dark and Ghost hits`);
    if (ab === 'Weak Armor' && mv.category === 'Physical') W('info', ab, `physical hits give ${nm} +2 Speed (and −1 Defense)`);
    if (ab === 'Stamina' && !status) W('info', ab, `every hit gives ${nm} +1 Defense`);
    if (ab === 'Anger Point' && !status) W('info', ab, `a critical hit maxes ${nm}'s Attack`);
    if (ab === 'Cursed Body' && !status) W('info', ab, `30% chance to disable the move you hit ${nm} with`);
    if (ab === 'Toxic Debris' && mv.category === 'Physical') W('info', ab, `physical hits on ${nm} set Toxic Spikes on your side`);
    if (['Thick Fat', 'Heatproof', 'Water Bubble', 'Purifying Salt', 'Fluffy'].includes(ab) && !status) {
      const halves = (ab === 'Thick Fat' && ['Fire', 'Ice'].includes(mv.type)) || (ab === 'Heatproof' && mv.type === 'Fire') || (ab === 'Water Bubble' && mv.type === 'Fire') || (ab === 'Purifying Salt' && mv.type === 'Ghost') || (ab === 'Fluffy' && mv.makesContact && mv.type !== 'Fire');
      if (halves) W('info', ab, `${nm} takes half damage from this (already in the numbers)`);
    }
    if (mv.makesContact && !(att && (att.ability === 'Long Reach' || att.item === 'Protective Pads'))) {
      if (['Rough Skin', 'Iron Barbs'].includes(ab)) W('warn', ab, `contact: you lose 1/8 of your HP`);
      if (ab === 'Static') W('warn', ab, `contact: 30% chance you're paralysed`);
      if (ab === 'Flame Body') W('warn', ab, `contact: 30% chance you're burned`);
      if (ab === 'Poison Point') W('warn', ab, `contact: 30% chance you're poisoned`);
      if (ab === 'Effect Spore') W('warn', ab, `contact: 30% chance of sleep, poison or paralysis`);
      if (ab === 'Cute Charm') W('info', ab, `contact: 30% chance of infatuation`);
      if (['Gooey', 'Tangling Hair'].includes(ab)) W('warn', ab, `contact: you get −1 Speed`);
      if (['Mummy', 'Lingering Aroma', 'Wandering Spirit'].includes(ab)) W('warn', ab, `contact: your ability gets replaced`);
      if (ab === 'Pickpocket') W('info', ab, `contact: it steals your item`);
      if (ab === 'Perish Body') W('warn', ab, `contact: both of you faint in 3 turns unless you switch`);
    }
    if (ab === 'Aftermath') W('warn', ab, `a contact KO costs you 1/4 of your HP`);
    if (ab === 'Innards Out') W('warn', ab, `the KO hit damages you by its remaining HP`);
  }
  if (ctx.terrain === 'Psychic' && (mv.priority || 0) > 0 && !def.types.includes('Flying') && ab !== 'Levitate' && it !== 'Air Balloon') W('bad', 'Psychic Terrain', `priority moves fail against grounded targets`);
  if (mv.type === 'Ground' && it === 'Air Balloon' && !status) W('bad', 'Air Balloon', `${nm} floats over Ground moves until it's hit`);
  if (!status && mv.makesContact && it === 'Rocky Helmet') W('warn', it, `contact: you lose 1/6 of your HP`);
  if (!status && it === 'Weakness Policy' && att && eff(mv.type, def.types) > 1) W('warn', it, `a super-effective hit gives ${nm} +2 Atk and Sp. Atk`);
  if (!status && it === 'Absorb Bulb' && mv.type === 'Water') W('info', it, `${nm} gets +1 Sp. Atk`);
  if (!status && it === 'Cell Battery' && mv.type === 'Electric') W('info', it, `${nm} gets +1 Attack`);
  if (!status && it === 'Snowball' && mv.type === 'Ice') W('info', it, `${nm} gets +1 Attack`);
  if (!status && it === 'Luminous Moss' && mv.type === 'Water') W('info', it, `${nm} gets +1 Sp. Def`);
  if (!status && it === 'Focus Sash' && ctx.defFull) W('warn', it, `${nm} survives any single hit from full HP`);
  if (!status && ['Red Card', 'Eject Button'].includes(it)) W('info', it, it === 'Red Card' ? 'your Pokémon gets forced out after the hit' : `${nm} switches out after the hit`);
  if (!status && !out.some(w => w.lvl === 'bad') && att && eff(mv.type, def.types) === 0 && !(att.ability === 'Scrappy' && ['Normal', 'Fighting'].includes(mv.type))) W('bad', 'No effect', `${nm} is immune to ${mv.type} moves`);
  return out;
}
const lifeOrb = p => p && p.item === 'Life Orb' && p.ability !== 'Magic Guard' && p.ability !== 'Sheer Force' ? 10 : 0;
const resTxt = r => r.parts.map(([n, v]) => n + ' ' + (v > 0 ? '+' : '−') + (Math.round(Math.abs(v) * 10) / 10) + '%').join(', ');

// Damage tables, computed on demand (per attacker, defender, both sides' stat stages and the attacker's status) so the search is arithmetic.
function buildMatrix(mine, foes, f) {
  const fm = { my: f.my || {}, foe: f.foe || {}, doubles: !!f.doubles, twoOpp: !!f.twoOpp, weather: f.weather, terrain: f.terrain, tr: f.tr, permW: !!f.permW, permT: !!f.permT };
  const sMe = mine.map(x => speedOf(x.p, fm, true)), sFoe = foes.map(x => speedOf(x.p, fm, false));
  const fl = { my: field(fm, true), foe: field(fm, false) };
  const memo = new Map();
  const boosted = (p, st, status) => {
    if ((!st || STATS.every(k => !st[k])) && (!status || status === p.status)) return p;
    const q = p.clone();
    if (st) STATS.forEach(k => { q.boosts[k] = clamp6((q.boosts[k] || 0) + (st[k] || 0)); });
    if (status) q.status = status;
    return q;
  };
  // side 'my': your a hits their d; 'foe': their a hits your d; 'myAlly' / 'foeAlly': a hits its own partner d.
  // sa / sd: attacker / defender stage changes on top of what the Pokémon already has; za: the attacker's status (burn halves physical hits)
  function hits(side, a, d, sa, sd, za) {
    const key = side + a + '|' + d + '|' + stKey(sa) + '|' + stKey(sd) + '|' + (za || '');
    let r = memo.get(key); if (r) return r;
    const mySide = side === 'my' || side === 'myAlly';
    const A = (mySide ? mine : foes)[a], Df = side === 'my' ? foes[d] : side === 'foe' ? mine[d] : (mySide ? mine : foes)[d];
    const p = boosted(A.p, sa, za), q = boosted(Df.p, sd && { def: sd.def, spd: sd.spd });
    r = movesOf(A.p, A.moves).map(n => {
      const h = Object.assign(hit(p, q, n, mySide ? fl.my : fl.foe), { spread: isSpread(n), ally: hitsAlly(n), acc: accOf(n, fm.weather) });
      if (A.p.ability === 'Triage' && MOVES[n] && MOVES[n].drain) h.prio = (h.prio || 0) + 3;
      if (n === 'Grassy Glide' && fm.terrain === 'Grassy') h.prio = (h.prio || 0) + 1;
      // Psychic Terrain: priority moves fail against a Pokémon on the ground
      if (fm.terrain === 'Psychic' && (h.prio || 0) > 0 && grounded(Df.p)) Object.assign(h, { lo: 0, hi: 0, loP: 0, hiP: 0, blocked: 'Psychic Terrain' });
      return h;
    }).filter(h => !h.status && !h.err);
    memo.set(key, r);
    return r;
  }
  const statusMoves = foes.map(fo => (fo.moves || []).filter(isStatus));
  const myStatusMoves = mine.map(x => (x.moves || []).filter(isStatus));
  const ctx = x => Object.assign({ weather: fm.weather, terrain: fm.terrain }, x.res || {});
  const res = { my: mine.map(x => residual(x.p, ctx(x))), foe: foes.map(x => residual(x.p, ctx(x))) };
  const heal = { my: mine.map(x => healItem(x.p)), foe: foes.map(x => healItem(x.p)) };
  const foeP = (j, st) => boosted(foes[j].p, st);
  // importance: a starred Pokémon's death counts three times
  const w = mine.map(x => (x.star ? 3 : 1));
  // two trainers at once: each one only replaces its own Pokémon (party slots 1-3 and 4-6)
  const group = k => (fm.twoOpp ? ((foes[k].m && foes[k].m.slot != null ? foes[k].m.slot : k) < 3 ? 0 : 1) : 0);
  return { mine, foes, f: fm, fIn: f, sMe, sFoe, hits, statusMoves, myStatusMoves, res, heal, foeP, w, group };
}
const grounded = p => !p.types.includes('Flying') && p.ability !== 'Levitate' && p.item !== 'Air Balloon';
/* ---- weather and terrain that change during the fight (Radical Red: 5 turns from an ability or a move, 8 with
   Damp / Heat / Smooth / Icy Rock or Terrain Extender; Hail is Snow). Drizzle, Drought, Sand Stream, Snow Warning,
   Orichalcum Pulse and the primal weathers set the weather when their Pokémon comes in; Electric / Grassy / Misty /
   Psychic Surge and Hadron Engine set the terrain. st.wx = { w, wt, t, tt } is what the fight has now (null = what it
   started with). MW(M, st) is the set of damage tables, Speeds and end-of-turn numbers for that weather and terrain. */
const WX_ABIL = { 'Drizzle': 'Rain', 'Drought': 'Sun', 'Orichalcum Pulse': 'Sun', 'Sand Stream': 'Sand', 'Snow Warning': 'Snow', 'Primordial Sea': 'Heavy Rain', 'Desolate Land': 'Harsh Sunshine', 'Delta Stream': 'Strong Winds' };
const TX_ABIL = { 'Electric Surge': 'Electric', 'Hadron Engine': 'Electric', 'Grassy Surge': 'Grassy', 'Misty Surge': 'Misty', 'Psychic Surge': 'Psychic' };
const WX_MOVE = { 'Rain Dance': 'Rain', 'Sunny Day': 'Sun', 'Sandstorm': 'Sand', 'Snowscape': 'Snow', 'Hail': 'Snow', 'Chilly Reception': 'Snow' };
const TX_MOVE = { 'Electric Terrain': 'Electric', 'Grassy Terrain': 'Grassy', 'Misty Terrain': 'Misty', 'Psychic Terrain': 'Psychic' };
const WX_ROCK = { Rain: 'Damp Rock', Sun: 'Heat Rock', Sand: 'Smooth Rock', Snow: 'Icy Rock' };
const PRIMAL = ['Heavy Rain', 'Harsh Sunshine', 'Strong Winds'];
const WX_WORD = { Rain: 'rain', Sun: 'harsh sunlight', Sand: 'a sandstorm', Snow: 'snow', 'Heavy Rain': 'heavy rain', 'Harsh Sunshine': 'extremely harsh sunlight', 'Strong Winds': 'strong winds' };
// screens set during the fight: st.wx.sc = { mref, mls, mveil, fref, fls, fveil } turns left (my / foe side)
const SCR = ['mref', 'mls', 'mveil', 'fref', 'fls', 'fveil'];
const scrKey = sc => (sc ? SCR.map(k => (sc[k] > 0 ? 1 : 0)).join('') : '');
const wxKey = st => (st.wx ? (st.wx.w != null ? st.wx.w : '~') + (st.wx.wt || '') + ',' + (st.wx.t != null ? st.wx.t : '~') + (st.wx.tt || '') + ',' + (st.wx.sc ? SCR.map(k => st.wx.sc[k] || 0).join('.') : '') : '');
function MW(M, st) {
  const R = M.root || M, x = st && st.wx;
  if (!x) return R;
  const w = x.w != null ? x.w : R.f.weather || '', t = x.t != null ? x.t : R.f.terrain || '', sk = scrKey(x.sc);
  if (w === (R.f.weather || '') && t === (R.f.terrain || '') && !/1/.test(sk)) return R;
  const k = w + '|' + t + '|' + sk;
  R.wv = R.wv || {};
  if (!R.wv[k]) {
    const sc = x.sc || {}, fi = R.fIn || {};
    const my = Object.assign({}, fi.my, sc.mref > 0 ? { ref: true } : {}, sc.mls > 0 ? { ls: true } : {}, sc.mveil > 0 ? { veil: true } : {});
    const foe = Object.assign({}, fi.foe, sc.fref > 0 ? { ref: true } : {}, sc.fls > 0 ? { ls: true } : {}, sc.fveil > 0 ? { veil: true } : {});
    const V = buildMatrix(R.mine, R.foes, Object.assign({}, fi, { weather: w, terrain: t, my, foe })); V.root = R; R.wv[k] = V;
  }
  return R.wv[k];
}
function wxNow(M, st) { const R = M.root || M, x = st.wx || {}; return { w: x.w != null ? x.w : R.f.weather || '', t: x.t != null ? x.t : R.f.terrain || '' }; }
// set the weather (w) and/or terrain (t) from Pokémon k's ability or move
function setWx(M, st, side, k, w, t, why, log) {
  const R = M.root || M, p = sideP(R, side, k), now = wxNow(R, st), x = Object.assign({}, st.wx || {});
  let said = '';
  if (w && !R.f.permW && !(PRIMAL.includes(now.w) && !PRIMAL.includes(w)) && !(now.w === w && x.wt == null)) {
    x.w = w; x.wt = PRIMAL.includes(w) ? 99 : p.item === WX_ROCK[w] ? 8 : 5;
    said = `${WX_WORD[w] || w}${x.wt < 99 ? ' for ' + x.wt + ' turns' : ''}`;
  }
  if (t && !R.f.permT && !(now.t === t && x.tt == null)) {
    x.t = t; x.tt = p.item === 'Terrain Extender' ? 8 : 5;
    said = `${t} Terrain for ${x.tt} turns`;
  }
  if (!said) return;
  st.wx = x;
  if (log && log.push) log.push({ t: 'abil', side, k, text: `${why} sets ${said}` });
}
function entryWx(M, st, side, k, log) {
  const p = sideP(M.root || M, side, k), w = WX_ABIL[p.ability], t = TX_ABIL[p.ability];
  if (w || t) setWx(M, st, side, k, w, t, p.ability, log);
}
// end of turn: the weather / terrain counts down; at 0 it's gone
function tickWx(st) {
  const x = st.wx; if (!x || (x.wt == null && x.tt == null && !x.sc)) return;
  const n = Object.assign({}, x);
  if (n.sc) { const sc = Object.assign({}, n.sc); SCR.forEach(k => { if (sc[k] > 0) sc[k]--; }); n.sc = sc; }
  if (n.wt != null && n.wt < 99) { n.wt--; if (n.wt <= 0) { n.w = ''; n.wt = null; } }
  if (n.tt != null) { n.tt--; if (n.tt <= 0) { n.t = ''; n.tt = null; } }
  st.wx = n;
}
// Move accuracy (0-1) from the game's move table (rrmoves.js), else the Pokédex; moves that never miss count as 1.
// Weather: Thunder, Hurricane and the Storm moves never miss in rain (Thunder / Hurricane 50% in sun), Blizzard in snow.
let ACC_BY_NAME = null;
function accOf(name, weather) {
  const w = weather || '';
  if (/Rain/.test(w) && ['Thunder', 'Hurricane', 'Bleakwind Storm', 'Wildbolt Storm', 'Sandsear Storm'].includes(name)) return 1;
  if (/Sun/.test(w) && (name === 'Thunder' || name === 'Hurricane')) return 0.5;
  if ((w === 'Snow' || w === 'Hail') && name === 'Blizzard') return 1;
  const RM = root.RR_MOVES, ra = RM ? RM.acc(name) : null;
  if (ra != null) return ra;
  const X = root.RR_DEX; if (!X) return 1;
  if (!ACC_BY_NAME) { ACC_BY_NAME = {}; Object.keys(X.moves).sort((a, b) => b - a).forEach(id => { const m = X.moves[id]; ACC_BY_NAME[m[0]] = m[3]; }); } // lowest id wins (Max moves re-use names)
  const a = ACC_BY_NAME[name];
  return typeof a === 'number' && a > 0 && a <= 100 ? a / 100 : 1;
}
/* ---- abilities and items that change what a hit does (the damage engine already covers the ones that change the number) ----
   Sturdy / Focus Sash: survive at 1 HP from full. Disguise (any hit) / Ice Face (physical): the first hit does nothing
   but break it (1/8 chip for Disguise). Multiscale / Shadow Shield: the table numbers are at full HP, so later hits double.
   Rough Skin / Iron Barbs (1/8) and Rocky Helmet (1/6) hurt a contact attacker; Aftermath (1/4) when KO'd by contact.
   Moxie / Chilling Neigh (+1 Atk), Grim Neigh (+1 Sp. Atk), Beast Boost (best attacking stat) after a KO. */
const MOXIE = { 'Moxie': 'atk', 'Chilling Neigh': 'atk', 'Grim Neigh': 'spa', 'As One (Glastrier)': 'atk', 'As One (Spectrier)': 'spa' };
const sideP = (M, side, k) => (side === 'my' ? M.mine : M.foes)[k].p;
const hpArr = (st, side) => (side === 'my' ? st.mh : st.fh);
function disguiseUp(M, st, side, k, cat) {
  const p = sideP(M, side, k), key = side[0] + k;
  if (st.dg && st.dg[key]) return false;
  return p.ability === 'Disguise' || (p.ability === 'Ice Face' && cat === 'Physical');
}
function effDmg(M, st, side, k, dmg) {
  const p = sideP(M, side, k), hp = hpArr(st, side)[k];
  if (['Multiscale', 'Shadow Shield'].includes(p.ability) && hp < 100 && p.curHP() >= p.maxHP()) return dmg * 2;
  return dmg;
}
// Would this hit KO? (Sturdy / Focus Sash at full HP, an unbroken Disguise and Multiscale all count.)
function canKO(M, st, side, k, dmg, cat) {
  const p = sideP(M, side, k), hp = hpArr(st, side)[k];
  if (disguiseUp(M, st, side, k, cat)) return false;
  if (hp >= 100 && SASH(p)) return false;
  return effDmg(M, st, side, k, dmg) >= hp;
}
// A log that keeps nothing: play-outs that are only scored skip the write-up (the best one is replayed with it).
const NOLOG = { push() { return 0; }, slice() { return NOLOG; }, splice() { return []; }, filter() { return []; }, length: 0 };
function note(st, key, ev) { if (!st.log) return; st.seen = st.seen || {}; if (st.seen[key]) return; st.seen[key] = 1; st.log.push(ev); }
// One attack landing: damage (with Disguise / Sash / Multiscale), then contact damage, Aftermath and Moxie-type boosts.
function strike(M, st, atkSide, a, defSide, d, h, dmg) {
  const defArr = hpArr(st, defSide), atkArr = hpArr(st, atkSide);
  const dp = sideP(M, defSide, d), ap = sideP(M, atkSide, a), before = defArr[d];
  if (before <= 0 || !h || dmg <= 0) return;
  if (disguiseUp(M, st, defSide, d, h.cat)) {
    st.dg = Object.assign({}, st.dg, { [defSide[0] + d]: 1 });
    if (dp.ability === 'Disguise') defArr[d] = Math.max(0, defArr[d] - 12.5);
    note(st, 'dg' + defSide + d, { t: 'abil', side: defSide, k: d, text: `${dp.ability} takes the first hit` });
  } else {
    defArr[d] = applyHit(dp, before, effDmg(M, st, defSide, d, dmg));
    if (before >= 100 && defArr[d] > 0 && defArr[d] <= 0.5) note(st, 'sash' + defSide + d, { t: 'abil', side: defSide, k: d, text: `${dp.ability === 'Sturdy' ? 'Sturdy' : 'Focus Sash'} hangs on at 1 HP` });
  }
  const mv = MOVES[h.name] || {};
  if (mv.makesContact && ap.ability !== 'Long Reach' && ap.item !== 'Protective Pads' && atkArr[a] > 0) {
    let chip = 0, why = [];
    if (['Rough Skin', 'Iron Barbs'].includes(dp.ability)) { chip += 12.5; why.push(dp.ability); }
    if (dp.item === 'Rocky Helmet') { chip += 100 / 6; why.push('Rocky Helmet'); }
    if (defArr[d] <= 0 && dp.ability === 'Aftermath') { chip += 25; why.push('Aftermath'); }
    if (chip && ap.ability !== 'Magic Guard') { atkArr[a] = Math.max(0, atkArr[a] - chip); note(st, 'ct' + atkSide + a + defSide + d, { t: 'abil', side: atkSide, k: a, text: `loses ${Math.round(chip)}% to ${why.join(' + ')} on contact` }); }
  }
  if (before > 0 && defArr[d] <= 0 && atkArr[a] > 0) {
    let stat = MOXIE[ap.ability];
    if (ap.ability === 'Beast Boost') stat = ap.rawStats.atk >= ap.rawStats.spa ? 'atk' : 'spa';
    if (stat) {
      const arr = atkSide === 'my' ? st.ma : st.fa;
      arr[a] = addSt(arr[a] || ZERO, { [stat]: 1 });
      st.log && st.log.push({ t: 'abil', side: atkSide, k: a, text: `${ap.ability}: +1 ${stat === 'atk' ? 'Attack' : 'Sp. Atk'} after the KO` });
    }
  }
}
function applyHit(p, hp, dmg) {
  let out = hp - dmg;
  if (out <= 0 && hp >= 100 && SASH(p)) out = 0.5; // Focus Sash / Sturdy hang on at 1 HP
  return Math.max(0, out);
}

// ---- Intimidate on entry ----
// keep: stages were already reset (leads come in together, so one's Intimidate isn't wiped by the other's arrival)
// leaving the field: trapped / cursed / locked end, Regenerator heals a third, Natural Cure cures
function leaveField(M, st, side, k) {
  const key = side[0] + k, p = sideP(M, side, k), hp = hpArr(st, side);
  ['trap', 'curse', 'lk'].forEach(f => { if (st[f] && st[f][side[0]]) st[f] = Object.assign({}, st[f], { [side[0]]: null }); });
  if (hp[k] > 0 && p.ability === 'Regenerator') hp[k] = Math.min(100, hp[k] + 100 / 3);
  if (p.ability === 'Natural Cure' && zArr(st, side)[k]) { zArr(st, side)[k] = ''; if (st.sl) delete st.sl[key]; }
}
function enterMine(M, st, i, foesOut, log, keep) {
  if (!keep) st.ma[i] = ZERO;
  ['trap', 'curse', 'lk'].forEach(f => { if (st[f] && st[f].m) st[f] = Object.assign({}, st[f], { m: null }); });
  if (st.rc && st.rc['m' + i]) st.rc = Object.assign({}, st.rc, { ['m' + i]: 0 });
  entryWx(M, st, 'my', i, log);
  if (M.mine[i].p.ability !== 'Intimidate') return;
  foesOut.filter(j => j >= 0 && st.fh[j] > 0).forEach(j => {
    const d = intimDelta(M.foes[j].p);
    if (d) st.fa[j] = addSt(st.fa[j] || ZERO, d);
    log.push({ t: 'intim', side: 'my', i, j, d });
  });
}
function enterFoe(M, st, j, mineOut, log, keep) {
  if (!keep) st.fa[j] = ZERO;
  ['trap', 'curse', 'lk'].forEach(f => { if (st[f] && st[f].f) st[f] = Object.assign({}, st[f], { f: null }); });
  if (st.rc && st.rc['f' + j]) st.rc = Object.assign({}, st.rc, { ['f' + j]: 0 });
  entryWx(M, st, 'foe', j, log);
  if (M.foes[j].p.ability !== 'Intimidate') return;
  mineOut.filter(i => i >= 0 && st.mh[i] > 0).forEach(i => {
    const d = intimDelta(M.mine[i].p);
    if (d) st.ma[i] = addSt(st.ma[i] || ZERO, d);
    log.push({ t: 'intim', side: 'foe', i, j, d });
  });
}

/* ======================= singles ======================= */
/* What a move does besides damage, for planning. self: the user's stat stages; foe: the target's; status: what it inflicts;
   sec: a secondary effect (Sheer Force, Shield Dust and Covert Cloak cancel it); hp: HP the user pays (%).
   Only sure effects are listed (a 10% burn chance is not something to plan around). */
const FX = {
  // setup
  'Swords Dance': { self: { atk: 2 } }, 'Nasty Plot': { self: { spa: 2 } }, 'Dragon Dance': { self: { atk: 1, spe: 1 } }, 'Calm Mind': { self: { spa: 1, spd: 1 } },
  'Bulk Up': { self: { atk: 1, def: 1 } }, 'Quiver Dance': { self: { spa: 1, spd: 1, spe: 1 } }, 'Shell Smash': { self: { atk: 2, spa: 2, spe: 2, def: -1, spd: -1 } },
  'Coil': { self: { atk: 1, def: 1 } }, 'Shift Gear': { self: { atk: 1, spe: 2 } }, 'Iron Defense': { self: { def: 2 } }, 'Acid Armor': { self: { def: 2 } }, 'Barrier': { self: { def: 2 } },
  'Amnesia': { self: { spd: 2 } }, 'Agility': { self: { spe: 2 } }, 'Rock Polish': { self: { spe: 2 } }, 'Autotomize': { self: { spe: 2 } },
  'Growth': { self: { atk: 1, spa: 1 } }, 'Howl': { self: { atk: 1 } }, 'Work Up': { self: { atk: 1, spa: 1 } }, 'Hone Claws': { self: { atk: 1 } }, 'Meditate': { self: { atk: 1 } }, 'Sharpen': { self: { atk: 1 } },
  'Tail Glow': { self: { spa: 3 } }, 'Victory Dance': { self: { atk: 1, def: 1, spe: 1 } }, 'Tidy Up': { self: { atk: 1, spe: 1 } }, 'Cosmic Power': { self: { def: 1, spd: 1 } },
  'Defend Order': { self: { def: 1, spd: 1 } }, 'Stockpile': { self: { def: 1, spd: 1 } }, 'Cotton Guard': { self: { def: 3 } }, 'Charge': { self: { spd: 1 } }, 'Defense Curl': { self: { def: 1 } }, 'Harden': { self: { def: 1 } }, 'Withdraw': { self: { def: 1 } },
  'Belly Drum': { self: { atk: 12 }, hp: 50 }, 'Clangorous Soul': { self: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, hp: 33 }, 'Fillet Away': { self: { atk: 2, spa: 2, spe: 2 }, hp: 50 },
  'No Retreat': { self: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } },
  // attacks that boost the user
  'Power-Up Punch': { self: { atk: 1 }, sec: 1 }, 'Flame Charge': { self: { spe: 1 }, sec: 1 }, 'Trailblaze': { self: { spe: 1 }, sec: 1 }, 'Aqua Step': { self: { spe: 1 }, sec: 1 },
  'Esper Wing': { self: { spe: 1 }, sec: 1 }, 'Rapid Spin': { self: { spe: 1 }, sec: 1 }, 'Torch Song': { self: { spa: 1 }, sec: 1 }, 'Charge Beam': { self: { spa: 1 }, sec: 1 },
  'Mystical Power': { self: { spa: 1 }, sec: 1 },
  // attacks that drop the user
  'Close Combat': { self: { def: -1, spd: -1 } }, 'Superpower': { self: { atk: -1, def: -1 } }, 'Draco Meteor': { self: { spa: -2 } }, 'Overheat': { self: { spa: -2 } },
  'Leaf Storm': { self: { spa: -2 } }, 'Fleur Cannon': { self: { spa: -2 } }, 'Psycho Boost': { self: { spa: -2 } }, 'Make It Rain': { self: { spa: -1 } }, 'Hammer Arm': { self: { spe: -1 } },
  'Ice Hammer': { self: { spe: -1 } }, 'V-create': { self: { def: -1, spd: -1, spe: -1 } }, 'Dragon Ascent': { self: { def: -1, spd: -1 } }, 'Headlong Rush': { self: { def: -1, spd: -1 } },
  'Armor Cannon': { self: { def: -1, spd: -1 } }, 'Spin Out': { self: { spe: -2 } }, 'Clanging Scales': { self: { def: -1 } },
  // attacks that drop the target
  'Rock Tomb': { foe: { spe: -1 }, sec: 1 }, 'Icy Wind': { foe: { spe: -1 }, sec: 1 }, 'Bulldoze': { foe: { spe: -1 }, sec: 1 }, 'Mud Shot': { foe: { spe: -1 }, sec: 1 },
  'Electroweb': { foe: { spe: -1 }, sec: 1 }, 'Low Sweep': { foe: { spe: -1 }, sec: 1 }, 'Glaciate': { foe: { spe: -1 }, sec: 1 }, 'Pounce': { foe: { spe: -1 }, sec: 1 }, 'Drum Beating': { foe: { spe: -1 }, sec: 1 },
  'Snarl': { foe: { spa: -1 }, sec: 1 }, 'Mystical Fire': { foe: { spa: -1 }, sec: 1 }, 'Struggle Bug': { foe: { spa: -1 }, sec: 1 }, 'Skitter Smack': { foe: { spa: -1 }, sec: 1 }, 'Spirit Break': { foe: { spa: -1 }, sec: 1 },
  'Lunge': { foe: { atk: -1 }, sec: 1 }, 'Trop Kick': { foe: { atk: -1 }, sec: 1 }, 'Breaking Swipe': { foe: { atk: -1 }, sec: 1 }, 'Chilling Water': { foe: { atk: -1 }, sec: 1 }, 'Bitter Malice': { foe: { atk: -1 }, sec: 1 },
  'Acid Spray': { foe: { spd: -2 }, sec: 1 }, 'Lumina Crash': { foe: { spd: -2 }, sec: 1 }, 'Apple Acid': { foe: { spd: -1 }, sec: 1 }, 'Grav Apple': { foe: { def: -1 }, sec: 1 },
  'Fire Lash': { foe: { def: -1 }, sec: 1 }, 'Thunderous Kick': { foe: { def: -1 }, sec: 1 }, 'Nuzzle': { status: 'par', sec: 1 },
  // status moves that drop the target
  'Screech': { foe: { def: -2 } }, 'Metal Sound': { foe: { spd: -2 } }, 'Fake Tears': { foe: { spd: -2 } }, 'Charm': { foe: { atk: -2 } }, 'Feather Dance': { foe: { atk: -2 } },
  'Eerie Impulse': { foe: { spa: -2 } }, 'Scary Face': { foe: { spe: -2 } }, 'Cotton Spore': { foe: { spe: -2 } }, 'String Shot': { foe: { spe: -2 } }, 'Growl': { foe: { atk: -1 } },
  'Parting Shot': { foe: { atk: -1, spa: -1 } }, 'Leer': { foe: { def: -1 } }, 'Tail Whip': { foe: { def: -1 } }, 'Noble Roar': { foe: { atk: -1, spa: -1 } }, 'Tickle': { foe: { atk: -1, def: -1 } }, 'Confide': { foe: { spa: -1 } },
  // status
  'Thunder Wave': { status: 'par' }, 'Glare': { status: 'par' }, 'Stun Spore': { status: 'par' }, 'Will-O-Wisp': { status: 'brn' },
  'Spore': { status: 'slp' }, 'Sleep Powder': { status: 'slp' }, 'Hypnosis': { status: 'slp' }, 'Lovely Kiss': { status: 'slp' }, 'Sing': { status: 'slp' }, 'Dark Void': { status: 'slp' }, 'Grass Whistle': { status: 'slp' },
  'Toxic': { status: 'tox' }, 'Poison Powder': { status: 'psn' }
};
// Radical Red: Bitter Malice can frostbite (30%) instead of lowering Attack. Sure (100%) side effects of other
// damaging moves come from the game's own move table.
delete FX['Bitter Malice'];
if (root.RR_MOVES) Object.keys(root.RR_MOVES.sure).forEach(n => { if (!FX[n]) FX[n] = Object.assign({ sec: 1 }, root.RR_MOVES.sure[n]); });
FX['Hyperspace Fury'] = { self: { def: -1 } };
const TRAPS = ['Bind', 'Wrap', 'Fire Spin', 'Clamp', 'Whirlpool', 'Sand Tomb', 'Magma Storm', 'Infestation', 'Snap Trap', 'Thunder Cage'];
const SCREEN_MOVES = { 'Reflect': 'ref', 'Light Screen': 'ls', 'Aurora Veil': 'veil' };
const SCREEN_BREAK = ['Brick Break', 'Psychic Fangs', 'Raging Bull'];
const PHAZE = ['Dragon Tail', 'Circle Throw', 'Roar of Time', 'Roar', 'Whirlwind'];
const RAMPAGE = ['Outrage', 'Thrash', 'Petal Dance'];
const BERRY_TAKE = ['Knock Off', 'Bug Bite', 'Pluck', 'Incinerate'];
const SLEEPERS = ['Spore', 'Sleep Powder', 'Hypnosis', 'Lovely Kiss', 'Sing', 'Dark Void', 'Grass Whistle', 'Yawn'];
const HEALS = ['Recover', 'Roost', 'Slack Off', 'Soft-Boiled', 'Synthesis', 'Moonlight', 'Morning Sun', 'Shore Up', 'Strength Sap', 'Milk Drink', 'Heal Order', 'Wish', 'Rest', 'Lunar Blessing', 'Jungle Healing', 'Life Dew'];
/* ---- recovery: what a move gives back to its user, in % of the user's max HP ----
   Drain moves give back part of the damage dealt (Draining Kiss and Oblivion Wing 3/4, the others 1/2; Big Root +30%;
   the target's Liquid Ooze turns it into damage). Shell Bell gives back 1/8 of the damage. Healing moves: Recover & co.
   1/2; Synthesis, Moonlight and Morning Sun 2/3 in sun and 1/4 in rain, sand or hail; Shore Up 2/3 in sand; Life Dew,
   Jungle Healing and Lunar Blessing 1/4; Rest all of it (then 2 turns asleep); Wish 1/2 of the user's HP at the end of
   the next turn; Strength Sap as much HP as the target's Attack stat (and -1 Attack). Triage: all of these +3 priority. */
function healPct(name, ap, dp, weather, atkStage) {
  const w = weather || '';
  switch (name) {
    case 'Rest': return 100;
    case 'Synthesis': case 'Moonlight': case 'Morning Sun': return /Sun/.test(w) ? 200 / 3 : /Rain|Sand|Hail|Snow/.test(w) ? 25 : 50;
    case 'Shore Up': return /Sand/.test(w) ? 200 / 3 : 50;
    case 'Life Dew': case 'Jungle Healing': case 'Lunar Blessing': return 25;
    case 'Strength Sap': {
      if (!dp || !ap) return 0;
      const sg = Math.max(-6, Math.min(6, atkStage || 0)), mult = sg >= 0 ? (2 + sg) / 2 : 2 / (2 - sg);
      return Math.min(100, dp.rawStats.atk * mult / ap.maxHP() * 100);
    }
    default: return HEALS.includes(name) ? 50 : 0;
  }
}
// Drain and Shell Bell from damage dealt (HP points, lo-hi), capped at what the target has left: % of the user's max HP.
function drainPct(ap, dp, name, lo, hi, cap) {
  const mv = MOVES[name] || {};
  const f = mv.drain ? mv.drain[0] / mv.drain[1] * (ap.item === 'Big Root' ? 1.3 : 1) : 0, bell = ap.item === 'Shell Bell' ? 1 / 8 : 0;
  if (!f && !bell) return null;
  const ooze = !!mv.drain && dp && dp.ability === 'Liquid Ooze';
  const c = x => Math.max(0, cap != null ? Math.min(x, cap) : x), k = (ooze ? (ap.ability === 'Magic Guard' ? 0 : -f) : f) + bell;
  return { lo: c(lo) * k / ap.maxHP() * 100, hi: c(hi) * k / ap.maxHP() * 100, ooze, bell: !!bell && !f };
}
/* recovery(att, def, move, hit, field): for the damage calc. { kind: 'drain'|'heal'|'wish'|'split'|'seed', lo, hi, ooze, triage } */
function recovery(ap, dp, name, h, fld) {
  const mv = MOVES[name]; if (!mv || !ap) return null;
  const triage = ap.ability === 'Triage' && (!!mv.drain || HEALS.includes(name));
  if (h && !h.status && !h.err) {
    const d = h.hi > 0 && dp ? drainPct(ap, dp, name, h.lo, h.hi, dp.curHP()) : null;
    return d ? Object.assign(d, { kind: 'drain', triage }) : triage ? { kind: 'none', triage } : null;
  }
  if (name === 'Pain Split' && dp) { const avg = (ap.curHP() + dp.curHP()) / 2; return { kind: 'split', lo: avg / ap.maxHP() * 100, hi: avg / dp.maxHP() * 100, triage: false }; }
  if (name === 'Leech Seed' && dp) { const g = dp.types.includes('Grass') ? 0 : dp.maxHP() / 8 * (ap.item === 'Big Root' ? 1.3 : 1) / ap.maxHP() * 100; return { kind: 'seed', lo: g, hi: g, ooze: dp.ability === 'Liquid Ooze', immune: dp.types.includes('Grass'), triage: false }; }
  if (HEALS.includes(name)) { const x = healPct(name, ap, dp, fld && fld.weather, dp ? dp.boosts.atk || 0 : 0); return { kind: name === 'Wish' ? 'wish' : 'heal', lo: x, hi: x, rest: name === 'Rest', ooze: name === 'Strength Sap' && dp && dp.ability === 'Liquid Ooze', triage }; }
  return null;
}
const addHeal = (st, side, x) => { if (x > 0 && st.hl) st.hl[side === 'my' ? 'm' : 'f'] += x; };
const PROTECTS = ['Protect', 'Detect', "King's Shield", 'Spiky Shield', 'Baneful Bunker', 'Obstruct', 'Silk Trap', 'Burning Bulwark'];
const BOOMS = ['Explosion', 'Self-Destruct', 'Misty Explosion'];
const HAZARDS = ['Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web'];
const DROP_BLOCK = ['Clear Body', 'White Smoke', 'Full Metal Body', 'Mirror Armor'];

const stArr = (st, side) => (side === 'my' ? st.ma : st.fa);
const zArr = (st, side) => (side === 'my' ? st.ms : st.fs);
const other = side => (side === 'my' ? 'foe' : 'my');
const W = (M, side, k) => (side === 'my' ? M.w[k] || 1 : 0);
// Speed with the stages and any paralysis picked up during the plan (what the Pokémon already had is in the base number).
function spe(M, st, side, k) {
  const V = MW(M, st), base = side === 'my' ? V.sMe[k] : V.sFoe[k], s = (stArr(st, side)[k] || ZERO).spe || 0, p = sideP(M, side, k);
  let v = base * (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
  if (zArr(st, side)[k] === 'par' && p.status !== 'par' && p.ability !== 'Quick Feet') v *= 0.5;
  return Math.floor(v);
}
const hitsOf = (M, st, side, a, d) => MW(M, st).hits(side, a, d, stArr(st, side)[a], stArr(st, other(side))[d], zArr(st, side)[a]);
// Chance a hit doing loP-hiP% (rolls spread evenly) takes at least x%.
const koP = (lo, hi, x) => (hi < x ? 0 : lo >= x || hi <= lo ? 1 : (hi - x) / (hi - lo));
const moves1 = (h, M, st, side, a, d) => goesFirst(h.prio, spe(M, st, side, a), 0, spe(M, st, other(side), d), M.f.tr) > 0;

// Can the status land on this Pokémon?
function statusOK(M, st, side, k, status, name, att) {
  const p = sideP(M, side, k), t = p.types, ab = p.ability;
  if (zArr(st, side)[k] || p.status) return false;
  if (ab === 'Comatose' || ab === 'Purifying Salt') return false;
  if ((ab === 'Magic Bounce' || ab === 'Good as Gold') && isStatus(name)) return false;
  if (['Spore', 'Sleep Powder', 'Stun Spore', 'Poison Powder'].includes(name) && (t.includes('Grass') || ab === 'Overcoat' || p.item === 'Safety Goggles')) return false;
  const terr = MW(M, st).f.terrain;
  if (terr === 'Misty' && grounded(p)) return false; // Misty Terrain: no new status on the ground
  if (status === 'par') return !(t.includes('Electric') && name !== 'Glare') && !(name === 'Thunder Wave' && t.includes('Ground')) && ab !== 'Limber';
  if (status === 'brn') return !t.includes('Fire') && !['Water Veil', 'Water Bubble', 'Thermal Exchange', 'Flash Fire', 'Well-Baked Body'].includes(ab);
  if (status === 'slp') return !['Insomnia', 'Vital Spirit', 'Sweet Veil'].includes(ab) && !(terr === 'Electric' && grounded(p));
  if (status === 'tox' || status === 'psn') return (!(t.includes('Poison') || t.includes('Steel')) || (att && att.ability === 'Corrosion')) && !['Immunity', 'Pastel Veil', 'Poison Heal'].includes(ab);
  if (status === 'frz') return !t.includes('Ice') && ab !== 'Magma Armor'; // frostbite
  return true;
}
// Stat changes landing on a Pokémon (Contrary, Simple, Clear Body & co., Defiant / Competitive).
function changeStages(M, st, side, k, d, fromFoe, log) {
  const p = sideP(M, side, k), arr = stArr(st, side);
  let dd = Object.assign({}, d);
  if (fromFoe) {
    if (DROP_BLOCK.includes(p.ability) || p.item === 'Clear Amulet') return;
    if (p.ability === 'Hyper Cutter') delete dd.atk;
    if (p.ability === 'Big Pecks') delete dd.def;
  }
  if (p.ability === 'Contrary') Object.keys(dd).forEach(s => { dd[s] = -dd[s]; });
  if (p.ability === 'Simple') Object.keys(dd).forEach(s => { dd[s] *= 2; });
  arr[k] = addSt(arr[k] || ZERO, dd);
  if (fromFoe && Object.values(dd).some(v => v < 0)) {
    if (p.ability === 'Defiant') arr[k] = addSt(arr[k], { atk: 2 });
    if (p.ability === 'Competitive') arr[k] = addSt(arr[k], { spa: 2 });
  }
}
// A move's side effects after it lands.
function applyFx(M, st, side, a, d, name, log) {
  const fx = FX[name]; if (!fx) return;
  const ap = sideP(M, side, a), dside = other(side), dp = sideP(M, dside, d);
  const damaging = MOVES[name] && !isStatus(name);
  if (fx.sec && damaging && ap.ability === 'Sheer Force') return;
  if (fx.hp) hpArr(st, side)[a] = Math.max(0.5, hpArr(st, side)[a] - fx.hp);
  if (fx.self && hpArr(st, side)[a] > 0) changeStages(M, st, side, a, fx.self, false, log);
  if (hpArr(st, dside)[d] <= 0) return;
  const shielded = fx.sec && (dp.ability === 'Shield Dust' || dp.item === 'Covert Cloak');
  if (fx.foe && !shielded) changeStages(M, st, dside, d, fx.foe, true, log);
  if (fx.status && !shielded && statusOK(M, st, dside, d, fx.status, name, ap)) {
    if (cureBerry(M, st, dside, d, fx.status, log)) return;
    zArr(st, dside)[d] = fx.status;
    if (fx.status === 'slp') st.sl[dside[0] + d] = dp.ability === 'Early Bird' ? 1 : 2;
    if (fx.status === 'tox') st.tx[dside[0] + d] = 0;
  }
}
// Lum Berry (anything), Chesto (sleep), Rawst (burn), Cheri (paralysis), Pecha (poison): cures the first status, once.
const CURES = { 'Lum Berry': ['slp', 'brn', 'par', 'psn', 'tox', 'frz'], 'Chesto Berry': ['slp'], 'Rawst Berry': ['brn'], 'Cheri Berry': ['par'], 'Pecha Berry': ['psn', 'tox'], 'Aspear Berry': ['frz'] };
const Z_WORD = { slp: 'sleep', brn: 'burn', par: 'paralysis', psn: 'poison', tox: 'poison', frz: 'frostbite', cnf: 'confusion' };
function cureBerry(M, st, side, k, status, log) {
  const p = sideP(M, side, k), key = side[0] + k;
  if (!CURES[p.item] || !CURES[p.item].includes(status) || st.bu[key]) return false;
  st.bu = Object.assign({}, st.bu, { [key]: 1 });
  if (log) note(st, 'cure' + key, { t: 'abil', side, k, text: `${p.item} cures the ${Z_WORD[status]} straight away` });
  return true;
}
// End-of-turn damage from a status picked up during the plan.
function newStatusRes(M, st, side, k) {
  const z = zArr(st, side)[k], p = sideP(M, side, k);
  if (!z || z === p.status || p.ability === 'Magic Guard') return 0;
  if (z === 'brn') return p.ability === 'Heatproof' ? -3.125 : -6.25;
  if (z === 'frz') return -6.25;
  if (z === 'psn') return p.ability === 'Poison Heal' ? 12.5 : -12.5;
  if (z === 'tox') { const key = side[0] + k; st.tx[key] = (st.tx[key] || 0) + 1; return p.ability === 'Poison Heal' ? 12.5 : -6.25 * st.tx[key]; }
  return 0;
}

/* The AI's move, scored the way CFRU does (core.js aiScoreMoves, on the planner's own damage tables):
   +9 KO before you move, +6 KO when you move first, +2 strongest attack, setup when neither side can KO, sleep / paralysis /
   burn / poison when they land, heal at low HP, Fake Out on its first turn. Ties go to the move that hurts you most. */
function foeAct(M, st, j, i) {
  const lk = st.lk && st.lk.f;
  if (lk && lk.k === j && lk.left > 0) { const h = hitsOf(M, st, 'foe', j, i).find(x => x.name === lk.name); if (h) return { name: lk.name, h, tie: null, ko: false, odds: [{ name: lk.name, label: h.label, loP: h.loP, hiP: h.hiP, score: 100, ko: false, p: 1, locked: 1 }] }; }
  const key = sitKey(st, i, j, true);
  M.fm = M.fm || new Map();
  if (M.fm.has(key)) return M.fm.get(key);
  const r = foeAct0(M, st, j, i);
  M.fm.set(key, r);
  return r;
}
function foeAct0(M, st, j, i) {
  const fo = M.foes[j], me = sideP(M, 'my', i), ai = fo.p;
  const hs = hitsOf(M, st, 'foe', j, i), mine = hitsOf(M, st, 'my', i, j);
  const sAi = spe(M, st, 'foe', j), sMe = spe(M, st, 'my', i);
  const kosMe = mine.filter(h => h.hiP >= st.fh[j] && goesFirst(h.prio, sMe, 0, sAi, M.f.tr) > 0);
  const pred = kosMe[0] || mine.reduce((a, h) => (!a || h.hiP > a.hiP ? h : a), null);
  const playerKOs = pred && pred.hiP >= st.fh[j] && goesFirst(pred.prio, sMe, 0, sAi, M.f.tr) > 0;
  const hp = st.fh[j], names = (fo.moves || []).filter(n => MOVES[n]);
  const hasProtect = names.some(n => PROTECTS.includes(n));
  const aiKO = hs.some(h => canKO(M, st, 'my', i, h.hiP, h.cat));
  const rows = names.map(name => {
    const h = hs.find(x => x.name === name), mv = MOVES[name];
    const r = { name, h: h || null, score: 100 };
    if (!isStatus(name)) {
      if (!h || h.hiP <= 0) { r.score = 0; return r; }
      if (name === 'Fake Out' || name === 'First Impression') { if (st.ft > 0) { r.score = 0; return r; } if (name === 'Fake Out' && !['Inner Focus', 'Shield Dust'].includes(me.ability)) r.score += 9; }
      if (name === 'Sucker Punch' && !pred) { r.score = 0; return r; }
      if (BOOMS.includes(name)) { if (hp <= 33 || playerKOs) r.score += 6; }
      const first = goesFirst(h.prio, sAi, pred ? pred.prio : 0, sMe, M.f.tr) > 0;
      const kills = canKO(M, st, 'my', i, h.hiP, h.cat);
      if (kills && first) { r.score += 9; r.ko = 1; } else if (kills && !hasProtect) { r.score += 6; r.ko = 1; } else if (playerKOs && first && h.prio > 0) r.score += 9;
      return r;
    }
    const fx = FX[name], myZ = st.ms[i] || me.status;
    if (me.ability === 'Magic Bounce' && !PROTECTS.includes(name) && !(fx && fx.self) && !HEALS.includes(name)) { r.score = 0; return r; }
    if (fx && fx.status) {
      if (myZ || !statusOK(M, st, 'my', i, fx.status, name, ai)) { r.score = 0; return r; }
      if (fx.status === 'slp') r.score += 3;
      else if (fx.status === 'brn') r.score += me.rawStats.atk >= me.rawStats.spa ? 3 : 1;
      else if (fx.status === 'par') r.score += sMe > sAi ? 3 : 1;
      else r.score += 2;
    } else if (name === 'Yawn') r.score += myZ ? -100 : 3;
    else if (name === 'Leech Seed') r.score += me.types.includes('Grass') || st.seed ? -100 : 2;
    else if (HAZARDS.includes(name)) r.score += st.hz ? -100 : 3;
    else if (fx && fx.self) {
      const maxed = Object.keys(fx.self).every(s => ((st.fa[j] || ZERO)[s] || 0) + (ai.boosts[s] || 0) >= 6);
      const threatened = pred && pred.hiP >= st.fh[j];
      if (maxed) r.score = 0; else if (!aiKO && !threatened) r.score += 3;
    } else if (HEALS.includes(name)) { r.score = hp > 70 ? 0 : hp <= 40 ? 105 : 102; }
    else if (PROTECTS.includes(name)) { if (st.fp) r.score = 0; else if (['brn', 'psn', 'tox'].includes(myZ) || st.seed) r.score += 2; }
    else if (name === 'Trick Room') r.score += M.f.tr ? -100 : sAi < sMe ? 5 : 0;
    else if (name === 'Tailwind') r.score += sAi < sMe ? 4 : 0;
    else if (name === 'Taunt' || name === 'Encore') r.score += 1;
    if (r.score < 0) r.score = 0;
    return r;
  });
  const RM = root.RR_MOVES;
  if (RM && rows.some(r => r.ko && !RM.recharge(r.name))) rows.forEach(r => { if (r.ko && RM.recharge(r.name)) r.score -= 9; });
  const dmg = rows.filter(r => r.h && r.score > 0), maxHi = Math.max(0, ...dmg.map(r => r.h.hiP));
  dmg.forEach(r => { if (r.h.hiP === maxHi && !r.ko && r.score < 109) r.score += 2; });
  const top = Math.max(0, ...rows.map(r => r.score));
  if (top <= 0) return null;
  const best = rows.filter(r => r.score === top);
  const pick = best.filter(r => r.h).sort((a, b) => b.h.hiP - a.h.hiP)[0] || best[0];
  const odds = rows.map(r => ({ name: r.name, label: r.h ? r.h.label : r.name, status: !r.h, loP: r.h ? r.h.loP : 0, hiP: r.h ? r.h.hiP : 0, score: r.score, ko: !!r.ko, p: r.score === top ? 1 / best.length : 0 }));
  return { name: pick.name, h: pick.h, tie: best.length > 1 ? best.map(r => r.name) : null, ko: !!pick.ko, odds };
}
// Two-turn moves: they hit a turn late (Power Herb, or sun for Solar Beam / Solar Blade, makes them instant), so the planner skips them.
const CHARGE = ['Bounce', 'Fly', 'Dig', 'Dive', 'Phantom Force', 'Shadow Force', 'Sky Attack', 'Skull Bash', 'Solar Beam', 'Solar Blade', 'Meteor Beam', 'Electro Shot', 'Freeze Shock', 'Ice Burn', 'Razor Wind', 'Sky Drop', 'Geomancy'];
function usable(M, st, i, h) {
  if (h.name === 'Fake Out' && st.mt > 0) return false;
  if (CHARGE.includes(h.name)) {
    const p = M.mine[i].p;
    if (p.item === 'Power Herb') return true;
    const w = MW(M, st).f.weather || '';
    if (/^Solar/.test(h.name) && /Sun/.test(w)) return true;
    if (h.name === 'Electro Shot' && /Rain/.test(w)) return true;
    return false;
  }
  return true;
}
// Your options this turn: each attack, plus setup / speed control / status moves that do something here.
function myActs(M, st, i, j) {
  const lk = st.lk && st.lk.m;
  if (lk && lk.k === i && lk.left > 0) { const h = hitsOf(M, st, 'my', i, j).find(x => x.name === lk.name); if (h) return [{ name: lk.name, label: h.label, h }]; }
  const hs = hitsOf(M, st, 'my', i, j).filter(h => h.hiP > 0 && usable(M, st, i, h));
  const acts = hs.map(h => ({ name: h.name, label: h.label, h }));
  const me = M.mine[i].p, fp = M.foes[j].p;
  (M.myStatusMoves[i] || []).forEach(n => {
    const fx = FX[n]; if (!fx || accOf(n) < 0.75) return;
    if (fx.status) { if (!statusOK(M, st, 'foe', j, fx.status, n, me) || fp.ability === 'Magic Bounce' || fp.ability === 'Good as Gold') return; }
    else if (fx.self) { const cur = st.ma[i] || ZERO; if (Object.keys(fx.self).every(s => fx.self[s] <= 0 || (cur[s] || 0) + (me.boosts[s] || 0) >= 6)) return; if (fx.hp && st.mh[i] <= fx.hp) return; }
    else if (fx.foe) { if (DROP_BLOCK.includes(fp.ability) || fp.ability === 'Magic Bounce' || ['Defiant', 'Competitive', 'Contrary'].includes(fp.ability)) return; }
    acts.push({ name: n, label: n, h: null });
  });
  (M.myStatusMoves[i] || []).forEach(n => {
    if (HEALS.includes(n) && st.mh[i] <= (n === 'Rest' ? 45 : n === 'Wish' ? 70 : 60) && !(st.wish && st.wish.my && n === 'Wish')) acts.push({ name: n, label: n, h: null });
    if (n === 'Pain Split' && st.mh[i] / 100 * me.maxHP() < st.fh[j] / 100 * fp.maxHP() - 1) acts.push({ name: n, label: n, h: null });
    if (n === 'Leech Seed' && !st.fseed && !fp.types.includes('Grass') && !['Magic Bounce', 'Good as Gold'].includes(fp.ability)) acts.push({ name: n, label: n, h: null });
  });
  return acts;
}
// Greedy attack for the quick look-ahead: a likely KO (moving first if possible), else the most damage on average.
function greedy(M, st, i, j) {
  const hs = hitsOf(M, st, 'my', i, j).filter(h => h.hiP > 0 && usable(M, st, i, h)); if (!hs.length) return null;
  const pk = h => koP(effDmg(M, st, 'foe', j, h.loP), effDmg(M, st, 'foe', j, h.hiP), st.fh[j]) * h.acc;
  const ko = hs.filter(h => pk(h) >= 0.5 && canKO(M, st, 'foe', j, h.hiP, h.cat)).sort((a, b) => (moves1(b, M, st, 'my', i, j) - moves1(a, M, st, 'my', i, j)) || (pk(b) - pk(a)) || (b.loP - a.loP))[0];
  const h = ko || hs.reduce((a, x) => ((x.loP + x.hiP) * x.acc > (a.loP + a.hiP) * a.acc ? x : a), hs[0]);
  return { name: h.name, label: h.label, h };
}
// Quick state copy for the look-ahead (no log).
function miniSt(st) {
  return { i: st.i, j: st.j, mh: st.mh.slice(), fh: st.fh.slice(), ma: st.ma.slice(), fa: st.fa.slice(), ms: st.ms.slice(), fs: st.fs.slice(), sl: Object.assign({}, st.sl), tx: Object.assign({}, st.tx), bu: st.bu, bm: st.bm ? st.bm.slice() : null, bf: st.bf ? st.bf.slice() : null, dg: st.dg ? Object.assign({}, st.dg) : null, risk: st.risk, fp: st.fp, ft: st.ft, mt: st.mt, seed: st.seed, fseed: st.fseed, wish: st.wish, hz: st.hz, out: st.out, log: null, sr: st.sr || 0, sq: st.sq || null, wx: st.wx || null, rc: st.rc || null, trap: st.trap || null, curse: st.curse || null, lk: st.lk || null };
}
// Can't switch out: a trapping move, or the other side's Shadow Tag / Arena Trap / Magnet Pull (Ghosts and Shed Shell get out)
function stuck(M, st, side, k) {
  const p = sideP(M, side, k), o = side === 'my' ? M.foes[st.j] : M.mine[st.i], op = o ? o.p : null;
  if (p.types.includes('Ghost') || p.item === 'Shed Shell') return false;
  const tr = st.trap && st.trap[side[0]];
  if (tr && tr.k === k && tr.left > 0) return true;
  if (!op) return false;
  if (op.ability === 'Shadow Tag' && p.ability !== 'Shadow Tag') return true;
  if (op.ability === 'Arena Trap' && grounded(p)) return true;
  if (op.ability === 'Magnet Pull' && p.types.includes('Steel')) return true;
  return false;
}
/* CFRU's AI switching out mid-fight (ShouldSwitch, singles): before anything else that turn, it swaps out when
   - none of its moves can do anything to you (only bad moves left),
   - Regenerator: it's at half HP or less, you're about to KO it, and it can't KO you first,
   - Natural Cure: it has a status and still half its HP or more,
   - it is about to be KO'd: your expected move KOs it before it moves (and it has more than 20% HP),
   each time only to a teammate that's immune to your move, walls you, resists all your moves, or outspeeds and KOs
   you, and that takes your hit well. Not the turn it came in, not while trapped. Returns { k, why } or null. */
function aiSwitchPick(M, st, i, j) {
  if (st.ft <= 0 || (st.aisw || 0) >= 4 || st.mh[i] <= 0 || stuck(M, st, 'foe', j)) return null;
  const ap = M.foes[j].p, cands = M.foes.map((_, k) => k).filter(k => k !== j && st.fh[k] > 0 && M.group(k) === M.group(j));
  if (!cands.length) return null;
  const mine = hitsOf(M, st, 'my', i, j), sMe = spe(M, st, 'my', i), sAi = spe(M, st, 'foe', j);
  const kosFirst = mine.filter(h => canKO(M, st, 'foe', j, h.hiP, h.cat) && goesFirst(h.prio, sMe, 0, sAi, M.f.tr) > 0);
  const pred = kosFirst[0] || mine.reduce((a, h) => (!a || h.hiP > a.hiP ? h : a), null);
  const predKO = pred && koP(effDmg(M, st, 'foe', j, pred.loP), effDmg(M, st, 'foe', j, pred.hiP), st.fh[j]) * pred.acc >= 0.5;
  const fa = foeAct0(M, st, j, i);
  const aiFirst = fa && fa.h && goesFirst(fa.h.prio, sAi, pred ? pred.prio : 0, sMe, M.f.tr) > 0;
  const aiKOs = fa && fa.h && canKO(M, st, 'my', i, fa.h.hiP, fa.h.cat);
  const rank = cands.map(k => ({ k, r: switchScore(M, st, k, i) })).sort((x, y) => y.r.s - x.r.s);
  const into = k => (pred ? hitsOf(M, st, 'my', i, k).find(x => x.name === pred.name) : null);
  const flags = x => ({ out: x.r.why.includes('it outspeeds'), walls: x.r.why.includes('it walls you'), res: x.r.why.includes('it resists all your moves'), ko: x.r.why.includes('it can KO') });
  const faints = k => hitsOf(M, st, 'my', i, k).some(h => h.hiP >= st.fh[k]);
  const takes = (x) => { const h = into(x.k); if (faints(x.k)) return false; if (!h) return true; return h.hiP < st.fh[x.k] && h.hiP * 2 < st.fh[x.k]; };
  const okSafe = x => { const f = flags(x); return (f.out || f.walls || f.res) && takes(x); };
  if (!fa) { const x = rank.find(okSafe); if (x) return { k: x.k, why: ['none of its moves can hurt you'] }; }
  if (ap.ability === 'Regenerator' && st.fh[j] <= 50 && predKO && !(aiFirst && aiKOs)) { const x = rank.find(y => flags(y).res || flags(y).walls) || rank.find(okSafe); if (x) return { k: x.k, why: ['Regenerator: it heals a third on the way out'] }; }
  if (ap.ability === 'Natural Cure' && zArr(st, 'foe')[j] && st.fh[j] >= 50) { const x = rank.find(y => flags(y).res || flags(y).walls) || rank.find(okSafe); if (x) return { k: x.k, why: ['Natural Cure: switching out cures its status'] }; }
  if (predKO && !aiFirst && st.fh[j] > 20) {
    const x = rank.find(y => { const f = flags(y), h = into(y.k); return ((f.out || f.walls || f.res) && h && h.hiP === 0) || ((f.walls || f.res || (f.ko && f.out)) && takes(y)); });
    if (x) return { k: x.k, why: [`your ${pred.label} would KO it`] };
  }
  return null;
}
// The AI's switch: it goes out (Regenerator / Natural Cure apply), its pick comes in and takes your move this turn.
function aiDoSwitch(M, st, i, j, sw, mm, log, n) {
  log.push({ t: "aiswitch", j, k: sw.k, i, why: sw.why, move: mm && mm.label, n });
  leaveField(M, st, 'foe', j);
  st.fa[j] = ZERO; st.aisw = (st.aisw || 0) + 1;
  st.out = [sw.k]; st.j = sw.k; st.ft = 0; st.fseed = 0; enterFoe(M, st, sw.k, [i], log);
  st.tk = { m: 0, f: 1, mh: 0, fh: 0, mAtk: !!(mm && mm.h), fAtk: false };
  if (mm) { const into = mm.h ? hitsOf(M, st, 'my', i, sw.k).find(x => x.name === mm.name) : null; if (!mm.h || into) act(M, st, 'my', i, sw.k, mm.h ? { name: mm.name, label: mm.label, h: into } : mm, false, log); }
  if (st.mh[i] > 0 && st.fh[sw.k] > 0) endTurn(M, st, i, sw.k);
  st.mt++; st.tn = (st.tn || 0) + 1;
}
// Pick your move: try each option this turn, then play the matchup out greedily; best = you live, it falls, least HP and risk,
// with a small bonus for boosts you carry into the next fight (that is what makes Power-Up Punch or Dragon Dance worth a turn).
// Everything about a one-on-one situation that changes what either side does (HP to 1% or 0.1%).
const dk = (o, k) => (o ? o[k] || '' : '');
function sitKey(st, i, j, fine) {
  const r = fine ? x => Math.round(x * 10) : Math.round;
  return i + ',' + j + '|' + r(st.mh[i]) + ',' + r(st.fh[j]) + '|' + stKey(st.ma[i]) + '|' + stKey(st.fa[j]) + '|' + (st.ms[i] || '') + (st.fs[j] || '') + '|' + dk(st.sl, 'm' + i) + dk(st.sl, 'f' + j) + dk(st.tx, 'm' + i) + dk(st.tx, 'f' + j) + '|' + (st.mt > 0 ? 1 : 0) + (st.ft > 0 ? 1 : 0) + (st.fp ? 1 : 0) + (st.seed ? 1 : 0) + (st.fseed ? 1 : 0) + (st.hz ? 1 : 0) + (st.wish ? JSON.stringify(st.wish) : '') + '|' + dk(st.bu, 'm' + i) + dk(st.bu, 'f' + j) + dk(st.dg, 'm' + i) + dk(st.dg, 'f' + j) + '|' + (st.bm ? (st.bm[i] ? 1 : 0) : 0) + (st.bf ? (st.bf[j] ? 1 : 0) : 0) + '|' + wxKey(st) + dk(st.rc, 'm' + i) + dk(st.rc, 'f' + j) + '|' + JSON.stringify([st.trap || 0, st.curse || 0, st.lk || 0]);
}
function chooseMine(M, st, i, j) {
  // the same situation comes up again and again across the search: remember the answer
  const key = sitKey(st, i, j, false);
  M.cm = M.cm || new Map();
  if (M.cm.has(key)) return M.cm.get(key);
  const best = chooseMine0(M, st, i, j);
  M.cm.set(key, best);
  return best;
}
function chooseMine0(M, st, i, j) {
  const acts = myActs(M, st, i, j);
  if (!acts.length) return null;
  let best = null, bs = Infinity, doom = false;
  for (const a of acts) {
    const s = miniSt(st);
    let n = 0;
    playTurn(M, s, i, j, a, null);
    while (s.mh[i] > 0 && s.fh[j] > 0 && n++ < 6) playTurn(M, s, i, j, greedy(M, s, i, j), null);
    const carry = s.mh[i] > 0 ? STATS.reduce((x, k) => x + Math.max(0, (s.ma[i] || ZERO)[k] || 0) * (k === 'def' || k === 'spd' ? 0.5 : 1.5), 0) : 0;
    const sc = (s.mh[i] <= 0 ? 1000 * W(M, 'my', i) + s.fh[j] * 3 : 0) + (s.fh[j] > 0 ? 300 + s.fh[j] * 3 : 0) + (st.mh[i] - Math.max(0, s.mh[i])) + (s.risk - st.risk + (s.mh[i] > 0 ? (s.sr || 0) - (st.sr || 0) : 0)) * 1000 + n * 8 - carry;
    if (sc < bs) { bs = sc; best = a; doom = s.mh[i] <= 0; }
  }
  // doom: even its best play loses this Pokémon in this matchup (a reason to switch it out while it still has HP)
  return Object.assign({}, best, { doom });
}
// One action resolving. Damage: a KO happens when it's at least 50% likely (rolls x accuracy), otherwise the average roll;
// the leftover chance that it goes wrong (a high roll, a crit, a miss, full paralysis) is added up as risk.
function act(M, st, side, a, d, ac, protectedNow, log) {
  const atk = hpArr(st, side), def = hpArr(st, other(side)), dside = other(side);
  if (!ac || atk[a] <= 0) return;
  const key = side[0] + a, tk = st.tk;
  if (st.rc && st.rc[key]) { st.rc = Object.assign({}, st.rc, { [key]: 0 }); if (log) note(st, 'rc' + key, { t: 'abil', side, k: a, text: 'has to recharge, so it loses a turn' }); if (tk) tk[side[0]] = 1; return; }
  if (zArr(st, side)[a] === 'slp' && st.sl[key] > 0) { st.sl[key]--; if (st.sl[key] === 0) zArr(st, side)[a] = ''; return; }
  if (tk) tk[side[0]] = 1; // it has moved this turn (for flinches and Payback)
  if (zArr(st, side)[a] === 'par' && side === 'my') st.risk += 0.25 * threatP(M, st, a, d) * W(M, 'my', a);
  const mv = MOVES[ac.name] || {};
  if (isStatus(ac.name)) {
    const ap = sideP(M, side, a), dp = sideP(M, dside, d);
    if (ac.name === 'Wish') { st.wish = Object.assign({}, st.wish, { [side]: { left: 2, hp: ap.maxHP() / 2 } }); return; }
    if (ac.name === 'Pain Split') {
      if (def[d] <= 0) return;
      const avg = (atk[a] / 100 * ap.maxHP() + def[d] / 100 * dp.maxHP()) / 2, before = atk[a];
      atk[a] = Math.min(100, avg / ap.maxHP() * 100); def[d] = Math.min(100, avg / dp.maxHP() * 100);
      addHeal(st, side, atk[a] - before);
      return;
    }
    if (WX_MOVE[ac.name] || TX_MOVE[ac.name]) { setWx(M, st, side, a, WX_MOVE[ac.name], TX_MOVE[ac.name], ac.name, log); return; }
    if (SCREEN_MOVES[ac.name]) {
      const w = wxNow(M, st).w; if (ac.name === 'Aurora Veil' && w !== 'Snow' && w !== 'Hail') return;
      const sk = side[0] + SCREEN_MOVES[ac.name], x = Object.assign({}, st.wx || {}), sc = Object.assign({}, x.sc);
      if (sc[sk] > 0) return;
      sc[sk] = ap.item === 'Light Clay' ? 8 : 5; x.sc = sc; st.wx = x;
      if (log && log.push) log.push({ t: 'abil', side, k: a, text: `sets up ${ac.name} for ${sc[sk]} turns` });
      return;
    }
    if (ac.name === 'Haze') { st.ma = st.ma.map(() => ZERO); st.fa = st.fa.map(() => ZERO); if (log && log.push) log.push({ t: 'abil', side, k: a, text: 'uses Haze: every stat change is gone' }); return; }
    if (ac.name === 'Curse') {
      if (ap.types.includes('Ghost')) { if (def[d] <= 0) return; atk[a] = Math.max(0, atk[a] - 50); st.curse = Object.assign({}, st.curse, { [dside[0]]: d + 1 }); return; }
      changeStages(M, st, side, a, { atk: 1, def: 1, spe: -1 }, false, log); return;
    }
    if (PHAZE.includes(ac.name)) { if (def[d] > 0 && dp.ability !== 'Suction Cups') phazed(M, st, dside, d, ac.name, log); return; }
    if (HEALS.includes(ac.name)) {
      const amt = healPct(ac.name, ap, dp, MW(M, st).f.weather, ((stArr(st, dside)[d] || ZERO).atk || 0) + (dp.boosts.atk || 0)), before = atk[a];
      if (ac.name === 'Strength Sap') {
        if (def[d] <= 0) return;
        changeStages(M, st, dside, d, { atk: -1 }, true, log);
        if (dp.ability === 'Liquid Ooze' && ap.ability !== 'Magic Guard') { atk[a] = Math.max(0, atk[a] - amt); return; }
      }
      atk[a] = Math.min(100, atk[a] + amt);
      addHeal(st, side, atk[a] - before);
      if (ac.name === 'Rest') { zArr(st, side)[a] = ''; if (!cureBerry(M, st, side, a, 'slp', log)) { zArr(st, side)[a] = 'slp'; st.sl[key] = 2; } }
      return;
    }
    if (PROTECTS.includes(ac.name)) return;
    if (accOf(ac.name) >= 0.5) applyFx(M, st, side, a, d, ac.name, log);
    if (ac.name === 'Leech Seed' && def[d] > 0 && !dp.types.includes('Grass')) { if (side === 'foe') st.seed = 1; else st.fseed = 1; }
    if (HAZARDS.includes(ac.name)) st.hz = 1;
    return;
  }
  if (protectedNow || !ac.h || def[d] <= 0) return;
  let h = ac.h;
  const hp = def[d], hitMe = side === 'my' ? 'mh' : 'fh';
  // Focus Punch fails if its user was hit first this turn; Avalanche / Revenge double if it was, Payback if the target already moved
  if (h.name === 'Focus Punch' && tk && tk[hitMe]) { if (log) note(st, 'fp' + key, { t: 'abil', side, k: a, text: 'loses its focus: Focus Punch fails after being hit' }); return; }
  if (tk && (h.name === 'Sucker Punch' || h.name === 'Thunderclap' || h.name === 'Upper Hand')) {
    const tAtk = tk[dside[0] + 'Atk'], tPrio = tk[dside[0] + 'Prio'] || 0;
    if (tk[dside[0]] || !tAtk || (h.name === 'Upper Hand' && !(tPrio > 0))) { if (log) note(st, 'sp' + key + (st.tn || 0), { t: 'abil', side, k: a, text: `${h.name} fails: the target wasn't about to attack${h.name === 'Upper Hand' ? ' with a priority move' : ''}` }); return; }
  }
  if (tk && (((h.name === 'Avalanche' || h.name === 'Revenge') && tk[hitMe]) || (h.name === 'Payback' && tk[dside[0]]))) h = Object.assign({}, h, { lo: h.lo * 2, hi: h.hi * 2, loP: h.loP * 2, hiP: h.hiP * 2 });
  const lo = effDmg(M, st, dside, d, h.loP), hi = effDmg(M, st, dside, d, h.hiP);
  const p = canKO(M, st, dside, d, hi, h.cat) ? koP(lo, hi, hp) * h.acc : 0;
  let dmg;
  if (p >= 0.5) {
    dmg = Math.max(h.hiP, hp + 1);
    if (side === 'my' && p < 1) st.risk += (1 - p) * threatP(M, st, a, d) * W(M, 'my', a); // it survives and hits back
  } else {
    dmg = (h.loP + h.hiP) / 2 * (h.acc < 1 ? (h.acc >= 0.5 ? 1 : 0) : 1);
    if (side === 'foe') {
      const c = critChance(sideP(M, side, a), sideP(M, dside, d), h.name);
      const cp = c && canKO(M, st, dside, d, hi * 1.5, h.cat) ? c * koP(lo * 1.5, hi * 1.5, hp) * h.acc : 0;
      const r = p + cp;
      if (r > 0.005) { st.risk += r * W(M, 'my', d); if (log) note(st, 'rk' + d + '|' + a + '|' + h.name, { t: 'risk', i: d, j: a, move: h.label, p: r, why: cp > p ? 'crit' : 'roll' }); }
    }
  }
  const ap = sideP(M, side, a), dp = sideP(M, dside, d), before = def[d];
  strike(M, st, side, a, dside, d, h, dmg);
  // what it actually took off (Sturdy, Disguise and Multiscale included), in HP points: recoil and drain work from that
  const dealt = Math.max(0, before - def[d]) / 100 * dp.maxHP();
  atk[a] = Math.max(0, atk[a] - lifeOrb(ap));
  if (mv.recoil && atk[a] > 0 && ap.ability !== 'Rock Head' && ap.ability !== 'Magic Guard') atk[a] = Math.max(0, atk[a] - dealt * mv.recoil[0] / mv.recoil[1] / ap.maxHP() * 100);
  if (atk[a] > 0 && dealt > 0) {
    const r = drainPct(ap, dp, h.name, dealt, dealt, null);
    if (r && r.lo < 0) { atk[a] = Math.max(0, atk[a] + r.lo); if (log) note(st, 'ooze' + side + a + dside + d, { t: 'abil', side, k: a, text: `loses ${Math.round(-r.lo)}% to ${dp.name}'s Liquid Ooze instead of healing` }); }
    else if (r && r.lo > 0) { const g = Math.min(100 - atk[a], r.lo); atk[a] += g; addHeal(st, side, g); }
  }
  if (BOOMS.includes(h.name)) atk[a] = 0;
  if (tk && def[d] < before) tk[dside === 'my' ? 'mh' : 'fh'] = 1;
  if (def[d] < before || dealt > 0) {
    // trapped for 4 turns (Grip Claw 7): 1/8 a turn (Binding Band 1/6), and no switching out
    if (TRAPS.includes(h.name) && def[d] > 0 && !(st.trap && st.trap[dside[0]])) st.trap = Object.assign({}, st.trap, { [dside[0]]: { k: d, left: ap.item === 'Grip Claw' ? 7 : 4, dmg: ap.item === 'Binding Band' ? 100 / 6 : 12.5 } });
    // Brick Break & co. shatter the target side's screens
    if (SCREEN_BREAK.includes(h.name) && st.wx && st.wx.sc) { const sc = Object.assign({}, st.wx.sc); ['ref', 'ls', 'veil'].forEach(z => { sc[dside[0] + z] = 0; }); st.wx = Object.assign({}, st.wx, { sc }); }
    // Clear Smog wipes the target's stat changes
    if (h.name === 'Clear Smog' && def[d] > 0) stArr(st, dside)[d] = ZERO;
    // Knock Off / Bug Bite / Pluck / Incinerate: its berry is gone (used up)
    if (BERRY_TAKE.includes(h.name) && def[d] > 0 && /Berry$/.test(dp.item || '') && dp.ability !== 'Sticky Hold') {
      const used = dside === 'my' ? (st.bm = st.bm || M.mine.map(() => false)) : (st.bf = st.bf || M.foes.map(() => false));
      if (!used[d]) { used[d] = true; st.bu = Object.assign({}, st.bu, { [dside[0] + d]: 1 }); if (log && log.push) note(st, 'kb' + dside + d, { t: 'abil', side: dside, k: d, text: `loses its ${dp.item} to ${h.name}` }); }
    }
    // Dragon Tail & co. drag the target out
    if (PHAZE.includes(h.name) && def[d] > 0 && atk[a] > 0 && dp.ability !== 'Suction Cups') phazed(M, st, dside, d, h.name, log);
  }
  // Outrage & co.: locked in for another turn
  if (RAMPAGE.includes(h.name) && atk[a] > 0 && !(st.lk && st.lk[side[0]])) st.lk = Object.assign({}, st.lk, { [side[0]]: { k: a, name: h.name, left: 1 } });
  else if (st.lk && st.lk[side[0]] && st.lk[side[0]].name === h.name) { const l = st.lk[side[0]]; st.lk = Object.assign({}, st.lk, { [side[0]]: l.left > 1 ? Object.assign({}, l, { left: l.left - 1 }) : null }); }
  const rc = root.RR_MOVES ? root.RR_MOVES.recharge(h.name) : '';
  if (rc && atk[a] > 0 && (rc === 'always' || def[d] > 0)) st.rc = Object.assign({}, st.rc, { [key]: 1 });
  if (side === 'foe' && def[d] > 0 && atk[a] > 0) secRisk(M, st, a, d, h, log);
  berries(M, st);
  applyFx(M, st, side, a, d, h.name, log);
}
/* Dragon Tail / Circle Throw / Roar of Time / Roar / Whirlwind: the target is dragged out and a random teammate comes in.
   The plan can't pick a random Pokémon, so it keeps the target in with its stat changes gone, and says so. */
function phazed(M, st, side, k, move, log) {
  stArr(st, side)[k] = ZERO;
  if (log && log.push) note(st, 'phz' + side + k + move, { t: 'abil', side, k, text: `is dragged out by ${move}: in the game a random teammate comes in (the plan keeps it in, with its stat changes gone)` });
}
/* Chance side effects of its hit on your Pokémon d (the game's own chances: Serene Grace doubles them; Sheer Force,
   Shield Dust and Covert Cloak cancel them). A flinch before you move costs you the turn: counted like full paralysis,
   as the chance its next hit KOs you (risk of a loss). A burn, frostbite, paralysis, poison, sleep or confusion weakens
   you for the rest of the fight: counted as a smaller side-effect risk (st.sr) that steers the plan but isn't a loss. */
const SEC_SEV = { brn: 0.08, frz: 0.08, par: 0.12, psn: 0.08, tox: 0.12, slp: 0.4, cnf: 0.12 };
function secRisk(M, st, a, d, h, log) {
  const RM = root.RR_MOVES; if (!RM) return;
  const ap = M.foes[a].p, dp = M.mine[d].p;
  if (ap.ability === 'Sheer Force' || dp.ability === 'Shield Dust' || dp.item === 'Covert Cloak') return;
  const list = (RM.sec(h.name) || []).slice(), acc = h.acc || 1, sg = ap.ability === 'Serene Grace' ? 2 : 1;
  if (!list.some(x => x[0] === 'flinch') && (['King\'s Rock', 'Razor Fang'].includes(ap.item) || ap.ability === 'Stench')) list.push(['flinch', 10]);
  if (!list.length) return;
  let mine = null;
  for (const [kind, pc] of list) {
    const c = Math.min(1, pc * sg / 100) * acc;
    if (c <= 0 || (kind !== 'flinch' && c >= 1 && FX[h.name] && FX[h.name].status === kind)) continue; // a sure status is played out, not a risk
    if (kind === 'flinch') {
      if (dp.ability === 'Inner Focus' || !st.tk || st.tk.m || (st.rc && st.rc['m' + d]) || (zArr(st, 'my')[d] === 'slp' && st.sl['m' + d] > 0)) continue; // only before you have moved this turn (and could)
      const r = c * threatP(M, st, d, a) * W(M, 'my', d);
      if (r > 0.002) { st.risk += r; if (log) note(st, 'fl' + d + '|' + a + '|' + h.name, { t: 'risk', i: d, j: a, move: h.label, p: c, why: 'flinch' }); }
      continue;
    }
    if (/-1$|^self\+/.test(kind)) {
      // a chance stat drop on your Pokémon, or a chance boost for theirs: counted when it's a stat that matters here
      if (!mine) { const hs = hitsOf(M, st, 'my', d, a); mine = hs.reduce((x, y) => (!x || y.hiP > x.hiP ? y : x), null); }
      const ths = hitsOf(M, st, 'foe', a, d), theirs = ths.reduce((x, y) => (!x || y.hiP > x.hiP ? y : x), null);
      const stat = kind.replace(/-1$/, '').replace(/^self\+/, ''), me = spe(M, st, 'my', d), it = spe(M, st, 'foe', a);
      let sev = 0;
      if (kind.startsWith('self+')) {
        if ((stat === 'atk' || stat === 'all') && theirs && theirs.cat === 'Physical') sev = 0.06;
        if ((stat === 'spa' || stat === 'all') && theirs && theirs.cat === 'Special') sev = 0.06;
        if ((stat === 'spe' || stat === 'all') && it <= me && it * 1.5 > me) sev = Math.max(sev, 0.08);
      } else {
        if (DROP_BLOCK.includes(dp.ability) || dp.item === 'Clear Amulet' || dp.ability === 'Contrary') continue;
        if ((stat === 'atk' && mine && mine.cat === 'Physical') || (stat === 'spa' && mine && mine.cat === 'Special')) sev = 0.06;
        if (stat === 'spe' && me > it && me * 2 / 3 <= it) sev = 0.08;
        if ((stat === 'def' && theirs && theirs.cat === 'Physical') || (stat === 'spd' && theirs && theirs.cat === 'Special')) sev = 0.04;
      }
      if (!sev) continue;
      const sk = 'm' + d + '|' + kind + (kind.startsWith('self+') ? a : ''), left = st.sq && st.sq[sk] != null ? st.sq[sk] : 1;
      st.sq = Object.assign({}, st.sq, { [sk]: left * (1 - c) });
      const r = left * c * sev * W(M, 'my', d);
      if (r > 0.002) { st.sr = (st.sr || 0) + r; if (log) note(st, 'sr' + d + '|' + a + '|' + h.name + kind, { t: 'srisk', i: d, j: a, move: h.label, p: c, kind }); }
      continue;
    }
    if (kind === 'cnf' ? dp.ability === 'Own Tempo' : !statusOK(M, st, 'my', d, kind, h.name, ap)) continue;
    if (kind !== 'cnf' && CURES[dp.item] && CURES[dp.item].includes(kind) && !(st.bu && st.bu['m' + d])) continue; // its berry would cure it
    let sev = SEC_SEV[kind] || 0.08;
    if (kind === 'brn' || kind === 'frz' || kind === 'par') {
      if (!mine) { const hs = hitsOf(M, st, 'my', d, a); mine = hs.reduce((x, y) => (!x || y.hiP > x.hiP ? y : x), null); }
      if (kind === 'brn' && mine && mine.cat === 'Physical' && dp.ability !== 'Guts') sev = 0.3; // halves its physical attacks
      if (kind === 'frz' && mine && mine.cat === 'Special') sev = 0.3; // frostbite halves its special attacks
      if (kind === 'par' && dp.ability !== 'Quick Feet' && spe(M, st, 'my', d) > spe(M, st, 'foe', a) && spe(M, st, 'my', d) / 2 <= spe(M, st, 'foe', a)) sev = 0.3; // it would lose the speed race
    }
    // a status lands once: what counts is the chance it happens now for the first time (st.sq: chance it hasn't yet)
    const sk = 'm' + d + '|' + kind, left = st.sq && st.sq[sk] != null ? st.sq[sk] : 1;
    st.sq = Object.assign({}, st.sq, { [sk]: left * (1 - c) });
    const r = left * c * sev * W(M, 'my', d);
    if (r > 0.002) { st.sr = (st.sr || 0) + r; if (log) note(st, 'sr' + d + '|' + a + '|' + h.name + kind, { t: 'srisk', i: d, j: a, move: h.label, p: c, kind, big: sev >= 0.3 }); }
  }
}
// Chance its strongest hit KOs your Pokémon i from where it is now (for "what if my KO fails / I'm fully paralysed").
function threatP(M, st, i, j) {
  if (st.fh[j] <= 0) return 0;
  const hs = hitsOf(M, st, 'foe', j, i);
  return Math.max(0, ...hs.map(h => (canKO(M, st, 'my', i, h.hiP, h.cat) ? koP(h.loP, h.hiP, st.mh[i]) * h.acc : 0)));
}
// Priority of a status move: Triage +3 for healing moves, Prankster +1, Teleport -6.
function statusPrio(M, side, k, name) {
  const p = sideP(M, side, k), mv = MOVES[name] || {};
  let pr = name === 'Teleport' ? -6 : mv.priority || 0;
  if (p.ability === 'Triage' && HEALS.includes(name)) pr += 3;
  if (p.ability === 'Prankster') pr += 1;
  return pr;
}
// One full turn: order by priority and Speed, Fake Out flinches, Protect blocks, then end-of-turn damage.
const AI_PIVOTS = ['U-turn', 'Volt Switch', 'Flip Turn', 'Parting Shot', 'Teleport'];
function playTurn(M, st, i, j, mine, log, theirs) {
  const fa = theirs !== undefined ? theirs : foeAct(M, st, j, i);
  st.hl = { m: 0, f: 0 }; // healing this turn, for the write-up
  st.tk = { m: 0, f: 0, mh: 0, fh: 0, mAtk: !!(mine && mine.h), fAtk: !!(fa && fa.h), mPrio: mine && mine.h ? mine.h.prio || 0 : 0, fPrio: fa && fa.h ? fa.h.prio || 0 : 0 }; // this turn so far: who has moved (m, f), who has been hit (mh, fh), who is attacking
  const mp = mine && mine.h ? mine.h.prio : (mine ? statusPrio(M, 'my', i, mine.name) : 0);
  const fpri = fa ? (fa.h ? fa.h.prio : statusPrio(M, 'foe', j, fa.name)) : 0;
  const meFirst = goesFirst(mp, spe(M, st, 'my', i), fpri, spe(M, st, 'foe', j), M.f.tr) > 0;
  const noFlinch = p => ['Inner Focus', 'Shield Dust'].includes(p.ability) || p.item === 'Covert Cloak';
  const foeProt = fa && PROTECTS.includes(fa.name) && !st.fp, myFlinch = fa && fa.name === 'Fake Out' && !meFirst && !noFlinch(M.mine[i].p);
  const foeFlinch = mine && mine.name === 'Fake Out' && mine.h && mine.h.hiP > 0 && meFirst && !foeProt && !noFlinch(M.foes[j].p);
  const myTurn = () => { if (!myFlinch) act(M, st, 'my', i, j, mine, foeProt, log); };
  const theirTurn = () => {
    if (foeFlinch && st.fh[j] > 0) { if (log && log.push) log.push({ t: 'abil', side: 'foe', k: j, text: 'flinches from Fake Out and loses its turn' }); return; }
    act(M, st, 'foe', j, i, fa, false, log);
  };
  if (meFirst) { myTurn(); theirTurn(); } else { theirTurn(); myTurn(); }
  st.fp = foeProt ? 1 : 0;
  // its U-turn / Volt Switch / Flip Turn / Parting Shot / Teleport: it switches to its best answer (CFRU picks the most suitable)
  if (log && fa && AI_PIVOTS.includes(fa.name) && st.fh[j] > 0 && st.mh[i] > 0 && st.tk.f && !foeFlinch && (isStatus(fa.name) || st.tk.mh)) {
    const nx = nextFoe(M, Object.assign({}, st, { out: [j] }), [i]);
    if (nx.k >= 0 && nx.k !== j) { log.push({ t: 'aiswitch', j, k: nx.k, i, why: [fa.name], pivot: 1 }); leaveField(M, st, 'foe', j); st.fa[j] = ZERO; st.j = nx.k; st.out = [nx.k]; st.ft = -1; st.fseed = 0; enterFoe(M, st, nx.k, [i], log); j = nx.k; }
  }
  const { rMe, rFoe } = endTurn(M, st, i, j);
  st.ft++; st.mt++;
  return { fa, meFirst, rMe, rFoe };
}
/* End of turn: weather, status, Leftovers & co. (M.res), a status picked up during the plan, Leech Seed (1/8 of the
   seeded one's HP goes to the other side: Big Root +30%, Liquid Ooze hurts instead), Wish landing, then berries. */
function endTurn(M, st, i, j) {
  const V = MW(M, st), rMe = V.res.my[i], rFoe = V.res.foe[j], me = M.mine[i].p, fo = M.foes[j].p;
  let dMe = 0, dFoe = 0;
  if (st.seed && st.mh[i] > 0 && me.ability !== 'Magic Guard') {
    dMe -= 12.5;
    if (st.fh[j] > 0) { const g = 12.5 * me.maxHP() / fo.maxHP() * (fo.item === 'Big Root' ? 1.3 : 1); dFoe += me.ability === 'Liquid Ooze' ? -g : g; }
  }
  if (st.fseed && st.fh[j] > 0 && fo.ability !== 'Magic Guard') {
    dFoe -= 12.5;
    if (st.mh[i] > 0) { const g = 12.5 * fo.maxHP() / me.maxHP() * (me.item === 'Big Root' ? 1.3 : 1); dMe += fo.ability === 'Liquid Ooze' ? -g : g; }
  }
  // trapping moves (1/8, 1/6 with Binding Band) and Curse (1/4) on whoever is in
  const tr = st.trap || {}, cu = st.curse || {};
  if (tr.m && tr.m.k === i && tr.m.left > 0 && me.ability !== 'Magic Guard') { dMe -= tr.m.dmg; st.trap = Object.assign({}, st.trap, { m: tr.m.left > 1 ? Object.assign({}, tr.m, { left: tr.m.left - 1 }) : null }); }
  if (tr.f && tr.f.k === j && tr.f.left > 0 && fo.ability !== 'Magic Guard') { dFoe -= tr.f.dmg; st.trap = Object.assign({}, st.trap, { f: tr.f.left > 1 ? Object.assign({}, tr.f, { left: tr.f.left - 1 }) : null }); }
  if (cu.m === i + 1 && me.ability !== 'Magic Guard') dMe -= 25;
  if (cu.f === j + 1 && fo.ability !== 'Magic Guard') dFoe -= 25;
  if (st.mh[i] > 0) { const b = st.mh[i]; st.mh[i] = Math.max(0, Math.min(100, st.mh[i] + rMe.net + newStatusRes(M, st, 'my', i) + dMe)); if (dMe > 0) addHeal(st, 'my', st.mh[i] - b > 0 ? Math.min(dMe, st.mh[i] - b) : 0); }
  if (st.fh[j] > 0) { st.fh[j] = Math.max(0, Math.min(100, st.fh[j] + rFoe.net + newStatusRes(M, st, 'foe', j) + dFoe)); if (dFoe > 0) addHeal(st, 'foe', dFoe); }
  if (st.wish) {
    const w = Object.assign({}, st.wish);
    ['my', 'foe'].forEach(sd => {
      if (!w[sd]) return;
      if (w[sd].left > 1) { w[sd] = { left: w[sd].left - 1, hp: w[sd].hp }; return; }
      const arr = hpArr(st, sd), k = sd === 'my' ? i : j, p = sideP(M, sd, k);
      if (arr[k] > 0) { const g = Math.min(100 - arr[k], w[sd].hp / p.maxHP() * 100); arr[k] += g; addHeal(st, sd, g); }
      delete w[sd];
    });
    st.wish = Object.keys(w).length ? w : null;
  }
  berries(M, st);
  tickWx(st);
  return { rMe, rFoe };
}
const ABSORBS = { Water: ['Water Absorb', 'Storm Drain', 'Dry Skin'], Electric: ['Volt Absorb', 'Lightning Rod', 'Motor Drive'], Fire: ['Flash Fire', 'Well-Baked Body'], Grass: ['Sap Sipper'], Ground: ['Earth Eater', 'Levitate'] };
function absorber(M, st, mv) {
  const list = ABSORBS[mv.type] || [];
  return M.foes.findIndex((fo, k) => k !== st.j && st.fh[k] > 0 && !st.out.includes(k) && list.includes(fo.p.ability) && M.group(k) === M.group(st.j));
}
// CFRU switch-in score of foe k coming in against your Pokémon i.
function switchScore(M, st, k, i) {
  M = MW(M, st);
  const theirBest = Math.max(0, ...M.hits('foe', k, i, ZERO, st.ma[i]).map(h => h.hiP));
  const mine = M.hits('my', i, k, st.ma[i] || ZERO), myBest = Math.max(0, ...mine.map(h => h.hiP));
  const outspeeds = goesFirst(0, M.sFoe[k], 0, st.ms ? spe(M, st, 'my', i) : M.sMe[i], M.f.tr) > 0;
  const koYou = theirBest >= st.mh[i], faints = myBest >= st.fh[k];
  const dmg = mine.filter(h => h.hi > 0);
  const resistAll = mine.length > 0 && mine.every(h => h.hi === 0 || eff(h.type, M.foes[k].p.types) < 1);
  const se = dmg.filter(h => eff(h.type, M.foes[k].p.types) > 1).length;
  let s = 0; const why = [];
  if (koYou) { s += 31; why.push('it can KO'); }
  if (koYou && outspeeds) s += 8;
  if (outspeeds) { s += 14; why.push('it outspeeds'); }
  if (resistAll) { s += 17; why.push('it resists all your moves'); }
  if (se === 0 && dmg.every(h => h.hiP < 34)) { s += 2; why.push('it walls you'); }
  if (!koYou && theirBest * 2 >= st.mh[i]) s += 2;
  if (faints) s -= outspeeds ? 15 : 39;
  s -= se;
  return { s, why };
}
/* The AI tends to switch an attacker out when its attacking stat is low (CFRU ShouldSwitchWhenOffensiveStatsAreLow at -3;
   in Radical Red players see it from -2, as a likelihood rather than a rule): Attack down and only physical moves,
   Sp. Atk down and only special moves, or both down; only when your Pokémon can't KO it right now, and only to a
   teammate that walls you, resists all your moves, or outspeeds you and takes your hit well. Returns { k, why } or null. */
const DROP_AT = -2;
function dropSwitch(M, st, i, j) {
  const fo = M.foes[j], p = fo.p, s = st.fa[j] || ZERO;
  const atk = (s.atk || 0) + (p.boosts.atk || 0), spa = (s.spa || 0) + (p.boosts.spa || 0);
  if (atk > DROP_AT && spa > DROP_AT) return null;
  const dmg = (fo.moves || []).filter(n => MOVES[n] && !isStatus(n) && !['Counter', 'Mirror Coat', 'Metal Burst', 'Body Press', 'Foul Play'].includes(n));
  if (dmg.length < 2) return null; // not an attacker
  const phys = dmg.some(n => MOVES[n].category === 'Physical'), spec = dmg.some(n => MOVES[n].category === 'Special');
  let why = '';
  if (atk <= DROP_AT && phys && !spec) why = `its Attack is down ${-atk}`;
  else if (spa <= DROP_AT && spec && !phys) why = `its Sp. Atk is down ${-spa}`;
  else if (atk <= DROP_AT && spa <= DROP_AT) why = `its Attack and Sp. Atk are down`;
  if (!why) return null;
  if (hitsOf(M, st, 'my', i, j).some(h => canKO(M, st, 'foe', j, h.hiP, h.cat))) return null;
  let best = null, bs = -1e9;
  M.foes.forEach((_, k) => {
    if (k === j || st.fh[k] <= 0 || M.group(k) !== M.group(j)) return;
    const r = switchScore(M, st, k, i), mine = Math.max(0, ...hitsOf(M, st, 'my', i, k).map(h => h.hiP));
    const ok = r.why.includes('it walls you') || r.why.includes('it resists all your moves') || (r.why.includes('it outspeeds') && mine < st.fh[k] && mine < 50);
    if (ok && r.s > bs) { bs = r.s; best = { k, why }; }
  });
  return best;
}
/* Its next Pokémon: the best switch-in score against any of your Pokémon on the field (from the fainted one's trainer in a
   two-trainer battle). Doubles: pass diag = your Pokémon diagonal to the slot that emptied (their left faces your left
   across the field, CFRU's FOE()): the AI scores its options against that one first, so that's who baits the
   replacement; your other Pokémon only breaks ties. When the diagonal one is gone too, it's the other one. */
function nextFoe(M, st, against, from, diag) {
  let best = -1, bs = -1e9, bwhy = [], bvs = -1;
  if (diag != null && diag >= 0 && st.mh[diag] > 0) {
    const others = against.filter(i => i >= 0 && i !== diag && st.mh[i] > 0);
    M.foes.forEach((_, k) => {
      if (st.fh[k] <= 0 || st.out.includes(k)) return;
      if (from != null && from >= 0 && M.group(k) !== M.group(from)) return;
      const r = switchScore(M, st, k, diag), tie = others.length ? Math.max(...others.map(i => switchScore(M, st, k, i).s)) / 1000 : 0;
      if (r.s + tie > bs) { bs = r.s + tie; best = k; bwhy = r.why; bvs = diag; }
    });
    return { k: best, why: bwhy, vs: bvs, diag: true };
  }
  M.foes.forEach((_, k) => {
    if (st.fh[k] <= 0 || st.out.includes(k)) return;
    if (from != null && from >= 0 && M.group(k) !== M.group(from)) return;
    against.filter(i => i >= 0 && st.mh[i] > 0).forEach(i => { const r = switchScore(M, st, k, i); if (r.s > bs) { bs = r.s; best = k; bwhy = r.why; bvs = i; } });
  });
  return { k: best, why: bwhy, vs: bvs };
}
// Old-style strongest-hit pick, for the danger notes.
function foeMove(M, st, j, i) {
  M = MW(M, st);
  const hs = M.hits('foe', j, i, st.fa[j]).filter(h => h.hiP > 0); if (!hs.length) return null;
  const ko = hs.filter(h => canKO(M, st, 'my', i, h.hiP, h.cat))[0];
  return ko || hs.reduce((a, h) => (h.hiP > a.hiP ? h : a), hs[0]);
}

function fight(M, st, logIn) {
  const log = logIn || [];
  let turns = 0, absorbed = false, lastMine = null, lastFoe = null;
  while (st.mh[st.i] > 0 && st.fh[st.j] > 0 && turns < MAX_TURNS) {
    const i = st.i, j = st.j;
    const mm = chooseMine(M, st, i, j), fa = foeAct(M, st, j, i);
    if (mm && mm.h && !absorbed) {
      const ab = absorber(M, st, mm.h);
      if (ab >= 0) {
        absorbed = true;
        log.push({ t: 'absorb', j, k: ab, i, move: mm.label, ability: M.foes[ab].p.ability });
        st.out = [ab]; st.j = ab; st.ft = 0; st.fseed = 0; enterFoe(M, st, ab, [i], log); continue;
      }
    }
    // an attacker whose attacking stat is down 2 is more likely (not certain) to be switched out: the plan doesn't count
    // on it, it says where it would most likely go and what your move would hit then
    if (log !== NOLOG && st.ft > 0) {
      const sw = dropSwitch(M, st, i, j);
      if (sw) note(st, 'aimay' + i + '|' + j, { t: 'aimay', j, k: sw.k, i, why: sw.why, move: mm && mm.label });
    }
    if (!mm && !(fa && fa.h)) { st.stall = true; break; }
    /* Decision points (Set mode, so every switch costs a hit): it is about to KO you and you don't KO it first, or this
       Pokémon has just come in and loses the matchup even with its best play. Asked once per turn, and at most
       4 switches against the same Pokémon so the plan can't go round in circles. */
    if (logIn && !(st.asked && st.asked[i + '-' + j + '-' + (st.tn || 0)]) && (!st.swc || (st.swc[j] || 0) < 4) && st.mh.some((h, k) => h > 0 && k !== i)) {
      const mk1 = mm && mm.h && moves1(mm.h, M, st, 'my', i, j) && canKO(M, st, 'foe', j, mm.h.hiP, mm.h.cat) && koP(mm.h.loP, mm.h.hiP, st.fh[j]) >= 0.5;
      const threat = fa && fa.ko && fa.h && !mk1, doom = st.mt === 0 && mm && mm.doom;
      if (threat || doom) { st.pending = 'threat'; st.why = threat ? 'ko' : 'doom'; return; }
    }
    const sw = aiSwitchPick(M, st, i, j);
    if (sw) { turns++; aiDoSwitch(M, st, i, j, sw, mm, log, turns); continue; }
    turns++;
    const sAi = spe(M, st, 'foe', j), sMe = spe(M, st, 'my', i);
    const fh = fa && fa.h, mh = mm && mm.h;
    const meFirst = !fa || goesFirst(mh ? mh.prio : 0, sMe, fh ? fh.prio : 0, sAi, M.f.tr) > 0;
    const aiKill = fh && canKO(M, st, 'my', i, fh.hiP, fh.cat) ? (meFirst ? 'slow' : 'fast') : fh && fh.hiP - MW(M, st).res.my[i].net >= st.mh[i] ? 'residual' : '';
    const pk = mh ? koP(effDmg(M, st, 'foe', j, mh.loP), effDmg(M, st, 'foe', j, mh.hiP), st.fh[j]) * mh.acc : 0;
    const myKill = mh && canKO(M, st, 'foe', j, mh.hiP, mh.cat) && pk > 0 ? (pk < 0.5 ? 'roll' : meFirst ? 'fast' : 'slow') : '';
    if (log === NOLOG) { playTurn(M, st, i, j, mm, log, fa); st.tn = (st.tn || 0) + 1; continue; }
    const before = { ma: Object.assign({}, st.ma[i]), fa: Object.assign({}, st.fa[j]), ms: st.ms[i], fs: st.fs[j] };
    const at = log.length;
    const r = playTurn(M, st, i, j, mm, log, fa);
    const chg = { my: diffSt(before.ma, st.ma[i]), foe: diffSt(before.fa, st.fa[j]), myZ: st.ms[i] !== before.ms ? st.ms[i] : '', foeZ: st.fs[j] !== before.fs ? st.fs[j] : '' };
    const hl = st.hl || { m: 0, f: 0 };
    if (turns === 1 || (mm && lastMine !== mm.name) || chg.my || chg.foe || chg.myZ || chg.foeZ || (fa && fa.name !== lastFoe) || hl.m >= 5 || hl.f >= 5)
      log.splice(at, 0, { t: 'fight', heal: { me: hl.m, foe: hl.f }, n: turns, i, j, mm: mm && mm.label, setup: mm && !mm.h, fm: fa && (fa.h ? fa.h.label : fa.name), fmStatus: fa && !fa.h, tie: fa && fa.tie, fmHi: fh ? fh.hiP : 0, mmLo: mh ? mh.loP : 0, mmHi: mh ? mh.hiP : 0, meFirst: r.meFirst, aiKill, myKill, pk, chg, mhp: st.mh[i], fhp: st.fh[j], resMe: turns === 1 ? r.rMe : null, resFoe: turns === 1 ? r.rFoe : null });
    lastMine = mm ? mm.name : null; lastFoe = fa ? fa.name : null;
    st.tn = (st.tn || 0) + 1;
  }
  if (turns >= MAX_TURNS && st.mh[st.i] > 0 && st.fh[st.j] > 0) st.stall = true;
}
const diffSt = (a, b) => { const d = {}; let any = false; STATS.forEach(k => { const v = ((b || ZERO)[k] || 0) - ((a || ZERO)[k] || 0); if (v) { d[k] = v; any = true; } }); return any ? d : null; };

function cloneSt(st) {
  return { i: st.i, j: st.j, act: st.act ? st.act.slice() : null, out: st.out.slice(), mh: st.mh.slice(), fh: st.fh.slice(), ma: st.ma.slice(), fa: st.fa.slice(), ms: st.ms ? st.ms.slice() : [], fs: st.fs ? st.fs.slice() : [], sl: Object.assign({}, st.sl), tx: Object.assign({}, st.tx), bu: st.bu || {}, risk: st.risk || 0, fp: st.fp, ft: st.ft, mt: st.mt, seed: st.seed, fseed: st.fseed, wish: st.wish, hz: st.hz, asked: Object.assign({}, st.asked), tn: st.tn || 0, swc: Object.assign({}, st.swc), why: st.why, log: st.log.slice(), lost: st.lost.slice(), stall: st.stall, done: st.done, won: st.won, pending: st.pending, quiet: st.quiet, slot: st.slot, turn: st.turn, fresh: st.fresh ? st.fresh.slice() : [], start: st.start, bm: st.bm ? st.bm.slice() : null, bf: st.bf ? st.bf.slice() : null, dg: st.dg ? Object.assign({}, st.dg) : null, seen: st.seen ? Object.assign({}, st.seen) : null, w: st.w, sr: st.sr || 0, sq: st.sq || null, wx: st.wx || null, rc: st.rc || null, trap: st.trap || null, curse: st.curse || null, lk: st.lk || null, aisw: st.aisw || 0 };
}
// Lower is better: a weighted death (starred Pokémon count 3x) is 1000, a % chance of one is 10 per %, then HP lost and their HP left.
function cost(st) {
  const w = st.w || [];
  const lost = st.lost.reduce((a, i) => a + (w[i] || 1), 0), hpLost = st.mh.reduce((a, h, i) => a + (st.start[i] - h), 0);
  const left = st.fh.reduce((a, h) => a + h, 0);
  return (st.done && !st.won ? 1e6 : 0) + (st.stall ? 5e4 : 0) + lost * 1000 + ((st.risk || 0) + (st.sr || 0)) * 1000 + hpLost + left * 3;
}
/* Scored play-outs (st.quiet) stay in every matchup, so a matchup from the same situation always ends the same way:
   its result is remembered (per plan) and reused, which makes scoring thousands of play-outs cheap. */
function fightQuiet(M, st) {
  const i = st.i, j = st.j;
  if (i < 0 || j < 0) { fight(M, st, null); return; }
  const alive = st.fh.map(h => (h > 0 ? 1 : 0)).join('');
  const key = sitKey(st, i, j, false) + '|' + alive; // HP to 1%: only used to rank lines
  M.fq = M.fq || new Map();
  let r = M.fq.get(key);
  if (!r) {
    const c = cloneSt(st); c.log = NOLOG;
    fight(M, c, null);
    if (c.j !== j) { Object.assign(st, c, { log: st.log }); return; } // it switched to an absorber: not reusable
    const g = (o, k) => (o ? o[k] : undefined);
    r = { mh: c.mh[i], fh: c.fh[j], ma: c.ma[i], fa: c.fa[j], ms: c.ms[i], fs: c.fs[j],
      sl: [g(c.sl, 'm' + i), g(c.sl, 'f' + j)], tx: [g(c.tx, 'm' + i), g(c.tx, 'f' + j)], bu: [g(c.bu, 'm' + i), g(c.bu, 'f' + j)], dg: [g(c.dg, 'm' + i), g(c.dg, 'f' + j)],
      bm: c.bm ? c.bm[i] : undefined, bf: c.bf ? c.bf[j] : undefined, risk: (c.risk || 0) - (st.risk || 0), fp: c.fp, ft: c.ft - st.ft, mt: c.mt - st.mt,
      seed: c.seed, fseed: c.fseed, wish: c.wish, hz: c.hz, tn: (c.tn || 0) - (st.tn || 0), stall: c.stall,
      sr: (c.sr || 0) - (st.sr || 0), wx: c.wx || null, rc: [g(c.rc, 'm' + i), g(c.rc, 'f' + j)],
      sq: c.sq ? Object.keys(c.sq).filter(k => k.startsWith('m' + i + '|')).reduce((o, k) => { o[k] = c.sq[k]; return o; }, {}) : null,
      trap: c.trap || null, curse: c.curse || null, lk: c.lk || null };
    M.fq.set(key, r);
  }
  const put = (o, k, v) => (v === undefined ? o : Object.assign({}, o, { [k]: v }));
  st.mh[i] = r.mh; st.fh[j] = r.fh; st.ma[i] = r.ma; st.fa[j] = r.fa; st.ms[i] = r.ms; st.fs[j] = r.fs;
  st.sl = put(put(st.sl || {}, 'm' + i, r.sl[0]), 'f' + j, r.sl[1]);
  st.tx = put(put(st.tx || {}, 'm' + i, r.tx[0]), 'f' + j, r.tx[1]);
  st.bu = put(put(st.bu || {}, 'm' + i, r.bu[0]), 'f' + j, r.bu[1]);
  st.dg = put(put(st.dg || {}, 'm' + i, r.dg[0]), 'f' + j, r.dg[1]);
  if (r.bm !== undefined) { st.bm = st.bm || M.mine.map(() => false); st.bm[i] = r.bm; }
  if (r.bf !== undefined) { st.bf = st.bf || M.foes.map(() => false); st.bf[j] = r.bf; }
  st.risk = (st.risk || 0) + r.risk; st.fp = r.fp; st.ft += r.ft; st.mt += r.mt; st.seed = r.seed; st.fseed = r.fseed; st.wish = r.wish; st.hz = r.hz; st.tn = (st.tn || 0) + r.tn;
  st.sr = (st.sr || 0) + r.sr; st.wx = r.wx; st.rc = put(put(st.rc || {}, 'm' + i, r.rc[0]), 'f' + j, r.rc[1]);
  if (r.sq) st.sq = Object.assign({}, st.sq, r.sq);
  st.trap = r.trap; st.curse = r.curse; st.lk = r.lk;
  if (r.stall) st.stall = true;
}
function advanceSingles(M, st) {
  for (;;) {
    if (st.quiet) fightQuiet(M, st); else fight(M, st, st.log);
    if (st.pending === 'threat') return st;
    if (st.stall) { st.done = true; st.won = false; return st; }
    if (st.fh[st.j] <= 0) {
      st.log.push({ t: 'ko', j: st.j, i: st.i, hp: st.mh[st.i] });
      if (st.fh.every(h => h <= 0)) { st.done = true; st.won = true; return st; }
      const was = st.j;
      st.out = [];
      // it picks against your Pokémon on the field (or, if both went down at once, against whoever you have left)
      const vs = st.mh[st.i] > 0 ? [st.i] : st.mh.map((h, i) => (h > 0 ? i : -1)).filter(i => i >= 0);
      const nx = nextFoe(M, st, vs, was);
      let k = nx.k >= 0 ? nx.k : nextFoe(M, st, vs).k;
      if (k < 0) k = st.fh.findIndex(h => h > 0);
      st.log.push({ t: 'send', k, i: st.i, why: nx.k >= 0 ? nx.why : [] });
      st.j = k; st.out = [k]; st.ft = 0; st.fseed = 0; enterFoe(M, st, k, [st.i], st.log);
      if (st.mh[st.i] <= 0) { st.lost.push(st.i); st.log.push({ t: 'faint', i: st.i, j: was }); if (st.mh.every(h => h <= 0)) { st.done = true; st.won = false; return st; } st.pending = 'faint'; return st; }
      st.pending = 'newfoe'; return st;
    }
    if (st.mh[st.i] <= 0) {
      st.lost.push(st.i); st.log.push({ t: 'faint', i: st.i, j: st.j, fhp: st.fh[st.j] });
      if (st.mh.every(h => h <= 0)) { st.done = true; st.won = false; return st; }
      st.pending = 'faint'; return st;
    }
  }
}
/* Pivot moves: hit (or not) and switch out in the same turn. Slower than the foe = your Pokémon takes its hit, then the
   one coming in is safe this turn; faster = you hit first and the one coming in takes the hit. Teleport always goes last. */
const PIVOTS = { 'U-turn': {}, 'Volt Switch': {}, 'Flip Turn': {}, 'Teleport': { prio: -6 }, 'Parting Shot': {} };
function optionsSingles(M, st) {
  const alive = st.mh.map((h, i) => h > 0 ? i : -1).filter(i => i >= 0);
  if (st.pending === 'faint' || st.pending === 'lead') return alive.map(k => ({ k, hard: false }));
  const out = [{ k: st.i, hard: false }];
  if (st.swc && (st.swc[st.j] || 0) >= 4) return out;
  if (stuck(M, st, 'my', st.i)) return out;
  const bench = alive.filter(k => k !== st.i);
  bench.forEach(k => out.push({ k, hard: true }));
  const pivots = (M.mine[st.i].moves || []).filter(n => PIVOTS[n] && MOVES[n]);
  pivots.forEach(mv => {
    if (!isStatus(mv)) { const h = hitsOf(M, st, 'my', st.i, st.j).find(x => x.name === mv); if (!h || h.hiP <= 0) return; } // immune: no switch
    bench.forEach(k => out.push({ k, pivot: mv }));
  });
  return out;
}
// A turn where your Pokémon uses a pivot move into k.
function pivotTurn(M, s, o) {
  const i = s.i, j = s.j, k = o.k, mv = o.pivot, me = M.mine[i].p;
  const fa = foeAct(M, s, j, i);
  const h = !isStatus(mv) ? hitsOf(M, s, 'my', i, j).find(x => x.name === mv) : null;
  const prio = h ? h.prio || 0 : statusPrio(M, 'my', i, mv);
  const fpri = fa ? (fa.h ? fa.h.prio : statusPrio(M, 'foe', j, fa.name)) : 0;
  const meFirst = goesFirst(prio, spe(M, s, 'my', i), fpri, spe(M, s, 'foe', j), M.f.tr) > 0;
  const foeProt = fa && PROTECTS.includes(fa.name) && !s.fp;
  const flinch = !meFirst && fa && fa.name === 'Fake Out' && !['Inner Focus', 'Shield Dust'].includes(me.ability);
  const ev = { t: 'pivot', from: i, k, j, move: mv, first: meFirst, fm: fa && (fa.h ? fa.h.label : fa.name), took: null };
  s.tk = { m: 0, f: 0, mh: 0, fh: 0 };
  let switched = false;
  const mine = () => {
    if (s.mh[i] <= 0 || flinch || foeProt) return;
    if (h) act(M, s, 'my', i, j, { name: mv, label: h.label, h }, false, s.log);
    else if (mv === 'Parting Shot') applyFx(M, s, 'my', i, j, mv, s.log);
    if (s.fh[j] <= 0 || s.mh[i] <= 0) return; // the hit KO'd (or recoil did): no switch here
    leaveField(M, s, 'my', i);
    s.ma[i] = ZERO; s.tx = Object.assign({}, s.tx, { ['m' + i]: 0 }); s.seed = 0;
    s.i = k; s.mt = 0; switched = true;
    enterMine(M, s, k, [j], s.log);
  };
  const theirs = () => {
    if (!fa || s.fh[j] <= 0) return;
    const tgt = s.i, before = s.mh[tgt];
    if (fa.h) { const into = hitsOf(M, s, 'foe', j, tgt).find(x => x.name === fa.name); if (into) act(M, s, 'foe', j, tgt, { name: fa.name, label: fa.h.label, h: into }, false, s.log); }
    else act(M, s, 'foe', j, tgt, fa, false, s.log);
    ev.took = { i: tgt, dmg: Math.max(0, before - s.mh[tgt]) };
  };
  if (meFirst) { mine(); theirs(); } else { theirs(); mine(); }
  s.fp = foeProt ? 1 : 0;
  endTurn(M, s, s.i, j);
  s.ft++; s.tn = (s.tn || 0) + 1; if (!switched) s.mt++;
  s.swc = Object.assign({}, s.swc, { [j]: ((s.swc && s.swc[j]) || 0) + 1 });
  ev.switched = switched; ev.left = s.mh[k]; ev.fromLeft = s.mh[i]; ev.fhp = s.fh[j];
  s.log.push(ev);
}
function decideSingles(M, st, o) {
  const s = cloneSt(st);
  if (o.hard) {
    // the switch-in eats the hit the AI aimed at the Pokémon on the field
    const fa = foeAct(M, s, s.j, s.i);
    let dmg = 0, into = null;
    if (fa && fa.h) { into = hitsOf(M, s, 'foe', s.j, o.k).find(h => h.name === fa.name); dmg = into ? into.hiP : 0; }
    if (fa && fa.name === 'Pursuit') { const ph = hitsOf(M, s, 'foe', s.j, s.i).find(h => h.name === 'Pursuit'); if (ph) { act(M, s, 'foe', s.j, s.i, { name: 'Pursuit', label: 'Pursuit (doubled on a switch)', h: Object.assign({}, ph, { lo: ph.lo * 2, hi: ph.hi * 2, loP: ph.loP * 2, hiP: ph.hiP * 2 }) }, false, s.log); into = null; } }
    leaveField(M, s, 'my', s.i);
    s.ma[s.i] = ZERO; s.tx = Object.assign({}, s.tx, { ['m' + s.i]: 0 }); s.seed = 0;
    s.tk = { m: 1, f: 0, mh: 0, fh: 0 }; // switching was your move this turn
    const from = s.i; s.i = o.k; s.mt = 0;
    if (into) act(M, s, 'foe', s.j, o.k, { name: fa.name, label: fa.h.label, h: into }, false, s.log);
    else if (fa && !fa.h) act(M, s, 'foe', s.j, o.k, fa, false, s.log);
    if (s.mh[o.k] > 0 && s.fh[s.j] > 0) endTurn(M, s, o.k, s.j); // the turn still ends: weather, Leftovers, status damage
    s.ft++; s.tn = (s.tn || 0) + 1;
    s.swc = Object.assign({}, s.swc, { [s.j]: ((s.swc && s.swc[s.j]) || 0) + 1 });
    s.log.push({ t: 'switch', from, k: o.k, j: s.j, move: fa && (fa.h ? fa.h.label : fa.name), dmg, left: s.mh[o.k] });
    if (s.mh[o.k] <= 0) { s.lost.push(o.k); s.log.push({ t: 'faint', i: o.k, j: s.j }); if (s.mh.every(h => h <= 0)) { s.done = true; s.won = false; return s; } s.pending = 'faint'; return s; }
    enterMine(M, s, o.k, [s.j], s.log);
  } else if (o.pivot) {
    pivotTurn(M, s, o);
  } else if (st.pending === 'lead') {
    s.log.push({ t: 'lead', i: o.k, j: s.j }); s.i = o.k; s.mt = 0; s.ft = 0;
    s.ma[o.k] = ZERO; s.fa[s.j] = ZERO;
    if (spe(M, s, 'my', o.k) >= spe(M, s, 'foe', s.j)) { enterMine(M, s, o.k, [s.j], s.log, true); enterFoe(M, s, s.j, [o.k], s.log, true); }
    else { enterFoe(M, s, s.j, [o.k], s.log, true); enterMine(M, s, o.k, [s.j], s.log, true); }
  } else if (st.pending === 'faint') {
    s.log.push({ t: 'in', i: o.k, j: s.j }); s.i = o.k; s.mt = 0; enterMine(M, s, o.k, [s.j], s.log);
  } else { s.log.push({ t: 'stay', i: o.k, j: s.j, threat: st.pending === 'threat', why: st.why }); s.i = o.k; s.asked[s.i + '-' + s.j + '-' + (s.tn || 0)] = 1; }
  s.pending = null; s.why = null;
  return advanceSingles(M, s);
}

/* ======================= doubles ======================= */
const noFakeOut = p => p.types.includes('Ghost') || p.ability === 'Inner Focus' || p.ability === 'Shield Dust';
const bestInto = (M, side, a, d, st) => Math.max(0, ...M.hits(side, a, d, st).map(h => h.hiP));
// The AI's choice for its Pokémon j this turn, following CFRU's doubles kill score.
function aiChoiceDoubles(M, st, j, partnerKOs) {
  M = MW(M, st);
  const myOut = st.act.filter(i => i >= 0 && st.mh[i] > 0);
  if (!myOut.length) return null;
  const uncovered = myOut.filter(i => !partnerKOs.includes(i)); // targets its partner already KOs are ignored
  const targets = uncovered.length ? uncovered : myOut;
  const partner = st.out.find(k => k !== j && k >= 0 && st.fh[k] > 0);
  // Fake Out on its first turn out, into whichever of yours threatens it most
  if (st.fresh.includes('f' + j) && (M.foes[j].moves || []).includes('Fake Out')) {
    const t = myOut.filter(i => !noFakeOut(M.mine[i].p)).sort((a, b) => bestInto(M, 'my', b, j, st.ma[b]) - bestInto(M, 'my', a, j, st.ma[a]))[0];
    if (t != null) return { j, name: 'Fake Out', fakeOut: true, targets: [t], score: 17, prio: 3 };
  }
  let best = null;
  const names = [...new Set(M.hits('foe', j, targets[0], st.fa[j]).map(h => h.name))];
  for (const name of names) {
    const spread = isSpread(name);
    for (const t of (spread ? [null] : targets)) {
      const hitT = spread ? myOut : [t];
      let score = 0, kos = 0, dmgSum = 0, threat = 0, prio = 0;
      for (const i of hitT) {
        if (spread && partnerKOs.includes(i)) continue;
        const all = M.hits('foe', j, i, st.fa[j]), h = all.find(x => x.name === name);
        if (!h || h.hiP <= 0) continue;
        prio = h.prio; score += 4;
        if (canKO(M, st, 'my', i, h.hiP, h.cat)) { score += 2; kos++; }
        else if (h.hiP >= Math.max(...all.map(x => x.hiP))) score += 1;
        else if (myOut.length >= 2) { if (h.hiP < 25) score -= 3; else if (h.hiP < 33) score -= 2; }
        dmgSum += Math.min(h.hiP, st.mh[i]);
        if (bestInto(M, 'my', i, j, st.ma[i]) >= st.fh[j]) threat++;
      }
      if (spread && hitsAlly(name) && partner != null) {
        const ah = M.hits('foeAlly', j, partner, st.fa[j]).find(x => x.name === name);
        if (ah && ah.hiP > 0) score -= 3;
      }
      const c = { j, name, spread, targets: hitT, score, kos, dmgSum, threat, prio };
      if (!best || score > best.score || (score === best.score && (kos > best.kos || (kos === best.kos && (threat > best.threat || (threat === best.threat && dmgSum > best.dmgSum)))))) best = c;
    }
  }
  return best;
}
// Your choice for your Pokémon i: KOs first, then the most damage; don't hit your partner.
function myChoiceDoubles(M, st, i, taken) {
  M = MW(M, st);
  const foesOut = st.out.filter(k => k >= 0 && st.fh[k] > 0);
  if (!foesOut.length) return null;
  const free = foesOut.filter(k => !taken.includes(k));
  const targets = free.length ? free : foesOut;
  const partner = st.act.find(x => x !== i && x >= 0 && st.mh[x] > 0);
  if (st.fresh.includes('m' + i) && (M.mine[i].moves || []).includes('Fake Out')) {
    const t = foesOut.filter(k => !noFakeOut(M.foes[k].p)).sort((a, b) => bestInto(M, 'foe', b, i, st.fa[b]) - bestInto(M, 'foe', a, i, st.fa[a]))[0];
    if (t != null && bestInto(M, 'foe', t, i, st.fa[t]) >= 40) return { i, name: 'Fake Out', fakeOut: true, targets: [t], prio: 3, kos: 0 };
  }
  let best = null;
  const names = [...new Set(M.hits('my', i, targets[0], st.ma[i]).map(h => h.name))];
  for (const name of names) {
    const spread = isSpread(name);
    for (const t of (spread ? [null] : targets)) {
      const hitT = spread ? foesOut : [t];
      let value = 0, kos = 0, prio = 0;
      hitT.forEach(k => { const h = M.hits('my', i, k, st.ma[i]).find(x => x.name === name); if (!h) return; prio = h.prio; value += Math.min(h.loP, st.fh[k]); if (canKO(M, st, 'foe', k, h.loP, h.cat)) { kos++; value += 60; } });
      if (spread && hitsAlly(name) && partner != null) { const ah = M.hits('myAlly', i, partner, st.ma[i]).find(x => x.name === name); if (ah && ah.hiP > 0) value -= ah.hiP * 1.5 + (ah.hiP >= st.mh[partner] ? 200 : 0); }
      if (!best || value > best.value) best = { i, name, spread, targets: hitT, value, kos, prio };
    }
  }
  return best;
}
function turnDoubles(M, st, forced, swaps) {
  M = MW(M, st);
  st.turn = (st.turn || 0) + 1;
  const ev = { t: 'turn', n: st.turn, acts: [] };
  const aiOut = st.out.filter(k => k >= 0 && st.fh[k] > 0).sort((a, b) => M.sFoe[b] - M.sFoe[a]);
  const aiActs = [], partnerKOs = [];
  aiOut.forEach(j => {
    const c = aiChoiceDoubles(M, st, j, partnerKOs); if (!c) return;
    aiActs.push(c);
    if (!c.fakeOut) c.targets.forEach(i => { const h = M.hits('foe', j, i, st.fa[j]).find(x => x.name === c.name); if (h && canKO(M, st, 'my', i, h.hiP, h.cat)) partnerKOs.push(i); });
  });
  // your switches go before any move; the AI already picked its targets, so whatever it aimed at that slot hits the one coming in
  (swaps || []).forEach(({ i, k }) => {
    const slot = st.act.indexOf(i);
    if (slot < 0 || !(st.mh[k] > 0) || st.act.includes(k)) return;
    leaveField(M, st, 'my', i);
    st.ma[i] = ZERO; st.act[slot] = k; st.fresh.push('m' + k);
    st.log.push({ t: 'dswitch', from: i, k, slot });
    enterMine(M, st, k, st.out, st.log);
    aiActs.forEach(a => { a.targets = a.targets.map(t => (t === i ? k : t)); });
  });
  const myOut = st.act.filter(i => i >= 0 && st.mh[i] > 0).sort((a, b) => M.sMe[b] - M.sMe[a]);
  const myActs = [], taken = [];
  if (forced) forced.forEach(c => { if (c && st.mh[c.i] > 0) myActs.push(c); });
  else myOut.forEach(i => { const c = myChoiceDoubles(M, st, i, taken); if (c) { myActs.push(c); if (!c.spread && c.kos) taken.push(c.targets[0]); } });
  const order = aiActs.map(a => ({ side: 'foe', a, prio: a.prio || 0, spd: M.sFoe[a.j] })).concat(myActs.map(a => ({ side: 'my', a, prio: a.prio || 0, spd: M.sMe[a.i] })));
  order.sort((x, y) => (y.prio - x.prio) || (M.f.tr ? x.spd - y.spd : y.spd - x.spd));
  // what the AI sees: a fast kill (it hits before that Pokémon moves) or a slow kill
  aiActs.forEach(a => {
    const pos = order.findIndex(x => x.a === a);
    a.sees = a.fakeOut ? [] : a.targets.map(i => {
      const h = M.hits('foe', a.j, i, st.fa[a.j]).find(x => x.name === a.name);
      if (!h || h.hiP < st.mh[i]) return null;
      const myPos = order.findIndex(x => x.side === 'my' && x.a.i === i);
      return { i, kind: myPos >= 0 && myPos < pos ? 'slow' : 'fast' };
    }).filter(Boolean);
  });
  const flinched = new Set();
  for (const x of order) {
    const a = x.a;
    if (x.side === 'foe') {
      if (st.fh[a.j] <= 0) continue;
      if (flinched.has('f' + a.j)) { ev.acts.push({ side: 'foe', j: a.j, flinch: true }); continue; }
      const tg = a.targets.filter(i => st.mh[i] > 0);
      const hitList = a.spread ? tg : tg.length ? tg : st.act.filter(i => i >= 0 && st.mh[i] > 0).slice(0, 1);
      hitList.forEach(i => { const h = M.hits('foe', a.j, i, st.fa[a.j]).find(z => z.name === a.name); if (h) strike(M, st, 'foe', a.j, 'my', i, h, h.hiP); if (a.fakeOut) flinched.add('m' + i); });
      if (a.spread && hitsAlly(a.name)) { const p2 = st.out.find(k => k !== a.j && k >= 0 && st.fh[k] > 0); if (p2 != null) { const ah = M.hits('foeAlly', a.j, p2, st.fa[a.j]).find(z => z.name === a.name); if (ah) st.fh[p2] = applyHit(M.foes[p2].p, st.fh[p2], ah.loP); } }
      if (hitList.length) st.fh[a.j] = Math.max(0, st.fh[a.j] - lifeOrb(M.foes[a.j].p));
      berries(M, st);
      if (hitList.length) ev.acts.push({ side: 'foe', j: a.j, name: a.name, spread: a.spread, targets: hitList, sees: a.sees, score: a.score });
    } else {
      if (st.mh[a.i] <= 0) continue;
      if (flinched.has('m' + a.i)) { ev.acts.push({ side: 'my', i: a.i, flinch: true }); continue; }
      const tg = a.targets.filter(k => st.fh[k] > 0);
      const hitList = a.spread ? tg : tg.length ? tg : st.out.filter(k => k >= 0 && st.fh[k] > 0).slice(0, 1); // its target already fell: it hits the other one
      hitList.forEach(k => { const h = M.hits('my', a.i, k, st.ma[a.i]).find(z => z.name === a.name); if (h) strike(M, st, 'my', a.i, 'foe', k, h, h.loP); if (a.fakeOut) flinched.add('f' + k); });
      if (a.spread && hitsAlly(a.name)) { const p2 = st.act.find(k => k !== a.i && k >= 0 && st.mh[k] > 0); if (p2 != null) { const ah = M.hits('myAlly', a.i, p2, st.ma[a.i]).find(z => z.name === a.name); if (ah) st.mh[p2] = applyHit(M.mine[p2].p, st.mh[p2], ah.hiP); } }
      if (hitList.length) st.mh[a.i] = Math.max(0, st.mh[a.i] - lifeOrb(M.mine[a.i].p));
      berries(M, st);
      if (hitList.length) ev.acts.push({ side: 'my', i: a.i, name: a.name, spread: a.spread, targets: hitList });
    }
  }
  // end of turn: weather, status, Leech Seed, Leftovers...
  st.act.forEach(i => { if (i >= 0 && st.mh[i] > 0) st.mh[i] = Math.max(0, Math.min(100, st.mh[i] + M.res.my[i].net)); });
  st.out.forEach(k => { if (k >= 0 && st.fh[k] > 0) st.fh[k] = Math.max(0, Math.min(100, st.fh[k] + M.res.foe[k].net)); });
  berries(M, st);
  tickWx(st);
  st.fresh = [];
  ev.hp = { my: st.act.filter(i => i >= 0).map(i => [i, st.mh[i]]), foe: st.out.filter(k => k >= 0).map(k => [k, st.fh[k]]) };
  st.log.push(ev);
  if (!aiActs.length && !myActs.length) st.stall = true;
}
function advanceDoubles(M, st) {
  for (let guard = 0; guard < 40; guard++) {
    turnDoubles(M, st);
    if (st.turn > 30) st.stall = true;
    if (st.stall) { st.done = true; st.won = false; return st; }
    if (afterDoubles(M, st)) return st;
  }
  st.stall = true; st.done = true; st.won = false; return st;
}
// After a doubles turn: their replacements (diagonal bait), the win / loss, and which of your slots needs a Pokémon. True = stop here.
function afterDoubles(M, st) {
  {
    // their fainted Pokémon are replaced from the back
    for (let s = 0; s < st.out.length; s++) {
      const k = st.out[s];
      if (k < 0 || st.fh[k] > 0) continue;
      st.log.push({ t: 'ko', j: k });
      st.out[s] = -1;
      const nx = nextFoe(M, st, st.act, k, st.act[s]);
      if (nx.k < 0) continue;
      st.log.push({ t: 'send', k: nx.k, i: nx.vs, why: nx.why, diag: nx.diag ? 1 : 0, slot: s });
      st.out[s] = nx.k; st.fresh.push('f' + nx.k);
      enterFoe(M, st, nx.k, st.act, st.log);
    }
    if (st.fh.every(h => h <= 0)) { st.done = true; st.won = true; return true; }
    const down = st.act.map((i, s) => (i >= 0 && st.mh[i] <= 0 ? s : -1)).filter(s => s >= 0);
    if (down.length) {
      down.forEach(s => { const i = st.act[s]; st.lost.push(i); st.log.push({ t: 'faint', i }); st.act[s] = -1; });
      if (st.mh.every(h => h <= 0)) { st.done = true; st.won = false; return true; }
      const bench = st.mh.map((h, i) => (h > 0 && !st.act.includes(i) ? i : -1)).filter(i => i >= 0);
      if (bench.length) { st.pending = 'faint'; st.slot = st.act.indexOf(-1); return true; }
    }
  }
  return false;
}
function optionsDoubles(M, st) {
  const alive = st.mh.map((h, i) => h > 0 ? i : -1).filter(i => i >= 0);
  if (st.pending === 'lead') {
    const out = [];
    for (let a = 0; a < alive.length; a++) for (let b = a + 1; b < alive.length; b++) out.push({ pair: [alive[a], alive[b]] });
    if (alive.length === 1) out.push({ pair: [alive[0], -1] });
    return out;
  }
  return alive.filter(i => !st.act.includes(i)).map(k => ({ k }));
}
function decideDoubles(M, st, o) {
  const s = cloneSt(st);
  if (st.pending === 'lead') {
    s.act = o.pair.slice(); s.log.push({ t: 'lead2', pair: s.act.slice(), foes: s.out.slice() });
    s.fresh = s.act.filter(i => i >= 0).map(i => 'm' + i).concat(s.out.filter(k => k >= 0).map(k => 'f' + k));
    s.act.filter(i => i >= 0).forEach(i => { s.ma[i] = ZERO; }); s.out.filter(k => k >= 0).forEach(k => { s.fa[k] = ZERO; });
    s.act.filter(i => i >= 0).forEach(i => enterMine(M, s, i, s.out, s.log, true));
    s.out.filter(k => k >= 0).forEach(k => enterFoe(M, s, k, s.act, s.log, true));
  } else {
    s.act[s.slot] = o.k; s.log.push({ t: 'in', i: o.k }); s.fresh.push('m' + o.k);
    enterMine(M, s, o.k, s.out, s.log);
    const other = s.act.indexOf(-1);
    if (other >= 0 && s.mh.some((h, i) => h > 0 && !s.act.includes(i))) { s.slot = other; s.pending = 'faint'; return s; }
  }
  s.pending = null;
  return advanceDoubles(M, s);
}

/* ======================= search ======================= */
/* plan({ mine: [{name, m, p, moves, hp?}], foes: [{name, m, p, moves, hp?}], f, foeActive?, foeActive2?, myActive?, myActive2? })
   f.doubles switches to the doubles model. Returns { won, lost, log, steps, verdict, winCons, dangers, tips }. */
// A fresh battle state: HP, stat stages, statuses (what each already has counts as there), and the bookkeeping the search needs.
function blankSt(M, mh, fh) {
  return { i: -1, j: -1, act: null, out: [], mh, fh, ma: M.mine.map(() => ZERO), fa: M.foes.map(() => ZERO), ms: M.mine.map(x => x.p.status || ''), fs: M.foes.map(x => x.p.status || ''),
    sl: {}, tx: {}, bu: {}, risk: 0, sr: 0, sq: null, wx: null, rc: {}, fp: 0, ft: 0, mt: 0, seed: 0, fseed: 0, wish: null, hz: 0, asked: {}, tn: 0, swc: {}, log: [], lost: [], stall: false, done: false, won: false, pending: null, start: mh.slice(), turn: 0, fresh: [], w: M.w };
}
function plan(opt) {
  const { mine, foes, f } = opt;
  if (!mine.length || !foes.length) return null;
  const M = buildMatrix(mine, foes, f);
  const dbl = !!f.doubles;
  const start = mine.map(x => x.hp != null ? x.hp : 100);
  const fh = foes.map(x => x.hp != null ? x.hp : 100);
  const firstAlive = from => fh.findIndex((h, k) => h > 0 && k !== from);
  const st0 = Object.assign(blankSt(M, start.slice(), fh), { i: -1, j: -1, act: null, out: [], pending: 'lead', start });
  if (dbl) {
    const a = opt.foeActive != null ? opt.foeActive : firstAlive(-1);
    const b = opt.foeActive2 != null ? opt.foeActive2 : firstAlive(a);
    st0.out = [a, b];
    if (opt.myActive != null) { st0.act = [opt.myActive, opt.myActive2 != null ? opt.myActive2 : -1]; st0.pending = null; }
  } else {
    st0.j = opt.foeActive != null ? opt.foeActive : firstAlive(-1); st0.out = [st0.j];
    if (opt.myActive != null && start[opt.myActive] > 0) { st0.i = opt.myActive; st0.pending = 'newfoe'; }
  }
  const options = dbl ? optionsDoubles : optionsSingles, decide = dbl ? decideDoubles : decideSingles;
  const width = opt.beam || BEAM;
  let beam = [st0], finished = [];
  if (dbl && st0.pending === null) { const s = advanceDoubles(M, cloneSt(st0)); if (s.done) { finished = [s]; beam = []; } else beam = [s]; }
  /* Singles: every unfinished line is scored by playing it to the end the simple way (stay in; replace a fainted Pokémon
     with the best answer left). The best of those play-outs is kept as an answer too, so the plan is never worse than
     the simple way from any point it looked at; the search only adds switches and pivots that beat it. */
  let bestRoll = null;
  const fast = !!opt.fast; // quick search (team trials): no play-outs
  const rank = s => {
    if (dbl || fast) return cost(s);
    const c = cost(finishDefault(M, s, true));
    if (!bestRoll || c < bestRoll.c) bestRoll = { from: s, c };
    return c;
  };
  for (let depth = 0; depth < 80 && beam.length; depth++) {
    const next = [];
    for (const st of beam) for (const o of options(M, st)) { const s = decide(M, st, o); (s.done ? finished : next).push(s); }
    if (dbl || fast) { beam = next.map(s => [cost(s), s]).sort((a, b) => a[0] - b[0]).slice(0, width).map(x => x[1]); }
    else {
      // keep the best half by cost so far and the best half by how they play out (each finds lines the other misses)
      const byCost = next.map(s => [cost(s), s]).sort((a, b) => a[0] - b[0]);
      const byRoll = next.map(s => [rank(s), s]).sort((a, b) => a[0] - b[0]);
      const keep = new Set(byCost.slice(0, width >> 1).map(x => x[1]));
      for (const [, s] of byRoll) { if (keep.size >= width) break; keep.add(s); }
      beam = [...keep];
    }
    if (finished.length > width * 4) break;
  }
  if (!dbl) beam = beam.map(s => finishDefault(M, s));
  finished = finished.concat(beam);
  if (bestRoll) finished.push(finishDefault(M, bestRoll.from)); // replay the best play-out with its write-up
  finished.sort((a, b) => cost(a) - cost(b));
  const best = finished[0];
  if (!best) return null;
  return Object.assign(describe(M, best), { M, st: best });
}

// How much HP (%) your Pokémon i needs to beat their Pokémon j one-on-one from full HP (999 = it can't), cached per plan.
function needVs(M, i, j) {
  M.need = M.need || {};
  const key = i + ',' + j;
  if (key in M.need) return M.need[key];
  const st = Object.assign(blankSt(M, M.mine.map(() => 100), M.foes.map(() => 100)), { i, j, out: [j] });
  fight(M, st, null);
  return (M.need[key] = st.fh[j] <= 0 && st.mh[i] > 0 ? 100 - st.mh[i] : 999);
}
// Play an unfinished line to the end the simple way: stay in, and replace a fainted Pokémon with the best answer left.
function finishDefault(M, st, quiet) {
  let s = st;
  if (quiet) { s = cloneSt(st); s.log = NOLOG; s.quiet = true; }
  for (let g = 0; g < 60 && !s.done; g++) {
    let o;
    if (s.pending === 'faint' || s.pending === 'lead') {
      const alive = s.mh.map((h, i) => (h > 0 ? i : -1)).filter(i => i >= 0);
      o = { k: alive.sort((a, b) => (needVs(M, a, s.j) - s.mh[a]) - (needVs(M, b, s.j) - s.mh[b]))[0], hard: false };
    } else o = { k: s.i, hard: false };
    s = decideSingles(M, s, o);
  }
  return s;
}

/* bestSix(opt): when you have more than six to pick from (party + box), choose the six you should bring.
   Starts from the six with the best matchups, then swaps one at a time while that loses fewer Pokémon (or less HP). */
function bestSix(opt) {
  const { mine, foes, f } = opt;
  const idx = mine.map((_, i) => i);
  if (mine.length <= 6) { const r = plan(opt); if (r) r.team = idx; return r; }
  // every candidate (the whole box) fights each of their Pokémon one-on-one from full HP:
  // 1 + HP left / 2 for a clean win, partial credit for the damage done otherwise
  const MA = buildMatrix(mine, foes, f);
  const live = foes.map((fo, j) => ((fo.hp != null ? fo.hp : 100) > 0 ? j : -1)).filter(j => j >= 0);
  const v11 = mine.map((_, i) => foes.map((_, j) => {
    if (!live.includes(j)) return 0;
    const st = Object.assign(blankSt(MA, mine.map(() => 100), foes.map(() => 100)), { i, j, out: [j], asked: { [i + '-' + j]: 1 } });
    fight(MA, st, null);
    return st.fh[j] <= 0 && st.mh[i] > 0 ? 1 + st.mh[i] / 200 : (100 - st.fh[j]) / 250 - (st.mh[i] <= 0 ? 0.2 : 0);
  }));
  const score = v11.map(r => r.reduce((a, x) => a + x, 0));
  // starting six: cover their team (each pick adds the most over what the team already beats), important Pokémon first
  let team = idx.filter(i => mine[i].star).slice(0, 6);
  while (team.length < 6) {
    let bi = -1, bg = -1e9;
    idx.forEach(i => { if (team.includes(i)) return; const g = foes.reduce((a, _, j) => a + Math.max(0, v11[i][j] - Math.max(0, ...team.map(t => v11[t][j]))), 0) + score[i] * 0.05; if (g > bg) { bg = g; bi = i; } });
    team.push(bi);
  }
  // swap trials use a narrower search (20 lines instead of 120); the best three teams get the full one at the end
  const run = (t, full) => { const r = plan(Object.assign({}, opt, { mine: t.map(i => mine[i]), beam: full ? BEAM : 20 })); return r ? { r, c: cost(r.st) } : { r: null, c: 1e9 }; };
  const tried = new Map(); // team -> quick-search cost, so the best few can get the full search at the end
  const runQ = t => { const k = t.slice().sort((a, b) => a - b).join(','); if (tried.has(k)) return tried.get(k); const r = run(t); tried.set(k, Object.assign(r, { t: t.slice() })); return r; };
  let best = runQ(team);
  // only the most promising Pokémon from the boxes are tried as swaps (the rest rarely win and each try is a full plan)
  const short = idx.slice().sort((a, b) => score[b] - score[a]).slice(0, 12);
  idx.forEach(i => { if (!short.includes(i) && live.some(j => v11[i][j] >= 1 && team.every(t => v11[t][j] < 1))) short.push(i); }); // plus anything that cleanly beats a Pokémon the team doesn't
  for (let round = 0; round < 3; round++) {
    let improved = false;
    for (let s = 0; s < 6; s++) {
      for (const cand of short) {
        if (team.includes(cand)) continue;
        const t = team.slice(); t[s] = cand;
        const r = runQ(t);
        if (r.c < best.c - 0.5) { best = r; team = t; improved = true; }
      }
    }
    if (!improved || (best.r && best.r.won && !best.r.lost.length && best.c < 50)) break;
  }
  // the three best teams from the quick search each get the full search; the best of those is the answer
  const finalists = [...tried.values()].sort((a, b) => a.c - b.c).slice(0, 3);
  let top = null;
  finalists.forEach(x => { const r = run(x.t, true); if (r.r && (!top || r.c < top.c)) top = Object.assign(r, { t: x.t }); });
  if (!top) return best.r;
  top.r.team = top.t; top.r.screened = mine.length;
  return top.r;
}

// Which of your Pokémon beat each of theirs one-on-one from full HP without fainting (singles model).
function cleanAnswers(M) {
  return M.foes.map((_, j) => M.mine.map((_, i) => {
    const st = Object.assign(blankSt(M, M.mine.map(() => 100), M.foes.map(() => 100)), { i, j, out: [j], asked: { [i + '-' + j]: 1 } });
    fight(M, st, null);
    return st.fh[j] <= 0 && st.mh[i] > 0 && !st.stall ? { i, left: st.mh[i] } : null;
  }).filter(Boolean));
}

const pct = x => Math.max(0, Math.round(x)) + '%';
// PP of a move from the Pokédex data when it's loaded (X.moves rows are [name, type, power, accuracy, pp, ...]).
let PP_BY_NAME = null;
function ppOf(name) {
  const X = root.RR_DEX; if (!X) return null;
  if (!PP_BY_NAME) { PP_BY_NAME = {}; Object.values(X.moves).forEach(m => { PP_BY_NAME[m[0]] = m[4]; }); }
  return PP_BY_NAME[name] != null ? PP_BY_NAME[name] : null;
}
const RECOVERY = ['Recover', 'Roost', 'Slack Off', 'Soft-Boiled', 'Synthesis', 'Moonlight', 'Morning Sun', 'Shore Up', 'Milk Drink', 'Wish', 'Rest', 'Strength Sap', 'Leech Seed'];
const STALL_STATUS = ['Toxic', 'Will-O-Wisp', 'Thunder Wave', 'Spore', 'Sleep Powder', 'Hypnosis', 'Yawn', 'Glare', 'Leech Seed', 'Taunt', 'Encore', 'Swords Dance', 'Nasty Plot', 'Calm Mind', 'Dragon Dance', 'Bulk Up', 'Quiver Dance', 'Shell Smash', 'Belly Drum', 'Curse', 'Perish Song', 'Destiny Bond'];
// PP stall: one of yours takes nothing (or less than it heals back) from everything this Pokémon can hit with.
function ppStall(M, j) {
  const fo = M.foes[j], dmgMoves = (fo.moves || []).filter(n => MOVES[n] && !isStatus(n));
  if (!dmgMoves.length) return null;
  const danger = (fo.moves || []).filter(n => STALL_STATUS.includes(n));
  const out = [];
  M.mine.forEach((me, i) => {
    const hs = M.hits('foe', j, i, ZERO).filter(h => dmgMoves.includes(h.name));
    const worst = Math.max(0, ...hs.map(h => h.hiP));
    const heals = (me.moves || []).filter(n => RECOVERY.includes(n));
    const protect = (me.moves || []).some(n => ['Protect', 'Detect', "King's Shield", 'Spiky Shield', 'Baneful Bunker', 'Obstruct', 'Silk Trap'].includes(n));
    const lefties = ['Leftovers', 'Black Sludge'].includes(me.p.item) || ['Regenerator', 'Poison Heal'].includes(me.p.ability);
    if (worst === 0) out.push({ i, kind: 'immune' });
    else if (worst <= 20 && (heals.length || (lefties && worst <= 8))) out.push({ i, kind: 'heal', worst, how: heals.length ? heals[0] : me.p.item || me.p.ability, protect });
  });
  if (!out.length) return null;
  const pp = dmgMoves.map(n => ppOf(n)).filter(x => x != null);
  return { list: out, moves: dmgMoves, pp: pp.length === dmgMoves.length ? pp.reduce((a, b) => a + b, 0) : null, danger };
}
const ZNAME = { par: 'paralysed', brn: 'burned', slp: 'asleep', psn: 'poisoned', tox: 'badly poisoned', '': 'cured' };
const pkTag = (x) => `<span class="pk" data-sp="${String(x.p && x.p.name || x.name).replace(/"/g, '&quot;')}">${x.name}</span>`;
function stepsOf(M, log) {
  const N = i => pkTag(M.mine[i]), F = j => pkTag(M.foes[j]);
  const steps = [];
  for (const e of log) {
    if (e.t === 'lead') steps.push({ k: 'lead', i: e.i, text: `Lead <b>${N(e.i)}</b> into ${F(e.j)}.` });
    else if (e.t === 'lead2') steps.push({ k: 'lead', text: `Lead <b>${e.pair.filter(i => i >= 0).map(N).join('</b> and <b>')}</b> into ${e.foes.filter(k => k >= 0).map(F).join(' and ')}.` });
    else if (e.t === 'in') steps.push({ k: 'in', i: e.i, text: `Send in <b>${N(e.i)}</b>${e.j != null ? ' against ' + F(e.j) : ''}.` });
    else if (e.t === 'stay') steps.push({ k: 'stay', i: e.i, text: e.threat ? (e.why === 'doom' ? `<b>${N(e.i)}</b> stays in: it loses this matchup, but switching out costs more here.` : `<b>${N(e.i)}</b> stays in although ${F(e.j)} threatens a KO: switching costs more here.`) : `Stay in with <b>${N(e.i)}</b>.` });
    else if (e.t === 'pivot') steps.push({ k: 'switch', i: e.k, text: e.switched
      ? `${N(e.from)} uses <b>${e.move}</b> and brings in <b>${N(e.k)}</b>${e.first ? (e.took && e.took.i === e.k ? `, which takes ${e.fm}` : '') : ` after taking ${e.fm || 'its move'}`}. <span class="hpline">→ ${N(e.k)} ${pct(e.left)} · ${N(e.from)} ${pct(e.fromLeft)} · ${F(e.j)} ${pct(e.fhp)}</span>`
      : `${N(e.from)} uses <b>${e.move}</b>${e.fhp <= 0 ? ` and KOs ${F(e.j)}` : ' but stays in'}.` });
    else if (e.t === 'intim') steps.push({ k: 'intim', text: e.side === 'my' ? `${N(e.i)}'s Intimidate: ${F(e.j)} ${e.d ? stTxt(e.d) : 'is unaffected'}.` : `${F(e.j)}'s Intimidate: ${N(e.i)} ${e.d ? stTxt(e.d) : 'is unaffected'}.` });
    else if (e.t === 'fight') {
      const chg = e.chg ? [e.chg.my && `${N(e.i)} ${stTxt(e.chg.my)}`, e.chg.foe && `${F(e.j)} ${stTxt(e.chg.foe)}`, e.chg.myZ && `${N(e.i)} is ${ZNAME[e.chg.myZ]}`, e.chg.foeZ && `${F(e.j)} is ${ZNAME[e.chg.foeZ]}`].filter(Boolean) : [];
      const mine = !e.mm ? 'no damaging move' : e.setup ? `<b>${e.mm}</b>` : `<b>${e.mm}</b> (${pct(e.mmLo)}–${pct(e.mmHi)})${e.myKill === 'fast' ? ', a fast kill' : e.myKill === 'slow' ? ', a slow kill' : e.myKill === 'roll' ? ', KO only on a high roll' : ''}${e.myKill && e.pk > 0 && e.pk < 0.995 ? ` (${Math.round(e.pk * 100)}% to KO)` : ''}`;
      const theirs = `${F(e.j)} ${e.aiKill === 'fast' ? '<b class="bad">sees a fast kill</b> with' : e.aiKill === 'slow' ? '<b class="warn">sees a slow kill</b> with' : e.aiKill === 'residual' ? '<b class="warn">KOs with end-of-turn damage</b> after' : e.fmStatus ? 'uses' : 'sees no kill, so it uses'} ${e.fm || 'nothing that hurts'}${e.fm && !e.fmStatus ? ' (up to ' + pct(e.fmHi) + ')' : ''}${e.tie ? ` <span class="muted">(or ${e.tie.filter(n => n !== e.fm).join(' / ')}: a tie)</span>` : ''}`;
      const head = e.n > 1 ? `Turn ${e.n}: ${N(e.i)}` : `${N(e.i)} ${e.meFirst ? 'moves first' : 'moves second'}:`;
      const heal = e.heal ? [e.heal.me >= 1 && `${N(e.i)} heals <b class="good">${pct(e.heal.me)}</b>`, e.heal.foe >= 1 && `${F(e.j)} heals ${pct(e.heal.foe)}`].filter(Boolean) : [];
      // the AI saw a kill and really got to attack (it moved first, or it was still standing after your move), yet you're alive
      const acted = !e.meFirst || e.fhp > 0;
      const saved = (e.aiKill === 'fast' || e.aiKill === 'slow') && e.mhp > 0 && acted ? (e.heal && e.heal.me >= 1 && e.meFirst ? ' <b class="good">It heals first, so it survives.</b>' : ' It survives (only a high roll would have done it).') : '';
      steps.push({ k: 'fight', i: e.i, ai: e.aiKill, me: e.myKill, text: `${head} ${mine}. ${theirs}.${saved}${heal.length ? ` <span class="hpline">${heal.join(' · ')}</span>` : ''}${chg.length ? ` <span class="hpline">${chg.join(' · ')}</span>` : ''}${e.n > 1 || chg.length ? ` <span class="hpline">→ ${N(e.i)} ${pct(e.mhp)} · ${F(e.j)} ${pct(e.fhp)}</span>` : ''}${e.resMe && e.resMe.parts.length ? ` End of turn: ${N(e.i)} ${resTxt(e.resMe)}.` : ''}${e.resFoe && e.resFoe.parts.length ? ` ${F(e.j)} ${resTxt(e.resFoe)}.` : ''}` });
    }
    else if (e.t === 'risk') steps.push({ k: 'risk', text: e.why === 'flinch'
      ? `<b class="warn">${Math.max(1, Math.round(e.p * 100))}% flinch chance:</b> ${F(e.j)}'s ${e.move} hits first and can make ${N(e.i)} flinch, which gives it another free hit.`
      : `<b class="warn">${Math.max(1, Math.round(e.p * 100))}% risk:</b> ${N(e.i)} goes down if ${F(e.j)}'s ${e.move} ${e.why === 'crit' ? 'crits' : 'rolls high'}. Worth it here.` });
    else if (e.t === 'srisk' && /-1$|^self\+/.test(e.kind)) { const SN = { atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed', all: 'stats' }, st0 = e.kind.replace(/-1$/, '').replace(/^self\+/, ''); steps.push({ k: 'risk', text: e.kind.startsWith('self+') ? `<b class="warn">${Math.max(1, Math.round(e.p * 100))}% chance</b> ${F(e.j)}'s ${e.move} raises its own ${SN[st0]}.` : `<b class="warn">${Math.max(1, Math.round(e.p * 100))}% chance</b> ${F(e.j)}'s ${e.move} lowers ${N(e.i)}'s ${SN[st0]}.` }); }
    else if (e.t === 'srisk') steps.push({ k: 'risk', text: `<b class="warn">${Math.max(1, Math.round(e.p * 100))}% chance</b> ${F(e.j)}'s ${e.move} leaves ${N(e.i)} with ${Z_WORD[e.kind] || e.kind}${e.big ? (e.kind === 'brn' ? ', which halves its physical attacks' : e.kind === 'frz' ? ', which halves its special attacks' : e.kind === 'par' ? ', and then it moves second' : '') : ''}.` });
    else if (e.t === 'turn') {
      const parts = e.acts.map(a => {
        if (a.flinch) return a.side === 'my' ? `${N(a.i)} flinches` : `${F(a.j)} flinches`;
        if (a.side === 'my') return `${N(a.i)}: <b>${a.name}</b>${a.spread ? ' (spread)' : ' → ' + a.targets.map(F).join(', ')}`;
        const sees = (a.sees || []).map(s => s.kind === 'fast' ? `<b class="bad">sees a fast kill on ${N(s.i)}</b>` : `<b class="warn">sees a slow kill on ${N(s.i)}</b>`).join(', ');
        return `${F(a.j)}: ${a.name}${a.spread ? ' (spread)' : ' → ' + a.targets.map(N).join(', ')}${sees ? ' — ' + sees : ''}`;
      });
      const hp = e.hp ? ` <span class="hpline">→ ${e.hp.my.map(([i, h]) => `${N(i)} ${pct(h)}`).concat(e.hp.foe.map(([k, h]) => `${F(k)} ${pct(h)}`)).join(' · ')}</span>` : '';
      steps.push({ k: 'fight', text: `Turn ${e.n}: ${parts.join(' · ')}.${hp}` });
    }
    else if (e.t === 'abil') steps.push({ k: 'intim', text: `${e.side === 'my' ? N(e.k) : F(e.k)}: ${e.text}.` });
    else if (e.t === 'berry') steps.push({ k: 'berry', text: `${e.side === 'my' ? N(e.k) : F(e.k)}'s ${e.item} restores ${pct(e.amt)}.` });
    else if (e.t === 'aiswitch') steps.push({ k: 'send', text: e.pivot ? `${F(e.j)} uses ${e.why[0]} and the AI brings in <b>${F(e.k)}</b>.` : `${e.n ? `Turn ${e.n}: ` : ''}The AI switches ${F(e.j)} out (${e.why.join(', ')}) for <b>${F(e.k)}</b>${e.move ? `: your ${e.move} hits ${F(e.k)} instead` : ''}.` });
    else if (e.t === 'aimay') steps.push({ k: 'risk', text: `Heads-up: ${F(e.j)}'s ${e.why.replace(/^its /, '')}, so the AI is now likely (not certain) to switch it out, most likely to <b>${F(e.k)}</b>. If it does, your ${e.move || 'move'} hits ${F(e.k)} instead and ${F(e.j)} comes back later without the drop.` });
    else if (e.t === 'absorb') steps.push({ k: 'absorb', text: `Careful: ${F(e.j)} will switch to <b>${F(e.k)}</b>, whose ${e.ability} absorbs ${e.move}.` });
    else if (e.t === 'ko') steps.push({ k: 'ko', text: `${F(e.j)} goes down.${e.i != null && e.hp != null ? ` ${N(e.i)} is left with about ${pct(e.hp)}.` : ''}` });
    else if (e.t === 'send' && e.diag) steps.push({ k: 'send', text: `The AI sends <b>${F(e.k)}</b> into its ${e.slot ? 'right' : 'left'} slot, picked against ${N(e.i)}, your Pokémon diagonal to that slot${e.why.length ? ' (' + e.why.join(', ') + ')' : ''}.` });
    else if (e.t === 'send') steps.push({ k: 'send', text: `The AI sends <b>${F(e.k)}</b> next${e.why.length ? ' (against ' + N(e.i) + ', ' + e.why.join(', ') + ')' : e.i >= 0 ? ' (none of its Pokémon matches up well into ' + N(e.i) + ', so it goes in team order)' : ''}.` });
    else if (e.t === 'dswitch') steps.push({ k: 'switch', i: e.k, text: `${N(e.from)} switches out for <b>${N(e.k)}</b> (${e.slot ? 'right' : 'left'}).` });
    else if (e.t === 'switch') steps.push({ k: 'switch', i: e.k, text: `Switch to <b>${N(e.k)}</b>: it takes ${e.move || 'the hit'}${e.dmg ? ' (up to ' + pct(e.dmg) + ')' : ' with no damage'}, aimed at ${N(e.from)}.${e.left != null ? ` <span class="hpline">→ ${N(e.k)} ${pct(e.left)}</span>` : ''}` });
    else if (e.t === 'faint') steps.push({ k: 'faint', text: `<b>${N(e.i)}</b> is likely to faint${e.j != null ? ' to ' + F(e.j) : ''}.${e.fhp != null ? ` <span class="hpline">→ ${F(e.j)} ${pct(e.fhp)}</span>` : ''}` });
  }
  return steps;
}
function describe(M, st) {
  const N = i => M.mine[i].name, F = j => M.foes[j].name;
  const steps = stepsOf(M, st.log);
  const lostNames = [...new Set(st.lost)].map(N);
  const riskPct = Math.round((st.risk || 0) * 100);
  const verdict = !st.won ? (st.stall ? "No damage line: one of their Pokémon walls everything you have. Look at the PP stall tips below." : 'No winning line with these Pokémon.')
    : (lostNames.length ? `Win, but expect to lose ${lostNames.join(' and ')}.` : 'Win with no losses.') + (riskPct >= 1 ? ` Risk of another loss: about ${riskPct}% (${st.log.some(e => e.t === 'risk' && e.why === 'flinch') ? 'high rolls, crits and flinches' : 'high rolls and crits'}).` : '');
  const clean = cleanAnswers(M), winCons = [], dangers = [], tips = [];
  const zst = { mh: M.mine.map(() => 100), fa: M.foes.map(() => ZERO) };
  M.foes.forEach((fo, j) => {
    if ((fo.hp != null ? fo.hp : 100) <= 0) return;
    const a = clean[j];
    if (!a.length) dangers.push(`Nothing beats <b>${fo.name}</b> one-on-one without fainting; chip it first or bring a sacrifice.`);
    else if (a.length === 1) winCons.push(`<b>${N(a[0].i)}</b> is your only clean answer to ${fo.name}: keep it healthy for that fight.`);
    const fastKO = M.mine.map((_, i) => i).filter(i => { const mv = foeMove(M, zst, j, i); return mv && mv.hiP >= 100 && goesFirst(mv.prio, M.sFoe[j], 0, M.sMe[i], M.f.tr) > 0; });
    if (fastKO.length >= Math.ceil(M.mine.length / 2) && M.mine.length > 1) dangers.push(`${fo.name} outspeeds and OHKOs most of your team; don't let it in for free.`);
    const setup = M.statusMoves[j].filter(n => /Dance|Plot|Calm Mind|Bulk Up|Shell Smash|Swords|Quiver|Agility|Rock Polish|Coil|Belly Drum/.test(n));
    if (setup.length) dangers.push(`${fo.name} has ${setup.join(', ')}: KO it before it sets up.`);
    const stall = ppStall(M, j);
    if (stall) {
      const who = stall.list.map(x => x.kind === 'immune' ? `<b>${N(x.i)}</b> (takes nothing)` : `<b>${N(x.i)}</b> (takes up to ${pct(x.worst)}, heals with ${x.how}${x.protect ? ', can Protect' : ''})`).join(', ');
      tips.push(`PP stall ${fo.name}: ${who}. Its attacks (${stall.moves.join(', ')}) have ${stall.pp != null ? 'about ' + stall.pp + ' PP in total' : 'limited PP'}; once they run out it can only Struggle, which hurts itself. Switch in, then heal or Protect until it's out of PP.${stall.danger.length ? ` Watch out: it also has ${stall.danger.join(', ')}.` : ''}`);
      if (st.stall) winCons.push(`This fight stalls: use the PP stall on ${fo.name} below.`);
    }
    const ab = ABILITY_NOTES[fo.p.ability];
    if (ab) tips.push(`<b>${fo.name}</b>'s ${fo.p.ability}: ${ab}`);
    const hi = M.heal.foe[j];
    if (hi) tips.push(`${fo.name} holds a ${hi.item}: it heals ${pct(hi.amt)} once it drops to ${hi.at}% HP, so a 2HKO may need a third hit. Knock Off or a big first hit that takes it from above ${hi.at}% straight to 0 gets around it.`);
    const fm2 = fo.moves || [];
    if (fm2.includes('Leech Seed')) tips.push(`${fo.name} has Leech Seed (1/8 of your HP every turn, and it heals). Grass types are immune; switching out clears it.`);
    if (fm2.includes('Toxic') || fm2.includes('Toxic Spikes')) tips.push(`${fo.name} has ${fm2.includes('Toxic') ? 'Toxic' : 'Toxic Spikes'}: badly poisoned damage grows every turn (1/16, 2/16, 3/16...). Steel and Poison types are immune; switching resets the counter.`);
    if (fm2.includes('Will-O-Wisp')) tips.push(`${fo.name} has Will-O-Wisp: a burn halves your physical damage and takes 1/16 a turn. Fire types are immune.`);
    if (fm2.some(n => ['Sandstorm', 'Hail', 'Snowscape', 'Curse', 'Salt Cure', 'Whirlpool', 'Fire Spin', 'Sand Tomb', 'Infestation', 'Bind', 'Wrap', 'Magma Storm'].includes(n))) tips.push(`${fo.name} has ${fm2.filter(n => ['Sandstorm', 'Hail', 'Snowscape', 'Curse', 'Salt Cure', 'Whirlpool', 'Fire Spin', 'Sand Tomb', 'Infestation', 'Bind', 'Wrap', 'Magma Storm'].includes(n)).join(', ')}: count the end-of-turn damage before you stay in at low HP.`);
    if (fo.p.ability === 'Intimidate') {
      const fine = M.mine.filter(x => { const d = intimDelta(x.p); return !d || (d.atk || 0) >= 0 || (d.spa || 0) > 0 || x.p.rawStats.spa > x.p.rawStats.atk; }).map(x => x.name);
      tips.push(`${fo.name} has Intimidate.${fine.length ? ` <b>${fine.join(', ')}</b> ${fine.length > 1 ? "don't" : "doesn't"} mind it (immune, boosted by it, or special attackers).` : ' Your physical attackers lose a stage of Attack when it comes in.'}`);
    }
    if (M.f.doubles) {
      [...new Set((fo.moves || []).filter(n => isSpread(n) && !['Explosion', 'Self-Destruct', 'Misty Explosion'].includes(n)))].forEach(n => {
        const immune = M.mine.filter((_, i) => { const h = M.hits('foe', j, i, ZERO).find(x => x.name === n); return h && h.hiP === 0; }).map(x => x.name);
        tips.push(`${fo.name} loves ${n}: a spread move scores +8 for hitting both of you. ${immune.length ? `<b>${immune.join(', ')}</b> ${immune.length > 1 ? 'are' : 'is'} immune, so leading one turns it into a single-target hit worth +4 and the AI usually picks something else.` : 'Wide Guard, or Protect on the turn it fires, wastes it.'}`);
      });
      if ((fo.moves || []).includes('Fake Out')) tips.push(`${fo.name} has Fake Out and uses it on its first turn (+17) on whichever of your Pokémon threatens it most. A Ghost type or an Inner Focus Pokémon wastes it.`);
    }
  });
  const killers = {}; st.log.filter(e => e.t === 'ko' && e.i != null).forEach(e => { (killers[e.i] = killers[e.i] || []).push(F(e.j)); });
  Object.entries(killers).forEach(([i, js]) => { if (js.length >= 2) winCons.push(`<b>${N(+i)}</b> carries this fight (${js.join(', ')}).`); });
  return { won: st.won, lost: lostNames, risk: st.risk || 0, expected: st.lost.length + (st.risk || 0), log: st.log, steps, verdict, winCons, dangers, tips };
}

// Abilities worth knowing about before a fight (the ones the numbers alone don't show).
const ABILITY_NOTES = {
  'Sturdy': 'survives any single hit from full HP at 1 HP. Chip it first (or use a multi-hit move).',
  'Disguise': 'its first hit does nothing but break the disguise. Hit it with something weak or multi-hit first.',
  'Ice Face': 'its first physical hit does nothing (it comes back in snow). Use a special move first.',
  'Multiscale': 'takes half damage at full HP. Chip it first; hazards or a weak hit break it.',
  'Shadow Shield': 'takes half damage at full HP. Chip it first.',
  'Speed Boost': 'gets +1 Speed every turn: by turn 2 it probably outspeeds you.',
  'Moxie': 'gets +1 Attack every time it KOs. Don’t feed it a KO.',
  'Beast Boost': 'boosts its best stat every time it KOs.',
  'Unaware': 'ignores your stat boosts, so setting up does nothing against it.',
  'Shadow Tag': 'traps you: you can’t switch out while it’s in.',
  'Arena Trap': 'traps grounded Pokémon: you can’t switch out (Flying types and Levitate escape).',
  'Magnet Pull': 'traps Steel types.',
  'Prankster': 'its status moves go first (Dark types are immune to them).',
  'Regenerator': 'heals a third when it switches out.',
  'Contrary': 'stat drops boost it (Intimidate gives it +1 Attack).',
  'Simple': 'stat changes are doubled.',
  'Protean': 'becomes the type of the move it uses (STAB on everything).',
  'Libero': 'becomes the type of the move it uses (STAB on everything).',
  'Unburden': 'doubles its Speed once its item is used.',
  'Moody': 'raises one stat by 2 and lowers another every turn.',
  'Magic Guard': 'takes no damage from poison, burn, weather, Leech Seed or contact abilities.',
  'Wonder Guard': 'only super-effective hits damage it.',
  'Mold Breaker': 'ignores abilities like Sturdy, Levitate and Multiscale on your side.',
  'Huge Power': 'doubles its Attack.',
  'Pure Power': 'doubles its Attack.',
  'Guts': 'gets 1.5x Attack when it has a status: don’t burn or poison it.',
  'Marvel Scale': 'gets 1.5x Defense when it has a status.',
  'Rough Skin': 'contact moves cost you 1/8 of your HP.',
  'Iron Barbs': 'contact moves cost you 1/8 of your HP.',
  'Poison Heal': 'heals 1/8 a turn when poisoned instead of taking damage.',
  'Download': 'gets +1 Attack or Sp. Atk depending on which of your defences is lower.',
  'Intimidate': 'lowers your Attack by one when it comes in.',
  'Trace': 'copies your ability.',
  'Imposter': 'transforms into your Pokémon.',
  'Defiant': 'gets +2 Attack when one of its stats is lowered (so don’t Intimidate it).',
  'Competitive': 'gets +2 Sp. Atk when one of its stats is lowered.',
  'Sheer Force': 'its moves hit harder but lose their side effects (and Life Orb recoil).',
  'Technician': 'weak moves (60 power or less) get 1.5x.',
  'Skill Link': 'multi-hit moves always hit five times.',
  'No Guard': 'every move hits, both ways.',
  'Sniper': 'its critical hits do extra damage.',
  'Tinted Lens': 'its resisted hits do double damage.',
  'Adaptability': 'its same-type moves get 2x instead of 1.5x.',
};

// How the doubles AI thinks, for the help text on both pages (from CFRU's Battle_AI source).
const DOUBLES_AI_NOTES = [
  'Each of its Pokémon scores every attack against each of your Pokémon: +4 per Pokémon it hits, +2 per KO, +1 if it is its strongest move into that target, −3 if it also hits its own partner.',
  'So a spread move that hits both of you (8 points) beats a single-target KO (6). Make a spread move hit only one of you (an immunity, Wide Guard) and it loses most of its appeal.',
  'Weak hits barely count: under a third of your HP it loses 2 points, under a quarter it loses 3. A Pokémon that resists everything draws little attention.',
  'Ties go to the move that KOs more, then to whichever of your Pokémon can KO it (the bigger threat), then to more damage.',
  "The faster AI Pokémon picks first and its partner ignores a target that will already be KO'd, so the slower one goes after your other Pokémon.",
  'Fake Out on its first turn outranks almost everything, and it goes on whichever of your Pokémon threatens it most.',
  'It only holds back Earthquake-style moves when its own partner would take damage, so it fires them freely next to Flying types and Levitate users.',
  'Replacements bait in diagonals: when one of its slots empties, the AI picks the Pokémon that matches up best against your Pokémon diagonal to that slot (its left faces your left across the field). Put the Pokémon you want to bait against on that side before the KO.'
];

/* predictDoubles({ mine, foes, f, myActive, myActive2, foeActive, foeActive2 }): what each AI Pokémon on the field
   will most likely do this turn under CFRU's doubles scoring, and which of your Pokémon it sees a fast or slow kill on. */
function predictDoubles(opt) {
  const M = buildMatrix(opt.mine, opt.foes, Object.assign({}, opt.f, { doubles: true }));
  const st = { act: [opt.myActive, opt.myActive2 != null ? opt.myActive2 : -1], out: [opt.foeActive, opt.foeActive2 != null ? opt.foeActive2 : -1],
    mh: opt.mine.map(x => x.hp != null ? x.hp : 100), fh: opt.foes.map(x => x.hp != null ? x.hp : 100), ma: opt.mine.map(() => ZERO), fa: opt.foes.map(() => ZERO), fresh: opt.fresh || [] };
  const aiOut = st.out.filter(k => k >= 0 && st.fh[k] > 0).sort((a, b) => M.sFoe[b] - M.sFoe[a]);
  const out = [], partnerKOs = [];
  aiOut.forEach(j => {
    const c = aiChoiceDoubles(M, st, j, partnerKOs); if (!c) return;
    c.sees = c.fakeOut ? [] : c.targets.map(i => {
      const h = M.hits('foe', j, i, ZERO).find(x => x.name === c.name);
      if (!h || h.hiP < st.mh[i]) return null;
      return { i, kind: goesFirst(h.prio, M.sFoe[j], 0, M.sMe[i], M.f.tr) > 0 ? 'fast' : 'slow' };
    }).filter(Boolean);
    c.sees.forEach(x => partnerKOs.push(x.i));
    out.push(c);
  });
  return out;
}

// Quick doubles lead pair (the top of a full doubles line).
function doublesLead(mine, foes, f) {
  const r = plan({ mine, foes, f: Object.assign({}, f, { doubles: true }) });
  const lead = r && r.log.find(e => e.t === 'lead2');
  return lead ? { pair: lead.pair.filter(i => i >= 0).map(i => mine[i]) } : null;
}

/* itemIdeas(opt, res, avail): held items worth giving your Pokémon for this fight. Each idea is tested by planning the fight again.
   avail(item) -> null when you can't get it yet, else where to get it (no avail = assume everything).
   Status berries: Lum Berry cures anything once; when it isn't available yet the specific berry for what the AI actually uses steps in
   (Pecha poison, Rawst burn, Cheri paralysis, Chesto sleep; Chesto or Lum also turn Rest into a full heal with no sleep).
   Then HP items (Sitrus, Leftovers) and Focus Sash for a Pokémon that goes down. Returns [{ i, name, item, from, to, where, why }] best first. */
const STATUS_BERRY = { slp: 'Chesto Berry', brn: 'Rawst Berry', par: 'Cheri Berry', psn: 'Pecha Berry', tox: 'Pecha Berry' };
const ITEM_WHY = {
  'Lum Berry': 'cures the first status it gets (sleep, burn, paralysis or poison)', 'Chesto Berry': 'wakes it from sleep straight away', 'Rawst Berry': 'cures a burn straight away',
  'Cheri Berry': 'cures paralysis straight away', 'Pecha Berry': 'cures poison straight away', 'Sitrus Berry': 'heals 25% once it drops to half', 'Leftovers': 'heals 1/16 every turn',
  'Focus Sash': 'survives one hit from full HP', 'Oran Berry': 'heals 10 HP at half'
};
function itemIdeas(opt, res, avail) {
  if (!res || !res.st || opt.f.doubles) return [];
  const mine = res.team && opt.mine.length > 6 ? res.team.map(i => opt.mine[i]) : opt.mine;
  const base = cost(res.st), baseExp = res.st.lost.length + (res.st.risk || 0);
  const ok = n => (avail ? avail(n) : '');
  // statuses the AI can inflict in this fight
  const inflicts = new Set();
  opt.foes.forEach(fo => (fo.moves || []).forEach(n => { const fx = FX[n]; if (fx && fx.status) inflicts.add(fx.status); if (n === 'Yawn') inflicts.add('slp'); }));
  const trouble = new Set(res.st.lost);
  res.log.forEach(e => { if (e.t === 'risk' && e.p >= 0.03) trouble.add(e.i); if (e.t === 'fight' && e.chg && e.chg.myZ) trouble.add(e.i); });
  const out = [];
  const tryItem = (i, item, why) => {
    const x = mine[i]; if (!x || x.p.item === item) return null;
    const where = ok(item); if (where == null) return null;
    const q = x.p.clone(); q.item = item;
    const m2 = mine.slice(); m2[i] = Object.assign({}, x, { p: q });
    const r = plan(Object.assign({}, opt, { mine: m2 })); if (!r) return null;
    const c = cost(r.st), gain = base - c;
    const to = r.st.lost.length + (r.st.risk || 0);
    return gain >= 60 && to <= baseExp - 0.05 ? { i, name: x.name, item, replaces: x.p.item || '', where, gain, from: baseExp, to, why: why || ITEM_WHY[item] || '' } : null;
  };
  let runs = 0;
  mine.forEach((x, i) => {
    if (runs > 14) return;
    const rest = (x.moves || []).includes('Rest');
    const cands = [];
    if (inflicts.size || rest) {
      cands.push(['Lum Berry']);
      const specific = [...new Set([...inflicts].map(z => STATUS_BERRY[z]).concat(rest ? ['Chesto Berry'] : []))];
      specific.forEach(b => cands.push([b, b === 'Chesto Berry' && rest ? 'with Rest: a full heal without falling asleep' : null]));
    }
    if (trouble.has(i)) cands.push(['Sitrus Berry'], ['Leftovers'], ['Focus Sash']);
    if (!cands.length || (!trouble.has(i) && !rest && ![...inflicts].length)) return;
    if (!trouble.has(i) && !rest) { const hitBy = res.log.some(e => e.t === 'fight' && e.i === i && e.fmStatus); if (!hitBy) return; }
    let lumOK = false;
    for (const [item, why] of cands) {
      if (runs > 14) break;
      if (item !== 'Lum Berry' && lumOK && STATUS_BERRY_SET.has(item)) continue; // a Lum already does this
      runs++;
      const r = tryItem(i, item, why);
      if (r) { out.push(r); if (item === 'Lum Berry') lumOK = true; }
    }
  });
  out.sort((a, b) => b.gain - a.gain);
  // one idea per Pokémon (with its alternatives listed), best first
  const by = new Map();
  out.forEach(r => { if (!by.has(r.i)) by.set(r.i, Object.assign({}, r, { alts: [] })); else by.get(r.i).alts.push(r); });
  return [...by.values()];
}
const STATUS_BERRY_SET = new Set(Object.values(STATUS_BERRY));

/* trade({ me, foe, f }): a straight damage race from where both are now, for the damage calc. You keep using one move
   (each of yours is tried), it keeps using its strongest hit (worst case, no guessing at the AI), with healing (drain
   moves, Leftovers, berries, Leech Seed), end-of-turn damage, Sturdy and the like counted.
   Returns the best of your moves: { move, won, turns, myHp, foeHp, healed } with HP in %. */
/* Words for the damage calc. recText(recovery result): what the move gives its user back ({ text, bad }).
   tradeText(trade result): who wins a straight exchange of hits ({ text, good }). */
const pc0 = x => Math.round(x) + '%';
const rng0 = (a, b) => (Math.round(a) === Math.round(b) ? pc0(a) : Math.round(Math.min(a, b)) + '–' + pc0(Math.max(a, b)));
function recText(R) {
  if (!R) return null;
  const tri = R.triage ? ' · Triage: it goes first' : '';
  if (R.kind === 'drain') return R.ooze ? { bad: true, text: `Liquid Ooze: loses ${rng0(-R.lo, -R.hi)} instead of healing` } : { text: `heals ${rng0(R.lo, R.hi)}${R.bell ? ' (Shell Bell)' : ''}${tri}` };
  if (R.kind === 'heal') return R.ooze ? { bad: true, text: `Liquid Ooze: loses ${pc0(R.lo)}` } : { text: (R.rest ? 'heals to full, then sleeps 2 turns' : `heals ${pc0(R.lo)}`) + tri };
  if (R.kind === 'wish') return { text: `heals ${pc0(R.lo)} at the end of the next turn` };
  if (R.kind === 'split') return { text: `Pain Split: the user goes to about ${pc0(R.lo)}, the target to about ${pc0(R.hi)}` };
  if (R.kind === 'seed') return R.immune ? { text: 'Leech Seed: Grass types are immune' } : R.ooze ? { bad: true, text: `Leech Seed into Liquid Ooze: loses ${pc0(R.lo)} a turn` } : { text: `Leech Seed: heals ${pc0(R.lo)} a turn` };
  return R.triage ? { text: 'Triage: it goes first' } : null;
}
function tradeText(t) {
  if (!t) return null;
  const healed = t.healed >= 1 ? ` (it heals you ${pc0(t.healed)} along the way)` : '';
  return t.won ? { good: true, text: `you win it with ${t.move} in ${t.turns} turn${t.turns === 1 ? '' : 's'} even on your low rolls, ending at about ${pc0(t.myHp)}${healed}` }
    : { good: false, text: `you lose it: your best try, ${t.move}, leaves it at about ${pc0(t.foeHp)}${healed}` };
}
/* Theory crafting: one of your Pokémon against each of their team, at the HP you give it.
   Per opponent: its worst hit on you and your best hit on it (all moves too), who moves first, a straight 1v1 (trade(),
   played safe), and its CFRU switch-in score against your Pokémon: when one of theirs faints while yours is out, the AI
   sends the highest score, so `bait` (highest first) is who your Pokémon pulls in. Their lead is always their first. */
function theory(opt) {
  const { me, foes, f } = opt;
  if (!me || !me.p || !foes || !foes.length) return null;
  const M = buildMatrix([me], foes, f || {});
  const st = Object.assign(blankSt(M, [me.hp != null ? me.hp : 100], foes.map(x => (x.hp != null ? x.hp : 100))), { i: 0, j: -1, out: [] });
  st.log = NOLOG;
  const pick = hs => hs.reduce((a, h) => (!a || h.hiP > a.hiP ? h : a), null);
  const rows = foes.map((fo, k) => {
    if (st.fh[k] <= 0) return null;
    const theirs = hitsOf(M, st, 'foe', k, 0).filter(h => h.hiP > 0), mine = hitsOf(M, st, 'my', 0, k).filter(h => h.hiP > 0);
    const sw = switchScore(M, st, k, 0);
    let t = null; try { t = trade({ me, foe: fo, f }); } catch (e) { t = null; }
    const first = goesFirst(0, M.sMe[0], 0, M.sFoe[k], M.f.tr);
    const s1 = Object.assign(cloneSt(st), { j: k, out: [k], ft: 0, mt: 0 }); s1.log = NOLOG;
    let fa = null; try { fa = foeAct0(M, s1, k, 0); } catch (e) { fa = null; }
    return { k, name: fo.name, worst: pick(theirs), best: pick(mine), theirs, mine, sMe: M.sMe[0], sFoe: M.sFoe[k], first, bait: sw.s, why: sw.why, trade: t, odds: fa ? fa.odds : [] };
  }).filter(Boolean);
  return { rows, bait: rows.slice().sort((x, y) => y.bait - x.bait) };
}
/* "If doubled": for each of your Pokémon on the field, both of theirs aim their strongest hit at it (high rolls, spread
   moves at their doubles strength). Is that a KO, and would either alone do it? pred = the AI is already set to do it. */
function doubledRisk(M, st, aiPicks) {
  const W = MW(M, st), foesOut = st.out.filter(k => k >= 0 && st.fh[k] > 0);
  if (foesOut.length < 2) return [];
  return st.act.filter(i => i >= 0 && st.mh[i] > 0).map(i => {
    const parts = foesOut.map(k => {
      const hs = W.hits('foe', k, i, st.fa[k]).filter(h => h.hiP > 0 && h.name !== 'Fake Out');
      const h = hs.reduce((a, x) => (!a || x.hiP > a.hiP ? x : a), null);
      return h ? { k, name: M.foes[k].name, move: h.label, loP: h.loP, hiP: h.hiP } : { k, name: M.foes[k].name, move: '', loP: 0, hiP: 0 };
    });
    const lo = parts.reduce((a, x) => a + x.loP, 0), hi = parts.reduce((a, x) => a + x.hiP, 0), hp = st.mh[i];
    const alone = parts.some(x => x.hiP >= hp);
    const pred = !!(aiPicks && aiPicks.length >= 2 && aiPicks.every(a => (a.targets || (a.dmg || []).map(d => d.i)).includes(i)));
    return { i, name: M.mine[i].name, hp, parts, lo, hi, ko: hi >= hp, sure: lo >= hp, alone, pred };
  });
}
/* Theory craft for a double battle: your pair (left, right) against their two leads.
   theoryDoubles({ pair: [a, b] (your Pokémon, a on the left), foes, f, lead: [k1, k2] }) ->
   { grid (each of yours vs each of theirs), ai (what each lead does this turn, and the kills it sees), bait: per slot of
   theirs, its replacement ranked against your Pokémon diagonal to it (and what changes if you swap sides) }. */
function theoryDoubles(opt) {
  const { pair, foes } = opt, f = Object.assign({}, opt.f || {}, { doubles: true });
  if (!pair || !pair[0] || !pair[0].p || !foes || !foes.length) return null;
  const mine = pair.filter(x => x && x.p), M = buildMatrix(mine, foes, f);
  const fh = foes.map(x => (x.hp != null ? x.hp : 100));
  const st = Object.assign(blankSt(M, mine.map(x => (x.hp != null ? x.hp : 100)), fh), { act: mine.map((_, i) => i), turn: 0 });
  const a = opt.lead && opt.lead[0] != null ? opt.lead[0] : fh.findIndex(h => h > 0);
  const b = opt.lead && opt.lead[1] != null ? opt.lead[1] : fh.findIndex((h, k) => h > 0 && k !== a);
  st.out = [a, b]; st.fresh = st.act.map(i => 'm' + i).concat(st.out.filter(k => k >= 0).map(k => 'f' + k));
  // on the way in: Intimidate, weather and terrain setters (faster side first)
  st.log = [];
  const ins = st.act.map(i => ({ side: 'my', k: i, s: M.sMe[i] })).concat(st.out.filter(k => k >= 0).map(k => ({ side: 'foe', k, s: M.sFoe[k] }))).sort((x, y) => y.s - x.s);
  ins.forEach(x => (x.side === 'my' ? enterMine(M, st, x.k, st.out, st.log, true) : enterFoe(M, st, x.k, st.act, st.log, true)));
  const entry = stepsOf(M, st.log).map(x => x.text);
  st.log = NOLOG;
  const W = MW(M, st);
  const grid = mine.map((me, i) => ({ i, name: me.name, spe: W.sMe[i], vs: foes.map((fo, k) => {
    const yours = W.hits('my', i, k, st.ma[i]).filter(h => h.hiP > 0), theirs = W.hits('foe', k, i, st.fa[k]).filter(h => h.hiP > 0);
    const best = yours.reduce((x, h) => (!x || h.hiP > x.hiP ? h : x), null), worst = theirs.reduce((x, h) => (!x || h.hiP > x.hiP ? h : x), null);
    return { k, name: fo.name, best, worst, first: goesFirst(0, W.sMe[i], 0, W.sFoe[k], W.f.tr), koIt: best ? canKO(W, st, 'foe', k, best.hiP, best.cat) : false, koYou: worst ? worst.hiP >= st.mh[i] : false };
  }) }));
  // what their leads do on turn 1 (fastest first, each ignoring targets its partner already KOs)
  const partnerKOs = [], ai = [];
  st.out.filter(k => k >= 0).sort((x, y) => W.sFoe[y] - W.sFoe[x]).forEach(j => {
    const c = aiChoiceDoubles(M, st, j, partnerKOs); if (!c) return;
    const dmg = c.targets.map(i => { const h = W.hits('foe', j, i, st.fa[j]).find(x => x.name === c.name); return { i, loP: h ? h.loP : 0, hiP: h ? h.hiP : 0, ko: h ? h.hiP >= st.mh[i] : false }; });
    if (!c.fakeOut) dmg.forEach(d => { if (d.ko) partnerKOs.push(d.i); });
    const myFirst = c.targets.map(i => goesFirst(0, W.sMe[i], c.prio || 0, W.sFoe[j], W.f.tr) > 0);
    ai.push({ j, name: c.name, spread: c.spread, fakeOut: !!c.fakeOut, dmg, sees: dmg.filter(d => d.ko).map(d => ({ i: d.i, kind: myFirst[c.targets.indexOf(d.i)] ? 'slow' : 'fast' })) });
  });
  // bait: if their slot s empties, the replacement is scored against your Pokémon in the same slot on your side (diagonal)
  const bench = foes.map((_, k) => k).filter(k => fh[k] > 0 && !st.out.includes(k));
  const rank = (vs, from) => bench.filter(k => from < 0 || M.group(k) === M.group(from)).map(k => ({ k, name: foes[k].name, ...switchScore(M, st, k, vs) })).sort((x, y) => y.s - x.s);
  const bait = st.out.map((k, s) => {
    const diag = st.act[s] != null && st.act[s] >= 0 ? st.act[s] : st.act[0], other = st.act.find((i, t) => t !== s && i >= 0);
    return { slot: s, out: k, outName: k >= 0 ? foes[k].name : '', diag, diagName: mine[diag] ? mine[diag].name : '', list: rank(diag, k), swapName: other != null && other !== diag ? mine[other].name : '', swap: other != null && other !== diag ? rank(other, k) : [] };
  });
  return { grid, ai, bait, lead: st.out.slice(), entry, doubled: doubledRisk(M, st, ai) };
}
/* ======================= battle sandbox =======================
   Play a fight yourself, turn by turn: you pick each move or switch, the AI answers by the same CFRU rules the
   planner uses (foeAct, absorber switches, nextFoe send-ins), damage and effects as in the plans (a KO when it's at
   least 50% likely, else the average roll; end-of-turn damage, berries, weather...). Singles.
   sbStart({ mine, foes, f, lead }) -> S;  sbOptions(S) -> { need, moves, switches, me, foe, aiNext };
   sbStep(S, { move } | { switch: k }) / sbReplace(S, k) -> lines of text for what happened;  sbUndo(S). */
function sbStart(opt) {
  const { mine, foes, f } = opt;
  if (!mine.length || !foes.length) return null;
  if (f && f.doubles) return sbStartDoubles(opt);
  const M = buildMatrix(mine, foes, f || {});
  const st = blankSt(M, mine.map(x => (x.hp != null ? x.hp : 100)), foes.map(x => (x.hp != null ? x.hp : 100)));
  const lead = opt.lead != null && st.mh[opt.lead] > 0 ? opt.lead : st.mh.findIndex(h => h > 0);
  Object.assign(st, { i: lead, j: st.fh.findIndex(h => h > 0), log: [], ft: 0, mt: 0 });
  st.out = [st.j];
  st.log.push({ t: 'lead', i: st.i, j: st.j });
  st.ma[st.i] = ZERO; st.fa[st.j] = ZERO;
  if (spe(M, st, 'my', st.i) >= spe(M, st, 'foe', st.j)) { enterMine(M, st, st.i, [st.j], st.log, true); enterFoe(M, st, st.j, [st.i], st.log, true); }
  else { enterFoe(M, st, st.j, [st.i], st.log, true); enterMine(M, st, st.i, [st.j], st.log, true); }
  const S = { M, st, hist: [], need: null, done: false, won: false, turn: 0, absorbed: {}, lines: [] };
  S.lines = stepsOf(M, st.log).map(x => x.text);
  return S;
}
function sbOptions(S) {
  if (S.dbl) return sbOptionsDoubles(S);
  const { M, st } = S, i = st.i, j = st.j;
  const alive = st.mh.map((h, k) => (h > 0 ? k : -1)).filter(k => k >= 0);
  if (S.done) return { done: true, won: S.won };
  if (S.need === 'replace') {
    // what each of theirs does to each Pokémon you could send in
    const foes = M.foes.map((x, k) => ({ k, name: x.name, species: x.p.name, hp: st.fh[k], item: x.p.item || '', ability: x.p.ability || '',
      vs: st.fh[k] > 0 ? alive.map(c => { const hs = hitsOf(M, st, 'foe', k, c); return { k: c, faster: goesFirst(0, spe(M, st, 'foe', k), 0, spe(M, st, 'my', c), M.f.tr) > 0, moves: (x.moves || []).filter(n => MOVES[n]).map(n => { const h = hs.find(z => z.name === n); return h ? { label: h.label, loP: h.loP, hiP: h.hiP, ko: h.hiP >= st.mh[c] } : { label: n, status: isStatus(n) }; }) }; }) : [] }));
    return { need: 'replace', switches: alive.map(k => ({ k, name: M.mine[k].name, hp: st.mh[k] })), foes };
  }
  const hs = hitsOf(M, st, 'my', i, j);
  const moves = (M.mine[i].moves || []).filter(n => MOVES[n]).map(n => {
    const h = hs.find(x => x.name === n);
    if (h) return { name: n, label: h.label, loP: h.loP, hiP: h.hiP, prio: h.prio, ko: canKO(M, st, 'foe', j, h.hiP, h.cat), usable: usable(M, st, i, h) };
    return { name: n, label: n, status: isStatus(n), loP: 0, hiP: 0 };
  });
  const fa = foeAct(M, st, j, i);
  const info = (side, k) => { const p = sideP(M, side, k), arr = side === 'my' ? st.mh : st.fh; return { name: (side === 'my' ? M.mine : M.foes)[k].name, species: p.name, hp: arr[k], st: stArr(st, side)[k] || ZERO, z: zArr(st, side)[k] || '', spe: spe(M, st, side, k) }; };
  return { need: null, moves, switches: alive.filter(k => k !== i).map(k => ({ k, name: M.mine[k].name, hp: st.mh[k] })), me: info('my', i), foe: info('foe', j),
    foes: M.foes.map((x, k) => {
      // what each of theirs would do to your Pokémon on the field (for a hover / tap peek)
      const hs = st.fh[k] > 0 ? hitsOf(M, st, 'foe', k, i) : [], me = spe(M, st, 'my', i), it = spe(M, st, 'foe', k);
      return { k, name: x.name, species: x.p.name, hp: st.fh[k], item: x.p.item || '', ability: x.p.ability || '', faster: goesFirst(0, it, 0, me, M.f.tr) > 0,
        moves: (x.moves || []).filter(n => MOVES[n]).map(n => { const h = hs.find(z => z.name === n); return h ? { label: h.label, loP: h.loP, hiP: h.hiP, ko: h.hiP >= st.mh[i] } : { label: n, status: isStatus(n) }; }) };
    }), aiNext: fa ? (fa.h ? fa.h.label : fa.name) : null, odds: fa ? fa.odds : [], wx: wxNow(M, st) };
}
// After a turn: KOs, the AI's next Pokémon, your replacement.
function sbAfter(S) {
  const { M, st } = S, i = st.i, j = st.j;
  if (st.fh[j] <= 0) {
    st.log.push({ t: 'ko', j, i: st.mh[i] > 0 ? i : null, hp: st.mh[i] > 0 ? st.mh[i] : null });
    if (st.fh.every(h => h <= 0)) { S.done = true; S.won = true; }
    else {
      const vs = st.mh[i] > 0 ? [i] : st.mh.map((h, k) => (h > 0 ? k : -1)).filter(k => k >= 0);
      const nx = nextFoe(M, st, vs, j);
      let k = nx.k >= 0 ? nx.k : nextFoe(M, st, vs).k; if (k < 0) k = st.fh.findIndex(h => h > 0);
      st.log.push({ t: 'send', k, i: st.mh[i] > 0 ? i : -1, why: nx.k >= 0 ? nx.why : [] });
      st.j = k; st.out = [k]; st.ft = 0; st.fseed = 0; enterFoe(M, st, k, st.mh[i] > 0 ? [i] : [], st.log);
    }
  }
  if (st.mh[i] <= 0) {
    st.lost.push(i); st.log.push({ t: 'faint', i, j: st.j });
    if (st.mh.every(h => h <= 0)) { S.done = true; S.won = false; } else if (!S.done) S.need = 'replace';
  }
}
function sbStep(S, choice) {
  if (S.dbl) return sbStepDoubles(S, choice);
  if (S.done || S.need) return [];
  const { M } = S, st = S.st, i = st.i, j = st.j, at = st.log.length;
  S.hist.push({ st: cloneSt(st), need: S.need, done: S.done, won: S.won, turn: S.turn, absorbed: Object.assign({}, S.absorbed), lines: S.lines.length });
  S.turn++;
  if (choice.switch != null) {
    const k = choice.switch, fa = foeAct(M, st, j, i);
    if (stuck(M, st, 'my', i)) { S.hist.pop(); S.turn--; return ['<b class="warn">You can\'t switch out: it\'s trapped.</b>']; }
    if (fa && fa.name === 'Pursuit') { const ph = hitsOf(M, st, 'foe', j, i).find(h => h.name === 'Pursuit'); if (ph) act(M, st, 'foe', j, i, { name: 'Pursuit', label: 'Pursuit (doubled on a switch)', h: Object.assign({}, ph, { lo: ph.lo * 2, hi: ph.hi * 2, loP: ph.loP * 2, hiP: ph.hiP * 2 }) }, false, st.log); }
    leaveField(M, st, 'my', i);
    st.ma[i] = ZERO; st.tx = Object.assign({}, st.tx, { ['m' + i]: 0 }); st.seed = 0;
    st.tk = { m: 1, f: 0, mh: 0, fh: 0 };
    st.i = k; st.mt = 0;
    let dmg = 0;
    if (fa && fa.h) { const into = hitsOf(M, st, 'foe', j, k).find(h => h.name === fa.name); if (into) { const b = st.mh[k]; act(M, st, 'foe', j, k, { name: fa.name, label: fa.h.label, h: into }, false, st.log); dmg = b - st.mh[k]; } }
    else if (fa) act(M, st, 'foe', j, k, fa, false, st.log);
    st.log.push({ t: 'switch', from: i, k, j, move: fa && (fa.h ? fa.h.label : fa.name), dmg, left: st.mh[k] });
    if (st.mh[k] > 0) { enterMine(M, st, k, [j], st.log); if (st.fh[j] > 0) endTurn(M, st, k, j); }
    st.ft++; st.tn = (st.tn || 0) + 1;
  } else {
    const n = choice.move, h = hitsOf(M, st, 'my', i, j).find(x => x.name === n) || null;
    const mm = { name: n, label: h ? h.label : n, h };
    // a teammate whose ability absorbs your attack comes in instead (once per Pokémon of theirs)
    if (h && !S.absorbed[j]) {
      const ab = absorber(M, st, h);
      if (ab >= 0) {
        S.absorbed[j] = 1;
        st.log.push({ t: 'absorb', j, k: ab, i, move: h.label, ability: M.foes[ab].p.ability });
        st.out = [ab]; st.j = ab; st.ft = 0; st.fseed = 0; enterFoe(M, st, ab, [i], st.log);
        const lines = stepsOf(M, st.log.slice(at)).map(x => x.text); S.lines.push(...lines); return lines;
      }
    }
    const sw = aiSwitchPick(M, st, i, j);
    if (sw) {
      aiDoSwitch(M, st, i, j, sw, mm, st.log, S.turn);
      sbAfter(S);
      const ls = stepsOf(M, st.log.slice(at)).map(x => x.text); S.lines.push(...ls); return ls;
    }
    const before = { ma: Object.assign({}, st.ma[i]), fa: Object.assign({}, st.fa[j]), ms: st.ms[i], fs: st.fs[j] };
    const fa = foeAct(M, st, j, i), fh = fa && fa.h;
    const sAi = spe(M, st, 'foe', j), sMe = spe(M, st, 'my', i);
    const meFirst = !fa || goesFirst(h ? h.prio : statusPrio(M, 'my', i, n), sMe, fh ? fh.prio : (fa ? statusPrio(M, 'foe', j, fa.name) : 0), sAi, M.f.tr) > 0;
    const aiKill = fh && canKO(M, st, 'my', i, fh.hiP, fh.cat) ? (meFirst ? 'slow' : 'fast') : '';
    const pk = h ? koP(effDmg(M, st, 'foe', j, h.loP), effDmg(M, st, 'foe', j, h.hiP), st.fh[j]) * h.acc : 0;
    const myKill = h && canKO(M, st, 'foe', j, h.hiP, h.cat) && pk > 0 ? (pk < 0.5 ? 'roll' : meFirst ? 'fast' : 'slow') : '';
    const mark = st.log.length;
    const r = playTurn(M, st, i, j, mm, st.log, fa);
    const chg = { my: diffSt(before.ma, st.ma[i]), foe: diffSt(before.fa, st.fa[j]), myZ: st.ms[i] !== before.ms ? st.ms[i] : '', foeZ: st.fs[j] !== before.fs ? st.fs[j] : '' };
    const hl = st.hl || { m: 0, f: 0 };
    st.log.splice(mark, 0, { t: 'fight', heal: { me: hl.m, foe: hl.f }, n: 2, i, j, mm: mm.label, setup: !h, fm: fa && (fa.h ? fa.h.label : fa.name), fmStatus: fa && !fa.h, tie: fa && fa.tie, fmHi: fh ? fh.hiP : 0, mmLo: h ? h.loP : 0, mmHi: h ? h.hiP : 0, meFirst: r.meFirst, aiKill, myKill, pk, chg, mhp: st.mh[i], fhp: st.fh[j], resMe: r.rMe, resFoe: r.rFoe });
    st.tn = (st.tn || 0) + 1;
  }
  sbAfter(S);
  const lines = stepsOf(M, st.log.slice(at)).map(x => x.text.replace(/^Turn 2: /, 'Turn ' + S.turn + ': ').replace(' Worth it here.', ''));
  S.lines.push(...lines);
  return lines;
}
function sbReplace(S, k) {
  if (S.dbl) return sbReplaceDoubles(S, k);
  const { M, st } = S;
  if (S.need !== 'replace' || !(st.mh[k] > 0)) return [];
  S.hist.push({ st: cloneSt(st), need: S.need, done: S.done, won: S.won, turn: S.turn, absorbed: Object.assign({}, S.absorbed), lines: S.lines.length });
  const at = st.log.length;
  st.log.push({ t: 'in', i: k, j: st.j }); st.i = k; st.mt = 0; S.need = null;
  enterMine(M, st, k, [st.j], st.log);
  const lines = stepsOf(M, st.log.slice(at)).map(x => x.text); S.lines.push(...lines);
  return lines;
}
/* Doubles sandbox: two of yours (lead = [left, right]) against their two leads. Each turn you pick a move and a target for
   both; the AI picks with the doubles rules (aiChoiceDoubles), and replaces a fainted Pokémon with the best answer to your
   Pokémon diagonal to that slot. Status moves aren't played in doubles (they show as "no effect"). */
function sbStartDoubles(opt) {
  const { mine, foes } = opt, f = Object.assign({}, opt.f, { doubles: true });
  const M = buildMatrix(mine, foes, f);
  const st = blankSt(M, mine.map(x => (x.hp != null ? x.hp : 100)), foes.map(x => (x.hp != null ? x.hp : 100)));
  const alive = st.mh.map((h, k) => (h > 0 ? k : -1)).filter(k => k >= 0);
  const l = opt.lead || [];
  const a = l[0] != null && st.mh[l[0]] > 0 ? l[0] : alive[0];
  const b = l[1] != null && st.mh[l[1]] > 0 && l[1] !== a ? l[1] : alive.find(k => k !== a);
  const fa = st.fh.findIndex(h => h > 0), fb = st.fh.findIndex((h, k) => h > 0 && k !== fa);
  Object.assign(st, { act: [a, b != null ? b : -1], out: [fa, fb], log: [], turn: 0, pending: null });
  st.fresh = st.act.filter(i => i >= 0).map(i => 'm' + i).concat(st.out.filter(k => k >= 0).map(k => 'f' + k));
  st.log.push({ t: 'lead2', pair: st.act.slice(), foes: st.out.slice() });
  st.act.filter(i => i >= 0).forEach(i => enterMine(M, st, i, st.out, st.log, true));
  st.out.filter(k => k >= 0).forEach(k => enterFoe(M, st, k, st.act, st.log, true));
  const S = { M, st, dbl: true, hist: [], need: null, done: false, won: false, turn: 0, lines: [] };
  S.lines = stepsOf(M, st.log).map(x => x.text);
  return S;
}
function sbOptionsDoubles(S) {
  const { M, st } = S;
  if (S.done) return { done: true, won: S.won, dbl: true };
  const W = MW(M, st), alive = st.mh.map((h, k) => (h > 0 ? k : -1)).filter(k => k >= 0);
  const foesOut = st.out.filter(k => k >= 0 && st.fh[k] > 0), myOut = st.act.filter(i => i >= 0 && st.mh[i] > 0);
  const info = (side, k) => { const p = sideP(M, side, k), arr = side === 'my' ? st.mh : st.fh; return { k, name: (side === 'my' ? M.mine : M.foes)[k].name, species: p.name, hp: arr[k], st: stArr(st, side)[k] || ZERO, z: zArr(st, side)[k] || '', spe: spe(M, st, side, k) }; };
  const foes = M.foes.map((x, k) => ({ k, name: x.name, species: x.p.name, hp: st.fh[k], item: x.p.item || '', ability: x.p.ability || '', out: st.out.includes(k),
    vs: st.fh[k] > 0 ? alive.map(c => { const hs = W.hits('foe', k, c, st.fa[k]); return { k: c, faster: goesFirst(0, spe(M, st, 'foe', k), 0, spe(M, st, 'my', c), M.f.tr) > 0, moves: (x.moves || []).filter(n => MOVES[n]).map(n => { const h = hs.find(z => z.name === n); return h ? { label: h.label, loP: h.loP, hiP: h.hiP, ko: h.hiP >= st.mh[c] } : { label: n, status: isStatus(n) }; }) }; }) : [] }));
  const base = { dbl: true, me: st.act.map(i => (i >= 0 && st.mh[i] > 0 ? info('my', i) : null)), foe: st.out.map(k => (k >= 0 && st.fh[k] > 0 ? info('foe', k) : null)), foes, wx: wxNow(M, st) };
  if (S.need === 'replace') return Object.assign(base, { need: 'replace', slot: st.slot, diagOf: st.out[st.slot], switches: alive.filter(k => !st.act.includes(k)).map(k => ({ k, name: M.mine[k].name, hp: st.mh[k] })) });
  // your two: every move into each target (spread moves hit both)
  const mons = myOut.map(i => ({ i, slot: st.act.indexOf(i), name: M.mine[i].name, moves: (M.mine[i].moves || []).filter(n => MOVES[n]).map(n => {
    const spread = isSpread(n), vs = foesOut.map(k => { const h = W.hits('my', i, k, st.ma[i]).find(x => x.name === n); return { k, loP: h ? h.loP : 0, hiP: h ? h.hiP : 0, ko: h ? canKO(M, st, 'foe', k, h.loP, h.cat) : false }; });
    return { name: n, label: n, spread, status: isStatus(n), vs, fake: n === 'Fake Out' && !st.fresh.includes('m' + i) };
  }) }));
  // what the AI is about to do (the same picks the turn will use)
  const partnerKOs = [], aiNext = [];
  foesOut.slice().sort((x, y) => W.sFoe[y] - W.sFoe[x]).forEach(j => {
    const c = aiChoiceDoubles(M, st, j, partnerKOs); if (!c) return;
    const dmg = c.targets.map(i => { const h = W.hits('foe', j, i, st.fa[j]).find(x => x.name === c.name); return { i, name: M.mine[i].name, loP: h ? h.loP : 0, hiP: h ? h.hiP : 0, ko: h ? h.hiP >= st.mh[i] : false }; });
    if (!c.fakeOut) dmg.forEach(d => { if (d.ko) partnerKOs.push(d.i); });
    aiNext.push({ j, name: M.foes[j].name, move: c.name, spread: c.spread, dmg });
  });
  const bench = alive.filter(k => !st.act.includes(k)).map(k => ({ k, name: M.mine[k].name, species: M.mine[k].p.name, hp: st.mh[k] }));
  return Object.assign(base, { need: null, mons, aiNext, bench, doubled: doubledRisk(M, st, aiNext) });
}
// choice = { acts: [{ i, move, target }] } (target = their Pokémon index; ignored for spread moves)
function sbStepDoubles(S, choice) {
  if (S.done || S.need) return [];
  const { M } = S, st = S.st, at = st.log.length, W = MW(M, st);
  S.hist.push({ st: cloneSt(st), need: S.need, done: S.done, won: S.won, turn: S.turn, lines: S.lines.length });
  S.turn++;
  const foesOut = st.out.filter(k => k >= 0 && st.fh[k] > 0);
  const swaps = (choice.acts || []).filter(c => c.switch != null && st.mh[c.i] > 0).map(c => ({ i: c.i, k: c.switch }));
  const forced = (choice.acts || []).map(c => {
    if (!(st.mh[c.i] > 0) || !c.move) return null;
    const spread = isSpread(c.move), t = foesOut.includes(c.target) ? c.target : foesOut[0];
    if (c.move === 'Fake Out' && !st.fresh.includes('m' + c.i)) return null;
    const h = t != null ? W.hits('my', c.i, t, st.ma[c.i]).find(x => x.name === c.move) : null;
    return { i: c.i, name: c.move, spread, targets: spread ? foesOut : [t], prio: h ? h.prio : (MOVES[c.move] && MOVES[c.move].priority) || 0, fakeOut: c.move === 'Fake Out' };
  }).filter(Boolean);
  st.turn = S.turn - 1;
  turnDoubles(M, st, forced, swaps);
  afterDoubles(M, st);
  if (st.done) { S.done = true; S.won = st.won; }
  else if (st.pending === 'faint') S.need = 'replace';
  const lines = stepsOf(M, st.log.slice(at)).map(x => x.text);
  S.lines.push(...lines);
  return lines;
}
function sbReplaceDoubles(S, k) {
  const { M, st } = S;
  if (S.need !== 'replace' || !(st.mh[k] > 0) || st.act.includes(k)) return [];
  S.hist.push({ st: cloneSt(st), need: S.need, done: S.done, won: S.won, turn: S.turn, lines: S.lines.length });
  const at = st.log.length;
  st.act[st.slot] = k; st.log.push({ t: 'in', i: k }); st.fresh.push('m' + k);
  enterMine(M, st, k, st.out, st.log);
  const other = st.act.indexOf(-1);
  if (other >= 0 && st.mh.some((h, i) => h > 0 && !st.act.includes(i))) st.slot = other;
  else { st.pending = null; S.need = null; }
  const lines = stepsOf(M, st.log.slice(at)).map(x => x.text); S.lines.push(...lines);
  return lines;
}
function sbUndo(S) {
  const h = S.hist.pop(); if (!h) return false;
  Object.assign(S, { st: h.st, need: h.need, done: h.done, won: h.won, turn: h.turn, absorbed: h.absorbed || {} });
  S.lines.length = h.lines;
  return true;
}
function trade(opt) {
  const { me, foe, f } = opt;
  if (!me || !foe || !me.p || !foe.p) return null;
  const M = buildMatrix([me], [foe], f || {});
  const base = Object.assign(blankSt(M, [me.hp != null ? me.hp : 100], [foe.hp != null ? foe.hp : 100]), { i: 0, j: 0, out: [0], ft: 1, mt: 1 });
  base.log = NOLOG;
  if (base.mh[0] <= 0 || base.fh[0] <= 0) return null;
  // played safe, for "can I survive this?": its strongest hit at its high roll, yours at your low roll
  const strongest = s => { const hs = hitsOf(M, s, 'foe', 0, 0).filter(h => h.hiP > 0 && !['Fake Out', 'First Impression'].includes(h.name) && !CHARGE.includes(h.name)); return hs.length ? (h => ({ name: h.name, label: h.label, h: Object.assign({}, h, { loP: h.hiP, lo: h.hi }) }))(hs.reduce((a, x) => (x.hiP > a.hiP ? x : a), hs[0])) : null; };
  const names = [...new Set(hitsOf(M, base, 'my', 0, 0).filter(h => h.hiP > 0 && usable(M, base, 0, h)).map(h => h.name))];
  let best = null;
  for (const name of names) {
    const s = cloneSt(base); s.log = NOLOG;
    let n = 0, healed = 0, label = name;
    while (s.mh[0] > 0 && s.fh[0] > 0 && n < 15) {
      const h = hitsOf(M, s, 'my', 0, 0).find(x => x.name === name); if (!h) break;
      n++; label = h.label;
      playTurn(M, s, 0, 0, { name, label: h.label, h: Object.assign({}, h, { hiP: h.loP, hi: h.lo }) }, null, strongest(s));
      healed += s.hl ? s.hl.m : 0;
    }
    const r = { move: label, won: s.fh[0] <= 0 && s.mh[0] > 0, turns: n, myHp: Math.max(0, s.mh[0]), foeHp: Math.max(0, s.fh[0]), healed };
    const score = r.won ? 1000 + r.myHp - r.turns * 0.1 : -r.foeHp - (s.mh[0] > 0 ? 0 : 1) + n * 0.01;
    if (!best || score > best.score) best = Object.assign(r, { score });
  }
  return best;
}

root.RRLines = { use, moveWarnings, plan, bestSix, itemIdeas, FX, recovery, trade, theory, theoryDoubles, sbStart, sbOptions, sbStep, sbReplace, sbUndo, recText, tradeText, healPct, isStatus, doublesLead, predictDoubles, residual, resTxt, healItem, critChance, deadToCrit, critTxt, DOUBLES_AI_NOTES, intimDelta };
})(typeof window !== 'undefined' ? window : globalThis);
