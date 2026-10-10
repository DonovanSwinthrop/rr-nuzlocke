/* Builds the same live data the mGBA script (rr_overlay.lua) sends, straight from the browser emulator's memory.
   Addresses are Radical Red 4.1 (FireRed USA base); same table as ../RR Nuzlocke Overlay/thor/ram_map.js. */
export const A = {
  saveBlock1Ptr: 0x03005008, mapHeader: 0x02036DFC, gMainInBattle: 0x03003529, battleType: 0x02022B4C, battleOutcome: 0x02023E8A,
  trainerA: 0x020386AE, trainerB: 0x020386B0, battleMons: 0x02023BE4, partyIndexes: 0x02023BCE, partyCount: 0x02024029,
  playerParty: 0x02024284, enemyParty: 0x0202402C, gameMode: 0x0203B25A, pcBoxes: 0x02029318, box20: 0x0203CB44,
  box23: 0x02027434, box25: 0x02024638, battleWeather: 0x02023F1C, sideStatuses: 0x02023DDE, sideTimers: 0x02023DE4,
  statuses3: 0x02023DFC, terrainType: 0x0203E028, newBattleStructPtr: 0x0203E038, storagePtr: 0x03005010
};
const PC_BYTES = 19 * 30 * 58, BOX_BYTES = 30 * 58;
const hex = b => { let s = ''; for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; };

/* Finds the GBA's RAM inside the emulator's WebAssembly memory.
   IWRAM holds the save-block pointers (gSaveBlock1Ptr, gSaveBlock2Ptr, gPokemonStoragePtr = 0x02029314) at +0x5008.
   Save states hold exact copies of EWRAM + IWRAM (same layout), so there can be several candidates; the live one is the
   copy whose frame counter (gMain.vblankCounter2, IWRAM+0x3114) keeps ticking. EWRAM sits 0x40000 before IWRAM. */
export const FRAME_COUNTER = 0x03003114;
export async function locateRam(memory, isRunning) {
  const u32 = new Uint32Array(memory.buffer), cands = [];
  for (let i = 2; i < u32.length; i++) {
    // the game shifts its save blocks by 0-124 bytes (all three by the same amount) when it loads a save
    const off = u32[i] - 0x02029314;
    if (off < 0 || off > 0x7C || (off & 3) || u32[i - 2] !== 0x0202552C + off || u32[i - 1] !== 0x02024588 + off) continue;
    const iw = i * 4 - 0x5010;
    if (iw >= 0x40000) cands.push(iw);
  }
  locateRam.found = cands.length; // 0 = no save loaded yet (title screen)
  if (!cands.length) return null;
  if (isRunning && !isRunning()) return null; // need the game running to tell the live copy apart
  const cnt = b => new DataView(memory.buffer).getUint32(b + 0x3114, true);
  const c0 = cands.map(cnt);
  await new Promise(r => setTimeout(r, 250));
  const c1 = cands.map(cnt);
  // the live copy counts up ~15 frames in 250 ms (more on fast forward); a save-state copy doesn't move, freed memory jumps around
  let best = -1, bd = 0;
  cands.forEach((b, k) => { const d = (c1[k] - c0[k]) >>> 0; if (d > 0 && d < 2000 && d > bd) { bd = d; best = k; } });
  return best >= 0 ? { iw: cands[best], ew: cands[best] - 0x40000 } : null;
}

// A reader for GBA addresses (EWRAM 0x02xxxxxx, IWRAM 0x03xxxxxx).
export function makeReader(memory, loc) {
  return (addr, len) => {
    const h = new Uint8Array(memory.buffer);
    let p;
    if (addr >= 0x02000000 && addr + len <= 0x02040000) p = loc.ew + (addr - 0x02000000);
    else if (addr >= 0x03000000 && addr + len <= 0x03008000) p = loc.iw + (addr - 0x03000000);
    else return new Uint8Array(len);
    return h.slice(p, p + len);
  };
}
const u16 = b => b[0] | (b[1] << 8), u32 = b => (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;

// Still looking at the real thing? (the save-block pointers are where they should be)
export function stillValid(read) {
  const off = u32(read(A.storagePtr, 4)) - 0x02029314;
  return off >= 0 && off <= 0x7C && !(off & 3) && u32(read(A.storagePtr - 8, 4)) === 0x0202552C + off;
}

export function buildState(read, frame) {
  const sb1 = u32(read(A.saveBlock1Ptr, 4));
  const inBattle = (read(A.gMainInBattle, 1)[0] & 2) !== 0;
  const s = {
    v: 1, frame, inBattle: inBattle ? 1 : 0, battleType: u32(read(A.battleType, 4)), outcome: read(A.battleOutcome, 1)[0],
    trainerA: u16(read(A.trainerA, 2)), trainerB: u16(read(A.trainerB, 2)), mapsec: read(A.mapHeader + 0x14, 1)[0],
    mode: read(A.gameMode, 1)[0], partyCount: read(A.partyCount, 1)[0], party: hex(read(A.playerParty, 600))
  };
  if (sb1 >= 0x02000000 && sb1 < 0x02040000) {
    const mp = read(sb1 + 4, 2); s.map = [mp[0], mp[1]];
    s.flags = hex(read(sb1 + 0xEE0, 0x120));
  }
  if (inBattle) {
    s.enemy = hex(read(A.enemyParty, 600)); s.battleMons = hex(read(A.battleMons, 0x58 * 4)); s.partyIdx = hex(read(A.partyIndexes, 8));
    s.weather = u16(read(A.battleWeather, 2)); s.sides = hex(read(A.sideStatuses, 4));
    s.timers = hex(read(A.sideTimers, 24)); s.terrain = read(A.terrainType, 1)[0]; s.status3 = hex(read(A.statuses3, 16));
    const nbs = u32(read(A.newBattleStructPtr, 4));
    if (nbs >= 0x02000000 && nbs < 0x02040000) s.nbs = hex(read(nbs, 0x18));
  }
  return s;
}

export function buildPC(read) {
  const x = new Uint8Array(6 * BOX_BYTES);
  x.set(read(A.box20, 3 * BOX_BYTES), 0); x.set(read(A.box23, 2 * BOX_BYTES), 3 * BOX_BYTES); x.set(read(A.box25, BOX_BYTES), 5 * BOX_BYTES);
  // boxes 1-19 move around in RAM: follow gPokemonStoragePtr (+4 skips the current-box byte), the fixed address is a fallback
  const pb = read(A.storagePtr, 4), ptr = (pb[0] | pb[1] << 8 | pb[2] << 16 | pb[3] << 24) >>> 0;
  const at = ptr >= 0x02000000 && ptr < 0x02040000 ? ptr + 4 : A.pcBoxes;
  return { pc: hex(read(at, PC_BYTES)), x: hex(x) };
}
