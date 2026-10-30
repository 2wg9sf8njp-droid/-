#!/usr/bin/env node
// 統合ライフコーチをヘッドレスブラウザで開き、全タブとサブ画面を巡回して
// JavaScript エラーが出ないかを確かめる。スクリーンショットも保存する。
// 使い方: node .claude/skills/lifecoach-maintain/scripts/smoke.mjs [index.htmlのパス] [スクショ保存先ディレクトリ]
// Playwright が必要(require('playwright') が通る環境を想定)。
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.log("Playwright が見つからないためスモークテストをスキップします(check.mjs の結果のみで判断してください)");
  process.exit(0);
}

const file = resolve(process.argv[2] || "index.html");
const shotDir = process.argv[3] || null;
if (shotDir) mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // iPhone 相当
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console.error: ${m.text()}`); });
// AI 呼び出しは外に出さない
await page.route("https://api.anthropic.com/**", (r) => r.fulfill({ status: 401, body: "{}" }));

await page.goto("file://" + file);
await page.waitForTimeout(500);

const tabs = await page.$$eval(".bottom-nav button", (bs) => bs.map((b) => b.dataset.tab));
for (const tab of tabs) {
  await page.click(`.bottom-nav button[data-tab="${tab}"]`);
  await page.waitForTimeout(300);
  const empty = await page.$eval(`#view-${tab}`, (v) => v.innerHTML.trim() === "");
  if (empty) problems.push(`タブ "${tab}" の中身が空です`);
  if (shotDir) await page.screenshot({ path: `${shotDir}/${tab}.png`, fullPage: true });
  // タブ内のセグメント切り替え(.seg button)も巡回する
  const segCount = await page.$$eval(`#view-${tab} .seg button`, (bs) => bs.length);
  for (let i = 0; i < segCount; i++) {
    const segs = await page.$$(`#view-${tab} .seg button`);
    if (!segs[i]) break;
    const label = (await segs[i].textContent()).trim();
    await segs[i].click();
    await page.waitForTimeout(250);
    if (shotDir) await page.screenshot({ path: `${shotDir}/${tab}-${i}-${label}.png`, fullPage: true });
  }
}

// エクスポート→インポートの往復でデータが壊れないか
const roundtrip = await page.evaluate(async () => {
  const before = await DB.exportAllData();
  await DB.importAllData(JSON.parse(JSON.stringify(before)));
  const after = await DB.exportAllData();
  return { ok: JSON.stringify(before.kv) === JSON.stringify(after.kv), schema: before.schema };
});
if (!roundtrip.ok) problems.push("エクスポート→インポートで kv の内容が変わりました");

await browser.close();
console.log(`巡回したタブ: ${tabs.join(", ")} / バックアップ形式: ${roundtrip.schema}`);
if (shotDir) console.log(`スクリーンショット: ${shotDir}`);
if (problems.length) {
  for (const p of problems) console.log(`問題: ${p}`);
  process.exit(1);
}
console.log("OK: スモークテストで問題は見つかりませんでした");
