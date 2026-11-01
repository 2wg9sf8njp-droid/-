# 築城記 Castellum — 中世城塞建築・領地経営シミュレーター（Phase 1）

地形を読み、自分だけの城塞を築くブラウザ3Dゲームの Phase 1 実装です。

## 起動方法

ビルド不要です（Three.js 0.160.0 を CDN から ES Modules で読み込み）。ES Modules を使うため、ファイルを直接開くのではなく静的サーバーで配信してください。

```bash
cd castle
python3 -m http.server 8080   # または npx serve .
# → http://localhost:8080/
```

## 操作

| 操作 | 建築モード |
|---|---|
| 左クリック | 選択／配置／城壁の点を追加 |
| 右ドラッグ | カメラ回転（Q/E でも回転、PageUp/Down で俯角） |
| 中ドラッグ・WASD・矢印 | カメラ移動（Shift で高速） |
| ホイール | ズーム |
| 右クリック・Esc | 城壁の連続配置を終了／ツール取消 |
| R / Shift+R | 15°回転（階段は登る向きを反転） |
| Shift（城壁配置中） | 15°刻みの角度スナップ |
| Del | 選択中の建築物を撤去 |
| Ctrl+Z / Ctrl+Y | 取り消し／やり直し |
| V / X / 1〜0 | 選択・撤去・各建築物 |
| Space | 一時停止 |
| F / Tab | 建築⇔探索モード切替 |

探索モード：クリックで視点操作開始、WASD 移動、Shift 走る、Space 跳ぶ、E 近くの城門を開閉、Esc でマウス解放。

## 構成

```
src/
  core/        乱数・ノイズ（シード再現性）、2D幾何（SAT・線分交差）
  terrain/     generator.js  地形データ生成（標高・傾斜・地表・地形区分・資源・農業適性・移動コスト）
               terrainMesh.js 地形メッシュ・表示モード・遠景・水面・高さ場レイキャスト
               vegetation.js  樹木・岩（インスタンス描画、建物下の木は自動で非表示）
  buildings/   defs.js       建築物の機能データ（耐久度・建設費・射程・説明）
               models.js     3Dモデル生成（基本形状の組み合わせ）
  world/       world.js      建築物データ管理（見た目から独立）
               derive.js     占有ポリゴン・基礎高さ・城壁断面・当たり判定
               placement.js  配置判定・スナップ・城壁への門の組み込み・分割
  render/      materials.js（手続き生成テクスチャ）, shapes.js, buildingRenderer.js, environment.js（空・昼夜）
  controls/    rtsCamera.js（俯瞰）, fpsController.js（一人称・衝突）
  tools/       buildTools.js 建築操作・プレビュー・取り消し履歴
  ui/          ui.js, minimap.js
  save/        saveManager.js
```

建築物はすべて `{type, 座標, パラメータ}` のプレーンなデータで、見た目（models.js）と機能（defs.js / derive.js）を分離しています。保存データはシード値＋建築物リストのみで、地形はシードから再生成されます。
