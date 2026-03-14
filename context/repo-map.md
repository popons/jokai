<!-- v1 | last-verified: 2026-03-14 -->
# Jokai Repo Map

## Overview

| Item | Detail |
|---|---|
| Purpose | 生産組合長向けの常会案内を Web で編集し、見本紙面に沿った案内PDFを生成する |
| Maturity | Greenfield |
| Primary invariant | 紙面見た目厳守。`docs/exmple.png` を視覚上の正解とする |
| Editor chrome principle | 印刷プレビュー以外の UI は余白を絞り、header / action / form / attachment viewer を高密度に保つ |
| Core stack | Rust/Axum, PostgreSQL, Vite, plain JavaScript, `pdfme` |
| Runtime dependencies | `pdftoppm` はプレビュー画像生成、`google-chrome`/`chromium` は最終PDF生成に必要 |

## Directory Map

| Path | Role |
|---|---|
| `src/main.rs` | Axum サーバー、API、HTML 配信、添付保存、プレビュー画像化、最終PDF生成 |
| `web-src/main.js` | 編集画面の状態管理、CRUD 呼び出し、常時プレビュー、添付ビューア |
| `web-src/notice-pdf.js` | `pdfme` で A4 固定レイアウトを組み立てる紙面生成本体 |
| `web-src/app.css` | 編集画面/プレビュー画面の UI スタイル。非印刷UIの余白密度もここで制御する |
| `db/001_init.sql` | `issues` / `blocks` / `attachments` / `generated_files` 初期定義 |
| `db/002_block_items.sql` | `block_items` 導入と添付の item 単位紐付け移行 |
| `docs/exmple.png` | 見本紙面の正本 |
| `tests/version_flags.rs` | `--version` / `-V` の CLI テスト |
| `build.rs` | ビルド時刻を埋め込む |
| `web-dist/` | フロントエンドのビルド成果物。手編集禁止 |

## Runtime Flow

### 1. Editing Flow

`GET /issues/{id}/edit`  
-> `web-src/main.js` が issue / block / attachment を state に正規化  
-> 入力変更時に save payload を構築  
-> `PUT /api/issues/{id}` で保存

### 2. Preview Flow

`web-src/notice-pdf.js` の `buildNoticePdfDocument(issue, blocks)`  
-> ブラウザ内で notice PDF bytes を生成  
-> `POST /api/preview-renders` に PDF を multipart 送信  
-> `src/main.rs` が `pdftoppm` で PNG 群へ変換  
-> base64 data URL を `web-src/main.js` に返却  
-> 編集画面の常時プレビューへ表示

### 3. Final PDF Flow

`GET /issues/{id}/print`  
-> サーバーが印刷用 HTML を返す  
-> `src/main.rs` が headless Chrome/Chromium で `--print-to-pdf` 実行  
-> `generated_files` に保存記録  
-> `GET /api/issues/{id}/print-pdf` からダウンロード

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
| `blocks` | セクション単位 | `agenda` / `submission` / `distribution` / `info` / `freeform` |
| `block_items` | 各ブロック内の箇条項目 | `db/002_block_items.sql` で導入。旧 `blocks.body` 系からの移行先 |
| `attachments` | 添付原本とサムネ | `item_id` 単位で紐付け。紙面には thumbnail を使う |
| `generated_files` | 生成済みPDF | 現状 `pdf` のみ |

## Key Endpoints

| Endpoint | Responsibility |
|---|---|
| `GET /api/meta` | DB 接続情報の簡易メタ返却 |
| `GET/POST /api/issues` | issue 一覧と新規作成 |
| `GET/PUT /api/issues/{id}` | issue 詳細取得と保存 |
| `POST /api/items/{id}/attachments` | item 添付アップロード |
| `DELETE /api/attachments/{id}` | 添付削除 |
| `GET /api/attachments/{id}/content` | 添付原本 |
| `GET /api/attachments/{id}/thumbnail` | 添付サムネ |
| `POST /api/preview-renders` | PDF bytes を PNG 群へ変換 |
| `GET /api/issues/{id}/print-pdf` | 最終PDF取得 |

## Verification Notes

- `web-src/` を触ったら `npm run build` で `web-dist/` を更新する。
- 変更後は `cargo fmt` を実行する。
- `cargo check` / `cargo test` / `cargo clippy` はバックグラウンド監視へ委ね、保存後 1 秒待ってから `build-error.txt` / `test-error.txt` / `build-error-win.txt` / `clippy-error.txt` を読む。
- 紙面を変える前に `docs/exmple.png` を確認し、差分の理由を説明できない変更は入れない。
- 非印刷 editor UI のスクロールが多いときは、まず `masthead` / action-row / card 内 gap を詰める。A4 プレビュー本体を縮めてごまかさない。
- editor 操作列は近い操作を近接配置する。`space-between` で横一杯に散らすと、視線移動が増えて編集効率が落ちる。
