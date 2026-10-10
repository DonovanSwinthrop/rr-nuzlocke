/* Shared battle core, taken unchanged from the Radical Red Nuzlocke Kit website (app.js). */
const C = window.calc, G = 9, SPEC = C.SPECIES[G], MOVES = C.MOVES[G];
const TYPECOL = { Normal: '#8d8d6c', Fire: '#dd6b2f', Water: '#3f7fd9', Electric: '#c9a312', Grass: '#4e9a3c', Ice: '#3fa9a8', Fighting: '#b2362c', Poison: '#90429f', Ground: '#b48838', Flying: '#7b7fd8', Psychic: '#d9466f', Bug: '#879a18', Rock: '#9e8838', Ghost: '#625090', Dragon: '#5d37cf', Dark: '#5f4c40', Steel: '#7d899d', Fairy: '#c86aa4', Stellar: '#4a7dbf', '???': '#777' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function types(name) { const s = SPEC[name]; return s ? s.types : []; }
function isSpecies(n) { return !!SPEC[n]; }
function eff(atkType, defTypes) {
  const ch = C.TYPE_CHART[G][atkType]; if (!ch) return 1;
  return defTypes.reduce((a, t) => a * (ch[t] == null ? 1 : ch[t]), 1);
}
function mk(o) {
  if (!o || !isSpecies(o.species)) return null;
  try {
    const opt = {
      level: Math.max(1, Math.min(100, +o.level || 50)), nature: o.nature || 'Hardy',
      ability: o.ability || undefined, item: o.item || undefined,
      evs: o.evs || {}, ivs: o.ivs || {}, boosts: o.boosts || {}, status: o.status || '',
      moves: (o.moves || []).filter(m => m && MOVES[m])
    };
    let p = new C.Pokemon(G, o.species, opt);
    if (o.hp != null && o.hp < 100) { opt.curHP = Math.max(1, Math.round(p.maxHP() * o.hp / 100)); p = new C.Pokemon(G, o.species, opt); }
    // in battle, use the game's own stats so speed and damage match exactly
    if (o.real) for (const k in o.real) if (o.real[k] > 0) { p.rawStats[k] = o.real[k]; p.stats[k] = o.real[k]; }
    return p;
  } catch (e) { return null; }
}
function sideOf(f, mine) { const s = mine ? f.my : f.foe; return { isReflect: !!s.ref, isLightScreen: !!s.ls, isTailwind: !!s.tw, isAuroraVeil: !!s.veil }; }
function field(f, atkMine) {
  return new C.Field({
    gameType: f.doubles ? 'Doubles' : 'Singles', weather: f.weather || undefined, terrain: f.terrain || undefined,
    attackerSide: sideOf(f, atkMine), defenderSide: sideOf(f, !atkMine)
  });
}
function genericMove(code, att) {
  const [t, c] = code.slice(1).split('|');
  return new C.Move(G, 'Tackle', { overrides: { basePower: 80, type: t, category: c }, ability: att.ability, item: att.item, species: att.name });
}
function genericCodes(p) {
  const phys = p.rawStats ? p.rawStats.atk >= p.rawStats.spa : p.stats.atk >= p.stats.spa;
  return p.types.map(t => '*' + t + '|' + (phys ? 'Physical' : 'Special'));
}
function label(code) { if (code && code[0] === '*') { const [t, c] = code.slice(1).split('|'); return t + ' STAB (' + (c === 'Physical' ? 'phys.' : 'spec.') + ' 80 BP)'; } return code; }
function hit(att, def, name, fld, crit) {
  const out = { name, label: label(name), status: false, lo: 0, hi: 0, loP: 0, hiP: 0, ko: '', type: '', prio: 0 };
  try {
    const mv = name[0] === '*' ? genericMove(name, att) : new C.Move(G, name, { ability: att.ability, item: att.item, species: att.name, isCrit: !!crit });
    out.type = mv.type; out.prio = mv.priority || 0; out.cat = mv.category;
    if (mv.category === 'Status') { out.status = true; return out; }
    const r = C.calculate(G, att, def, mv, fld);
    const rg = r.range(); out.lo = rg[0]; out.hi = rg[1];
    out.frost = att.status === 'frz' && mv.category === 'Special'; // the engine halves these (Radical Red's frostbite)
    const max = def.maxHP(); out.loP = out.lo / max * 100; out.hiP = out.hi / max * 100;
    out.cur = def.curHP(); out.max = max;
    try { out.ko = r.kochance().text || ''; } catch (e) { out.ko = ''; }
    try { out.desc = r.desc(); } catch (e) { out.desc = ''; }
  } catch (e) { out.err = true; }
  return out;
}
function speedOf(p, f, mine) {
  try { const fl = field(f, mine); return C.getFinalSpeed(C.Generations.get(G), p, fl, fl.attackerSide); }
  catch (e) { return p.stats.spe; }
}
function movesOf(p, list) { const ms = (list || []).filter(m => m && MOVES[m]); return ms.length ? ms : genericCodes(p); }

function scorePair(me, foe, fld) {
  const myMoves = movesOf(me.p, me.moves);
  const offs = myMoves.map(n => hit(me.p, foe.p, n, field(fld, true)));
  const defs = movesOf(foe.p, foe.moves).map(n => hit(foe.p, me.p, n, field(fld, false)));
  const bestOff = offs.reduce((a, x) => x.hiP > a.hiP ? x : a, { hiP: 0, loP: 0, label: '—' });
  const worstDef = defs.reduce((a, x) => x.hiP > a.hiP ? x : a, { hiP: 0, loP: 0, label: '—' });
  const fast = speedOf(me.p, fld, true) > speedOf(foe.p, fld, false);
  let s = 0;
  s += bestOff.loP >= 100 ? 4 : bestOff.hiP >= 100 ? 3 : bestOff.loP >= 50 ? 2 : bestOff.hiP >= 34 ? 1 : 0;
  s += worstDef.hiP >= 100 ? -4 : worstDef.hiP >= 50 ? -1 : worstDef.hiP < 25 ? 2 : 1;
  if (fast && bestOff.hiP >= 100) s += 1;
  if (!fast && worstDef.hiP >= 100) s -= 1;
  return { s, bestOff, worstDef, fast, generic: !me.moves.some(x => x && MOVES[x]) };
}
const SLEEP = ['Spore', 'Sleep Powder', 'Hypnosis', 'Yawn', 'Dark Void', 'Sing', 'Grass Whistle', 'Lovely Kiss'];
const POWDER = ['Spore', 'Sleep Powder', 'Stun Spore', 'Poison Powder'];
const SETUP = { 'Swords Dance': ['atk'], 'Nasty Plot': ['spa'], 'Dragon Dance': ['atk', 'spe'], 'Calm Mind': ['spa', 'spd'], 'Bulk Up': ['atk', 'def'], 'Quiver Dance': ['spa', 'spd', 'spe'], 'Shell Smash': ['atk', 'spa', 'spe'], 'Coil': ['atk', 'def'], 'Shift Gear': ['atk', 'spe'], 'Iron Defense': ['def'], 'Acid Armor': ['def'], 'Amnesia': ['spd'], 'Agility': ['spe'], 'Rock Polish': ['spe'], 'Autotomize': ['spe'], 'Curse': ['atk', 'def'], 'Growth': ['atk', 'spa'], 'Howl': ['atk'], 'Work Up': ['atk', 'spa'], 'Hone Claws': ['atk'], 'Tail Glow': ['spa'], 'Clangorous Soul': ['atk', 'spa'], 'Victory Dance': ['atk', 'def', 'spe'], 'Belly Drum': ['atk'], 'No Retreat': ['atk', 'spa'], 'Geomancy': ['spa', 'spd', 'spe'], 'Cosmic Power': ['def', 'spd'], 'Stockpile': ['def', 'spd'], 'Defend Order': ['def', 'spd'], 'Cotton Guard': ['def'], 'Fillet Away': ['atk', 'spa', 'spe'], 'Tidy Up': ['atk', 'spe'], 'Charge': ['spd'] };
const HEAL = ['Recover', 'Roost', 'Slack Off', 'Soft-Boiled', 'Synthesis', 'Moonlight', 'Morning Sun', 'Shore Up', 'Strength Sap', 'Milk Drink', 'Heal Order', 'Wish', 'Rest', 'Lunar Blessing', 'Jungle Healing'];
const PROTECT = ['Protect', 'Detect', "King's Shield", 'Spiky Shield', 'Baneful Bunker', 'Obstruct', 'Silk Trap', 'Burning Bulwark'];
const HAZ = ['Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web'];
const BOOM = ['Explosion', 'Self-Destruct', 'Misty Explosion'];
const ABSORB = { Water: ['Water Absorb', 'Storm Drain', 'Dry Skin'], Electric: ['Volt Absorb', 'Lightning Rod', 'Motor Drive'], Fire: ['Flash Fire', 'Well-Baked Body'], Grass: ['Sap Sipper'], Ground: ['Earth Eater'] };
function goesFirst(aPrio, aSpd, bPrio, bSpd, tr) {
  if (aPrio !== bPrio) return aPrio > bPrio ? 1 : -1;
  if (aSpd === bSpd) return 0;
  return (tr ? aSpd < bSpd : aSpd > bSpd) ? 1 : -1;
}
function predictPlayerMove(me, foe, myMoves, f) {
  // The AI predicts the player's move by picking the player's strongest attack (a KO it can land first is preferred).
  const sMe = speedOf(me, f, true), sFoe = speedOf(foe, f, false);
  const hs = movesOf(me, myMoves).map(n => hit(me, foe, n, field(f, true))).filter(h => !h.status && !h.err);
  if (!hs.length) return null;
  const kos = hs.filter(h => h.hi >= foe.curHP() && goesFirst(h.prio, sMe, 0, sFoe, f.tr) > 0);
  if (kos.length) return kos[0];
  return hs.reduce((a, h) => h.hi > a.hi ? h : a, hs[0]);
}
function aiScoreMoves(ai, me, aiMoves, myMoves, f, ctx) {
  const sAi = speedOf(ai, f, false), sMe = speedOf(me, f, true);
  const pred = predictPlayerMove(me, ai, myMoves, f);
  const playerKOs = pred && pred.hi >= ai.curHP() && goesFirst(pred.prio, sMe, 0, sAi, f.tr) > 0;
  const hp = ai.curHP() / ai.maxHP() * 100;
  const hasProtect = aiMoves.some(m => PROTECT.includes(m));
  const rows = aiMoves.map(name => {
    const h = hit(ai, me, name, field(f, false));
    const r = { name, h, score: 100, why: [] };
    if (h.err) { r.score = 0; r.why.push('unknown move'); return r; }
    if (ctx.lock && ctx.lock !== name) { r.score = 0; r.why.push('choice-locked into ' + ctx.lock); return r; }
    const tTypes = me.types, ab = me.ability, st = me.status;
    if (h.status) {
      const bounce = ab === 'Magic Bounce';
      if (bounce && !PROTECT.includes(name) && !SETUP[name] && !HEAL.includes(name)) { r.score = 0; r.why.push('Magic Bounce would reflect it'); return r; }
      if (SLEEP.includes(name)) {
        if (st || ['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Comatose', 'Purifying Salt'].includes(ab) || (POWDER.includes(name) && (tTypes.includes('Grass') || ab === 'Overcoat' || me.item === 'Safety Goggles')) || f.terrain === 'Electric' || f.terrain === 'Misty') { r.score = 0; r.why.push("can't put you to sleep"); }
        else { r.score += 3; r.why.push('+3 sleep is valuable'); }
      } else if (name === 'Will-O-Wisp') {
        if (st || tTypes.includes('Fire') || ['Water Veil', 'Water Bubble', 'Thermal Exchange', 'Comatose', 'Purifying Salt', 'Flash Fire', 'Well-Baked Body'].includes(ab)) { r.score = 0; r.why.push("can't burn you"); }
        else if (me.rawStats.atk >= me.rawStats.spa) { r.score += 3; r.why.push('+3 you are a physical attacker'); } else { r.score += 1; r.why.push('+1 burn chip'); }
      } else if (['Thunder Wave', 'Glare', 'Stun Spore'].includes(name)) {
        if (st || (name !== 'Glare' && tTypes.includes('Electric')) || (name === 'Thunder Wave' && tTypes.includes('Ground')) || ['Limber', 'Comatose', 'Purifying Salt'].includes(ab) || (name === 'Stun Spore' && (tTypes.includes('Grass') || me.item === 'Safety Goggles'))) { r.score = 0; r.why.push("can't paralyze you"); }
        else { const fast = goesFirst(0, sMe, 0, sAi, f.tr) > 0; r.score += fast ? 3 : 1; r.why.push(fast ? '+3 you outspeed it' : '+1 paralysis'); }
      } else if (['Toxic', 'Poison Powder', 'Toxic Thread'].includes(name)) {
        if (st || ((tTypes.includes('Poison') || tTypes.includes('Steel')) && ai.ability !== 'Corrosion') || ['Immunity', 'Comatose', 'Purifying Salt', 'Pastel Veil', 'Poison Heal'].includes(ab)) { r.score = 0; r.why.push("can't poison you"); }
        else { r.score += 2; r.why.push('+2 poison'); }
      } else if (name === 'Leech Seed') {
        if (tTypes.includes('Grass') || ctx.seeded) { r.score = 0; r.why.push("can't seed you"); } else { r.score += 2; r.why.push('+2 Leech Seed'); }
      } else if (HAZ.includes(name)) {
        if (ctx.hazards) { r.score = 0; r.why.push('hazards already up'); } else { r.score += 3; r.why.push('+3 hazards are not up yet'); }
      } else if (SETUP[name]) {
        const maxed = SETUP[name].every(s => (ai.boosts[s] || 0) >= 6);
        const aiKO = aiMoves.some(n => { const x = hit(ai, me, n, field(f, false)); return !x.status && x.hi >= me.curHP(); });
        const threatened = pred && pred.hi >= ai.curHP();
        if (maxed) { r.score = 0; r.why.push('stats already maxed'); }
        else if (!aiKO && !threatened) { r.score += 3; r.why.push("+3 safe to set up: it can't KO you and you can't KO it this turn"); }
        else r.why.push(aiKO ? 'it would rather take the KO' : "you threaten a KO, so it won't set up");
      } else if (HEAL.includes(name)) {
        if (hp > 70) { r.score = 0; r.why.push('HP too high to heal'); }
        else if (hp <= 40) { r.score += 5; r.why.push('+5 low HP'); }
        else { r.score += 2; r.why.push('+2 HP below 70%'); }
      } else if (PROTECT.includes(name)) {
        if (ctx.aiProtectedLast) { r.score = 0; r.why.push('it Protected last turn (would likely fail)'); }
        else if (ctx.first && ['Flame Orb', 'Toxic Orb'].includes(ai.item) && !ai.status) { r.score += 10; r.why.push('+10 activates its ' + ai.item + ' first'); }
        else if (['brn', 'psn', 'tox'].includes(me.status) || ctx.seeded) { r.score += 2; r.why.push('+2 you are taking residual damage'); }
      } else if (name === 'Trick Room') {
        if (f.tr) { r.score = 0; r.why.push('would end Trick Room'); } else if (sAi < sMe) { r.score += 5; r.why.push('+5 it is slower than you'); }
      } else if (name === 'Tailwind') {
        if (f.foe.tw) { r.score = 0; r.why.push('Tailwind already up'); } else if (sAi < sMe) { r.score += 4; r.why.push('+4 it is slower than you'); }
      } else if (name === 'Taunt' || name === 'Encore') { r.score += 1; r.why.push('+1 disruption'); }
      return r;
    }
    // damaging moves
    if (h.hi === 0) { r.score = 0; r.why.push('no effect on you'); return r; }
    if (name === 'Fake Out' || name === 'First Impression') {
      if (!ctx.first) { r.score = 0; r.why.push('only works on its first turn out'); return r; }
      if (name === 'Fake Out' && !['Inner Focus', 'Shield Dust'].includes(ab)) { r.score += 9; r.why.push('+9 free Fake Out on its first turn'); }
    }
    if (name === 'Sucker Punch' && (!pred)) { r.score = 0; r.why.push('fails if you do not attack'); return r; }
    if (BOOM.includes(name)) {
      if (ab === 'Damp' || ai.ability === 'Damp') { r.score = 0; r.why.push('Damp stops it'); return r; }
      if (hp <= 33 || playerKOs) { r.score += 6; r.why.push('+6 it is about to faint anyway'); }
      if (ctx.last) { r.score += 3; r.why.push('+3 you ' + (ctx.last === 'protect' ? 'Protected' : 'were immune') + ' last turn'); }
    }
    const first = goesFirst(h.prio, sAi, pred ? pred.prio : 0, sMe, f.tr) > 0;
    const kills = h.hi >= me.curHP();
    r.kills = kills; r.first = first;
    if (kills && first) { r.score += 9; r.why.push('+9 KO before you can move'); }
    else if (kills && !hasProtect) { r.score += 6; r.why.push('+6 KO (but you move first)'); }
    else if (playerKOs && first && h.prio > 0) { r.score += 9; r.why.push('+9 desperate priority: you would KO it first'); }
    return r;
  });
  // strongest damaging move bonus
  const dmg = rows.filter(r => !r.h.status && r.h.hi > 0 && r.score > 0);
  const maxHi = Math.max(0, ...dmg.map(r => r.h.hi));
  dmg.forEach(r => { if (r.h.hi === maxHi && !r.why.some(w => w.startsWith('+9') || w.startsWith('+6 KO'))) { r.score += 2; r.why.push('+2 strongest attack'); } });
  if (ctx.lock) rows.forEach(r => { if (r.name === ctx.lock) r.score = 200; });
  const top = Math.max(...rows.map(r => r.score));
  const best = rows.filter(r => r.score === top && top > 0);
  rows.forEach(r => { r.prob = best.includes(r) ? 1 / best.length : 0; });
  return { rows, pred, playerKOs, sAi, sMe };
}
function switchFlags(cand, foe, foeMoves, candMoves, f) {
  const sC = speedOf(cand, f, false), sF = speedOf(foe, f, true);
  const outspeeds = goesFirst(0, sC, 0, sF, f.tr) > 0;
  const mine = movesOf(cand, candMoves).map(n => hit(cand, foe, n, field(f, false))).filter(h => !h.status);
  const theirs = movesOf(foe, foeMoves).map(n => hit(foe, cand, n, field(f, true))).filter(h => !h.status && !h.err);
  const koFoe = mine.some(h => h.hi >= foe.curHP());
  const twoHKO = mine.some(h => h.hi * 2 >= foe.curHP());
  const faints = theirs.some(h => h.hi >= cand.curHP());
  const dmgTheirs = theirs.filter(h => h.hi > 0);
  const resistAll = theirs.length > 0 && theirs.every(h => h.hi === 0 || eff(h.type, cand.types) < 1);
  const se = theirs.filter(h => h.hi > 0 && eff(h.type, cand.types) > 1).length;
  const walls = se === 0 && dmgTheirs.every(h => h.hiP < 34);
  let score = 0; const why = [];
  if (koFoe) { score += 31; why.push('+31 can KO you'); }
  if (koFoe && outspeeds) { score += 8; why.push('+8 revenge kill'); }
  if (outspeeds) { score += 14; why.push('+14 outspeeds you'); }
  if (resistAll) { score += 17; why.push('+17 resists all your moves'); }
  if (walls) { score += 2; why.push('+2 walls you'); }
  if (!koFoe && twoHKO) { score += 2; why.push('+2 can 2HKO you'); }
  if (faints) { score -= outspeeds ? 15 : 39; why.push((outspeeds ? '−15' : '−39') + ' you can KO it'); }
  if (se) { score -= se; why.push('−' + se + ' weak to your moves'); }
  return { score, why, outspeeds, koFoe, resistAll, walls, faints };
}
function rankSwitchIns(list, foe, foeMoves, f) {
  return list.map(c => Object.assign({ c }, switchFlags(c.p, foe, foeMoves, c.moves, f))).sort((a, b) => b.score - a.score);
}
function aiDecideSwitch(ai, aiMoves, me, myMoves, f, party, scored) {
  if (!party.length) return null;
  const pred = scored.pred;
  if (!pred) return null;
  const ranked = rankSwitchIns(party, me, myMoves, f);
  // 1. a teammate whose ability absorbs your predicted move
  const absorbers = (ABSORB[pred.type] || []);
  if (pred.hi > 0) {
    const abs = party.find(c => absorbers.includes(c.p.ability));
    if (abs) return { to: abs, why: `${abs.m.s}'s ${abs.p.ability} absorbs your predicted ${pred.label}`, ranked };
  }
  // 2. only useless moves left
  const useful = scored.rows.some(r => r.score > 0 && (r.h.status || r.h.hiP >= 25));
  if (!useful) {
    const good = ranked.find(x => (x.outspeeds || x.walls || x.resistAll) && !x.faints);
    if (good) return { to: good.c, why: 'its moves are all bad against you (it can\'t even 4HKO)', ranked };
  }
  // 3. switch to avoid being KO'd
  const best = scored.rows.reduce((a, r) => r.prob > a.prob ? r : a, scored.rows[0]);
  const aiFirst = best && best.first;
  const hp = ai.curHP() / ai.maxHP() * 100;
  if (scored.playerKOs && !aiFirst && hp > 20) {
    for (const x of ranked) {
      const into = hit(me, x.c.p, pred.name, field(f, true));
      const immune = into.hi === 0;
      if (((x.outspeeds || x.walls || x.resistAll) && immune) || ((x.walls || x.resistAll || (x.koFoe && x.outspeeds)) && into.hiP < 50))
        return { to: x.c, why: `your ${pred.label} would KO it first, and ${x.c.m.s} ${immune ? 'is immune to it' : 'takes it well'}`, ranked };
    }
  }
  return { to: null, ranked };
}
