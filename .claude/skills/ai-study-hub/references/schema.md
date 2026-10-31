# 学習ハブのデータ形式

URL: https://claude.ai/artifact/1hcwDxrA9z3uko6KKR1xgu

日付はすべて日本時間の `YYYY-MM-DD`。日時は `2026-10-30T12:30:00+09:00` の形。既存の文書を書き換えるときは、読んだときの `version` を `if_version` に渡す(`ArtifactData` の決まり)。複数の文書を書くときは `batch` を使う。1回で最大50件。

## entries/<id> — 配信1回分

id の付け方: `<日付>-<kind>-<短い英字スラッグ>` (例: `2026-10-31-lesson-llm`, `2026-10-31-news`)

```json
{
  "kind": "lesson | deepdive | news",
  "date": "2026-10-31",
  "slot": "noon | night",
  "createdAt": "2026-10-31T12:30:00+09:00",
  "title": "見出し(30字前後)",
  "summary": "一覧で見える1〜2文の要約",
  "body": "本文。Markdown(### 見出し、- 箇条書き、1. 番号、`コード`、**太字**、[リンク](https://…)、``` のコードブロックだけが表示される)",
  "tags": ["git", "セキュリティ"],
  "concepts": ["concepts の id", "…"],
  "quiz": [{ "q": "問い", "choices": ["選択肢A", "選択肢B", "選択肢C", "選択肢D"], "answer": 1, "a": "解説(なぜその答えか、間違いの選択肢のどこが違うか)" }],
  "practice": [{ "title": "課題名", "why": "なぜやるか", "steps": ["手順", "…"] }],
  "sources": [{ "title": "記事名(媒体)", "url": "https://…" }]
}
```

- `quiz` は**選択式**にする。ページでは選択肢ボタンになり、押すと正誤と解説 `a` が出る。講義・深掘りでは本文の最後に「今日の振り返り」として表示される。
  - 1回あたり、その回の振り返り問題3〜4問と、復習問題1〜2問。復習問題は問いの頭に「【復習】」と付ける
  - `choices` は4つ。`answer` は正解の位置(0始まり)。正解の位置は問題ごとにばらけさせる(いつも A にしない)
  - 間違いの選択肢は「ありがちな誤解」にする。明らかに変なものばかりだと、考えずに当たってしまう
  - `a` には正解の理由を1〜2文で書く。`choices` が無い問題(記述式)は、問いをタップすると `a` が出るだけになる
- `practice` は本文の下に表示される要約。詳しい手順は `practice` コレクションに書く。
- `sources` はニュースでは必須。講義では公式ドキュメントなどを入れるとよい。

## concepts/<id> — 知識1つ

id は英小文字とハイフン(例: `context-window`)。既存の id を `list` で確かめ、同じ知識を重複して作らない。

```json
{
  "name": "表示名",
  "area": "カリキュラムの分野名(meta/curriculum の areas[].name と同じ表記)",
  "oneLine": "一言でいうと(40字以内)",
  "detail": "Markdown の説明(たとえ・具体例・注意点)",
  "reviewQ": "復習で出す問い",
  "reviewChoices": ["選択肢A", "選択肢B", "選択肢C", "選択肢D"],
  "reviewAnswer": 2,
  "reviewA": "その答え(1〜2文。選んだあとに解説として出る)",
  "related": ["つながる concepts の id"],
  "status": "new | learning | solid",
  "stage": 0,
  "firstSeen": "2026-10-31",
  "nextReview": "2026-11-01",
  "lastReviewed": "2026-11-01",
  "lastGrade": "good | hard | again",
  "reviewCount": 0,
  "entryIds": ["登場した entries の id"]
}
```

復習タブは `reviewChoices` があれば選択式で出題する(正解の位置 `reviewAnswer` は0始まり)。無いと「自分で書いてから答えを見る」形式になり答えにくいので、新しい知識には必ず `reviewChoices` と `reviewAnswer` を付ける。選択肢の作り方は quiz と同じ(4つ、正解の位置をばらけさせる、間違いはありがちな誤解)。

復習スケジュールの決まり(ページの復習ボタンと同じ計算):

- 間隔の表 `INTERVALS = [1, 3, 7, 14, 30, 60]`(日)
- 新しく登録したとき: `stage: 0`, `nextReview: 翌日`, `status: "new"`
- 配信の中で復習として出題したとき: `stage` を1つ上げ(上限5)、`nextReview` = 今日 + `INTERVALS[stage]`、`status` は stage が4以上なら `"solid"`、それ以外は `"learning"`。`lastReviewed` を今日にする。
- ページの復習で正解して「次へ」: stage+1。「勘で当たった」: stage はそのままで翌日。不正解: stage 0 で翌日。
- 既存の知識が新しい配信に再登場したら、`entryIds` に追加し、`related` を増やす。`stage` はそのままにする。

## notes/<id> — ユーザーのメモ

ページから書かれたものは id が自動で付く。

```json
{ "text": "本文", "status": "pending | done", "createdAt": "…", "resultEntry": "深掘りした entries の id" }
```

深掘りしたら `status: "done"` と `resultEntry` を `update` で書く。`text` は書き換えない。

## practice/<id> — 実践課題

```json
{
  "title": "課題名",
  "why": "この課題で何が身につくか",
  "steps": ["具体的な手順(コマンドはバッククォートで)", "…"],
  "time": "20分",
  "concepts": ["concepts の id"],
  "status": "todo | doing | done",
  "from": "元になった entries の id",
  "createdAt": "…"
}
```

ユーザーがページで status を変える。`done` になった課題は、次の配信で「やってみてどうだったか」を尋ねたり、発展課題を出したりする材料にする。

## meta/curriculum — カリキュラム

```json
{
  "updatedAt": "2026-10-30",
  "areas": [
    { "id": "ai-basics", "name": "AIの仕組み", "units": [
      { "id": "llm", "title": "LLMとは何か", "status": "todo | done", "entryId": "扱った entries の id" }
    ]}
  ]
}
```

「次の回」は、areas を上から順に見て最初の `status: "todo"` の unit。ページもこの順で「→」を付けている。
