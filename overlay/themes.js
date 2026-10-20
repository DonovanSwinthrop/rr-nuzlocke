/* Radical Red Nuzlocke Kit - colour themes, shared by the phone app and the overlay (on PC and inside the phone app).
   A theme sets the colour variables both stylesheets use; an optional custom accent colour goes on top.
   Saved in localStorage 'rrweb-theme' as { name, accent }. Pages on the same origin (the phone app and the overlay
   inside it) follow each other's changes through the storage event. */
(function (root) {
  'use strict';
  const THEMES = {
    firered: { label: 'Fire Red', bg: '#13151a', panel: '#1b1e25', ink: '#eceef2', muted: '#9aa3ae', accent: '#ff5d52', good: '#5fd08f', warn: '#f0b73d', bad: '#ff7b70', dark: true },
    leafgreen: { label: 'Leaf Green', bg: '#0f1712', panel: '#16211a', ink: '#e8f2eb', muted: '#91a798', accent: '#4cc38a', good: '#7fe0a3', warn: '#f0b73d', bad: '#ff7b70', dark: true },
    ocean: { label: 'Ocean', bg: '#0c1421', panel: '#131f31', ink: '#e7eef8', muted: '#91a2b8', accent: '#4aa8ff', good: '#5fd08f', warn: '#f0b73d', bad: '#ff7b70', dark: true },
    ghost: { label: 'Ghost', bg: '#14101c', panel: '#1d1727', ink: '#eeeaf6', muted: '#a39bb3', accent: '#b17cff', good: '#5fd08f', warn: '#f0b73d', bad: '#ff7b70', dark: true },
    pikachu: { label: 'Pikachu', bg: '#15130b', panel: '#1f1c10', ink: '#f3f0e3', muted: '#a9a38c', accent: '#f7d046', good: '#5fd08f', warn: '#ff9f43', bad: '#ff7b70', dark: true },
    oled: { label: 'OLED black', bg: '#000000', panel: '#0c0c0e', ink: '#eceef2', muted: '#8e96a0', accent: '#ff5d52', good: '#5fd08f', warn: '#f0b73d', bad: '#ff7b70', dark: true },
    light: { label: 'Light', bg: '#f1f2f5', panel: '#ffffff', ink: '#15181e', muted: '#596270', accent: '#d9443a', good: '#16884a', warn: '#a8650c', bad: '#cf3a30', dark: false }
  };
  // The pixel look's palettes (overlay pixel.css): window fill, a second fill for panels, the two frame tones, buttons.
  const D = { good: '#38c46a', warn: '#f0c030', bad: '#ff6a5c', dark: true }, L = { good: '#2a9a4a', warn: '#b36d00', bad: '#c8301f', dark: false };
  const PIXEL = {
    platinum: Object.assign({ label: 'Platinum', win: '#eef3f8', win2: '#dfe8f1', frame: '#4b6179', light: '#9fb6cd', ink: '#1d2836', muted: '#5d7088', accent: '#d8452f', btn: '#cfdbe8' }, L),
    night:    Object.assign({ label: 'Night', win: '#101a34', win2: '#16234a', frame: '#06091a', light: '#5f86c8', ink: '#e6eeff', muted: '#8da3cf', accent: '#ffcc4d', btn: '#1d2d5c' }, D),
    black:    Object.assign({ label: 'Black', win: '#0c0c0e', win2: '#17171b', frame: '#000000', light: '#8a8a96', ink: '#f0f0f4', muted: '#a2a2ae', accent: '#ff6a55', btn: '#232329' }, D),
    navy:     Object.assign({ label: 'Navy', win: '#0d2147', win2: '#133064', frame: '#050f26', light: '#4f9be8', ink: '#eaf3ff', muted: '#9bbbe6', accent: '#5ec8ff', btn: '#1b3f7f' }, D),
    purple:   Object.assign({ label: 'Purple', win: '#231338', win2: '#33204f', frame: '#10061d', light: '#a77fe0', ink: '#f4ecff', muted: '#bba3e3', accent: '#ff7ad9', btn: '#43286a' }, D),
    teal:     Object.assign({ label: 'Teal', win: '#0a2b2e', win2: '#0f3d41', frame: '#031416', light: '#4dc5bf', ink: '#e6fffd', muted: '#8fcfc9', accent: '#ffd24d', btn: '#15575b' }, D),
    bright:   Object.assign({ label: 'Bright', win: '#fff3cf', win2: '#ffe39a', frame: '#8a2a1e', light: '#f0a63a', ink: '#3a1a10', muted: '#8a5a3a', accent: '#e23b2e', btn: '#ffd36a' }, L)
  };
  const rgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  // relative luminance (WCAG): dark text on light accents, white text on dark ones
  const lum = h => { const c = rgb(h); if (!c) return 0; const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const onAccent = h => (lum(h) > 0.3 ? '#160b05' : '#ffffff');
  function load() {
    try {
      const t = JSON.parse(localStorage.getItem('rrweb-theme') || 'null');
      if (t && t.style === 'pixel' && PIXEL[t.name]) return t;
      if (t && THEMES[t.name]) return { name: t.name, accent: t.accent || '', style: 'classic' }; // a pick from before the pixel look keeps its look
    } catch (e) { /* storage off */ }
    return { style: 'pixel', name: 'platinum', accent: '' };
  }
  function save(t) { try { localStorage.setItem('rrweb-theme', JSON.stringify(t)); } catch (e) { /* storage off */ } apply(t); }
  function apply(t, doc) {
    t = t || load(); doc = doc || document;
    if (t.style === 'pixel' && PIXEL[t.name]) return applyPixel(t, doc);
    delete doc.documentElement.dataset.style;
    ['--pwin', '--pwin2', '--pframe', '--plight', '--pbtn'].forEach(k => doc.documentElement.style.removeProperty(k));
    const th = THEMES[t.name] || THEMES.firered, accent = t.accent && rgb(t.accent) ? t.accent : th.accent;
    const tint = th.dark ? '255,255,255' : '0,0,0';
    const v = {
      '--bg': th.bg, '--panel': th.panel, '--ink': th.ink, '--muted': th.muted, '--accent': accent, '--good': th.good, '--warn': th.warn, '--bad': th.bad,
      '--tint': tint, '--line': `rgba(${tint}, ${th.dark ? 0.1 : 0.14})`, '--on-accent': onAccent(accent), '--accent-rgb': rgb(accent).join(','),
      '--panel-rgb': rgb(th.panel).join(','), '--glass': `rgba(${rgb(th.bg).join(',')}, 0.97)`, '--glass2': `rgba(${rgb(th.panel).join(',')}, 0.98)`,
      '--sunk': th.dark ? 'rgba(0,0,0,.35)' : 'rgba(0,0,0,.06)'
    };
    const st = doc.documentElement.style;
    Object.keys(v).forEach(k => st.setProperty(k, v[k]));
    doc.documentElement.dataset.theme = th.dark ? 'dark' : 'light';
    doc.documentElement.style.colorScheme = th.dark ? 'dark' : 'light';
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', th.bg);
  }
  function applyPixel(t, doc) {
    const th = PIXEL[t.name], accent = t.accent && rgb(t.accent) ? t.accent : th.accent, tint = th.dark ? '255,255,255' : '0,0,0';
    const v = {
      '--bg': th.win, '--panel': th.win2, '--ink': th.ink, '--muted': th.muted, '--accent': accent, '--good': th.good, '--warn': th.warn, '--bad': th.bad,
      '--tint': tint, '--line': th.light, '--on-accent': onAccent(accent), '--accent-rgb': rgb(accent).join(','), '--panel-rgb': rgb(th.win2).join(','),
      '--glass': th.win, '--glass2': th.win2, '--sunk': th.dark ? 'rgba(0,0,0,.35)' : 'rgba(0,0,0,.08)',
      '--pwin': th.win, '--pwin2': th.win2, '--pframe': th.frame, '--plight': th.light, '--pbtn': th.btn
    };
    const st = doc.documentElement.style;
    Object.keys(v).forEach(k => st.setProperty(k, v[k]));
    doc.documentElement.dataset.style = 'pixel';
    doc.documentElement.dataset.theme = th.dark ? 'dark' : 'light';
    doc.documentElement.style.colorScheme = th.dark ? 'dark' : 'light';
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', th.win);
  }
  // A small picker: a swatch per theme and a custom accent colour. bind(el, onChange) wires it up.
  function pickerHTML() {
    const t = load(), px = t.style === 'pixel', th = px ? PIXEL[t.name] : (THEMES[t.name] || THEMES.firered);
    const style = `<div class="seg thstyle">${[['pixel', 'Pixel'], ['classic', 'Classic']].map(([k, n]) => `<button type="button" data-sty="${k}" class="${(px ? 'pixel' : 'classic') === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    if (px) {
      return style + `<div class="themes pxthemes">${Object.keys(PIXEL).map(k => { const x = PIXEL[k]; return `<button type="button" class="thm pxthm${k === t.name ? ' on' : ''}" data-thm="${k}" title="${x.label}"><i style="background:${x.win};border-color:${x.frame};box-shadow:inset 0 0 0 3px ${x.light}"></i>${x.label}</button>`; }).join('')}</div>
      <label class="thmacc">Accent colour <input type="color" data-thmacc value="${t.accent || th.accent}"> <button type="button" data-thmreset${t.accent ? '' : ' hidden'}>Palette's own</button></label>`;
    }
    return style + `<div class="themes">${Object.keys(THEMES).map(k => { const x = THEMES[k]; return `<button type="button" class="thm${k === t.name ? ' on' : ''}" data-thm="${k}" title="${x.label}" style="background:${x.bg};color:${x.ink};border-color:${k === t.name ? (t.accent || x.accent) : x.panel}"><i style="background:${x.accent}"></i>${x.label}</button>`; }).join('')}</div>
      <label class="thmacc">Accent colour <input type="color" data-thmacc value="${t.accent || th.accent}"> <button type="button" data-thmreset${t.accent ? '' : ' hidden'}>Theme's own</button></label>`;
  }
  function bind(el, onChange) {
    el.querySelectorAll('[data-sty]').forEach(b => b.onclick = () => { const k = b.dataset.sty; save(k === 'pixel' ? { style: 'pixel', name: 'platinum', accent: '' } : { style: 'classic', name: 'firered', accent: '' }); if (onChange) onChange(); });
    el.querySelectorAll('[data-thm]').forEach(b => b.onclick = () => { save({ style: load().style, name: b.dataset.thm, accent: '' }); if (onChange) onChange(); });
    const c = el.querySelector('[data-thmacc]');
    if (c) c.oninput = () => { save({ style: load().style, name: load().name, accent: c.value }); const r = el.querySelector('[data-thmreset]'); if (r) r.hidden = false; };
    if (c) c.onchange = () => { if (onChange) onChange(); };
    const r = el.querySelector('[data-thmreset]');
    if (r) r.onclick = () => { save({ style: load().style, name: load().name, accent: '' }); if (onChange) onChange(); };
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', e => { if (e.key === 'rrweb-theme') apply(); });
  root.RRTheme = { THEMES, PIXEL, load, save, apply, pickerHTML, bind, onAccent };
  try { apply(); } catch (e) { /* no page yet */ }
})(typeof window !== 'undefined' ? window : globalThis);
