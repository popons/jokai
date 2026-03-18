<!-- v1 | last-verified: 2026-03-19 -->
# Jokai Repo Map

## Overview

| Item | Detail |
|---|---|
| Purpose | 生産組合長向けの常会案内を Web で編集し、見本紙面に沿った案内PDFを生成する |
| Maturity | Greenfield |
| Primary invariant | 紙面見た目厳守。`docs/exmple.png` を視覚上の正解とする |
| Editor chrome principle | 印刷プレビュー以外の UI は余白を絞り、header / action / form / attachment viewer を高密度に保つ |
| Core stack | Rust/Axum, PostgreSQL, Vite, plain JavaScript, `pdfme` |
| Runtime dependencies | `pdftoppm` はプレビュー画像生成と PDF 添付サムネ生成に必須。案内PDF本体は browser-side `pdfme` で生成し、frontend asset と紙面用フォントはバイナリへ埋め込んで配信する |

## Directory Map

| Path | Role |
|---|---|
| `src/main.rs` | Axum サーバー、埋め込み HTML/JS/CSS/紙面フォント配信、issue 一覧 CRUD、draft 限定削除、issue 深い複製、添付の DB 保存、内部 temp dir を使う `pdftoppm` preview / thumbnail 生成、印刷用 shell 配信。legacy filesystem 吸い上げは web 起動時ではなく DB コマンドの明示 `--legacy-storage-dir` 側に寄せた |
| `web-src/main.js` | 一覧画面と編集画面の状態管理、CRUD 呼び出し、一覧カード操作、常時プレビュー、添付ビューア、item 添付欄での Clipboard 画像登録 |
| `web-src/notice-pdf.js` | `pdfme` で A4 固定レイアウトを組み立てる紙面生成本体 |
| `web-src/app.css` | 編集画面/プレビュー画面の UI スタイル。非印刷UIの余白密度もここで制御する |
| `db/001_init.sql` | `issues` / `blocks` / `attachments` / `generated_files` 初期定義 |
| `db/002_block_items.sql` | `block_items` 導入と添付の item 単位紐付け移行 |
| `db/003_embedded_assets_and_attachment_blobs.sql` | 添付原本の DB blob 化、thumbnail cache、publish version 列、legacy path 列への改名 |
| `bundled-assets/fonts/` | 紙面/PDF 用にバイナリへ埋め込む固定フォントと license |
| `docs/exmple.png` | 見本紙面の正本 |
| `tests/version_flags.rs` | `--version` / `-V` の CLI テスト |
| `build.rs` | ビルド時刻と埋め込み asset 再読込トリガを設定する |
| `web-dist/` | フロントエンドのビルド成果物。手編集禁止。runtime ではバイナリ埋め込みで配信する |

## Runtime Flow

### 1. Index / List Actions

`GET /issues`
-> `web-src/main.js` が一覧カードを描画  
-> `POST /api/issues` で新規作成し、編集画面へ遷移  
-> `POST /api/issues/{id}/duplicate` で issue / block / item / attachment を深い複製し、新しい編集画面へ遷移  
-> `DELETE /api/issues/{id}` で draft 案内のみ削除する。`published` は UI 側でボタンを disabled にし、API 側でも拒否する

### 2. Editing Flow

`GET /issues/{id}/edit`  
-> `web-src/main.js` が issue / block / attachment を state に正規化  
-> 入力変更時に save payload を構築  
-> `PUT /api/issues/{id}` で保存し、`issues.source_version` を加算する

item 添付欄では、ファイル選択・貼り付け欄での `Ctrl+V` / `Cmd+V`・`Clipboardから追加` ボタンの 3 導線が存在する。Clipboard 画像も新規 API ではなく既存の `POST /api/items/{id}/attachments` へ `FormData(file)` として送る。

編集画面で `Ctrl+P` / `Cmd+P` が押された場合は browser 既定印刷を抑止し、未保存変更があれば保存成功を待ってから `/issues/{id}/print` へ遷移する。

### 3. Preview Flow

`web-src/notice-pdf.js` の `buildNoticePdfDocument(issue, blocks)`  
-> ブラウザ内で notice PDF bytes を生成  
-> `POST /api/preview-renders` に PDF を multipart 送信  
-> `src/main.rs` が `pdftoppm` で PNG 群へ変換  
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

## Layout Invariants

| Rule | Current implementation anchor |
|---|---|
| A4 縦固定 | `web-src/notice-pdf.js` の `A4_WIDTH_MM = 210`, `A4_HEIGHT_MM = 297` |
| 左本文・右資料サムネ | 本文は概ね `x=14` 起点、右サムネ列は `addItemRow` の `sideX = 146` を基点に構成 |
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
| `block_items` | 各ブロック内の箇条項目 | `db/002_block_items.sql` で導入。旧 `blocks.body` 系からの移行先 |
| `attachments` | 添付メタデータ | `item_id` 単位で紐付け。原本/サムネ本体ではなく filename・mime・legacy path・紙面補助メタを持つ |
| `attachment_original_contents` | 添付原本の正本 | `bytea` で原本 bytes を保持する。新規 upload はここが正本 |
| `attachment_thumbnail_caches` | 添付サムネ cache | 画像添付は原本流用、PDF 添付は `pdftoppm` で 1 ページ目 PNG を生成して cache する |
| `generated_files` | legacy server-side PDF bookkeeping | テーブルと挿入コードは残るが、現行 browser-side 出力経路では未更新 |

## Key Endpoints

| Endpoint | Responsibility |
|---|---|
| `GET /issues/{id}/print` | 印刷用 shell。編集画面の `印刷画面` 導線と `Ctrl+P` / `Cmd+P` が集約される |
| `GET /api/meta` | DB 接続情報と runtime temp dir の簡易メタ返却 |
| `GET/POST /api/issues` | issue 一覧と新規作成 |
| `GET/PUT/DELETE /api/issues/{id}` | issue 詳細取得、保存、draft 限定削除 |
| `POST /api/issues/{id}/duplicate` | issue / block / item / attachment を深い複製し、複製先の新しい issue id を返す |
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
- 変更後は `cargo fmt` を実行する。
- `cargo check` / `cargo test` / `cargo clippy` はバックグラウンド監視へ委ね、保存後 1 秒待ってから `build-error.txt` / `test-error.txt` / `build-error-win.txt` / `clippy-error.txt` を読む。
- 一覧カードの操作を触ったら、`draft` で `複製` / `削除` が出ること、`published` の `削除` が disabled のまま API でも拒否されることを確認する。
- item 添付導線を触ったら、ファイル選択、貼り付け欄での `Ctrl+V` / `Cmd+V`、`Clipboardから追加` ボタン、本文 textarea での通常テキスト貼り付け非干渉を確認する。
- 紙面を変える前に `docs/exmple.png` を確認し、差分の理由を説明できない変更は入れない。
- 最終PDFの不具合は `web-src/main.js` の `downloadNoticePdf()` / `openPrintPageFromEditor()`、`web-src/notice-pdf.js`、`src/main.rs` の `/issues/{id}/print` shell を優先確認する。`/api/issues/{id}/print-pdf` は本線ではない。
- 非印刷 editor UI のスクロールが多いときは、まず `masthead` / action-row / card 内 gap を詰める。A4 プレビュー本体を縮めてごまかさない。
- editor 操作列は近い操作を近接配置する。`space-between` で横一杯に散らすと、視線移動が増えて編集効率が落ちる。
