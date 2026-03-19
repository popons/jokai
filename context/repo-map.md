<!-- v1 | last-verified: 2026-03-19 -->
# Jokai Repo Map

## Overview

| Item | Detail |
|---|---|
| Purpose | 生産組合長向けの常会案内と、別文書ファミリーの SVG テンプレ帳票を Web で編集し PDF 生成する |
| Maturity | Greenfield |
| Primary invariant | 紙面見た目厳守。`docs/exmple.png` を視覚上の正解とする |
| Editor chrome principle | 印刷プレビュー以外の UI は余白を絞り、header / action / form / attachment viewer を高密度に保つ |
| Core stack | Rust/Axum, PostgreSQL, Vite, plain JavaScript, `pdfme` |
| Runtime dependencies | `pdftoppm` はプレビュー画像生成と PDF 添付サムネ生成に必須。案内PDF本体は browser-side `pdfme` で生成し、frontend asset と紙面用フォントはバイナリへ埋め込んで配信する。紙面フォントは `NotoSansJP-VF.ttf` を生成元にしつつ、配信用には static instance を使う |

## Directory Map

| Path | Role |
|---|---|
| `src/main.rs` | Axum サーバー、埋め込み HTML/JS/CSS/紙面フォント配信、`issues` 系 CRUD、`template_documents` 系 CRUD、draft 限定削除、issue 深い複製、添付の DB 保存、内部 temp dir を使う `pdftoppm` preview / thumbnail 生成、印刷用 shell 配信を担当。`農作業傷害共済` は `payload.rows[]` を single object 互換で正規化し、行数ベースの自動タイトルを返し、server-rendered `/template-documents/{id}/print` 正本 HTML、headless Chromium による `print-pdf` 生成、`preview-images` API もここで持つ。legacy filesystem 吸い上げは web 起動時ではなく DB コマンドの明示 `--legacy-storage-dir` 側に寄せた |
| `web-src/main.js` | 文書ファミリー切替付き一覧画面、常会案内 editor、SVG テンプレ帳票 editor の状態管理、CRUD 呼び出し、一覧カード操作、常時プレビュー、rows[] 台帳 UI、補助 JSON editor、item 添付欄での Clipboard 画像登録、item ごとの補足行群（赤/青）編集、`meta_layout` による対象者/期限の並び替え、`thumb_scale_percent` による項目単位サムネ倍率 slider を担当。常会案内 editor の小項目 toolbar は、heading/body/対象者/期限/補足行/添付のいずれかがあるときだけ `①` などの番号を表示する。`農作業傷害共済` editor では 1 行 1 ページ前提で `payload.rows[]` を編集し、行編集または valid JSON 入力時に auto-save 後、server-side `preview-images` を再取得する |
| `web-src/notice-pdf.js` | `pdfme` で A4 固定レイアウトを組み立てる紙面生成本体。item ごとの赤/青補足行群を本文直下へ入力順で縦積みし、`meta_layout` に応じて対象者/期限を同一行または縦積みで組版する。本文 `item.body`、補足行、対象者/期限メタ行は紙面上で一文字インデントする。小項目見出しの `①` などの番号は、紙面に出る内容が 1 つでもある item にだけ表示し、完全に空の item では番号も出さない。右脇サムネは `thumb_scale_percent` で項目ごとに 80〜200% を右上基点で拡縮し、`measureImageDataUrl()` で実画像アスペクト比を測って「見えている画像」自体の右上を固定する。画像自体は全テキストの背面へ置き、`pushTextSchema()` の halo は blank page の top padding を割らないよう clamp する。`loadFonts()` は static instance の body/body-bold/title を読み込み、Thin 側へ落ちないようにしている |
| `web-src/template-doc-registry.js` | `農作業傷害共済` の template 定義、binding キー、`payload.rows[]` の default/normalize、行単位必須チェック、タイトル自動生成規則の正本 |
| `web-src/template-doc-pdf.js` | `templateDocumentPdfFileName()` と rows[] 対応の browser-side 補助 builder を持つ補助モジュール。`農作業傷害共済` の本線 preview / print / PDF 出力は 2026-03-19 時点で Chromium 経路が正本 |
| `web-src/app.css` | 編集画面/プレビュー画面の UI スタイル。非印刷UIの余白密度もここで制御する |
| `db/001_init.sql` | `issues` / `blocks` / `attachments` / `generated_files` 初期定義 |
| `db/002_block_items.sql` | `block_items` 導入と添付の item 単位紐付け移行 |
| `db/003_embedded_assets_and_attachment_blobs.sql` | 添付原本の DB blob 化、thumbnail cache、publish version 列、legacy path 列への改名 |
| `db/007_template_documents.sql` | `template_documents` テーブル。`document_family` / `template_key` / `payload jsonb` / `template_asset_path` / `template_version` を保持する |
| `bundled-assets/fonts/` | 紙面/PDF 用にバイナリへ埋め込む固定フォントと license。`NotoSansJP-VF.ttf` を生成元にし、配信用の `NotoSansJP-Regular.ttf` / `NotoSansJP-Bold.ttf` を持つ |
| `20260319-templ-shogai-kyosai.svg` | `農作業傷害共済` v1 の SVG 正本。`inkscape:label="bind:..."` を意味、`id="bind-..."` を安定参照に使う |
| `docs/exmple.png` | 見本紙面の正本 |
| `tests/version_flags.rs` | `--version` / `-V` の CLI テスト |
| `build.rs` | ビルド時刻と埋め込み asset 再読込トリガを設定する |
| `web-dist/` | フロントエンドのビルド成果物。手編集禁止。runtime ではバイナリ埋め込みで配信するため、watch なしで起動中の server は build 後に再起動しない限り古い asset を配り続ける |

## Runtime Flow

### 1. Index / List Actions

`GET /` / `GET /issues` / `GET /template-documents`
-> `web-src/main.js` が文書ファミリー tabs を描画  
-> `常会案内` tab は `GET /api/issues` を表示  
-> `農作業傷害共済` tab は `GET /api/template-documents` を表示  
-> `POST /api/issues` で新規作成し、編集画面へ遷移  
-> `POST /api/issues/{id}/duplicate` で issue / block / item / attachment を深い複製し、新しい編集画面へ遷移  
-> `DELETE /api/issues/{id}` で draft 案内のみ削除する。`published` は UI 側でボタンを disabled にし、API 側でも拒否する

`農作業傷害共済` 側では `POST /api/template-documents` で新規作成し、`GET /template-documents/{id}/edit` へ遷移する。一覧カードは rows[] の入力済み件数を表示し、削除は `DELETE /api/template-documents/{id}`。

### 2. Editing Flow

`GET /issues/{id}/edit`  
-> `web-src/main.js` が issue / block / attachment を state に正規化  
-> item ごとの補足行群を `block_item_supplements` から読み込み、`meta_layout` は対象者/期限の並びだけを `same_line` / `stacked` として、`thumb_scale_percent` は右脇サムネ倍率として payload へ含めて保存する  
-> 入力変更時に save payload を構築  
-> `PUT /api/issues/{id}` で保存し、`issues.source_version` を加算する

item 添付欄では、ファイル選択・貼り付け欄での `Ctrl+V` / `Cmd+V`・`Clipboardから追加` ボタンの 3 導線が存在する。Clipboard 画像も新規 API ではなく既存の `POST /api/items/{id}/attachments` へ `FormData(file)` として送る。

編集画面で `Ctrl+P` / `Cmd+P` が押された場合は browser 既定印刷を抑止し、未保存変更があれば保存成功を待ってから `/issues/{id}/print` へ遷移する。

### 3. Preview Flow

`web-src/notice-pdf.js` の `buildNoticePdfDocument(issue, blocks)`  
-> ブラウザ内で notice PDF bytes を生成  
-> `POST /api/preview-renders` に PDF を multipart 送信  
-> `src/main.rs` が `pdftoppm` で高DPI PNG 群へ変換  
-> base64 data URL を `web-src/main.js` に返却  
-> 編集画面の常時プレビューへ表示

### 4. Final PDF / Print Flow

`GET /issues/{id}/print`  
-> サーバーが印刷用 shell HTML を返す  
-> 編集画面の印刷ショートカットと `印刷画面` 導線はここへ集約される  
-> `web-src/main.js` が issue / blocks を読み込み、編集画面と同じ `buildNoticePdfDocument(issue, blocks)` で PDF bytes を生成  
-> `POST /api/preview-renders` で PNG 群へ変換し、印刷画面へ表示  
-> ユーザーが `案内PDFを出力` を押すと、ブラウザがその場の bytes をダウンロードする  
-> `GET /api/issues/{id}/print-pdf` は互換メッセージのみで、現行の取得経路ではない

### 5. Template Document Flow

`GET /template-documents/{id}/edit`
-> `web-src/main.js` が `GET /api/template-documents/{id}` を読み込み、single object 互換を含めて `payload.rows[]` へ正規化する  
-> editor 主UIは 7 項目の行編集台帳で、1 行がそのまま 1 ページになる。JSON textarea は補助導線として残す  
-> 新規作成直後の default payload は blank row 1 件を持つので、editor 初回表示でも preview は要求されるが、不足中は warning を出して止まる  
-> 行編集または valid JSON 入力時は debounce 後に `PUT /api/template-documents/{id}` で auto-save し、その保存済み draft を使って `GET /api/template-documents/{id}/preview-images` を再取得する  
-> `preview-images` は server-side の headless Chromium で `/template-documents/{id}/print` を複数ページ PDF 化し、その PDF を `pdftoppm` で PNG 群へ変換して返す

`GET /template-documents/{id}/print`
-> サーバーが rows[] 各行を raw SVG へ token 置換した A4 正本 HTML を返し、1 行 1 ページで縦積みする  
-> 画面表示自体が Chrome の SVG renderer をそのまま見せる  
-> `帳票PDFを出力` ボタンは `GET /api/template-documents/{id}/print-pdf` を叩き、同じ `/template-documents/{id}/print` を headless Chromium で印刷した PDF をダウンロードする

## Layout Invariants

| Rule | Current implementation anchor |
|---|---|
| A4 縦固定 | `web-src/notice-pdf.js` の `A4_WIDTH_MM = 210`, `A4_HEIGHT_MM = 297` |
| 左本文・右資料サムネ | 本文は概ね `x=14` 起点、右サムネ列は `addItemRow` の `sideX = 146` を基点に構成 |
| item 本文・補足行・メタの表示 | 本文 `item.body`、補足行、対象者/期限メタ行は紙面上で一文字インデントする。補足行は `block_item_supplements` の入力順で本文直下に縦積みし、`block_items.meta_layout` は対象者/期限だけを `same_line` / `stacked` で制御する |
| 項目サムネ倍率 | `block_items.thumb_scale_percent` は 80〜200 の 5 刻み。right-top は schema box ではなく見えている画像自体の右上固定を意味し、本文位置は動かさない。縦方向の重なりは許容し、画像は常に全テキストの背面へ置く |
| 白ハロー境界 | テキスト halo の上方向オフセットは `BLANK_A4_PDF.padding[0]` を下回らないよう clamp し、pdfme の dynamic page 計算で page -1 を踏まない |
| プレビューと最終PDFの見た目を揃える | プレビューは同じ PDF bytes を rasterize して表示する |
| 編集 chrome は過度に広げない | `masthead` / `editor-actions` / `card` / `asset-stage` は作業負荷を増やさない密度を保つ |
| 最終ページ footer | 左下は issue ごとの任意赤字メッセージ、右下は固定必須の連絡先ブロック。footer 帯を予約して本文と衝突させない |
| 添付は紙面ではサムネのみ | `buildAttachmentAssets()` と `addItemRow()` が thumbnail ベースで表示 |
| 原本閲覧/ダウンロードは別導線 | `GET /api/attachments/{id}/content` と `GET /api/attachments/{id}/thumbnail` を分離 |
| 案内PDFに原本を結合しない | 最終PDFは print ページ由来の本体紙面のみを出力する |

## Data Model

| Table | Role | Notes |
|---|---|---|
| `issues` | 案内全体 | `issue_type`, `status`, `meeting_date`, `place`, `header_note`, 最終ページ左下用 `footer_note` などを保持 |
| `issues.source_version` / `published_*_version` | 再現用 version 刻印 | save ごとに `source_version` が増え、`published` 遷移時は source/layout/font/renderer の version を固定化する |
| `blocks` | セクション単位 | `agenda` / `submission` / `distribution` / `info` / `freeform` |
| `block_items` | 各ブロック内の箇条項目 | `db/002_block_items.sql` で導入。旧 `blocks.body` 系からの移行先。`meta_layout` は対象者/期限の紙面表示だけを `same_line` / `stacked` で保持し、`thumb_scale_percent` は項目単位の右脇サムネ倍率を保持する |
| `block_item_supplements` | item ごとの補足行 | `db/005_block_item_supplements.sql` で導入。赤/青の補足行を複数保持し、旧 `block_items.note` は初回 migration 時に先頭の赤補足へ吸い上げる |
| `attachments` | 添付メタデータ | `item_id` 単位で紐付け。原本/サムネ本体ではなく filename・mime・legacy path・紙面補助メタを持つ |
| `attachment_original_contents` | 添付原本の正本 | `bytea` で原本 bytes を保持する。新規 upload はここが正本 |
| `attachment_thumbnail_caches` | 添付サムネ cache | 画像添付は原本流用、PDF 添付は `pdftoppm` で 1 ページ目 PNG を生成して cache する |
| `generated_files` | legacy server-side PDF bookkeeping | テーブルと挿入コードは残るが、現行 browser-side 出力経路では未更新 |
| `template_documents` | SVG テンプレ帳票の下書き | `document_family` / `template_key` / `payload jsonb` / `template_asset_path` / `template_version` を保持し、`issues` 系とは分離する。`payload` の正本は rows[] で、旧 single object は互換吸収する |

### Template Draft Defaults

- `src/main.rs` の `default_template_document_payload()` は `join_renewal` の required 7 キーを全て空文字にした blank row を `rows[0]` として初期化する。
- `src/main.rs` / `web-src/template-doc-registry.js` は旧 single object payload を rows[] へ自動吸収する互換を持つ。調査時は保存実値が旧形式か rows[] かを確認する。
- 新規 `template_documents` は作成直後の時点では保存可能だが、未入力行が 1 行でも残ると preview / print / print-pdf は未成立で、editor は warning を出して止まる。
- タイトルは契約者名ベースではなく、PDF 出力日ベースの `YYYY-MM-DD / N件` 自動命名を使う。
- `農作業傷害共済` は 2026-03-19 時点で `drawSvg` を本線から外している。見た目差分調査では `preview-images` / `print-pdf` / `/template-documents/{id}/print` の Chromium 系経路を優先して確認する。

## Key Endpoints

| Endpoint | Responsibility |
|---|---|
| `GET /issues/{id}/print` | 印刷用 shell。編集画面の `印刷画面` 導線と `Ctrl+P` / `Cmd+P` が集約される |
| `GET /api/meta` | DB 接続情報と runtime temp dir の簡易メタ返却 |
| `GET/POST /api/issues` | issue 一覧と新規作成 |
| `GET/PUT/DELETE /api/issues/{id}` | issue 詳細取得、保存、draft 限定削除 |
| `POST /api/issues/{id}/duplicate` | issue / block / item / attachment を深い複製し、複製先の新しい issue id を返す |
| `GET/POST /api/template-documents` | SVG テンプレ帳票一覧と新規作成 |
| `GET/PUT/DELETE /api/template-documents/{id}` | SVG テンプレ帳票の詳細取得、保存、削除 |
| `GET /api/template-documents/{id}/preview-images` | 保存済み draft を headless Chromium で PDF 化し、`pdftoppm` で PNG preview 群へ変換する |
| `GET /api/template-documents/{id}/print-pdf` | 保存済み draft を headless Chromium で `/template-documents/{id}/print` から PDF 化して返す |
| `POST /api/items/{id}/attachments` | item 添付アップロード。ファイル選択と Clipboard 画像登録の両方がここへ集約される |
| `DELETE /api/attachments/{id}` | 添付削除 |
| `GET /api/attachments/{id}/content` | 添付原本 |
| `GET /api/attachments/{id}/thumbnail` | 添付サムネ |
| `POST /api/preview-renders` | PDF bytes を PNG 群へ変換 |
| `GET /api/issues/{id}/print-pdf` | deprecated な互換導線。利用者へ browser-side 出力へ移るよう案内する |

## Startup Notes

- `run_web()` は起動時に DB migration を適用し、preview / thumbnail 用の internal temp dir を確保する。`web` 実行は `--storage-dir` に依存しない。
- legacy filesystem 添付の吸い上げは `db init` / `db migrate` に `--legacy-storage-dir` を明示したときだけ実行する。
- filesystem 上の `data/issues/...` は互換吸い上げ元であり、長期的な正本ではない。新規 upload の正本は DB blob 側。

## Verification Notes

- 初回 clone 後や WSL 側へ作業ツリーを持ち直した直後など `node_modules` が無い状態では、先に `npm ci` を実行する。未セットアップのまま `./watch-run-server.sh` を動かすと内部の `npm run build` が `vite: not found` で落ちる。
- `web-src/` を触ったら `npm run build` で `web-dist/` を更新する。配信は埋め込みだが、埋め込み元はこの build 成果物。
- `web-src/` を触って `npm run build` だけ済ませても、watch なしで動いている既存 server は古い `web-dist` を埋め込んだままの可能性がある。画面が変わらないときは browser cache だけでなく server 側の再起動有無も確認する。
- 変更後は `cargo fmt` を実行する。
- watch なしでローカル確認だけ回したいときは `./run-server.sh` を使う。これは `npm run build` 後に `cargo run -- web ...` を一発起動する補助スクリプト。
- `cargo check` / `cargo test` / `cargo clippy` はバックグラウンド監視へ委ね、保存後 1 秒待ってから `build-error.txt` / `test-error.txt` / `build-error-win.txt` / `clippy-error.txt` を読む。
- `農作業傷害共済` を触ったら、family tabs で `常会案内` と `農作業傷害共済` を切り替えられること、`/api/template-documents` の CRUD、auto-save 後の `/api/template-documents/{id}/preview-images`、正本 `/template-documents/{id}/print`、`/api/template-documents/{id}/print-pdf` が通ることを確認する。
- `農作業傷害共済` の preview が更新されないときは、まず browser network で `PUT /api/template-documents/{id}` と `GET /api/template-documents/{id}/preview-images` が順に発火しているか、未入力行で止まっていないかを見る。
- `農作業傷害共済` の print / PDF が崩れるときは、`drawSvg` ではなく rows[] を raw SVG へ展開する `/template-documents/{id}/print` と `src/main.rs` の headless Chromium 経路を優先確認する。
- `農作業傷害共済` の一覧カードを触ったら、入力済み件数が `row_count` と一致すること、編集画面と印刷画面が同じ件数・同じページ数になることを確認する。
- 一覧カードの操作を触ったら、`draft` で `複製` / `削除` が出ること、`published` の `削除` が disabled のまま API でも拒否されることを確認する。
- item 添付導線を触ったら、ファイル選択、貼り付け欄での `Ctrl+V` / `Cmd+V`、`Clipboardから追加` ボタン、本文 textarea での通常テキスト貼り付け非干渉を確認する。
- 小項目番号表示を触ったら、空の item では editor toolbar も紙面見出しも `①` を出さず、heading/body/対象者/期限/補足行/添付のどれかが入った時点で番号が出ることを確認する。
- 紙面を変える前に `docs/exmple.png` を確認し、差分の理由を説明できない変更は入れない。
- 最終PDFの不具合は `web-src/main.js` の `downloadNoticePdf()` / `openPrintPageFromEditor()`、`web-src/notice-pdf.js`、`src/main.rs` の `/issues/{id}/print` shell を優先確認する。`/api/issues/{id}/print-pdf` は本線ではない。
- 非印刷 editor UI のスクロールが多いときは、まず `masthead` / action-row / card 内 gap を詰める。A4 プレビュー本体を縮めてごまかさない。
- editor 操作列は近い操作を近接配置する。`space-between` で横一杯に散らすと、視線移動が増えて編集効率が落ちる。
