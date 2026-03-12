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
};

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

function normalizeBlock(block = {}) {
  return {
    id: block.id || "",
    block_kind: block.block_kind || "freeform",
    heading: block.heading || "",
    body: block.body || "",
    audience_label: block.audience_label || "",
    due_date: block.due_date || "",
    note: block.note || "",
    sort_order: block.sort_order || 0,
    attachments: Array.isArray(block.attachments)
      ? block.attachments.map(normalizeAttachment)
      : [],
  };
}

function initialBlock(blockKind = "freeform") {
  return normalizeBlock({
    block_kind: blockKind,
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
    return "月未設定";
  }
  const [year, month] = value.split("-");
  return `${year}年${Number(month)}月`;
}

function dateLabel(value) {
  if (!value) {
    return "未設定";
  }
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) {
    return value;
  }
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function meetingLine(issue) {
  if (!issue.meeting_date && !issue.meeting_time) {
    return "日時 未設定";
  }
  const dateText = issue.meeting_date ? dateLabel(issue.meeting_date) : "日付未設定";
  const timeText = issue.meeting_time ? ` ${issue.meeting_time}より` : "";
  return `日時 ${dateText}${timeText}`;
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
    blocks: state.blocks.map((block) => ({
      id: block.id || "",
      block_kind: block.block_kind,
      heading: block.heading,
      body: block.body,
      audience_label: block.audience_label,
      due_date: block.due_date,
      note: block.note,
    })),
  };
}

function allAttachments() {
  return state.blocks.flatMap((block) => block.attachments || []);
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
    <main class="shell">
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

function renderThumbnailStack(attachments) {
  if (!attachments?.length) {
    return `<div class="notice-thumb-empty">資料なし</div>`;
  }

  return attachments
    .map(
      (attachment) => `
        <figure class="notice-thumb">
          ${
            attachment.display_kind === "pdf" || attachment.display_kind === "image"
              ? `<img src="${escapeHtml(attachment.thumbnail_url)}" alt="${escapeHtml(attachment.original_filename)}">`
              : `<div class="notice-thumb-file">${escapeHtml((attachment.mime_type || "file").toUpperCase())}</div>`
          }
          <figcaption>${escapeHtml(attachment.original_filename)}</figcaption>
        </figure>
      `,
    )
    .join("");
}

function renderNoticePaper(issue, blocks, { embedded = false } = {}) {
  const title = issue.title || "無題の案内";
  const note = issue.header_note
    ? `<p class="notice-note">${escapeHtml(issue.header_note).replace(/\n/g, "<br>")}</p>`
    : "";

  const rows = blocks.length
    ? blocks
        .map(
          (block, index) => `
            <section class="notice-row">
              <div class="notice-row-main">
                <div class="notice-row-heading">
                  <span class="notice-index">${index + 1}</span>
                  <div>
                    <div class="notice-heading">${escapeHtml(block.heading || blockKindLabels[block.block_kind] || "項目")}</div>
                    ${
                      block.body
                        ? `<div class="notice-body">${escapeHtml(block.body).replace(/\n/g, "<br>")}</div>`
                        : ""
                    }
                    <div class="notice-meta-line">
                      ${block.audience_label ? `<span class="notice-inline-label">対象:${escapeHtml(block.audience_label)}</span>` : ""}
                      ${block.due_date ? `<span class="notice-inline-label">期限:${escapeHtml(dateLabel(block.due_date))}</span>` : ""}
                      ${block.note ? `<span class="notice-inline-label">${escapeHtml(block.note)}</span>` : ""}
                    </div>
                  </div>
                </div>
              </div>
              <aside class="notice-row-side">
                ${renderThumbnailStack(block.attachments)}
              </aside>
            </section>
          `,
        )
        .join("")
    : `<div class="empty-state">まだ本文ブロックがありません。左側で項目を追加するとここに紙面の流れが出ます。</div>`;

  return `
    <section class="notice-page ${embedded ? "notice-page--embedded" : ""}">
      <header class="notice-header">
        <h1 class="notice-title">${escapeHtml(title)}</h1>
        <div class="notice-summary">
          <div>${escapeHtml(meetingLine(issue))}</div>
          <div>場所 ${escapeHtml(issue.place || "未設定")}</div>
          <div>対象月 ${escapeHtml(monthLabel(issue.issue_month))}</div>
        </div>
        ${note}
      </header>
      <div class="notice-blocks">${rows}</div>
    </section>
  `;
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
                <span class="issue-card-stat">${monthLabel(issue.issue_month ? issue.issue_month.slice(0, 7) : "")}</span>
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
          <p class="page-lead">印刷用の案内を基準にしながら、本文と資料サムネを同じ画面で整えます。</p>
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
            <p class="section-copy">4 つの型だけを正式対応にしています。作成後すぐ編集画面へ移動します。</p>
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
            <p class="section-copy">草稿を積み上げる一覧です。案内本体と block 編集、資料アップロード、案内PDF出力までをここで育てます。</p>
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
      <p class="section-copy">${escapeHtml(attachment.original_filename)}</p>
    `;
  }

  if (attachment.display_kind === "image") {
    return `
      <div class="preview-heading">
        <strong>資料ビューア</strong>
        <span class="badge badge--pine">画像原本</span>
      </div>
      <div class="asset-stage asset-stage--image">
        <img class="asset-image" src="${escapeHtml(attachment.content_url)}" alt="${escapeHtml(attachment.original_filename)}">
      </div>
      <p class="section-copy">${escapeHtml(attachment.original_filename)}</p>
    `;
  }

  return `
    <div class="preview-heading">
      <strong>資料ビューア</strong>
      <span class="badge badge--draft">ファイル</span>
    </div>
    <div class="empty-state">
      この形式は埋め込み表示しません。<br>
      <a class="issue-link" href="${escapeHtml(attachment.content_url)}" target="_blank" rel="noreferrer">原本を開く</a>
    </div>
  `;
}

function renderEditor() {
  if (!state.issue) {
    renderLoading("編集画面を準備中です", "案内データを読み込んでいます。");
    return;
  }

  const issue = state.issue;
  const blockMarkup = state.blocks.length
    ? state.blocks
        .map(
          (block, index) => `
            <article class="block-card">
              <div class="block-card-head">
                <span class="block-chip">${index + 1}. ${escapeHtml(blockKindLabels[block.block_kind] || block.block_kind)}</span>
                <div class="block-actions">
                  <button class="ghost-button" type="button" data-move-block="${index}" data-direction="up" ${index === 0 ? "disabled" : ""}>上へ</button>
                  <button class="ghost-button" type="button" data-move-block="${index}" data-direction="down" ${index === state.blocks.length - 1 ? "disabled" : ""}>下へ</button>
                  <button class="danger-button" type="button" data-remove-block="${index}">削除</button>
                </div>
              </div>

              <div class="form-grid">
                <div class="form-grid form-grid--two">
                  <div class="field">
                    <label>Block Kind</label>
                    <select data-block-field="block_kind" data-block-index="${index}">
                      ${blockKindOptions(block.block_kind)}
                    </select>
                  </div>
                  <div class="field">
                    <label>対象ラベル</label>
                    <input data-block-field="audience_label" data-block-index="${index}" value="${escapeHtml(block.audience_label)}" placeholder="全員 / 希望者 / 一部">
                  </div>
                </div>

                <div class="field">
                  <label>見出し</label>
                  <input data-block-field="heading" data-block-index="${index}" value="${escapeHtml(block.heading)}" placeholder="例: 3月度提出物">
                </div>

                <div class="field">
                  <label>本文</label>
                  <textarea data-block-field="body" data-block-index="${index}" placeholder="紙面左側に出したい説明を書きます。">${escapeHtml(block.body)}</textarea>
                </div>

                <div class="form-grid form-grid--two">
                  <div class="field">
                    <label>期限</label>
                    <input type="date" data-block-field="due_date" data-block-index="${index}" value="${escapeHtml(block.due_date)}">
                  </div>
                  <div class="field">
                    <label>補足メモ</label>
                    <input data-block-field="note" data-block-index="${index}" value="${escapeHtml(block.note)}" placeholder="紙面右下の補助情報など">
                  </div>
                </div>

                <div class="field">
                  <label>資料</label>
                  ${
                    block.id
                      ? `
                        <label class="upload-slot">
                          <span>PDF / 画像を追加</span>
                          <input type="file" accept="application/pdf,image/*" data-upload-block="${index}">
                        </label>
                      `
                      : `<div class="muted">この block を一度保存すると、資料を添付できます。</div>`
                  }
                  <div class="attachment-list">
                    ${
                      block.attachments?.length
                        ? block.attachments
                            .map(
                              (attachment) => `
                                <div class="attachment-chip ${state.selectedAttachmentId === attachment.id ? "attachment-chip--active" : ""}">
                                  <button class="attachment-preview-button" type="button" data-preview-attachment="${attachment.id}">
                                    <strong>${escapeHtml(attachment.original_filename)}</strong>
                                    <span>${escapeHtml(attachment.display_kind)}</span>
                                  </button>
                                  <div class="attachment-inline-actions">
                                    <a class="toolbar-link" href="${escapeHtml(attachment.content_url)}" target="_blank" rel="noreferrer">原本</a>
                                    <button class="attachment-delete-button" type="button" data-delete-attachment="${attachment.id}">削除</button>
                                  </div>
                                </div>
                              `,
                            )
                            .join("")
                        : `<div class="muted">資料なし</div>`
                    }
                  </div>
                </div>
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">まだ本文ブロックがありません。下の「提出物」「配布物」などから始めてください。</div>`;

  app.innerHTML = `
    <main class="shell">
      <header class="masthead">
        <div class="brand-block">
          <span class="eyebrow">JOKAI EDITOR</span>
          <h1 class="page-title">常会案内を編集する</h1>
          <p class="page-lead">右上で印刷プレビューを確認しながら、本文と資料の見せ方を調整します。</p>
        </div>
        <aside class="status-panel">
          <div class="status-grid">
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

      <section class="workspace editor-layout">
        <div class="editor-main">
          <div class="toolbar">
            <div class="toolbar-actions">
              <a class="toolbar-link" href="/issues">一覧へ戻る</a>
              <span class="badge badge--accent">${escapeHtml(issueTypeLabels[issue.issue_type] || issue.issue_type)}</span>
              <span class="badge badge--draft">${escapeHtml(issue.status)}</span>
            </div>
            <div class="toolbar-actions">
              <a class="ghost-button toolbar-button-link" href="/issues/${escapeHtml(issue.id)}/print" target="_blank" rel="noreferrer">印刷画面</a>
              <a class="primary-button toolbar-button-link" href="/api/issues/${escapeHtml(issue.id)}/print-pdf" target="_blank" rel="noreferrer">案内PDFを出力</a>
              <button class="ghost-button" type="button" id="reload-issue-button">再読込</button>
              <button class="primary-button" type="button" id="save-issue-button" ${state.saving ? "disabled" : ""}>保存する</button>
            </div>
          </div>

          ${state.error ? `<div class="flash flash--error">${escapeHtml(state.error)}</div>` : ""}
          ${state.notice ? `<div class="flash flash--info">${escapeHtml(state.notice)}</div>` : ""}

          <section class="card">
            <h2 class="card-title">号の骨格</h2>
            <p class="card-copy">案内の型、タイトル、日時、場所などの共通情報です。ここは紙面全体の印象を決めます。</p>
            <div class="form-grid">
              <div class="form-grid form-grid--two">
                <div class="field">
                  <label>Issue Type</label>
                  <select data-issue-field="issue_type">
                    ${issueTypeOptions(issue.issue_type)}
                  </select>
                </div>
                <div class="field">
                  <label>対象月</label>
                  <input type="month" data-issue-field="issue_month" value="${escapeHtml(issue.issue_month)}">
                </div>
              </div>

              <div class="field">
                <label>タイトル</label>
                <input data-issue-field="title" value="${escapeHtml(issue.title)}" placeholder="例: 平古場生産組合 常会の案内">
              </div>

              <div class="form-grid form-grid--two">
                <div class="field">
                  <label>開催日</label>
                  <input type="date" data-issue-field="meeting_date" value="${escapeHtml(issue.meeting_date)}">
                </div>
                <div class="field">
                  <label>開始時刻</label>
                  <input type="time" data-issue-field="meeting_time" value="${escapeHtml(issue.meeting_time)}">
                </div>
              </div>

              <div class="field">
                <label>場所</label>
                <input data-issue-field="place" value="${escapeHtml(issue.place)}" placeholder="例: 平古場自治公民館">
              </div>

              <div class="field">
                <label>上部注記</label>
                <textarea data-issue-field="header_note" placeholder="田祈祷、忘年会、開始時刻の訂正など">${escapeHtml(issue.header_note)}</textarea>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="blocks-header">
              <div>
                <h2 class="card-title">本文ブロック</h2>
                <p class="card-copy">紙面左側の説明です。右上の印刷プレビューには、資料はサムネだけ載ります。</p>
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
          <div class="preview-frame" id="preview-root">
            <div class="preview-heading">
              <strong>印刷プレビュー</strong>
              <span class="badge badge--draft">${escapeHtml(issueTypeLabels[issue.issue_type] || issue.issue_type)}</span>
            </div>
            ${renderNoticePaper(issue, state.blocks, { embedded: true })}
          </div>
          <div class="preview-frame" id="attachment-preview-root">
            ${renderAttachmentViewerHtml()}
          </div>
        </aside>
      </section>
    </main>
  `;

  bindEditEvents();
}

function renderPrintPage() {
  if (!state.issue) {
    renderLoading("印刷紙面を準備中です", "保存済みの案内を読込んでいます。");
    return;
  }

  app.innerHTML = `
    <main class="print-shell">
      ${renderNoticePaper(state.issue, state.blocks)}
    </main>
  `;
}

function updatePreview() {
  const previewRoot = document.querySelector("#preview-root");
  if (!previewRoot || !state.issue) {
    return;
  }
  previewRoot.innerHTML = `
    <div class="preview-heading">
      <strong>印刷プレビュー</strong>
      <span class="badge badge--draft">${escapeHtml(issueTypeLabels[state.issue.issue_type] || state.issue.issue_type)}</span>
    </div>
    ${renderNoticePaper(state.issue, state.blocks, { embedded: true })}
  `;

  const attachmentPreviewRoot = document.querySelector("#attachment-preview-root");
  if (attachmentPreviewRoot) {
    attachmentPreviewRoot.innerHTML = renderAttachmentViewerHtml();
  }
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

function bindEditEvents() {
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
      updatePreview();
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
      updatePreview();
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

  document.querySelectorAll("[data-upload-block]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const index = Number(input.getAttribute("data-upload-block"));
      const block = state.blocks[index];
      const file = event.currentTarget.files?.[0];
      if (!block?.id || !file) {
        return;
      }
      state.error = "";
      state.notice = "";
      renderEditor();
      try {
        const formData = new FormData();
        formData.append("file", file);
        const documentPayload = await api(`/api/blocks/${block.id}/attachments`, {
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
    renderEditor();
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    renderEditor();
  }
}

async function loadPrint() {
  state.loading = true;
  renderLoading("印刷紙面を読込中です", "案内の保存済みデータを取得しています。");
  try {
    await loadIssueDocument();
    state.loading = false;
    renderPrintPage();
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    app.innerHTML = `<main class="print-shell"><div class="flash flash--error">${escapeHtml(error.message)}</div></main>`;
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

if (boot.view === "edit" && boot.issueId) {
  loadEditor();
} else if (boot.view === "print" && boot.issueId) {
  loadPrint();
} else {
  loadIndex();
}
