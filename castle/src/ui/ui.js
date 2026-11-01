// UI 管理：パレット、情報パネル、状態表示、モーダル
import { DEFS, CATEGORIES, RES_NAME, itemCost, itemMaxHp } from '../buildings/defs.js';
import { MAP_TYPES } from '../terrain/generator.js';
import { SLOTS, slotInfo, storageAvailable, validateState } from '../save/saveManager.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function costText(c) {
  const parts = Object.entries(c).filter(([, v]) => v > 0).map(([k, v]) => `${RES_NAME[k]} ${v.toLocaleString()}`);
  return parts.length ? parts.join('・') : '—';
}

export class UI {
  constructor(game) {
    this.g = game;
    this._statusTimer = 0;
    this._buildPalette();
    this._bindTop();
  }

  _buildPalette() {
    const el = $('#palette');
    let html = '<h3>道具</h3><div class="tools">' +
      '<button class="tool" data-tool="select" aria-pressed="true"><span>選択</span><kbd>V</kbd></button>' +
      '<button class="tool" data-tool="demolish"><span>撤去</span><kbd>X</kbd></button></div>';
    for (const cat of CATEGORIES) {
      html += `<h3>${cat.name}</h3><div class="tools">`;
      for (const [k, d] of Object.entries(DEFS)) {
        if (d.cat !== cat.key) continue;
        html += `<button class="tool${d.name.length > 5 ? ' wide' : ''}" data-tool="${k}" title="${esc(d.desc)}"><span>${esc(d.name)}</span>${d.hotkey ? `<kbd>${d.hotkey}</kbd>` : ''}</button>`;
      }
      html += '</div>';
    }
    html += '<div id="toolopts"></div>';
    el.innerHTML = html;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tool]');
      if (b) { this.g.tools.setTool(b.dataset.tool); this.g.focusView(); }
    });
  }

  onToolChanged(key) {
    document.querySelectorAll('#palette .tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === key)));
    const box = $('#toolopts');
    const def = DEFS[key];
    if (!def) { box.innerHTML = ''; return; }
    let html = `<div class="optnote"><b style="color:var(--gilt-hi)">${esc(def.name)}</b>　${esc(def.desc)}</div>`;
    const p = this.g.tools.params[key];
    if (def.params) {
      for (const [pk, spec] of Object.entries(def.params)) {
        html += `<label class="opt"><span>${spec.label}</span><input type="range" id="opt-${key}-${pk}" data-p="${pk}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${p[pk]}"><output>${p[pk]}${spec.unit}</output></label>`;
      }
    }
    if (def.kind !== 'line') html += `<div class="optnote">建設費の目安：${costText(def.cost || {})}</div>`;
    else html += `<div class="optnote">建設費の目安：1mあたり ${costText(def.costPerM)}</div>`;
    box.innerHTML = html;
    box.querySelectorAll('input[type=range]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const spec = def.params[inp.dataset.p];
        p[inp.dataset.p] = Number(inp.value);
        inp.nextElementSibling.textContent = inp.value + spec.unit;
        this.g.tools.needsPreview = true;
        this.g.tools.ghostKey = '';
      });
    });
  }

  _bindTop() {
    $('#speed').addEventListener('click', (e) => {
      const b = e.target.closest('[data-speed]');
      if (b) this.g.setSpeed(Number(b.dataset.speed));
    });
    $('#modeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (b) this.g.setMode(b.dataset.mode);
    });
    $('#overlay').addEventListener('change', (e) => { this.g.terrainView.setMode(e.target.value); this.g.focusView(); });
    $('#btnNew').addEventListener('click', () => this.openNewMap());
    $('#btnSave').addEventListener('click', () => this.openSaveLoad('save'));
    $('#btnLoad').addEventListener('click', () => this.openSaveLoad('load'));
    $('#btnLock').addEventListener('click', () => this.g.fps.lock());
    $('#btnBackBuild').addEventListener('click', () => this.g.setMode('build'));
  }

  setSpeedUI(s) {
    document.querySelectorAll('#speed button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s)));
  }

  setModeUI(m) {
    document.querySelectorAll('#modeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    document.body.classList.toggle('explore', m === 'explore');
    $('#crosshair').hidden = m !== 'explore';
  }

  setExploreCard(show) { $('#explore-card').hidden = !show; }

  clock(day, hour) {
    const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
    $('#clock').innerHTML = `<b>${day}</b>日目 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  totals(t) {
    $('#totals').innerHTML = `<span>建築物 <b>${t.count}</b></span><span>城壁 <b>${Math.round(t.wallLen)}m</b></span><span class="cost" title="建設費の合計（Phase 2 で実際に資源を消費します）">費用 <b>石${t.cost.stone.toLocaleString()} 木${t.cost.wood.toLocaleString()} 金${t.cost.gold.toLocaleString()}</b></span>`;
  }

  mapName(t) { $('#mapname').textContent = `${t.type.name}・${t.seed}`; }

  status(msg, kind = 'ok', transient = false) {
    if (transient && this.statusLocked()) return;
    const el = $('#status');
    el.textContent = msg;
    el.className = kind === 'ok' ? '' : kind;
    if (!transient) this._statusLock = performance.now() + 2500;
  }
  statusLocked() { return (this._statusLock || 0) > performance.now(); }

  flash() {
    const el = $('#status');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  hint(h) { $('#hint').textContent = h; }

  toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // 地点情報（ホバー位置の地形）
  terrainInfo(info) {
    this._terrain = info;
    if (this._item) return;
    this._renderInfo();
  }

  showItem(item) {
    this._item = item;
    this._renderInfo();
  }

  _renderInfo() {
    const el = $('#info');
    const item = this._item;
    let html = '';
    if (item) {
      const def = DEFS[item.type];
      const hp = itemMaxHp(item);
      html += `<h2>${esc(def.name)}</h2><p class="muted">${esc(def.desc)}</p>`;
      html += '<h4>諸元</h4><dl class="kv">';
      if (hp) html += `<dt>耐久度</dt><dd>${hp.toLocaleString()} / ${hp.toLocaleString()}</dd>`;
      if (def.kind === 'line') html += `<dt>長さ</dt><dd>${Math.hypot(item.bx - item.ax, item.bz - item.az).toFixed(1)} m</dd>`;
      if (item.height) html += `<dt>高さ</dt><dd>${item.height} m</dd>`;
      if (item.thickness) html += `<dt>厚さ</dt><dd>${item.thickness} m</dd>`;
      if (def.range) html += `<dt>射程</dt><dd>${def.range} m</dd>`;
      if (item.type === 'gate') html += `<dt>状態</dt><dd>${item.open ? '開門' : '閉門'}</dd>`;
      const d = this.g.world.der(item.id);
      if (d?.base != null) html += `<dt>基礎標高</dt><dd>${d.base.toFixed(1)} m</dd>`;
      html += `<dt>建設費</dt><dd>${costText(itemCost(item))}</dd></dl>`;
      if (hp) html += '<div class="hpbar"><i style="width:100%"></i></div>';
      html += `<h4>機能</h4><p>${esc(def.func)}</p>`;
      if (def.params) {
        html += '<h4>調整</h4>';
        for (const [pk, spec] of Object.entries(def.params)) {
          html += `<label class="opt"><span>${spec.label}</span><input type="range" id="sel-${pk}" data-p="${pk}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${item[pk]}"><output>${item[pk]}${spec.unit}</output></label>`;
        }
      }
      html += '<div class="actions">';
      if (item.type === 'gate') html += `<button class="btn primary" data-act="gate">${item.open ? '門を閉じる' : '門を開く'}</button>`;
      if (item.type === 'wall') html += '<button class="btn" data-act="flip">胸壁の向きを反転</button>';
      html += '<button class="btn danger" data-act="del">撤去 (Del)</button></div>';
    } else {
      html += '<h2>地点情報</h2>';
      const t = this._terrain;
      if (!t) html += '<p class="muted">地図上にカーソルを置くと、その地点の地形を表示します。</p>';
      else {
        html += `<dl class="kv"><dt>標高</dt><dd>${t.height.toFixed(1)} m</dd><dt>傾斜</dt><dd>${t.slopeDeg.toFixed(0)}°</dd>
          <dt>地形</dt><dd>${t.landform}</dd><dt>地表</dt><dd>${t.surface}</dd><dt>建築</dt><dd>${t.build}</dd>
          <dt>木材資源</dt><dd>${t.wood || '—'}</dd><dt>石材資源</dt><dd>${t.stone || '—'}</dd>
          <dt>農業適性</dt><dd>${Math.round(t.fert * 100)}%</dd><dt>移動コスト</dt><dd>${Number.isFinite(t.moveCost) ? '×' + t.moveCost.toFixed(1) : '通行不可'}</dd></dl>`;
        html += '<p class="muted" style="font-size:11.5px">高台は防衛に有利だが、建築用地と水の確保は難しくなる。</p>';
      }
    }
    el.innerHTML = html;
    if (item) {
      el.querySelectorAll('input[type=range]').forEach((inp) => {
        const spec = DEFS[item.type].params[inp.dataset.p];
        inp.addEventListener('input', () => { inp.nextElementSibling.textContent = inp.value + spec.unit; });
        inp.addEventListener('change', () => {
          if (!this.g.tools.modifySelected({ [inp.dataset.p]: Number(inp.value) })) {
            inp.value = item[inp.dataset.p];
            inp.nextElementSibling.textContent = item[inp.dataset.p] + spec.unit;
          }
        });
      });
      el.querySelector('[data-act=gate]')?.addEventListener('click', () => this.g.tools.toggleGate(item.id));
      el.querySelector('[data-act=flip]')?.addEventListener('click', () => this.g.tools.modifySelected({ outer: -(item.outer || 1) }));
      el.querySelector('[data-act=del]')?.addEventListener('click', () => this.g.tools.demolish(item.id));
    }
  }

  // ---- モーダル ----
  modal(html) {
    const m = $('#modal');
    m.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">${html}</div>`;
    m.hidden = false;
    this.g.modalOpen = true;
    m.onclick = (e) => { if (e.target === m) this.closeModal(); };
    return m.querySelector('.dialog');
  }
  closeModal() {
    const m = $('#modal');
    m.hidden = true; m.innerHTML = '';
    this.g.modalOpen = false;
    this.g.focusView();
  }

  openNewMap() {
    const opts = Object.entries(MAP_TYPES).map(([k, t]) => `<option value="${k}"${k === this.g.terrain.typeKey ? ' selected' : ''}>${t.name} — ${t.desc}</option>`).join('');
    const dlg = this.modal(`<h2>新しい領地</h2>
      <div class="field"><label for="nmSeed">シード値（同じ値なら同じ地形）</label>
        <div class="row"><input id="nmSeed" value="${esc(randomSeed())}" style="flex:1"><button class="btn" id="nmRand">ランダム</button></div></div>
      <div class="field"><label for="nmType">地形タイプ</label><select id="nmType">${opts}</select></div>
      <p class="optnote">現在の城塞は破棄されます。必要なら先に保存してください。</p>
      <div class="row end"><button class="btn" id="nmCancel">やめる</button><button class="btn primary" id="nmGo">生成する</button></div>`);
    dlg.querySelector('#nmRand').onclick = () => { dlg.querySelector('#nmSeed').value = randomSeed(); };
    dlg.querySelector('#nmCancel').onclick = () => this.closeModal();
    dlg.querySelector('#nmGo').onclick = () => {
      const seed = dlg.querySelector('#nmSeed').value.trim() || randomSeed();
      const type = dlg.querySelector('#nmType').value;
      this.closeModal();
      this.g.newMap(seed, type);
    };
  }

  openSaveLoad(mode) {
    const ok = storageAvailable();
    const rows = SLOTS.map((s) => {
      const info = ok ? slotInfo(s) : null;
      const name = s === 'auto' ? '自動保存' : `スロット ${s}`;
      const meta = info ? `${info.mapName}・${esc(info.seed)}・建築物${info.count}・${info.savedAt.toLocaleString('ja-JP')}` : '空き';
      const btns = (mode === 'save' && s !== 'auto' ? `<button class="btn primary" data-save="${s}">保存</button>` : '<span></span>') +
        (info ? `<button class="btn${mode === 'load' ? ' primary' : ''}" data-load="${s}">読込</button>` : '<span></span>');
      return `<div class="slot"><div><b>${name}</b><div class="meta">${meta}</div></div>${btns}</div>`;
    }).join('');
    const dlg = this.modal(`<h2>${mode === 'save' ? '保存' : '読み込み'}</h2>
      ${ok ? '' : '<p class="optnote" style="color:var(--warn)">この環境ではブラウザ保存が使えません。下の書き出し／読み込みを使ってください。</p>'}
      ${rows}
      <h4 style="font-family:var(--font-display);color:var(--gilt);letter-spacing:.18em;font-size:11.5px;margin:14px 0 6px">データの書き出し・読み込み</h4>
      <div class="field"><textarea id="slJson" placeholder="ここに保存データ(JSON)を貼り付けて「テキストから読込」"></textarea></div>
      <div class="row"><button class="btn" id="slExport">現在の状態を書き出す</button><button class="btn" id="slCopy">コピー</button>
        <button class="btn" id="slImport">テキストから読込</button>
        <label class="btn" for="slFile">ファイルから読込</label><input type="file" id="slFile" accept=".json,application/json" hidden></div>
      <div class="row end"><button class="btn" id="slClose">閉じる</button></div>`);
    dlg.querySelectorAll('[data-save]').forEach((b) => b.onclick = () => { this.g.saveTo(b.dataset.save); this.openSaveLoad(mode); });
    dlg.querySelectorAll('[data-load]').forEach((b) => b.onclick = () => { this.closeModal(); this.g.loadFrom(b.dataset.load); });
    const ta = dlg.querySelector('#slJson');
    dlg.querySelector('#slExport').onclick = () => { ta.value = JSON.stringify(this.g.exportState()); ta.select(); };
    dlg.querySelector('#slCopy').onclick = () => {
      if (!ta.value) ta.value = JSON.stringify(this.g.exportState());
      navigator.clipboard?.writeText(ta.value).then(() => this.toast('コピーしました'), () => { ta.select(); this.toast('選択しました。Ctrl+C でコピーしてください'); });
    };
    const importText = (txt) => {
      try {
        const s = validateState(JSON.parse(txt));
        this.closeModal();
        this.g.applyState(s);
        this.toast('読み込みました');
      } catch (e) {
        this.toast('読み込めません：' + e.message);
      }
    };
    dlg.querySelector('#slImport').onclick = () => importText(ta.value);
    dlg.querySelector('#slFile').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => importText(r.result);
      r.readAsText(f);
    };
    dlg.querySelector('#slClose').onclick = () => this.closeModal();
  }
}

export function randomSeed() {
  const words = ['kestrel', 'aldmoor', 'ravens', 'thornby', 'wyvern', 'highcairn', 'ashford', 'greywatch', 'oakhold', 'marlow'];
  return words[Math.floor(Math.random() * words.length)] + '-' + Math.floor(Math.random() * 9000 + 1000);
}
