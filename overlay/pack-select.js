/* A game pack (packs/<game>/pack.js): picks the difficulty's boss teams where the pack has several (Unbound:
   insane / expert / difficult, localStorage 'rro-diff-<game>'; others have one, 'default') and brings the damage
   engine in line with the game's own stats, types, abilities and moves (window.UB_CALC). Loaded by game-select.js. */
(function () {
  'use strict';
  var keys = Object.keys(window.RR_PACKS), diff = keys.indexOf('insane') >= 0 ? 'insane' : keys[0];
  try { diff = localStorage.getItem('rro-diff-' + window.RR_GAME) || diff; } catch (e) { /* default */ }
  if (!window.RR_PACKS[diff]) diff = keys[0];
  window.RR_DIFF = diff;
  window.RR_DATA = window.RR_PACKS[diff].data;
  window.RR_TRAINERS = window.RR_PACKS[diff].trainers;

  var C = window.calc, U = window.UB_CALC;
  if (!C || !U || !C.Generations) return;
  var toID = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); };
  var G = C.Generations.get(9), S = C.SPECIES[9], M = C.MOVES[9];
  var STAT = { hp: 'hp', at: 'atk', df: 'def', sa: 'spa', sd: 'spd', sp: 'spe' };
  var bulbasaur = G.species.get('bulbasaur'), tackle = G.moves.get('tackle');
  var Specie = bulbasaur && Object.getPrototypeOf(bulbasaur).constructor;
  var MoveData = tackle && Object.getPrototypeOf(tackle).constructor;
  var extraS = {}, extraM = {};

  Object.keys(U.species).forEach(function (name) {
    var u = U.species[name], raw = S[name];
    if (raw) {
      raw.bs = u.bs; raw.types = u.types; if (u.abilities) raw.abilities = u.abilities;
      var sp = G.species.get(toID(name));
      if (sp) {
        var b = {}; Object.keys(STAT).forEach(function (k) { b[STAT[k]] = u.bs[k]; });
        sp.baseStats = b; sp.types = u.types; if (u.abilities) sp.abilities = u.abilities;
      }
    } else if (Specie) {
      S[name] = u;
      try { extraS[toID(name)] = new Specie(name, u, 9); } catch (e) { /* the engine can't build it: it stays unknown */ }
    }
  });
  Object.keys(U.moves).forEach(function (name) {
    if (name === '(No Move)') return;
    var u = U.moves[name], raw = M[name], mv = G.moves.get(toID(name));
    if (raw) {
      if (u.bp != null) { raw.bp = u.bp; if (mv) mv.basePower = u.bp; }
      if (u.type) { raw.type = u.type; if (mv) mv.type = u.type; }
      if (u.category) { raw.category = u.category; if (mv) mv.category = u.category; }
    } else if (MoveData) {
      M[name] = Object.assign({ bp: 0, type: 'Normal', category: 'Status' }, u);
      try { extraM[toID(name)] = new MoveData(name, M[name], 9); } catch (e) { /* unknown to the engine */ }
    }
  });
  // names the engine doesn't have (Unbound's own Pokémon and moves) resolve to the ones built above
  // (on the gen 9 tables themselves: species and moves may share a prototype)
  [[G.species, extraS], [G.moves, extraM]].forEach(function (pair) {
    var table = pair[0], extra = pair[1], get = table.get;
    table.get = function (id) { var r = get.call(this, id); return r !== undefined ? r : extra[id]; };
  });
})();
