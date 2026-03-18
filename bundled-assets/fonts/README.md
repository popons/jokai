# Bundled Paper Fonts

- `NotoSansJP-VF.ttf`: 紙面フォントのソースにしている可変フォント。
- `NotoSansJP-Regular.ttf`: `NotoSansJP-VF.ttf` から `wght=400` で生成した本文用 static instance。
- `NotoSansJP-Bold.ttf`: `NotoSansJP-VF.ttf` から `wght=700` で生成した強調/タイトル用 static instance。
- `OFL.txt`: フォント license。

運用メモ:

- 紙面/PDF は公開後の再現性が必要なので、editor chrome と違って Web フォント取得に依存しない。
- `pdfme` へ可変フォントをそのまま渡すと Thin 側で埋め込まれて紙面が弱く見えるため、配信用には static instance を使う。
- 差し替える場合は、紙面見た目の差分確認と `CURRENT_FONT_VERSION` の更新をセットで行うこと。
