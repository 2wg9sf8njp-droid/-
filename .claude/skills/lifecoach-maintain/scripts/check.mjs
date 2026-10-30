#!/usr/bin/env node
// 統合ライフコーチ(index.html)の静的チェック。
// 使い方: node .claude/skills/lifecoach-maintain/scripts/check.mjs [index.htmlのパス]
// 問題があれば終了コード1で終わる。
import { readFileSync } from "node:fs";
import vm from "node:vm";

const path = process.argv[2] || "index.html";
const html = readFileSync(path, "utf8");
const errors = [];
const warns = [];

// 1. <script> が1つだけで、構文として正しいこと
const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) errors.push(`<script> が ${scripts.length} 個あります(単一ファイル版は1個の想定)`);
const js = scripts.map((m) => m[2]).join("\n");
try {
  new vm.Script(js, { filename: "index.html<script>" });
} catch (e) {
  errors.push(`JavaScript の構文エラー: ${e.message}`);
}

// 2. 外部リソースに依存していないこと(オフライン・単一ファイルで動くため)
for (const m of html.matchAll(/<(script|link|img|iframe)\b[^>]*\b(src|href)\s*=\s*"([^"]+)"/g)) {
  const url = m[3];
  if (!url.startsWith("data:") && !url.startsWith("#")) errors.push(`外部リソースを参照しています: <${m[1]} ${m[2]}="${url.slice(0, 80)}">`);
}
for (const m of js.matchAll(/fetch\(\s*["'`]([^"'`]+)/g)) {
  if (!m[1].startsWith("https://api.anthropic.com/")) errors.push(`想定外の通信先: ${m[1]}`);
}

// 3. 互換性を壊す変更が入っていないこと
const dbName = js.match(/const DB_NAME = "([^"]+)"/)?.[1];
if (dbName !== "lifecoach_db") errors.push(`DB_NAME が "lifecoach_db" ではありません(${dbName}) — 既存データが見えなくなります`);
const dbVersion = Number(js.match(/const DB_VERSION = (\d+)/)?.[1]);
if (!dbVersion) errors.push("DB_VERSION が見つかりません");
if (/deleteObjectStore|deleteIndex/.test(js)) errors.push("deleteObjectStore / deleteIndex を使っています — スキーマ変更は加算のみのルールです");
if (!js.includes('"life-coach-mobile.v1"')) warns.push('バックアップ形式 "life-coach-mobile.v1" が見当たりません — 古いバックアップを読めるか確認してください');

// 4. kv キーがすべて KV_DEFAULTS に登録されていること(バックアップ対象から漏れるため)
const defaultsBlock = js.match(/const KV_DEFAULTS = \{([\s\S]*?)\n\};/)?.[1] || "";
const defaultKeys = new Set([...defaultsBlock.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((m) => m[1]));
const usedKeys = new Set([...js.matchAll(/kv(?:Get|Set)\(\s*"([a-zA-Z]+)"/g)].map((m) => m[1]));
for (const k of usedKeys) {
  if (!defaultKeys.has(k)) errors.push(`kv キー "${k}" が KV_DEFAULTS にありません — エクスポートに含まれず、初期値も undefined になります`);
}

// 5. タブ: nav ボタン / section / RENDERERS が揃っていること
const navTabs = new Set([...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]));
const views = new Set([...html.matchAll(/id="view-([a-z]+)"/g)].map((m) => m[1]));
const renderersBlock = js.match(/const RENDERERS = \{([\s\S]*?)\};/)?.[1] || "";
const renderers = new Set([...renderersBlock.matchAll(/([a-z]+)\s*:/g)].map((m) => m[1]));
for (const t of new Set([...navTabs, ...views, ...renderers])) {
  const missing = [!navTabs.has(t) && "ナビボタン", !views.has(t) && "section#view-*", !renderers.has(t) && "RENDERERS"].filter(Boolean);
  if (missing.length) errors.push(`タブ "${t}" に ${missing.join("・")} がありません`);
}

// 6. CSS 変数: 未定義の var(--x) を使っていないこと
const rootBlock = html.match(/:root\s*\{([\s\S]*?)\}/)?.[1] || "";
const definedVars = new Set([...rootBlock.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
for (const v of new Set([...html.matchAll(/var\((--[a-zA-Z0-9-]+)/g)].map((m) => m[1]))) {
  if (!definedVars.has(v)) errors.push(`CSS 変数 ${v} が :root で定義されていません`);
}

// 7. 重複した id
const ids = [...html.matchAll(/\sid="([^"$]+)"/g)].map((m) => m[1]);
const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
if (dup.length) warns.push(`静的HTML内で id が重複しています: ${dup.join(", ")}`);

console.log(`チェック対象: ${path} (${(html.length / 1024).toFixed(1)} KB, DB_VERSION=${dbVersion})`);
for (const w of warns) console.log(`警告: ${w}`);
for (const e of errors) console.log(`エラー: ${e}`);
if (errors.length) process.exit(1);
console.log("OK: 静的チェックはすべて通りました");
