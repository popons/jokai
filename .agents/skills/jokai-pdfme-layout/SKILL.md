---
name: jokai-pdfme-layout
description: Use when changing or debugging Jokai's `pdfme`-based notice layout, preview mismatch, browser-side PDF output, footer band, or right-side attachment thumbnail rail.
---

# Jokai PDFME Layout

## When To Use

- `web-src/notice-pdf.js` の段組み、余白、文字組み、ページ送り、footer 帯を触るとき
- `docs/exmple.png` と紙面がズレているとき
- 編集画面プレビューとダウンロードされる案内PDFの見た目がズレるとき
- `Ctrl+P` / `Cmd+P`、`印刷画面`、`案内PDFを出力` の導線を触るとき
- 右脇サムネ列、添付 thumbnail、対象者ラベルの表示を触るとき

## What It Produces

- 紙面変更または不具合修正
- 紙面/プレビュー/PDF 経路の診断メモ
- 必要なら `AGENTS.md` / `context/repo-map.md` の保守更新

## Minimal Questions

不明なときだけ、次の順で最小限に聞く。

1. 変えたい対象は紙面本体か、editor chrome か、その両方か。
2. 正解は `docs/exmple.png` 準拠か、意図的な差分か。

## Workflow

1. 最初に `docs/exmple.png`、`context/repo-map.md`、`web-src/notice-pdf.js` を読む。
2. プレビューや出力導線の問題なら、`web-src/main.js` の `generatePreview()` / `downloadNoticePdf()` / `openPrintPageFromEditor()` と、`src/main.rs` の `/api/preview-renders` / `/issues/{id}/print` を続けて確認する。
3. 紙面本体の変更と editor chrome の変更を分離して考える。chrome 側なら `web-src/app.css` と `web-src/main.js` の DOM 構造をセットで見る。
4. 次の不変条件を守る:
   - A4 縦固定
   - 左が本文、右が資料サムネ
   - 添付原本は紙面に結合しない
   - 最終ページ footer は左下が任意赤字、右下が必須連絡先
   - プレビューとダウンロードPDFは同じ `buildNoticePdfDocument()` の bytes を使う
5. 変更後は `web-src/` を触ったら `npm run build`、その後 `cargo fmt` を実行する。
6. 保存後は 1 秒待って `build-error.txt` / `test-error.txt` / `build-error-win.txt` / `clippy-error.txt` を確認する。

## Project-Specific Gotchas

- `src/main.rs` の headless Chrome / `generated_files` 経路は legacy。現行の案内PDF出力本線として扱わない。
- `pdftoppm` は PDF bytes を PNG に rasterize しているだけで、案内PDF自体を生成していない。
- editor の余白問題を `notice-pdf.js` 側でごまかさない。非印刷UIの密度は `web-src/app.css` 側で詰める。
- item 本文の `**...**` は本文欄だけの赤太字 inline 強調。raw text はそのまま保存し、`notice-pdf.js` で複数 text schema に分けて描画する。Markdown 全般、補足行、メタ、footer へ広げない。
- 添付や item のデータ形状を変えるなら、`db/*.sql` / `src/main.rs` / `web-src/main.js` を同時に揃える。
- `web-dist/` は build 成果物なので手編集しない。

## Definition Of Done

- 紙面変更が `docs/exmple.png` または明示された差分意図で説明できる。
- 編集画面プレビューとダウンロードPDFの整合が崩れていない。
- 導線や責務分界が変わったなら、`AGENTS.md` か `context/repo-map.md` が追従している。
