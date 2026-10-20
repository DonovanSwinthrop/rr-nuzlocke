/* Picks the game's data before the overlay's scripts run. overlay.html?game=unbound / ?game=swsh loads that game's
   pack (packs/<game>/pack.js, built by packs/unbound/build_pack.py or packs/rom_pack.py) and pack-select.js; anything
   else is Radical Red.
   It runs while the page is parsed, so the scripts it writes load in order, before core.js and overlay.js. */
(function () {
  'use strict';
  var g = (/[?&]game=([a-z0-9]+)/.exec(location.search) || [])[1] || 'rr';
  window.RR_GAME = g;
  // games with a pack: Unbound (Dynamic Calc sets), Sword and Shield Ultimate Plus (from its ROM)
  var PACKS = ['unbound', 'swsh', 'imperium', 'soulgold', 'bb2r', 'b2', 'pt', 'rp', 'hgss'];
  if (PACKS.indexOf(g) < 0) g = window.RR_GAME = 'rr';
  var files = g !== 'rr'
    ? ['packs/' + g + '/pack.js', 'pack-select.js']
    : ['rrmoves.js', 'data.js', 'savedata.js', 'overlaydata.js', 'where.js', 'items.js'];
  files.forEach(function (f) { document.write('<script src="' + f + '"><\/script>'); });
})();
