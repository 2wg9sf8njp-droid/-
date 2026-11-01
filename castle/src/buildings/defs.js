// 建築物の定義：ゲーム上の機能データ（見た目は models.js 側）
// cost は建設費の目安。Phase 2 で実際に資源を消費する予定。

export const CATEGORIES = [
  { key: 'fort', name: '城塞' },
  { key: 'inner', name: '城内施設' },
  { key: 'town', name: '集落' },
];

export const DEFS = {
  wall: {
    name: '城壁', cat: 'fort', kind: 'line', hotkey: '1',
    desc: '石造の幕壁。始点から順にクリックして線分を連続配置し、自由な多角形の囲郭を作る。上部に歩廊と胸壁を持つ。',
    func: '敵の移動を遮断する。歩廊は守備兵の射撃位置（攻撃処理はPhase 3）。',
    params: {
      height: { label: '高さ', min: 5, max: 14, step: 1, def: 9, unit: 'm' },
      thickness: { label: '厚さ', min: 2, max: 5, step: 0.5, def: 3, unit: 'm' },
    },
    hpPerM: 120, costPerM: { stone: 5, gold: 1 },
  },
  gate: {
    name: '城門（門楼）', cat: 'fort', kind: 'point', hotkey: '2',
    fp: { shape: 'rect', w: 12, d: 9 }, maxDiff: 3.0,
    desc: '左右に塔を備えた門楼。城壁に近づけると自動で城壁に組み込まれる。扉は開閉でき、開いていれば通行可能。',
    func: '囲郭の出入口。閉じた門は敵の攻撃目標になる（Phase 3）。',
    hp: 2600, cost: { stone: 320, wood: 90, gold: 80 },
  },
  towerSquare: {
    name: '方形塔', cat: 'fort', kind: 'point', hotkey: '3',
    fp: { shape: 'rect', w: 7, d: 7 }, maxDiff: 4,
    desc: '石造の方形塔。城壁の角（接続点）や城壁上にスナップして配置でき、城壁から突出させて側射できる。',
    func: '射程 42m の射撃拠点（攻撃処理はPhase 3）。',
    params: { height: { label: '高さ', min: 10, max: 24, step: 1, def: 15, unit: 'm' } },
    hp: 1900, cost: { stone: 220, gold: 30 }, range: 42,
  },
  towerRound: {
    name: '円形塔', cat: 'fort', kind: 'point', hotkey: '4',
    fp: { shape: 'circle', r: 4 }, maxDiff: 4,
    desc: '円筒形の塔。死角が少なく、角を持たないため崩されにくい。円錐屋根付き。',
    func: '射程 45m の射撃拠点（攻撃処理はPhase 3）。',
    params: { height: { label: '高さ', min: 10, max: 24, step: 1, def: 16, unit: 'm' } },
    hp: 2200, cost: { stone: 260, gold: 40 }, range: 45,
  },
  keep: {
    name: '主塔（キープ）', cat: 'fort', kind: 'point', hotkey: '5',
    fp: { shape: 'rect', w: 15, d: 15 }, maxDiff: 3.5,
    desc: '城の中枢となる大塔。領主の居所であり最後の砦。高台に置くほど遠くを見渡せる。',
    func: '敵の最終目標。陥落すると敗北（Phase 3）。',
    params: { height: { label: '高さ', min: 16, max: 34, step: 1, def: 24, unit: 'm' } },
    hp: 7000, cost: { stone: 900, wood: 200, gold: 300 },
  },
  stairs: {
    name: '城壁階段', cat: 'fort', kind: 'point', hotkey: '6',
    fp: { shape: 'rect', w: 10, d: 2.4 }, maxDiff: 99,
    desc: '城壁の内側に沿って歩廊へ登る石段。城壁の近くで配置すると高さが自動で合う。Rキーで登る向きを反転。',
    func: '探索モードで城壁の上へ登れる。守備兵の移動経路（Phase 3）。',
    hp: 800, cost: { stone: 60 },
  },
  barracks: {
    name: '兵舎', cat: 'inner', kind: 'point', hotkey: '7',
    fp: { shape: 'rect', w: 16, d: 9 }, maxDiff: 2.5,
    desc: '石造一階・瓦屋根の長屋。守備兵が寝起きする。',
    func: '守備兵の募集と駐屯（Phase 2〜3で実装予定）。',
    hp: 900, cost: { wood: 120, stone: 80, gold: 40 },
  },
  storehouse: {
    name: '倉庫', cat: 'inner', kind: 'point', hotkey: '8',
    fp: { shape: 'rect', w: 10, d: 8 }, maxDiff: 2.5,
    desc: '木造の倉。穀物や資材を蓄える。',
    func: '資源の保管上限を増やす（Phase 2で実装予定）。',
    hp: 600, cost: { wood: 100, gold: 10 },
  },
  stable: {
    name: '厩舎', cat: 'inner', kind: 'point',
    fp: { shape: 'rect', w: 14, d: 7 }, maxDiff: 2.5,
    desc: '馬房の並ぶ木造の厩。',
    func: '騎兵・伝令の馬を飼育（Phase 3以降で実装予定）。',
    hp: 500, cost: { wood: 90, gold: 20 },
  },
  house: {
    name: '民家', cat: 'town', kind: 'point', hotkey: '9',
    fp: { shape: 'rect', w: 6, d: 8 }, maxDiff: 2.0,
    desc: '木組みと漆喰の家。屋根は藁葺きか瓦葺き。',
    func: '人口 +6（Phase 2で実装予定）。',
    hp: 300, cost: { wood: 40, gold: 5 },
  },
  well: {
    name: '井戸', cat: 'town', kind: 'point',
    fp: { shape: 'circle', r: 1.8 }, maxDiff: 1.5,
    desc: '石組みの井戸。籠城時の水源として重要。',
    func: '周辺の民家の衛生・防火（Phase 2で実装予定）。',
    hp: 200, cost: { stone: 30, gold: 5 },
  },
  road: {
    name: '道路', cat: 'town', kind: 'line', hotkey: '0',
    desc: '土の道。城壁と同じ操作で連続配置できる。城壁は横切れないので城門を通す。',
    func: '移動速度の向上・建物の接続（Phase 2で実装予定）。',
    width: 4, costPerM: { gold: 0.5 },
  },
};

export const RES_NAME = { wood: '木材', stone: '石材', gold: '金貨' };

export function itemCost(item) {
  const def = DEFS[item.type];
  if (!def) return {};
  if (def.kind === 'line') {
    const len = Math.hypot(item.bx - item.ax, item.bz - item.az);
    let f = 1;
    if (item.type === 'wall') f = (item.height / 9) * (item.thickness / 3);
    const out = {};
    for (const [k, v] of Object.entries(def.costPerM)) out[k] = Math.round(v * len * f);
    return out;
  }
  const out = { ...def.cost };
  if (def.params?.height && item.height) {
    const f = item.height / def.params.height.def;
    for (const k of Object.keys(out)) if (k === 'stone') out[k] = Math.round(out[k] * f);
  }
  return out;
}

export function itemMaxHp(item) {
  const def = DEFS[item.type];
  if (!def) return 0;
  if (item.type === 'wall') {
    const len = Math.hypot(item.bx - item.ax, item.bz - item.az);
    return Math.round(def.hpPerM * len * (item.thickness / 3));
  }
  return def.hp || 0;
}
