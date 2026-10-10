/* Radical Red Nuzlocke Overlay - browser mode.
   In the desktop app, preload.js provides window.rr. In a plain browser this file provides the same window.rr API:
   - opened from thor/bridge.js (AYN Thor bottom screen): live data comes from the bridge's feed (/events);
   - embedded in the phone app (overlay.html?embed inside RR Nuzlocke Web): live data comes from the parent page,
     which reads the emulator's memory itself. Tapping into the overlay asks the parent to pause the game. */
(function () {
  'use strict';
  if (window.rr) return; // running inside the desktop overlay
  const handlers = {};
  const emit = (ch, ...a) => (handlers[ch] || []).forEach(fn => { try { fn(...a); } catch (e) { console.error(e); } });
  const embedded = /[?&]embed\b/.test(location.search) && window.parent !== window;
  const toParent = msg => { try { window.parent.postMessage(Object.assign({ rr: true }, msg), location.origin); } catch (e) { /* ignore */ } };

  function connectFeed() {
    if (typeof EventSource === 'undefined' || location.protocol === 'file:') return;
    const es = new EventSource('/events');
    es.addEventListener('state', e => emit('state', JSON.parse(e.data)));
    es.addEventListener('pc', e => { const d = JSON.parse(e.data); emit('pc', d.pc, d.x || ''); });
    es.addEventListener('conn', e => emit('conn', JSON.parse(e.data)));
    es.onerror = () => emit('conn', false); // EventSource reconnects by itself
  }
  function connectParent() {
    window.addEventListener('message', e => {
      if (e.origin !== location.origin || !e.data || !e.data.rr) return;
      const d = e.data;
      if (d.type === 'state') emit('state', d.state);
      else if (d.type === 'pc') emit('pc', d.pc, d.x || '');
      else if (d.type === 'conn') emit('conn', !!d.value);
      else if (d.type === 'tab') emit('tab', d.tab);
      else if (d.type === 'clock') { window.__gameHour = d.hour; emit('clock', d.hour); }
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
    web: true, embedded
  };
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.classList.add('web');
    if (embedded) document.documentElement.classList.add('embedded');
    emit('mode', 'panel'); // a second screen / the phone panel has room for the full panel
    if (embedded) connectParent(); else connectFeed();
  });
})();
