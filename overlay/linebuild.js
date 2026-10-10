/* Radical Red Nuzlocke Kit - "fully trained" battle lines.
   Takes every living Pokémon you have (party and boxes) to the fight's level cap (evolving by level, new moves from level-up,
   TMs and tutors you can get by now; see RRBuild.buildAtCap), picks the best six for the fight with RRLines.bestSix and
   says which IVs matter for them. Needs RRLines, RRBuild, mk and speedOf (core.js), RR_DEX and RR_ITEMS.
   planBuilt({ pool: [{ name, star, m: { species, level, nature, ability, item, moves, evs, ivs, slot } }], foes: [{ name, moves, p }], f, cap, sec })
     -> { res (bestSix result + builds for the six), opt (what was planned, for item ideas) } */
(function (root) {
'use strict';
const STAT = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };
// IVs that change something in this fight: Speed benchmarks against their team, and a weak attacking IV.
function ivAdvice(x, foes, f) {
  const o = x.opts, iv = Object.assign({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, o.ivs || {});
  const spAt = v => { const p = root.mk(Object.assign({}, o, { ivs: Object.assign({}, iv, { spe: v }) })); return p ? root.speedOf(p, f, true) : 0; };
  const out = [];
  const now = spAt(iv.spe), max = spAt(31);
  const sFoe = foes.map(fo => ({ name: fo.name, s: root.speedOf(fo.p, f, false) }));
  const gain = sFoe.filter(fo => now <= fo.s && max > fo.s);
  if (gain.length) {
    const top = Math.max(...gain.map(g => g.s));
    let need = 31; for (let v = iv.spe; v <= 31; v++) if (spAt(v) > top) { need = v; break; }
    out.push(`Speed IV ${need}+ (yours: ${iv.spe}) outspeeds ${gain.map(g => g.name).join(', ')}`);
  }
  const lose = sFoe.filter(fo => fo.s >= max && fo.s < spAt(31) * 1.5).map(g => g.name);
  if (!gain.length && lose.length && iv.spe < 31) out.push(`Speed doesn't change anything here (even at 31 it's slower than ${lose.join(', ')})`);
  const p = root.mk(o), att = p && p.rawStats.atk >= p.rawStats.spa ? 'atk' : 'spa';
  if (iv[att] < 20) out.push(`its ${STAT[att]} IV is only ${iv[att]}: a Pokémon of the same species with a higher one hits about ${Math.round((31 - iv[att]) / 2)}% harder at this level`);
  return { ivs: iv, notes: out };
}
function planBuilt(job) {
  const { foes, f } = job;
  const built = job.pool.map(x => {
    const b = root.RRBuild.buildAtCap({ m: x.m, foes, f, cap: job.cap, sec: job.sec, beaten: job.beaten, nextN: job.nextN });
    const opts = Object.assign({}, b ? b.opts : { species: x.m.species, level: Math.max(job.cap || 1, x.m.level || 1), nature: x.m.nature, ability: x.m.ability, item: x.m.item, evs: x.m.evs || {}, ivs: x.m.ivs || {}, moves: x.m.moves }, { hp: 100, status: '' });
    const p = root.mk(opts);
    return p ? { name: x.name, star: !!x.star, moves: opts.moves, m: { slot: x.m.slot, species: x.m.species }, p, opts, build: b, from: x.m } : null;
  }).filter(Boolean);
  const opt = { mine: built, foes, f };
  const res = root.RRLines.bestSix(opt);
  if (res) {
    res.builds = (res.team || built.map((_, i) => i)).map(i => {
      const x = built[i], b = x.build;
      return { i, name: x.name, species: x.opts.species, was: x.from.species, level: x.opts.level, wasLevel: x.from.level, nature: x.opts.nature, ability: x.opts.ability, item: x.opts.item,
        moves: x.opts.moves, newMoves: b ? b.newMoves : [], evolved: b ? b.evolved : [], iv: ivAdvice(x, foes, f) };
    });
    res.pool = built.length;
  }
  return { res, opt };
}
root.RRLineBuild = { planBuilt, ivAdvice };
})(typeof window !== 'undefined' ? window : globalThis);
