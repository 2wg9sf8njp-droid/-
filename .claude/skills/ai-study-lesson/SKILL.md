---
name: ai-study-lesson
description: 毎日お昼(12:30ごろ)に届けるAI・システムの勉強パートを作って配信するスキル。ユーザーのメモの深掘り、またはカリキュラムの次の回の講義に、復習問題と手を動かす実践課題を添えて、学習ハブ「AIシステム学習帳」に記録する。定期実行の「お昼の講義」タスクから呼ばれたとき、ユーザーが「今日の講義」「次の回を教えて」「続きを勉強したい」と言ったときは必ず使うこと。
---

# お昼の勉強パートを配信する

## 0. 準備

1. Skill ツールで `ai-study-hub` を読み込み、その `references/schema.md` と `references/writing.md` を読む。データの形と書き方はそこにある。
2. `ArtifactData` を ToolSearch(`select:ArtifactData`)で読み込む。
3. 今日の日付を日本時間で確かめる(`TZ=Asia/Tokyo date +%F`)。

## 1. 状況を読む

学習帳(https://claude.ai/artifact/1hcwDxrA9z3uko6KKR1xgu)から次のものを読む:

- `notes` を `status == "pending"` で query
- `meta/curriculum`
- `concepts` を全件 list(id の重複を避け、つながりを作るため)
- `practice` で `status == "done"` のもの(最近の数件)
- 今日の `entries`。すでに今日の昼の配信があれば、二重に作らずにそれを返して終わる。

## 2. 今日のテーマを決める

優先順位:

1. **pending のメモがある** → 深掘り(`kind: "deepdive"`)。メモが複数あるなら、古いものから、関連するものはまとめて1回で扱う。ユーザーが自分で書いた学びは、カリキュラムより大事。
2. **メモが無い** → カリキュラムの「次の回」の講義(`kind: "lesson"`)。最近の done の実践課題や、メモで見えた関心に強く関わる回が後ろにあれば、先にしてよい。
3. **日曜日** → 1か2に加えて、本文の最後に `### 今週のまとめ` を付ける。その週の entries を見て、つながりを短くまとめる。

## 3. 内容を作る

`writing.md` の型に沿って書く。レベル b(AI は使うが仕組みはこれから)を意識し、初出の用語は言い換える。正確さが大事な事実(コマンドの挙動、仕様)は、自信が無ければ Web 検索や公式ドキュメントで確かめる。

**復習**: `concepts` のうち `nextReview <= 今日` のものを、古い順に1〜2個選ぶ。`quiz` に「【復習】」付きで入れる。今日のテーマとつながる知識を選べると、なおよい。

**実践課題**: 1〜2件。安全に試せる場所を指定し、最後の手順を「分かったことを学習帳のメモに書く」にする。

## 4. 記録する(batch で一度に)

- `entries/<日付>-<kind>-<スラッグ>` を set
- 新しい知識を `concepts` に set(1回に2〜4個。`related` で既存とつなぐ)。既存の知識が再登場したら update で `entryIds` と `related` に追加
- 出題した復習知識を update(stage+1、nextReview を進める。計算は schema.md)
- `practice` に新しい課題を set
- 深掘りしたメモを update(`status: "done"`, `resultEntry`)
- 扱ったカリキュラムの回を `meta/curriculum` で `status: "done"`, `entryId` に update(areas 配列ごと書き換える。読んだ version を if_version に渡す)

書き込みが失敗したら、エラー内容を読んで直し、もう一度書く。成功したことを確かめずに「記録しました」と言わない。

## 5. 返答する

`writing.md` の「会話への返答」の形で短く返す。
