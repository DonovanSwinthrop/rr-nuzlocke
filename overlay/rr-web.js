/* Radical Red Nuzlocke Overlay - browser mode.
   In the desktop app, preload.js provides window.rr. In a plain browser this file provides the same window.rr API:
   - opened from thor/bridge.js (AYN Thor bottom screen): live data comes from the bridge's feed (/events);
   - embedded in the phone app (overlay.html?embed inside RR Nuzlocke Web): live data comes from the parent page,
     which reads the emulator's memory itself. Tapping into the overlay asks the parent to pause the game;
   - inside the Thor Companion app (overlay.html?android, a WebView tab): the app calls window.__rrFeed({type, ...})
     with the same messages the phone app posts. */
(function () {
  'use strict';
  if (window.rr) return; // running inside the desktop overlay
  const handlers = {};
  const emit = (ch, ...a) => (handlers[ch] || []).forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } });
  const embedded = /[?&]embed\b/.test(location.search) && window.parent !== window;
  const android = /[?&]android\b/.test(location.search);
  const toParent = msg => { try { window.parent.postMessage(Object.assign({ rr: true }, msg), location.origin); } catch (e) { /* ignore */ } };

  function connectFeed() {
    if (typeof EventSource === 'undefined' || location.protocol === 'file:') return;
    const es = new EventSource('/events');
    es.addEventListener('state', e => emit('state', JSON.parse(e.data)));
    es.addEventListener('pc', e => { const d = JSON.parse(e.data); emit('pc', d.pc, d.x || ''); });
    es.addEventListener('conn', e => emit('conn', JSON.parse(e.data)));
    es.onerror = () => emit('conn', false); // EventSource reconnects by itself
  }
  function dispatch(d) {
    if (d.type === 'state') emit('state', d.state);
    else if (d.type === 'pc') emit('pc', d.pc, d.x || '');
    else if (d.type === 'conn') emit('conn', !!d.value);
    else if (d.type === 'tab') emit('tab', d.tab);
    else if (d.type === 'clock') { window.__gameHour = d.hour; emit('clock', d.hour); }
  }
  function connectAndroid() {
    // messages sent before the page finished loading wait in window.__rrQueue
    window.__rrFeed = d => { if (d && d.type) dispatch(d); };
    (window.__rrQueue || []).forEach(window.__rrFeed);
    window.__rrQueue = null;
    // Android's WebView can lay the page out at height 0 when its view is sized after loading:
    // pin the page to the window's real height, now and on every resize.
    const fit = () => { const h = window.innerHeight + 'px'; document.documentElement.style.height = h; document.body.style.height = h; };
    fit(); window.addEventListener('resize', fit);
    document.documentElement.classList.add('android');
    document.addEventListener('contextmenu', e => e.preventDefault());
    if (window.RRAndroid && window.RRAndroid.ready) window.RRAndroid.ready();
  }
  function connectParent() {
    window.addEventListener('message', e => {
      if (e.origin !== location.origin || !e.data || !e.data.rr) return;
      dispatch(e.data);
    });
    // tapping into the overlay pauses the game (like clicking into it on PC)
    document.addEventListener('pointerdown', () => toParent({ type: 'focus' }), true);
    // no long-press magnifier / callout / text selection inside the phone app
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('selectstart', e => { if (!e.target.closest || !e.target.closest('input, select')) e.preventDefault(); });
    toParent({ type: 'ready' });
  }

  window.rr = {
    on: (ch, fn) => { (handlers[ch] = handlers[ch] || []).push(fn); },
    mode: () => {}, opacity: () => {}, hide: () => {}, quit: () => {},
    backToGame: () => toParent({ type: 'back' }),
    settings: () => Promise.resolve({ opacity: 1, mode: 'panel' }),
    scriptLine: () => Promise.resolve(''), copy: () => {},
    web: true, embedded, android
  };
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.classList.add('web');
    if (embedded || android) document.documentElement.classList.add('embedded');
    emit('mode', 'panel'); // a second screen / the phone panel has room for the full panel
    if (android) connectAndroid(); else if (embedded) connectParent(); else connectFeed();
  });
})();
