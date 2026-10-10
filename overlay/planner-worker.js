/* Battle planner thread: runs lines.js (lines, live steering, item ideas) away from the page, so taps, menus and the game
   stay smooth while it thinks. The page sends Pokémon as calc options (mk() input) and gets plain results back. */
self.window = self;
importScripts('engine.js', 'rrmoves.js', 'core.js', 'lines.js', 'builder.js', 'linebuild.js', 'items.js');
try { importScripts('dex.js'); if (self.RR_MOVES) RR_MOVES.patchDex(self.RR_DEX); } catch (e) { /* PP and accuracy fall back to the game's move table */ }
RRLines.use({ hit, movesOf, speedOf, goesFirst, eff, field, MOVES, scorePair });
RRBuild.use({ mk, hit, movesOf, speedOf, field, MOVES, SPEC });
self.mk = mk; self.speedOf = speedOf;

const full = new Map(); // key -> full result (item ideas re-use the line they were asked about)
const build = list => list.map(x => Object.assign({}, x, { p: mk(x.opts) }));
const strip = r => r && { won: r.won, lost: r.lost, risk: r.risk, expected: r.expected, log: r.log, steps: r.steps, verdict: r.verdict, winCons: r.winCons, dangers: r.dangers, tips: r.tips, team: r.team, builds: r.builds, pool: r.pool, names: r.names };

onmessage = e => {
  const job = e.data;
  let out = null;
  try {
    const foes = build(job.opt.foes);
    // 'built': your whole party and box, trained to the level cap with the moves you can teach by now (linebuild.js)
    const run = () => {
      if (job.kind === 'built' || (job.kind === 'ideas' && job.opt.pool)) return RRLineBuild.planBuilt(Object.assign({}, job.opt, { foes }));
      const opt = Object.assign({}, job.opt, { mine: build(job.opt.mine), foes });
      return { res: job.kind === 'six' ? RRLines.bestSix(opt) : RRLines.plan(opt), opt };
    };
    if (job.kind === 'ideas') {
      const r = full.get(job.base) || run();
      const avail = job.avail || {};
      out = r.res ? RRLines.itemIdeas(r.opt, r.res, n => (n in avail ? avail[n] : null)) : [];
    } else {
      const r = run();
      if (r.res) { full.set(job.key, r); if (full.size > 4) full.delete(full.keys().next().value); r.res.names = r.opt.mine.map(x => x.name); }
      out = strip(r.res);
    }
  } catch (err) {
    out = { error: String(err && err.message || err) };
  }
  postMessage({ key: job.key, res: out });
};
