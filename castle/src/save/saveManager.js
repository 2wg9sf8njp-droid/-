// 保存・読み込み（ブラウザのローカル保存＋JSON書き出し／読み込み）
import { DEFS } from '../buildings/defs.js';
import { MAP_TYPES } from '../terrain/generator.js';

const KEY = 'castellum.save.';
export const SLOTS = ['1', '2', '3', 'auto'];
export const SAVE_VERSION = 1;

export function makeState(game) {
  return {
    v: SAVE_VERSION,
    savedAt: Date.now(),
    seed: game.terrain.seed,
    mapType: game.terrain.typeKey,
    items: game.world.serialize(),
    camera: game.rts.getState(),
    time: { day: game.time.day, hour: game.time.hour },
  };
}

export function validateState(s) {
  if (!s || typeof s !== 'object') throw new Error('データ形式が正しくありません');
  if (s.v !== SAVE_VERSION) throw new Error('対応していない保存データのバージョンです');
  if (typeof s.seed !== 'string' || !MAP_TYPES[s.mapType]) throw new Error('地形情報が不正です');
  if (!Array.isArray(s.items)) throw new Error('建築物データがありません');
  for (const it of s.items) {
    if (!DEFS[it.type]) throw new Error(`不明な建築物: ${it.type}`);
    const nums = DEFS[it.type].kind === 'line' ? ['ax', 'az', 'bx', 'bz'] : ['x', 'z'];
    for (const k of nums) if (!Number.isFinite(it[k])) throw new Error('座標が不正です');
  }
  return s;
}

export function saveSlot(slot, state) {
  try {
    localStorage.setItem(KEY + slot, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadSlot(slot) {
  try {
    const raw = localStorage.getItem(KEY + slot);
    if (!raw) return null;
    return validateState(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

export function slotInfo(slot) {
  const s = loadSlot(slot);
  if (!s) return null;
  return {
    savedAt: new Date(s.savedAt),
    seed: s.seed,
    mapName: MAP_TYPES[s.mapType].name,
    count: s.items.length,
    day: s.time?.day ?? 1,
  };
}

export function storageAvailable() {
  try {
    const k = KEY + '__test';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
}
