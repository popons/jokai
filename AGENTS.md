# 原理原則

- Userとは日本語やりとりするようにしてください。
- ただし、かならず思考は英語で実施すること。
- ユーザーに指示に対しては、常に、不明点、疑問点、問題点、懸念点がないのかを厳重に思索し、ユーザーに問い合わせることがあればそれを最優先しましょう。
- ユーザーに質問する際は番号を添えてください。
  - ただし質問する際には熟考し調査しつくした上で質問してください
  - 無駄な対話は不要です。
- コマンドラインを示す場合には1行で示してください。(\\で改行を挟めないで)
  - また連番振ったり、箇条書きの`-`をコマンド前に書かないでください。
  - コピペで実行かのうな状態で呈示してください


ただ同意するのではなく、私に対して率直で本質的な助言者として行動してほしい。
お世辞も慰めもいらない。遠慮せず、真実をそのまま伝えてほしい。
私の考えを徹底的に検証し、前提を問い直し、見落としている盲点を指摘してほしい。
感情ではなく、論理的で客観的に。包み隠さず、フィルターをかけずに話してほしい。
もし私の論理が弱いなら、その理由を明確に示して。
自分を甘やかしたり、都合よく解釈しているなら、それを正直に指摘して。
不快な現実から逃げていたり、時間を無駄にしているなら、それをはっきり伝え、どんな機会を失っているのかを説明して。
私の状況を、完全な客観性と戦略的な視点から見て、どこで言い訳をしているのか、どこで小さくまとまっているのか、あるいはリスクや努力を過小評価しているのかを明らかにしてほしい。
そのうえで、次の段階に進むために変えるべき思考・行動・姿勢を、具体的かつ優先順位をつけて提案してほしい。
遠慮せず、本音で。
私は慰めではなく、成長のために真実を聞きたい。
だから、あなたには「私の成長に本気で関わるアドバイザー」として接してほしい。
そして、可能な限り、私の言葉の奥にある「本当の意図」や「まだ言語化できていない真実」を感じ取りながら答えてほしい。

## 質問品質ルール

- 矛盾した回答が可能になる質問はしないこと。
- 選択肢を提示する場合は、相互排他的かつ前提が衝突しない形にすること。
- 複数質問が依存関係を持つ場合は、前の回答が確定してから次を聞くこと。
- 1問で意思決定できる内容は1問にまとめること。
- 質問文は必ず「何を決める質問か」が分かるように書くこと。

## Rust のルール

- バックグラウンドタスクが自動で `cargo check`・`cargo test`・`cargo clippy` を実行します。  
- これらタスクのエラーメッセージは `build-error.txt`・`test-error.txt`・`build-error-win.txt`・`clippy-error.txt` のいずれかに記録されます。  
- いずれかのファイルを変更して保存したら、`cargo check` が終わるまで **1 秒間** 待機してください。  
- その後、エラーが出ていないか **`build-error.txt`・`test-error.txt`・`build-error-win.txt`・`clippy-error.txt`** を確認してください。  
- **決して** 手動で `cargo run`・`cargo check`・`cargo build`・`cargo clippy` を実行しないでください。  
- 作業開始前には毎回「build-error.txt と test-error.txt を読もう！」と大声で叫んでください。  
- 新機能を追加する際、受け入れ先の土台が不足している場合は、
  まず既存の挙動を変えない形で必要な基盤を整え、
  その上に機能を実装してください。
- 変更したら、cargo fmtを実行すること

## Jokai 紙面ルール

- 常会案内の正本見本は `docs/exmple.png`。
- 本体紙面は「左が本文、右脇に資料サムネ」の構成を守ること。
- 編集画面の常時プレビューは、この紙面と同じ見た目を保つこと。
- 生成する「案内PDF」は常会案内の本体紙面のみを出力すること。
- 添付資料の原本PDFや原本画像は、案内PDFに結合しないこと。
- 添付資料は本体紙面ではサムネ表示のみとし、原本の閲覧やダウンロードは別導線に分離すること。
- 最終ページ下端には footer 帯を置ける前提で組版すること。左下は任意赤字メッセージ、右下は必須連絡先ブロックを出す。
- 項目ごとのサムネ倍率は右上基点で拡縮し、本文位置は動かさないこと。right-top は「見えている画像自体」の右上固定を意味し、pdfme の box 内中央寄せに任せないこと。サムネは本文より背面に置き、重なった本文は白まわりで可読性を守ること。

# python

pythonコマンドないので、python3コマンドを使ってね


# 作業メモ運用

- 気付いたこと発見注意点など時系列メモMarkdownに追記すること。
- メモは本ディレクトリの`WORK_TIMELINE.md`を使用すること。
- 作業メモはChatの終わりにまとめて書き出すのではなくその都度即座に書き出すこと
- 各行は`[カテゴリ]`を時刻の直後に入れること。
- 書式は`- YYYY-MM-DD HH:MM:SS +0900 [カテゴリ] メモ`。

以下サンプル
```
- 2026-02-25 19:28:14 +0900 [$カテゴリ] `mmcli -m 0`でEMS31-JとSIM認識を確認。未接続の主因はAPNプロファイル未作成と判断。
- 2026-02-25 19:29:01 +0900 [$カテゴリ] `nmcli connection add ... apn 4gn.jp`で`rocketmobile`接続を新規作成。
- 2026-02-25 19:30:03 +0900 [$カテゴリ] `ttyCommModem:gsm:connected`と`ppp0`生成を確認。
- 2026-02-25 19:32:10 +0900 [$カテゴリ] `/etc/NetworkManager/system-connections/rocketmobile.nmconnection`を`persist_file`実行。
- 2026-02-25 19:35:12 +0900 [$カテゴリ] デフォルトルートは`eth0(metric 100)`優先、`ppp0(metric 700)`はバックアップ経路。
- 2026-02-25 19:36:44 +0900 [$カテゴリ] `100.75.x.x`はCGNAT帯でグローバルIPではないため、外部からの直接着信は不可。
```

## Codex Native 運用

- Codex に対する正本 instruction は `AGENTS.md`。`CLAUDE.md` は移行元の参考資料として扱い、新しい正本ルールはまず `AGENTS.md` を更新すること。
- このプロジェクトは `Greenfield` 扱いだが、最優先原則は「紙面見た目厳守」。新機能よりも、見本紙面・プレビュー・最終PDFの整合を優先すること。
- `context/` は深い説明の置き場所。`AGENTS.md` には作業判断に必要な短い運用ルールだけを書き、詳細は `context/*.md` に逃がすこと。

## プロジェクト概要

- 目的: 生産組合長向けの常会案内を作成しつつ、別文書ファミリーの SVG テンプレ帳票も同じアプリで扱う。
- 技術スタック: Rust + Axum + PostgreSQL + Vite + 素の JavaScript + `pdfme`。
- 画面/出力の正解: `docs/exmple.png`。
- 重要な生成境界:
  - 編集UIの常時プレビューは見本紙面と同じ見た目を保つ。
  - 編集UIのうち印刷プレビュー以外の chrome は、余白を絞って視線移動とスクロール負荷を減らすこと。
  - 「案内PDF」は本体紙面のみ出力する。
  - 添付資料は紙面ではサムネのみ表示し、原本閲覧/ダウンロードは別導線に分離する。
  - `農作業傷害共済` は `常会案内` と同じ `issues` 系へ混ぜず、`template_documents` 系の別保存モデルで扱う。
  - `農作業傷害共済` は `payload.rows[]` の 1 行を 1 ページとして印刷する。未入力行が 1 行でも残ると、一括 preview / PDF 全体を止める。

## Repo Map

- `src/main.rs`: Axum エントリポイント。埋め込み frontend asset / 紙面用フォント配信、`issues` 系 CRUD、`template_documents` 系 CRUD、issue の draft 限定削除、一覧からの深い複製、添付の DB 保存、内部 temp dir を使う preview / thumbnail 生成、`/issues/{id}/print` と `/template-documents/{id}/print` の印刷 shell 配信を担当。`農作業傷害共済` は raw SVG を返す `/template-documents/{id}/print` 正本 HTML、headless Chromium による `/api/template-documents/{id}/print-pdf`、`/api/template-documents/{id}/preview-images` もここで持つ。legacy filesystem 吸い上げは `db init` / `db migrate` の明示 `--legacy-storage-dir` 側へ分離した。`/api/issues/{id}/print-pdf` は互換メッセージのみで、server-side PDF生成は現状本線ではない。
- `web-src/main.js`: 文書ファミリー切替つき一覧画面、常会案内 editor、SVG テンプレ帳票 editor、状態管理、保存、常時プレビュー再生成、一覧カードの `編集へ` / `複製` / `削除` 導線、template document の rows[] 台帳 UI と補助 JSON editor、添付ビューア、item 添付欄での Clipboard 画像登録導線、item ごとの補足行群（赤/青）編集、`thumb_scale_percent` による項目サムネ倍率 slider を担当。常会案内 editor の小項目 toolbar は、heading/body/対象者/期限/補足行/添付のいずれかがあるときだけ `①` などの番号を表示する。`農作業傷害共済` editor は `payload.rows[]` を 1 行 1 ページ前提で編集し、行編集または valid JSON 変更後に auto-save して、その保存済み draft を使って `preview-images` を再取得する。
- `web-src/notice-pdf.js`: `pdfme` を使う A4 固定レイアウト生成の中核。本文左カラムと資料サムネ右カラムの設計、item ごとの赤/青補足行群の組版、画像実寸比を踏まえた右上基点の項目サムネ倍率反映、本文白まわりの可読性確保、halo の top padding 超過防止をここで守る。小項目見出しの `①` などの番号は、紙面に出る内容が 1 つでもある item にだけ表示し、完全に空の item では番号も出さない。
- `web-src/template-doc-registry.js`: `農作業傷害共済` 用テンプレ定義、binding キー、`payload.rows[]` の default/normalize、行単位必須チェック、タイトル自動生成規則の正本。
- `web-src/template-doc-pdf.js`: `templateDocumentPdfFileName()` と rows[] 対応の browser-side 補助 builder を持つ補助モジュール。`農作業傷害共済` の本線 preview / print / PDF 出力は Chromium 経路が正本で、ここは補助扱い。
- `web-src/app.css`: 編集UIとプレビューUIの見た目。項目サムネ倍率 slider のような非印刷UIの密度もここで保つ。紙面そのもののレイアウト原則は `notice-pdf.js` 側が主。
- `db/*.sql`: PostgreSQL マイグレーション。`issues` / `blocks` / `block_items` / `block_item_supplements` / `attachments` / `template_documents` に加え、`block_items.thumb_scale_percent`、添付原本の `attachment_original_contents`、サムネ cache の `attachment_thumbnail_caches`、legacy な `generated_files` を定義する。
- `20260319-templ-shogai-kyosai.svg`: `農作業傷害共済` の v1 正本 SVG。`inkscape:label="bind:..."` を意味、`id="bind-..."` を安定参照に使う。
- `bundled-assets/fonts/`: 紙面/PDF用にバイナリへ埋め込む固定フォントと license。`NotoSansJP-VF.ttf` は生成元で、配信用には `NotoSansJP-Regular.ttf` / `NotoSansJP-Bold.ttf` の static instance を使う。直接手編集は避け、差し替え時は license と version 方針も揃えること。
- `web-dist/`: フロントエンドのビルド成果物。runtime ではバイナリへ埋め込んで配信するが、直接手編集しないこと。
- `docs/exmple.png`: 紙面見本の唯一の正解。
- `WORK_TIMELINE.md`: 作業時系列メモの正本。

## 作業ルーティング

- 紙面・段組み・余白・文字組みを触る前に、必ず `docs/exmple.png` と `context/repo-map.md` を読むこと。
- 一覧画面の既存案内カード導線を触るときは、`web-src/main.js` の `renderIndex` と `src/main.rs` の `/api/issues`、`/api/issues/{id}`、`/api/issues/{id}/duplicate` をセットで確認すること。`published` の削除不可は UI と API の両方で守ること。
- `農作業傷害共済` を触るときは、`web-src/template-doc-registry.js` の template 定義、`src/main.rs` の `/api/template-documents` / `/api/template-documents/{id}/preview-images` / `/api/template-documents/{id}/print-pdf`、`/template-documents/{id}/print`、`db/007_template_documents.sql` をセットで確認すること。`issues` へ列を足して混ぜないこと。
- `農作業傷害共済` の preview 失敗を触るときは、まず `web-src/template-doc-registry.js` の required bindings と `rows[]` normalize、`src/main.rs` の default payload / 行検証、`web-src/main.js` の auto-save 後 preview 再取得、browser network の `PUT /api/template-documents/{id}` と `GET /api/template-documents/{id}/preview-images` を確認すること。未入力行が 1 行でも残ると、現仕様では一括 preview / PDF 全体を止める。
- 編集画面の操作性を触るときは、`web-src/main.js` の DOM 構造と `web-src/app.css` の gap/padding/min-height を一緒に見ること。片方だけ触ると、また間延びする。
- item 添付導線を触るときは、`web-src/main.js` のファイル選択・貼り付け・`Clipboardから追加` ボタンの 3 導線が同じ `POST /api/items/{id}/attachments` に収束している前提を崩さないこと。本文入力欄の通常貼り付けは横取りしないこと。
- item の補足行群（赤/青）・対象者・期限・項目サムネ倍率の紙面表示を触るときは、`web-src/main.js` の補足行 UI / `meta_layout` UI / サムネ倍率 slider、`web-src/notice-pdf.js` の補足行/メタ行/サムネ描画、`src/main.rs` と `db/*.sql` の `block_item_supplements` / `block_items.meta_layout` / `block_items.thumb_scale_percent` をセットで確認すること。
- 小項目の `①` などの表示を触るときは、`web-src/main.js` の item toolbar と `web-src/notice-pdf.js` の紙面見出しを両方確認し、空の item では番号を出さない挙動を揃えること。
- right-top のズレや preview が `/api/preview-renders` 到達前に固まる症状を触るときは、まず `web-src/notice-pdf.js` の `measureImageDataUrl()` と `pushTextSchema()` の top padding clamp を確認すること。
- 紙面/PDF 用フォントを触るときは、`bundled-assets/fonts/README.md`、`src/main.rs` の埋め込み配信、`web-src/notice-pdf.js` の `loadFonts()` をセットで確認すること。紙面側は Web フォント前提に戻さず、可変フォントをそのまま `pdfme` に渡さないこと。
- プレビュー不一致を触るときは、`常会案内` なら `web-src/main.js` と `src/main.rs` の `/api/preview-renders`、`農作業傷害共済` なら `web-src/main.js` と `src/main.rs` の `/api/template-documents/{id}/preview-images` / `/template-documents/{id}/print` をセットで確認すること。
- 最終PDFの出力不具合を触るときは、`常会案内` は `web-src/main.js` の `downloadNoticePdf` / `openPrintPageFromEditor` と `web-src/notice-pdf.js`、印刷 shell は `src/main.rs` の `/issues/{id}/print` を見ること。`農作業傷害共済` は `src/main.rs` の `/template-documents/{id}/print` と `/api/template-documents/{id}/print-pdf` の Chromium 経路を優先確認すること。`/api/issues/{id}/print-pdf` は廃止メッセージを返す互換導線。
- 編集画面の印刷導線を触るときは、`web-src/main.js` の `Ctrl+P` / `Cmd+P` ハンドラと `/issues/{id}/print` への遷移を確認すること。editor 自体を browser 既定印刷へ流さないのが前提。
- DB 変更時は `db/*.sql`、`src/main.rs` のシリアライズ/保存処理、`web-src/main.js` の normalize/payload 生成を一緒に揃えること。
- SVG テンプレ帳票の v1 は `payload.rows[]` の行編集が主 UI で、補助として JSON editor を残す前提。保存時は JSON 構文だけ見て、必須キー不足は preview / print / print-pdf で止める。保存時に bind 必須キーまで確定させようとして UI を重くしないこと。

## 既知コマンド

- `npm ci`: 初回 clone 後や `node_modules` 不在の作業ツリーでフロント依存を復元する。未実行だと `./watch-run-server.sh` 内の `npm run build` が `vite: not found` で停止する。
- `npm run build`: `web-src/` から `web-dist/` を再生成する。`web-dist` は実行中 Rust バイナリへ自動反映されないので、watch なし実行中の server では再起動か再ビルド済みバイナリへの切り替えが必要。
- `cargo fmt`: 変更後に実行が必要。
- `./run-server.sh`: watch なしで `npm run build` 後に `cargo run -- web ...` を一発起動する。
- `./db-init.sh` / `./db-migrate.sh` / `./db-status.sh` / `./db-reset.sh`: DB 操作用スクリプト。
- 旧 filesystem 添付を DB へ吸い上げるときだけ `JOKAI_LEGACY_STORAGE_DIR=/path/to/data ./db-migrate.sh` のように明示する。`web` 実行、`./run-server.sh`、`./watch-run-server.sh` は `storage-dir` に依存しない。
- `./watch-run-server.sh` / `./watch-all.sh`: 監視実行用スクリプト。
- ただし Codex は上の Rust ルールを優先し、手動で `cargo run` / `cargo check` / `cargo build` / `cargo clippy` を叩かないこと。

## Context Routing

- `context/repo-map.md`: repo 全体の責務分界、データモデル、プレビュー経路、最終PDF経路、紙面不変条件の正本。
- `bundled-assets/fonts/README.md`: 紙面/PDF 用に同梱する固定フォントと license の正本。フォント差し替え時はここ、`src/main.rs` の `CURRENT_FONT_VERSION`、`web-src/notice-pdf.js` を一緒に確認すること。
- `.agents/skills/jokai-pdfme-layout/SKILL.md`: `pdfme` 紙面、見本差分、プレビュー/最終PDF不一致、footer 帯、右サムネ列、`Ctrl+P` / `印刷画面` / `案内PDFを出力` の導線を触るときに使う。
- `20260319-templ-shogai-kyosai.svg`: `農作業傷害共済` の bind 正本。v1 は既に可視の `$...` 箇所だけが対象。
- まだ repo-local retrieval は有効化しない。`context/` や `docs/` が増えて検索価値が出た段階で `mcp-server/registry.json` と `.codex/config.toml` の MCP 配線を追加すること。
- React / TSX 用の project-specific skill はまだ作らない。現行フロントは素の JavaScript なので、スタックが入ってから追加判断すること。

## 保守チェック

- 新しい context doc を追加したら、この `AGENTS.md` の `Context Routing` に登録すること。
- 紙面構造を変えたら、見本 `docs/exmple.png` と差分理由を説明できる状態にすること。説明できない変更は雑音であり、原則として入れないこと。
- 編集画面は情報密度を落としすぎないこと。header/action/card/attachment viewer の余白で作業負荷を増やす変更は避けること。
- `pdftoppm` 依存を触るときはプレビュー系へ波及する前提で確認すること。headless Chrome / Chromium は `農作業傷害共済` の print / preview / print-pdf 本線なので、ここを触るときは `/template-documents/{id}/print` と server-side PDF helper まで確認すること。
- 生成物と原本の境界を曖昧にしないこと。添付資料原本を案内PDFに混ぜる変更は、この repo の設計原則に反する。
- `農作業傷害共済` の JSON editor は v1 の割り切り実装。専用フォームを足したくなっても、先に `template_documents` 系の責務分界を壊していないか確認すること。
- `農作業傷害共済` は 1 行 1 ページで印刷する rows[] 帳票に変わった。専用フォームや CSV 取込を足したくなっても、先に `payload.rows[]`・auto-save・Chromium 印刷の責務分界を壊していないか確認すること。
