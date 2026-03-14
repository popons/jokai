import "./app.css";
import { buildNoticePdfDocument, pdfFileName } from "./notice-pdf.js";

const app = document.querySelector("#app");

const boot = {
  view: app?.dataset.view || "index",
  issueId: app?.dataset.issueId || "",
  printMode: app?.dataset.printMode === "1",
};

const issueTypeLabels = {
  normal: "通常案内",
  correction: "訂正案内",
  no_meeting: "常会なし",
  one_off: "単発案内",
};

const blockKindLabels = {
  agenda: "議題",
  submission: "提出物",
  distribution: "配布物",
  info: "案内事項",
  freeform: "自由記述",
};

const state = {
  meta: null,
  issues: [],
  issue: null,
  blocks: [],
  selectedAttachmentId: "",
  loading: true,
  saving: false,
  dirty: false,
  notice: "",
  error: "",
  previewBytes: null,
  previewImages: [],
  previewPending: false,
  previewReadyAt: "",
  previewGeneration: 0,
  previewTimer: 0,
};

const itemIndexLabels = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function issueTypeOptions(selected) {
  return Object.entries(issueTypeLabels)
    .map(
      ([value, label]) =>
        `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`,
    )
    .join("");
}

function blockKindOptions(selected) {
  return Object.entries(blockKindLabels)
    .map(
      ([value, label]) =>
        `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`,
    )
    .join("");
}

function normalizeIssue(issue) {
  return {
    id: issue.id,
    issue_type: issue.issue_type || "normal",
    status: issue.status || "draft",
    title: issue.title || "",
    issue_month: issue.issue_month ? issue.issue_month.slice(0, 7) : "",
    meeting_date: issue.meeting_date || "",
    meeting_time: issue.meeting_time || "",
    place: issue.place || "",
    header_note: issue.header_note || "",
    footer_note: issue.footer_note || "",
    published_at: issue.published_at || "",
  };
}

function normalizeAttachment(attachment = {}) {
  return {
    id: attachment.id || "",
    original_filename: attachment.original_filename || "",
    mime_type: attachment.mime_type || "",
    display_kind: attachment.display_kind || "other",
    thumbnail_url: attachment.thumbnail_url || "",
    content_url: attachment.content_url || "",
  };
}

function normalizeItem(item = {}) {
  return {
    id: item.id || "",
    heading: item.heading || "",
    body: item.body || "",
    audience_label: item.audience_label || "",
    due_date: item.due_date || "",
    note: item.note || "",
    sort_order: item.sort_order || 0,
    attachments: Array.isArray(item.attachments) ? item.attachments.map(normalizeAttachment) : [],
  };
}

function normalizeBlock(block = {}) {
  return {
    id: block.id || "",
    block_kind: block.block_kind || "freeform",
    heading: block.heading || "",
    sort_order: block.sort_order || 0,
    items: Array.isArray(block.items) ? block.items.map(normalizeItem) : [],
  };
}

function initialBlock(blockKind = "freeform") {
  return normalizeBlock({
    block_kind: blockKind,
    heading: "",
    items: [initialItem()],
  });
}

function initialItem() {
  return normalizeItem({
    heading: "",
    body: "",
    audience_label: "",
    due_date: "",
    note: "",
    attachments: [],
  });
}

function monthLabel(value) {
  if (!value) {
    return "未設定";
  }
  const [year, month] = String(value).slice(0, 7).split("-");
  if (!year || !month) {
    return String(value);
  }
  return `${year}年${Number(month)}月`;
}

function dateLabel(value) {
  if (!value) {
    return "未設定";
  }
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) {
    return String(value);
  }
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function issueSummaryLine(issue) {
  if (!issue.meeting_date && !issue.meeting_time) {
    return "日時 未設定";
  }
  const date = issue.meeting_date ? dateLabel(issue.meeting_date) : "日付未設定";
  const time = issue.meeting_time ? ` / ${issue.meeting_time}` : "";
  return `${date}${time}`;
}

function payloadFromState() {
  return {
    issue_type: state.issue.issue_type,
    title: state.issue.title.trim(),
    issue_month: state.issue.issue_month ? `${state.issue.issue_month}-01` : "",
    meeting_date: state.issue.meeting_date,
    meeting_time: state.issue.meeting_time,
    place: state.issue.place.trim(),
    header_note: state.issue.header_note,
    footer_note: state.issue.footer_note,
    blocks: state.blocks.map((block) => ({
      id: block.id || "",
      block_kind: block.block_kind,
      heading: block.heading,
      items: block.items.map((item) => ({
        id: item.id || "",
        heading: item.heading,
        body: item.body,
        audience_label: item.audience_label,
        due_date: item.due_date,
        note: item.note,
      })),
    })),
  };
}

function allAttachments() {
  return state.blocks.flatMap((block) =>
    (block.items || []).flatMap((item) => item.attachments || []),
  );
}

function ensureSelectedAttachment() {
  const attachments = allAttachments();
  if (!attachments.length) {
    state.selectedAttachmentId = "";
    return;
  }
  const exists = attachments.some((attachment) => attachment.id === state.selectedAttachmentId);
  if (!exists) {
    state.selectedAttachmentId = attachments[0].id;
  }
}

function selectedAttachment() {
  return allAttachments().find((attachment) => attachment.id === state.selectedAttachmentId) || null;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await fetch(path, {
    ...options,
    headers,
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function renderLoading(title, copy) {
  app.innerHTML = `
    <main class="shell shell--center">
      <section class="loading-shell">
        <div class="loading-mark"></div>
        <div>
          <h1 class="page-title">${escapeHtml(title)}</h1>
          <p class="page-lead">${escapeHtml(copy)}</p>
        </div>
      </section>
    </main>
  `;
}

function renderAttachmentViewerHtml() {
  ensureSelectedAttachment();
  const attachment = selectedAttachment();
  if (!attachment) {
    return `<div class="empty-state">まだ資料はありません。保存済みの block に PDF や画像を追加すると、ここで原本を確認できます。</div>`;
  }

  if (attachment.display_kind === "pdf") {
    return `
      <div class="preview-heading">
        <strong>資料ビューア</strong>
        <span class="badge badge--accent">PDF 原本</span>
      </div>
      <div class="asset-stage">
        <iframe class="asset-frame" src="${escapeHtml(attachment.content_url)}#view=FitH" title="${escapeHtml(attachment.original_filename)}"></iframe>
      </div>
      <div class="asset-caption">${escapeHtml(attachment.original_filename)}</div>
    `;
  }

  if (attachment.display_kind === "image") {
    return `
      <div class="preview-heading">
        <strong>資料ビューア</strong>
        <span class="badge badge--accent">画像原本</span>
      </div>
      <div class="asset-stage asset-stage--image">
        <img class="asset-image" src="${escapeHtml(attachment.content_url)}" alt="${escapeHtml(attachment.original_filename)}">
      </div>
      <div class="asset-caption">${escapeHtml(attachment.original_filename)}</div>
    `;
  }

  return `
    <div class="preview-heading">
      <strong>資料ビューア</strong>
      <span class="badge badge--draft">原本</span>
    </div>
    <div class="empty-state">
      <p>${escapeHtml(attachment.original_filename)}</p>
      <p><a class="inline-link" href="${escapeHtml(attachment.content_url)}" target="_blank" rel="noreferrer">原本を開く</a></p>
    </div>
  `;
}

function itemMarker(index) {
  return itemIndexLabels[index] || `${index + 1}.`;
}

function renderAttachmentList(item, blockIndex, itemIndex) {
  const attachments = item.attachments || [];
  const items = attachments.length
    ? attachments
        .map(
          (attachment) => `
            <li class="attachment-item ${attachment.id === state.selectedAttachmentId ? "is-selected" : ""}">
              <button class="attachment-preview-button" type="button" data-preview-attachment="${attachment.id}">
                <span>${escapeHtml(attachment.original_filename)}</span>
                <small>${escapeHtml(attachment.display_kind.toUpperCase())}</small>
              </button>
              <button class="ghost-button ghost-button--danger" type="button" data-delete-attachment="${attachment.id}">削除</button>
            </li>
          `,
        )
        .join("")
    : `<li class="attachment-empty">資料なし</li>`;

  return `
    <div class="attachment-block">
      <label class="upload-dropzone">
        <input data-upload-item="${blockIndex}:${itemIndex}" type="file" accept="application/pdf,image/*" ${item.id ? "" : "disabled"}>
        <span>${item.id ? "PDF / 画像を追加" : "保存後に資料追加できます"}</span>
      </label>
      <ul class="attachment-list">${items}</ul>
    </div>
  `;
}

function renderItemCard(block, blockIndex, item, itemIndex) {
  return `
    <section class="item-card">
      <div class="item-toolbar">
        <span class="item-index">${itemMarker(itemIndex)} 項目</span>
        <div class="block-toolbar-actions">
          <button class="ghost-button" type="button" data-move-item="${blockIndex}:${itemIndex}" data-direction="up" ${itemIndex === 0 ? "disabled" : ""}>上へ</button>
          <button class="ghost-button" type="button" data-move-item="${blockIndex}:${itemIndex}" data-direction="down" ${itemIndex === block.items.length - 1 ? "disabled" : ""}>下へ</button>
          <button class="ghost-button ghost-button--danger" type="button" data-remove-item="${blockIndex}:${itemIndex}">削除</button>
        </div>
      </div>
      <div class="form-grid form-grid--block">
        <div class="field field--wide">
          <label>項目見出し</label>
          <input data-item-field="heading" data-block-index="${blockIndex}" data-item-index="${itemIndex}" value="${escapeHtml(item.heading)}" placeholder="例: 令和7年産 水稲〜">
        </div>
        <div class="field field--wide">
          <label>本文</label>
          <textarea data-item-field="body" data-block-index="${blockIndex}" data-item-index="${itemIndex}" placeholder="記入方法や説明を書きます。">${escapeHtml(item.body)}</textarea>
        </div>
        <div class="field">
          <label>対象者</label>
          <input data-item-field="audience_label" data-block-index="${blockIndex}" data-item-index="${itemIndex}" value="${escapeHtml(item.audience_label)}" placeholder="全員 / 一部 / 希望者">
        </div>
        <div class="field">
          <label>期限</label>
          <input data-item-field="due_date" data-block-index="${blockIndex}" data-item-index="${itemIndex}" type="date" value="${escapeHtml(item.due_date)}">
        </div>
        <div class="field field--wide">
          <label>赤字補足</label>
          <textarea data-item-field="note" data-block-index="${blockIndex}" data-item-index="${itemIndex}" placeholder="裏面記入例にならい〜 など">${escapeHtml(item.note)}</textarea>
        </div>
      </div>
      <div class="field">
        <label>資料</label>
        ${renderAttachmentList(item, blockIndex, itemIndex)}
      </div>
    </section>
  `;
}

function renderNoticePreviewMarkup() {
  const previewStatus = state.previewPending
    ? "PDF を組版中…"
    : state.previewReadyAt
      ? `更新済み ${escapeHtml(state.previewReadyAt)}`
      : "保存前でも右で案内PDFを確認できます";

  return `
    <div class="preview-heading">
      <strong>印刷プレビュー</strong>
      <span class="badge badge--accent">A4固定</span>
    </div>
    <div class="pdf-stage">
      <div id="notice-preview-pages" class="pdf-preview-pages" aria-label="常会案内 PDF プレビュー">${renderPreviewPagesMarkup()}</div>
      <div class="pdf-stage-placeholder ${state.previewImages.length ? "is-hidden" : ""}" id="notice-preview-placeholder">
        <p>ここに生成済みの案内PDFが表示されます。</p>
      </div>
      <div class="pdf-stage-overlay ${state.previewPending ? "is-visible" : ""}" id="notice-preview-overlay">PDF を生成しています…</div>
    </div>
    <div class="preview-footer">
      <span class="preview-status" id="notice-preview-status">${previewStatus}</span>
      <div class="preview-actions">
        <button class="ghost-button" type="button" id="refresh-preview-button">再生成</button>
        <button class="primary-button" type="button" id="download-notice-pdf-button">案内PDFを出力</button>
      </div>
    </div>
  `;
}

function renderPreviewPagesMarkup() {
  if (!state.previewImages.length) {
    return "";
  }
  return state.previewImages
    .map(
      (src, index) => `
        <div class="pdf-preview-page">
          <img class="pdf-preview-image" src="${src}" alt="常会案内プレビュー ${index + 1}ページ目">
        </div>
      `,
    )
    .join("");
}

function renderIndex() {
  const issueCards = state.issues.length
    ? state.issues
        .map(
          (issue) => `
            <article class="issue-card">
              <div class="issue-card-head">
                <div>
                  <h2 class="issue-card-title">${escapeHtml(issue.title)}</h2>
                  <div class="issue-card-meta">
                    <span class="badge badge--accent">${escapeHtml(issueTypeLabels[issue.issue_type] || issue.issue_type)}</span>
                    <span class="badge badge--draft">${escapeHtml(issue.status)}</span>
                  </div>
                </div>
                <span class="issue-card-stat">${escapeHtml(monthLabel(issue.issue_month ? issue.issue_month.slice(0, 7) : ""))}</span>
              </div>
              <p class="issue-card-copy">場所: ${escapeHtml(issue.place || "未設定")} / ブロック数: ${issue.block_count}</p>
              <div class="issue-card-footer">
                <span class="issue-card-stat">${issue.published_at ? `公開: ${escapeHtml(issue.published_at)}` : "公開前の下書き"}</span>
                <a class="issue-link" href="/issues/${escapeHtml(issue.id)}/edit">編集へ</a>
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">まだ案内はありません。左の作成ボタンから最初の号を起こしてください。</div>`;

  app.innerHTML = `
    <main class="shell">
      <header class="masthead">
        <div class="brand-block">
          <span class="eyebrow">JOKAI COMPOSER</span>
          <h1 class="page-title">常会案内を作成する</h1>
          <p class="page-lead">固定テンプレの案内PDFを右側の正本プレビューで確かめながら、本文と資料サムネを整えます。</p>
        </div>
        <aside class="status-panel">
          <div class="status-grid">
            <div class="status-kv">
              <span class="status-label">Database</span>
              <span class="status-value">${escapeHtml(state.meta?.database_url || "読込中")}</span>
            </div>
            <div class="status-kv">
              <span class="status-label">Storage</span>
              <span class="status-value">${escapeHtml(state.meta?.storage_dir || "読込中")}</span>
            </div>
            <div class="status-kv">
              <span class="status-label">Migrations</span>
              <span class="status-value">${escapeHtml((state.meta?.applied_migrations || []).join(", ") || "なし")}</span>
            </div>
          </div>
        </aside>
      </header>

      <section class="workspace index-layout">
        <div class="panel">
          <div class="panel-inner">
            <h2 class="section-title">新しい号を起こす</h2>
            <p class="section-copy">まず型を選び、本文 block と資料サムネを積み上げます。</p>
            <div class="create-grid">
              <button class="create-button" data-create-issue="normal">
                <strong>通常案内</strong>
                <span>開催日時・場所・議題・提出物を持つ、いつもの常会案内。</span>
              </button>
              <button class="create-button" data-create-issue="correction">
                <strong>訂正案内</strong>
                <span>時間や記載内容の誤りを差し替える訂正版を起こします。</span>
              </button>
              <button class="create-button" data-create-issue="no_meeting">
                <strong>常会なし</strong>
                <span>今月は開催しないが、提出物や周知だけは出したいとき用です。</span>
              </button>
              <button class="create-button" data-create-issue="one_off">
                <strong>単発案内</strong>
                <span>井手堰や座談会のような別件の案内を個別に組み立てます。</span>
              </button>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-inner">
            <h2 class="section-title">既存の案内</h2>
            <p class="section-copy">草稿の一覧です。編集から資料アップロード、案内PDF出力まで進められます。</p>
            ${state.error ? `<div class="flash flash--error">${escapeHtml(state.error)}</div>` : ""}
            ${state.notice ? `<div class="flash flash--info">${escapeHtml(state.notice)}</div>` : ""}
            <div class="list-grid">${issueCards}</div>
          </div>
        </div>
      </section>
    </main>
  `;

  app.querySelectorAll("[data-create-issue]").forEach((button) => {
    button.addEventListener("click", async () => {
      const issueType = button.getAttribute("data-create-issue");
      await createIssue(issueType);
    });
  });
}

function renderEditor() {
  if (!state.issue) {
    renderLoading("編集画面を準備中です", "対象の号を取得しています。");
    return;
  }

  const issue = state.issue;
  const blockMarkup = state.blocks.length
    ? state.blocks
        .map(
          (block, index) => `
            <section class="block-card">
              <div class="block-toolbar">
                <span class="block-index">${index + 1}. ${escapeHtml(block.heading || blockKindLabels[block.block_kind] || "大項目")}</span>
                <div class="block-toolbar-actions">
                  <button class="ghost-button" type="button" data-move-block="${index}" data-direction="up" ${index === 0 ? "disabled" : ""}>上へ</button>
                  <button class="ghost-button" type="button" data-move-block="${index}" data-direction="down" ${index === state.blocks.length - 1 ? "disabled" : ""}>下へ</button>
                  <button class="ghost-button ghost-button--danger" type="button" data-remove-block="${index}">削除</button>
                </div>
              </div>
              <div class="form-grid form-grid--block">
                <div class="field">
                  <label>SECTION KIND</label>
                  <select data-block-field="block_kind" data-block-index="${index}">
                    ${blockKindOptions(block.block_kind)}
                  </select>
                </div>
                <div class="field field--wide">
                  <label>大項目見出し</label>
                  <input data-block-field="heading" data-block-index="${index}" value="${escapeHtml(block.heading)}" placeholder="例: 9月度提出物 / 配布物">
                </div>
              </div>
              <div class="block-items">
                <div class="item-list-header">
                  <strong>小項目</strong>
                  <button class="ghost-button" type="button" data-add-item="${index}">項目を追加</button>
                </div>
                <div class="item-stack">
                  ${
                    block.items.length
                      ? block.items.map((item, itemIndex) => renderItemCard(block, index, item, itemIndex)).join("")
                      : '<div class="empty-state">まだ小項目がありません。項目を追加してください。</div>'
                  }
                </div>
              </div>
            </section>
          `,
        )
        .join("")
    : `<div class="empty-state">まだ本文 section がありません。提出物や配布物の大項目を追加してください。</div>`;

  app.innerHTML = `
    <main class="shell shell--wide shell--editor">
      <header class="masthead masthead--editor">
        <div class="brand-block">
          <span class="eyebrow">JOKAI EDITOR</span>
          <h1 class="page-title">常会案内を編集する</h1>
          <p class="page-lead">右側の A4 正本プレビューは、実際に生成した案内PDFそのものです。</p>
        </div>
        <aside class="status-panel status-panel--editor">
          <div class="status-grid status-grid--editor">
            <div class="status-kv">
              <span class="status-label">Issue</span>
              <span class="status-value">${escapeHtml(issue.id)}</span>
            </div>
            <div class="status-kv">
              <span class="status-label">State</span>
              <span class="status-value" id="save-state-text">${state.saving ? "保存中…" : state.dirty ? "未保存の変更あり" : "保存済み"}</span>
            </div>
            <div class="status-kv">
              <span class="status-label">DB</span>
              <span class="status-value">${escapeHtml(state.meta?.database_url || "読込中")}</span>
            </div>
          </div>
        </aside>
      </header>

      <div class="editor-actions">
        <div class="editor-actions-group">
          <a class="ghost-link" href="/issues">一覧へ戻る</a>
          <span class="badge badge--accent">${escapeHtml(issueTypeLabels[issue.issue_type] || issue.issue_type)}</span>
          <span class="badge badge--draft">${escapeHtml(issue.status)}</span>
        </div>
        <div class="editor-actions-group editor-actions-group--primary">
          <a class="ghost-link" href="/issues/${escapeHtml(issue.id)}/print" target="_blank" rel="noreferrer">印刷画面</a>
          <button class="ghost-button" type="button" id="reload-issue-button">再読込</button>
          <button class="primary-button" type="button" id="save-issue-button">保存する</button>
        </div>
      </div>

      ${state.error ? `<div class="flash flash--error">${escapeHtml(state.error)}</div>` : ""}
      ${state.notice ? `<div class="flash flash--info">${escapeHtml(state.notice)}</div>` : ""}

      <section class="workspace editor-layout">
        <div class="editor-column">
          <section class="card">
            <h2 class="card-title">号の骨格</h2>
            <p class="card-copy">タイトル、日時、場所、注記。ここが紙面の印象を決めます。</p>
            <div class="form-grid">
              <div class="issue-meta-row">
                <div class="field">
                  <label>ISSUE TYPE</label>
                  <select data-issue-field="issue_type">${issueTypeOptions(issue.issue_type)}</select>
                </div>
                <div class="field">
                  <label>対象月</label>
                  <input data-issue-field="issue_month" type="month" value="${escapeHtml(issue.issue_month)}">
                </div>
                <div class="field">
                  <label>開催日</label>
                  <input data-issue-field="meeting_date" type="date" value="${escapeHtml(issue.meeting_date)}">
                </div>
                <div class="field">
                  <label>開始時刻</label>
                  <input data-issue-field="meeting_time" type="time" value="${escapeHtml(issue.meeting_time)}">
                </div>
              </div>
              <div class="field field--wide">
                <label>タイトル</label>
                <input data-issue-field="title" value="${escapeHtml(issue.title)}" placeholder="例: 平古場生産組合 常会の案内">
              </div>
              <div class="field field--wide">
                <label>場所</label>
                <input data-issue-field="place" value="${escapeHtml(issue.place)}" placeholder="例: 平古場自治公民館">
              </div>
              <div class="field field--wide">
                <label>上部注記</label>
                <textarea data-issue-field="header_note" placeholder="田祈祷、忘年会、開始時刻の訂正など">${escapeHtml(issue.header_note)}</textarea>
              </div>
              <div class="field field--wide">
                <label>最終ページ左下メモ</label>
                <textarea data-issue-field="footer_note" placeholder="★提出書類は、常会当日か10月25日(土)までに、組合長に提出して下さい">${escapeHtml(issue.footer_note)}</textarea>
                <p class="field-hint">最終ページだけに表示されます。右下の連絡先「平古場生産組合 / 組合長 古川 豊 / ☎090-7581-7819」は毎回自動で入ります。</p>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">本文セクション</h2>
                <p class="card-copy">大項目の下に複数の小項目を持たせ、各小項目ごとに右脇サムネを付けます。</p>
              </div>
              <div class="add-row">
                <button class="ghost-button" type="button" data-add-block="agenda">議題</button>
                <button class="ghost-button" type="button" data-add-block="submission">提出物</button>
                <button class="ghost-button" type="button" data-add-block="distribution">配布物</button>
                <button class="ghost-button" type="button" data-add-block="info">案内事項</button>
              </div>
            </div>
            <div class="block-stack">${blockMarkup}</div>
          </section>
        </div>

        <aside class="preview-column">
          <section class="preview-panel">
            ${renderNoticePreviewMarkup()}
          </section>
          <section class="preview-panel">
            ${renderAttachmentViewerHtml()}
          </section>
        </aside>
      </section>
    </main>
  `;

  bindEditEvents();
  schedulePreview("render-editor");
}

function renderPrintPage() {
  if (!state.issue) {
    renderLoading("印刷紙面を準備中です", "保存済みの案内を読込んでいます。");
    return;
  }

  app.innerHTML = `
    <main class="print-shell-app">
      <header class="print-header">
        <div>
          <span class="eyebrow">JOKAI PRINT</span>
          <h1 class="print-title">${escapeHtml(state.issue.title || "常会案内")}</h1>
          <p class="print-copy">${escapeHtml(issueSummaryLine(state.issue))} / ${escapeHtml(state.issue.place || "未設定")}</p>
        </div>
        <div class="preview-actions">
          <a class="ghost-link" href="/issues/${escapeHtml(state.issue.id)}/edit">編集へ戻る</a>
        </div>
      </header>
      <section class="print-preview-panel">
        ${renderNoticePreviewMarkup()}
      </section>
    </main>
  `;

  bindPrintEvents();
  schedulePreview("render-print");
}

function updatePreviewDom() {
  const pages = document.querySelector("#notice-preview-pages");
  const placeholder = document.querySelector("#notice-preview-placeholder");
  const overlay = document.querySelector("#notice-preview-overlay");
  const status = document.querySelector("#notice-preview-status");

  if (pages) {
    pages.innerHTML = renderPreviewPagesMarkup();
  }
  if (placeholder) {
    placeholder.classList.toggle("is-hidden", Boolean(state.previewImages.length));
  }
  if (overlay) {
    overlay.classList.toggle("is-visible", state.previewPending);
  }
  if (status) {
    status.textContent = state.previewPending
      ? "PDF を組版中…"
      : state.previewReadyAt
        ? `更新済み ${state.previewReadyAt}`
        : "保存前でも右で案内PDFを確認できます";
  }
}

async function rasterizePreview(bytes) {
  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type: "application/pdf" }), "preview.pdf");
  return api("/api/preview-renders", {
    method: "POST",
    body: formData,
  });
}

function schedulePreview(reason = "") {
  if (!state.issue || (boot.view !== "edit" && boot.view !== "print")) {
    return;
  }
  window.clearTimeout(state.previewTimer);
  state.previewTimer = window.setTimeout(() => {
    void generatePreview(reason);
  }, 220);
  state.previewPending = true;
  updatePreviewDom();
}

async function generatePreview(reason = "", { forceDownload = false } = {}) {
  if (!state.issue) {
    return;
  }

  state.previewPending = true;
  updatePreviewDom();
  const generation = ++state.previewGeneration;

  try {
    const { bytes } = await buildNoticePdfDocument(state.issue, state.blocks);
    if (generation !== state.previewGeneration) {
      return;
    }

    state.previewBytes = bytes;
    const preview = await rasterizePreview(bytes);
    if (generation !== state.previewGeneration) {
      return;
    }
    state.previewImages = Array.isArray(preview.images) ? preview.images : [];
    state.previewPending = false;
    state.previewReadyAt = new Date().toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    updatePreviewDom();

    if (forceDownload) {
      downloadBytes(bytes, pdfFileName(state.issue));
    }
  } catch (error) {
    if (generation !== state.previewGeneration) {
      return;
    }
    state.previewPending = false;
    state.previewImages = [];
    state.error = `プレビュー生成に失敗しました: ${error.message}`;
    updatePreviewDom();
    if (boot.view === "edit") {
      renderEditor();
    } else if (boot.view === "print") {
      renderPrintPage();
    }
  }
}

function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadNoticePdf() {
  if (state.previewBytes) {
    downloadBytes(state.previewBytes, pdfFileName(state.issue));
    return;
  }
  await generatePreview("download", { forceDownload: true });
}

function updateSaveStateText() {
  const node = document.querySelector("#save-state-text");
  if (!node) {
    return;
  }
  node.textContent = state.saving ? "保存中…" : state.dirty ? "未保存の変更あり" : "保存済み";
}

function markDirty() {
  state.dirty = true;
  state.notice = "";
  updateSaveStateText();
}

function bindPreviewButtons() {
  document.querySelector("#refresh-preview-button")?.addEventListener("click", () => {
    schedulePreview("manual-refresh");
  });
  document.querySelector("#download-notice-pdf-button")?.addEventListener("click", async () => {
    await downloadNoticePdf();
  });
}

function bindPrintEvents() {
  bindPreviewButtons();
}

function bindEditEvents() {
  bindPreviewButtons();

  document.querySelector("#reload-issue-button")?.addEventListener("click", async () => {
    await loadEditor();
  });

  document.querySelector("#save-issue-button")?.addEventListener("click", async () => {
    await saveEditor();
  });

  document.querySelectorAll("[data-issue-field]").forEach((node) => {
    const field = node.getAttribute("data-issue-field");
    const handler = (event) => {
      state.issue[field] = event.currentTarget.value;
      markDirty();
      schedulePreview(`issue-${field}`);
    };
    node.addEventListener("input", handler);
    node.addEventListener("change", handler);
  });

  document.querySelectorAll("[data-add-block]").forEach((button) => {
    button.addEventListener("click", () => {
      const blockKind = button.getAttribute("data-add-block") || "freeform";
      state.blocks.push(initialBlock(blockKind));
      markDirty();
      renderEditor();
    });
  });

  document.querySelectorAll("[data-block-field]").forEach((node) => {
    const field = node.getAttribute("data-block-field");
    const index = Number(node.getAttribute("data-block-index"));
    const handler = (event) => {
      state.blocks[index][field] = event.currentTarget.value;
      markDirty();
      schedulePreview(`block-${field}`);
    };
    node.addEventListener("input", handler);
    node.addEventListener("change", handler);
  });

  document.querySelectorAll("[data-add-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const blockIndex = Number(button.getAttribute("data-add-item"));
      state.blocks[blockIndex].items.push(initialItem());
      markDirty();
      renderEditor();
    });
  });

  document.querySelectorAll("[data-item-field]").forEach((node) => {
    const field = node.getAttribute("data-item-field");
    const blockIndex = Number(node.getAttribute("data-block-index"));
    const itemIndex = Number(node.getAttribute("data-item-index"));
    const handler = (event) => {
      state.blocks[blockIndex].items[itemIndex][field] = event.currentTarget.value;
      markDirty();
      schedulePreview(`item-${field}`);
    };
    node.addEventListener("input", handler);
    node.addEventListener("change", handler);
  });

  document.querySelectorAll("[data-remove-block]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-remove-block"));
      state.blocks.splice(index, 1);
      markDirty();
      renderEditor();
    });
  });

  document.querySelectorAll("[data-remove-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const [blockIndex, itemIndex] = String(button.getAttribute("data-remove-item"))
        .split(":")
        .map((value) => Number(value));
      state.blocks[blockIndex].items.splice(itemIndex, 1);
      markDirty();
      renderEditor();
    });
  });

  document.querySelectorAll("[data-move-block]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-move-block"));
      const direction = button.getAttribute("data-direction");
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= state.blocks.length) {
        return;
      }
      const [block] = state.blocks.splice(index, 1);
      state.blocks.splice(targetIndex, 0, block);
      markDirty();
      renderEditor();
    });
  });

  document.querySelectorAll("[data-move-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const [blockIndex, itemIndex] = String(button.getAttribute("data-move-item"))
        .split(":")
        .map((value) => Number(value));
      const direction = button.getAttribute("data-direction");
      const items = state.blocks[blockIndex].items;
      const targetIndex = direction === "up" ? itemIndex - 1 : itemIndex + 1;
      if (targetIndex < 0 || targetIndex >= items.length) {
        return;
      }
      const [item] = items.splice(itemIndex, 1);
      items.splice(targetIndex, 0, item);
      markDirty();
      renderEditor();
    });
  });

  document.querySelectorAll("[data-preview-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAttachmentId = button.getAttribute("data-preview-attachment") || "";
      renderEditor();
    });
  });

  document.querySelectorAll("[data-delete-attachment]").forEach((button) => {
    button.addEventListener("click", async () => {
      const attachmentId = button.getAttribute("data-delete-attachment");
      if (!attachmentId) {
        return;
      }
      if (!window.confirm("この資料を削除しますか？")) {
        return;
      }
      state.error = "";
      state.notice = "";
      renderEditor();
      try {
        const documentPayload = await api(`/api/attachments/${attachmentId}`, {
          method: "DELETE",
        });
        state.issue = normalizeIssue(documentPayload.issue);
        state.blocks = documentPayload.blocks.map(normalizeBlock);
        state.notice = "資料を削除しました。";
        ensureSelectedAttachment();
      } catch (error) {
        state.error = error.message;
      }
      renderEditor();
    });
  });

  document.querySelectorAll("[data-upload-item]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const [blockIndex, itemIndex] = String(input.getAttribute("data-upload-item"))
        .split(":")
        .map((value) => Number(value));
      const item = state.blocks[blockIndex]?.items?.[itemIndex];
      const file = event.currentTarget.files?.[0];
      if (!item?.id || !file) {
        return;
      }
      state.error = "";
      state.notice = "";
      renderEditor();
      try {
        const formData = new FormData();
        formData.append("file", file);
        const documentPayload = await api(`/api/items/${item.id}/attachments`, {
          method: "POST",
          body: formData,
        });
        state.issue = normalizeIssue(documentPayload.issue);
        state.blocks = documentPayload.blocks.map(normalizeBlock);
        state.notice = "資料を追加しました。";
        ensureSelectedAttachment();
      } catch (error) {
        state.error = error.message;
      }
      renderEditor();
    });
  });
}

async function createIssue(issueType) {
  state.error = "";
  state.notice = "";
  renderIndex();
  try {
    const response = await api("/api/issues", {
      method: "POST",
      body: { issue_type: issueType },
    });
    window.location.href = `/issues/${response.id}/edit`;
  } catch (error) {
    state.error = error.message;
    renderIndex();
  }
}

async function loadIndex() {
  state.loading = true;
  renderLoading("常会案内を読込中です", "一覧と作成パネルを準備しています。");
  try {
    const [meta, issues] = await Promise.all([api("/api/meta"), api("/api/issues")]);
    state.meta = meta;
    state.issues = issues;
    state.loading = false;
    renderIndex();
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    renderIndex();
  }
}

async function loadIssueDocument() {
  const documentPayload = await api(`/api/issues/${boot.issueId}`);
  state.issue = normalizeIssue(documentPayload.issue);
  state.blocks = documentPayload.blocks.map(normalizeBlock);
  ensureSelectedAttachment();
}

async function loadEditor() {
  state.loading = true;
  state.error = "";
  state.notice = "";
  renderLoading("編集画面を読込中です", "対象の号と block 群を取得しています。");
  try {
    const [meta] = await Promise.all([api("/api/meta"), loadIssueDocument()]);
    state.meta = meta;
    state.loading = false;
    state.dirty = false;
    state.previewBytes = null;
    state.previewImages = [];
    state.previewReadyAt = "";
    renderEditor();
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    renderEditor();
  }
}

async function loadPrint() {
  state.loading = true;
  renderLoading("印刷紙面を読込中です", "案内PDFの元データを取得しています。");
  try {
    await loadIssueDocument();
    state.loading = false;
    state.previewBytes = null;
    state.previewImages = [];
    state.previewReadyAt = "";
    renderPrintPage();
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    app.innerHTML = `<main class="print-shell-app"><div class="flash flash--error">${escapeHtml(error.message)}</div></main>`;
  }
}

async function saveEditor() {
  state.saving = true;
  state.error = "";
  state.notice = "";
  renderEditor();
  try {
    const documentPayload = await api(`/api/issues/${boot.issueId}`, {
      method: "PUT",
      body: payloadFromState(),
    });
    state.issue = normalizeIssue(documentPayload.issue);
    state.blocks = documentPayload.blocks.map(normalizeBlock);
    ensureSelectedAttachment();
    state.dirty = false;
    state.notice = "保存しました。";
  } catch (error) {
    state.error = error.message;
  } finally {
    state.saving = false;
    renderEditor();
  }
}

window.addEventListener("beforeunload", (event) => {
  if (state.dirty && boot.view === "edit") {
    event.preventDefault();
    event.returnValue = "";
  }
});

if (boot.view === "edit" && boot.issueId) {
  loadEditor();
} else if (boot.view === "print" && boot.issueId) {
  loadPrint();
} else {
  loadIndex();
}
