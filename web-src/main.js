import "./app.css";
import {
  ITEM_THUMBNAIL_SCALE_DEFAULT_PERCENT,
  ITEM_THUMBNAIL_SCALE_LIMITS,
  PAPER_FONT_SCALE_DEFAULTS,
  PAPER_FONT_SCALE_LIMITS,
  PAPER_FONT_SCALE_ORDER,
  buildNoticePdfDocument,
  itemHasVisibleContent,
  normalizeItemThumbnailScalePercent,
  normalizePaperFontScale,
  pdfFileName,
} from "./notice-pdf.js";
import {
  ISSUE_FAMILY_KEY,
  SHOGAI_KYOSAI_FAMILY_KEY,
  SHOGAI_KYOSAI_JOIN_RENEWAL_TEMPLATE_KEY,
  blankTemplatePayloadRow,
  defaultTemplatePayload,
  familyDefinition,
  familyIndexPath,
  familyTemplateDefinitions,
  missingTemplatePayloadKeys,
  normalizeFamilyKey,
  normalizeTemplatePayload,
  templatePayloadActiveRowCount,
  templatePayloadRows,
  templateDefinition,
  templateDocumentAutoTitle,
  templateLabel,
  templatePayloadText,
  templateRowHasAnyValue,
} from "./template-doc-registry.js";
import {
  templateDocumentPdfFileName,
} from "./template-doc-pdf.js";

const app = document.querySelector("#app");

const boot = {
  view: app?.dataset.view || "index",
  issueId: app?.dataset.issueId || "",
  templateDocumentId: app?.dataset.templateDocumentId || "",
  familyTab: normalizeFamilyKey(app?.dataset.familyTab || ISSUE_FAMILY_KEY),
  printMode: app?.dataset.printMode === "1",
};

const issueTypeLabels = {
  normal: "通常案内",
  correction: "訂正案内",
  no_meeting: "常会なし",
  one_off: "単発案内",
};
const issueStatusLabels = {
  draft: "下書き",
  published: "発行済み",
};
const DEFAULT_AGENDA_LABEL = "常会事項";

const blockKindLabels = {
  agenda: "議題",
  submission: "提出物",
  distribution: "配布物",
  info: "案内事項",
  freeform: "自由記述",
};

const paperFontScaleLabels = {
  title: "title",
  header: "header",
  h1: "h1",
  h2: "h2",
  body: "body",
  footer: "footer",
};
const itemMetaLayoutLabels = {
  stacked: "別行",
  same_line: "同じ行",
};
const itemSupplementToneLabels = {
  red: "赤",
  blue: "青",
};
const paperFontScaleStorageKey = "jokai.paper-font-scale.v1";
const issueListModeStorageKey = "jokai.issue-list-mode.v1";

const state = {
  meta: null,
  issues: [],
  templateDocuments: [],
  issue: null,
  issueNavigation: { newer: null, older: null },
  templateDocument: null,
  templatePayloadText: "",
  activeFamily: boot.familyTab,
  issueListMode: loadIssueListMode(),
  blocks: [],
  paperFontScale: loadPaperFontScale(),
  selectedAttachmentId: "",
  loading: true,
  saving: false,
  publishing: false,
  dirty: false,
  notice: "",
  error: "",
  warning: "",
  previewBytes: null,
  previewImages: [],
  previewPending: false,
  previewReadyAt: "",
  previewGeneration: 0,
  previewTimer: 0,
  templatePreviewMissingBindings: [],
};

const itemIndexLabels = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];
let printShortcutPending = false;

function normalizeIssueListMode(value) {
  return value === "detail" ? "detail" : "thumb";
}

function loadIssueListMode() {
  try {
    const raw = window.localStorage.getItem(issueListModeStorageKey);
    return normalizeIssueListMode(raw);
  } catch {
    return "thumb";
  }
}

function persistIssueListMode() {
  try {
    window.localStorage.setItem(issueListModeStorageKey, state.issueListMode);
  } catch {
    // Ignore localStorage failures and keep the in-memory value.
  }
}

function loadPaperFontScale() {
  try {
    const raw = window.localStorage.getItem(paperFontScaleStorageKey);
    if (!raw) {
      return { ...PAPER_FONT_SCALE_DEFAULTS };
    }
    return normalizePaperFontScale(JSON.parse(raw));
  } catch {
    return { ...PAPER_FONT_SCALE_DEFAULTS };
  }
}

function persistPaperFontScale() {
  try {
    window.localStorage.setItem(paperFontScaleStorageKey, JSON.stringify(state.paperFontScale));
  } catch {
    // Ignore localStorage failures and keep the in-memory value.
  }
}

function updatePaperFontScale(partial = {}) {
  state.paperFontScale = normalizePaperFontScale({
    ...state.paperFontScale,
    ...partial,
  });
  persistPaperFontScale();
}

function adjustPaperFontScale(category, delta) {
  const nextValue =
    (state.paperFontScale[category] || PAPER_FONT_SCALE_DEFAULTS[category]) +
    delta * PAPER_FONT_SCALE_LIMITS.step;
  updatePaperFontScale({ [category]: nextValue });
}

function resetPaperFontScale() {
  state.paperFontScale = { ...PAPER_FONT_SCALE_DEFAULTS };
  persistPaperFontScale();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeItemMetaLayout(value) {
  return value === "same_line" ? "same_line" : "stacked";
}

function normalizeItemSupplementTone(value) {
  return value === "blue" ? "blue" : "red";
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

function itemMetaLayoutOptions(selected) {
  return Object.entries(itemMetaLayoutLabels)
    .map(
      ([value, label]) =>
        `<option value="${value}" ${normalizeItemMetaLayout(selected) === value ? "selected" : ""}>${label}</option>`,
    )
    .join("");
}

function itemSupplementToneOptions(selected) {
  return Object.entries(itemSupplementToneLabels)
    .map(
      ([value, label]) =>
        `<option value="${value}" ${normalizeItemSupplementTone(selected) === value ? "selected" : ""}>${label}</option>`,
    )
    .join("");
}

function normalizeIssue(issue) {
  return {
    id: issue.id,
    issue_type: issue.issue_type || "normal",
    status: normalizeIssueStatus(issue.status),
    title: issue.title || "",
    agenda_label: issue.agenda_label || DEFAULT_AGENDA_LABEL,
    issue_month: issue.issue_month ? issue.issue_month.slice(0, 7) : "",
    meeting_date: issue.meeting_date || "",
    meeting_time: issue.meeting_time || "",
    place: issue.place || "",
    header_note: issue.header_note || "",
    footer_note: issue.footer_note || "",
    published_at: issue.published_at || "",
  };
}

function normalizeIssueNavigationEntry(entry = null) {
  if (!entry || !entry.id) {
    return null;
  }
  return {
    id: entry.id || "",
    title: entry.title || "",
    issue_month: entry.issue_month ? String(entry.issue_month).slice(0, 7) : "",
    status: normalizeIssueStatus(entry.status),
  };
}

function normalizeIssueNavigation(navigation = {}) {
  return {
    newer: normalizeIssueNavigationEntry(navigation.newer),
    older: normalizeIssueNavigationEntry(navigation.older),
  };
}

function normalizeIssueListItem(issue = {}) {
  return {
    id: issue.id || "",
    issue_type: issue.issue_type || "normal",
    status: normalizeIssueStatus(issue.status),
    title: issue.title || "",
    issue_month: issue.issue_month || "",
    place: issue.place || "",
    published_at: issue.published_at || "",
    block_count: Number.isFinite(issue.block_count) ? issue.block_count : 0,
    thumbnail_url: issue.thumbnail_url || "",
  };
}

function normalizeTemplateDocument(document = {}) {
  const documentFamily = document.document_family || SHOGAI_KYOSAI_FAMILY_KEY;
  const templateKey = document.template_key || SHOGAI_KYOSAI_JOIN_RENEWAL_TEMPLATE_KEY;
  const hasPayload = Object.prototype.hasOwnProperty.call(document, "payload");
  const payload = hasPayload
    ? normalizeTemplatePayload(documentFamily, templateKey, document.payload || {})
    : undefined;
  return {
    id: document.id || "",
    document_family: documentFamily,
    template_key: templateKey,
    status: document.status || "draft",
    title:
      String(document.title || "").trim() ||
      templateDocumentAutoTitle(documentFamily, templateKey, payload || defaultTemplatePayload(documentFamily, templateKey)),
    template_asset_path:
      document.template_asset_path || templateDefinition(documentFamily, templateKey).template_asset_path,
    template_version:
      document.template_version || templateDefinition(documentFamily, templateKey).template_version,
    payload,
    row_count:
      Number.isFinite(document.row_count) && document.row_count >= 0
        ? document.row_count
        : templatePayloadActiveRowCount(documentFamily, templateKey, payload),
    created_at: document.created_at || "",
    updated_at: document.updated_at || "",
  };
}

function templateDocumentRows(document = state.templateDocument) {
  if (!document) {
    return [];
  }
  return templatePayloadRows(document.document_family, document.template_key, document.payload || {});
}

function templateDocumentRowCount(document = state.templateDocument) {
  if (!document) {
    return 0;
  }
  return templatePayloadActiveRowCount(document.document_family, document.template_key, document.payload || {});
}

function syncTemplateDocumentTitle() {
  if (!state.templateDocument) {
    return;
  }
  state.templateDocument.title = templateDocumentAutoTitle(
    state.templateDocument.document_family,
    state.templateDocument.template_key,
    state.templateDocument.payload,
  );
  state.templateDocument.row_count = templateDocumentRowCount(state.templateDocument);
}

function syncTemplatePayloadTextFromDocument() {
  if (!state.templateDocument) {
    state.templatePayloadText = "";
    return;
  }
  state.templatePayloadText = templatePayloadText(
    state.templateDocument.document_family,
    state.templateDocument.template_key,
    state.templateDocument.payload,
  );
}

function setTemplateDocumentPayload(payload) {
  if (!state.templateDocument) {
    return;
  }
  state.templateDocument.payload = normalizeTemplatePayload(
    state.templateDocument.document_family,
    state.templateDocument.template_key,
    payload,
  );
  syncTemplateDocumentTitle();
  syncTemplatePayloadTextFromDocument();
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

function normalizeItemSupplement(supplement = {}) {
  return {
    id: supplement.id || "",
    tone: normalizeItemSupplementTone(supplement.tone),
    content: supplement.content || "",
    sort_order: supplement.sort_order || 0,
  };
}

function normalizeItem(item = {}) {
  const normalizedSupplements = Array.isArray(item.supplements)
    ? item.supplements.map(normalizeItemSupplement)
    : [];
  const supplements = normalizedSupplements.length
    ? normalizedSupplements
    : item.note
      ? [normalizeItemSupplement({ tone: "red", content: item.note, sort_order: 1 })]
      : [];
  return {
    id: item.id || "",
    heading: item.heading || "",
    body: item.body || "",
    audience_label: item.audience_label || "",
    due_date: item.due_date || "",
    supplements,
    meta_layout: normalizeItemMetaLayout(item.meta_layout),
    thumb_scale_percent: normalizeItemThumbnailScalePercent(item.thumb_scale_percent),
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
    supplements: [],
    meta_layout: "stacked",
    thumb_scale_percent: ITEM_THUMBNAIL_SCALE_DEFAULT_PERCENT,
    attachments: [],
  });
}

function initialTemplateDocumentDraft(documentFamily, templateKey) {
  const payload = defaultTemplatePayload(documentFamily, templateKey);
  return normalizeTemplateDocument({
    document_family: documentFamily,
    template_key: templateKey,
    payload,
  });
}

function initialItemSupplement(tone = "red") {
  return normalizeItemSupplement({
    tone,
    content: "",
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

function normalizeIssueStatus(value) {
  return value === "published" ? "published" : "draft";
}

function issueStatusLabel(status) {
  return issueStatusLabels[normalizeIssueStatus(status)] || String(status || "").trim() || issueStatusLabels.draft;
}

function issueStatusBadgeClass(status) {
  return normalizeIssueStatus(status) === "published" ? "badge--published" : "badge--draft";
}

function isIssuePublished(issue = state.issue) {
  return normalizeIssueStatus(issue?.status) === "published";
}

function issueEditorReadOnly(issue = state.issue) {
  return isIssuePublished(issue);
}

function issuePrimaryLinkLabel(issue = state.issue) {
  return isIssuePublished(issue) ? "閲覧へ" : "編集へ";
}

function issuePublishedStat(issue = state.issue) {
  return issue?.published_at ? `発行: ${issue.published_at}` : "発行前の下書き";
}

function editorSaveStateText() {
  if (state.publishing) {
    return "発行中…";
  }
  if (state.saving) {
    return "保存中…";
  }
  if (boot.view === "edit" && isIssuePublished()) {
    return "発行済み・読取専用";
  }
  return state.dirty ? "未保存の変更あり" : "保存済み";
}

function disabledAttr(disabled) {
  return disabled ? "disabled" : "";
}

function renderIssueReadonlyBanner(issue = state.issue) {
  if (!issueEditorReadOnly(issue)) {
    return "";
  }
  const publishedSummary = issue?.published_at
    ? `${issue.published_at} に発行済みです。`
    : "この案内は発行済みです。";
  return `<div class="flash flash--warning">${escapeHtml(`${publishedSummary} この画面では直接編集できません。修正は「複製して編集」から新しい下書きで行ってください。`)}</div>`;
}

function issueNavigationTooltip(entry) {
  if (!entry) {
    return "";
  }
  const parts = [issueStatusLabel(entry.status), monthLabel(entry.issue_month), entry.title || "無題の案内"];
  return parts.filter(Boolean).join(" / ");
}

function renderIssueNavigationLink(entry, direction) {
  const isNewer = direction === "newer";
  const label = isNewer ? "&larr; 新しい案内" : "古い案内 &rarr;";
  if (!entry) {
    return `<span class="ghost-link ghost-link--disabled issue-nav-link" aria-disabled="true">${label}</span>`;
  }
  return `
    <a
      class="ghost-link issue-nav-link"
      href="/issues/${encodeURIComponent(entry.id)}/edit"
      title="${escapeHtml(issueNavigationTooltip(entry))}"
    >${label}</a>
  `;
}

async function syncIssueAfterReadonlyConflict(
  error,
  noticeMessage = "既に発行済みのため最新状態を再読込しました。",
) {
  const message = String(error?.message || "");
  if (!boot.issueId || (!message.includes("発行済み") && !message.includes("公開済み"))) {
    return false;
  }
  try {
    await loadIssueDocument();
    state.dirty = false;
    state.error = "";
    state.notice = noticeMessage;
    ensureSelectedAttachment();
    return true;
  } catch (reloadError) {
    state.error = `${message} / 再読込にも失敗しました: ${reloadError.message}`;
    return false;
  }
}

function payloadFromState() {
  return {
    issue_type: state.issue.issue_type,
    title: state.issue.title.trim(),
    agenda_label: state.issue.agenda_label.trim(),
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
        supplements: item.supplements.map((supplement) => ({
          tone: normalizeItemSupplementTone(supplement.tone),
          content: supplement.content,
        })),
        meta_layout: normalizeItemMetaLayout(item.meta_layout),
        thumb_scale_percent: normalizeItemThumbnailScalePercent(item.thumb_scale_percent),
      })),
    })),
  };
}

function printPageUrl(issueId = state.issue?.id || boot.issueId) {
  return `/issues/${encodeURIComponent(issueId || "")}/print`;
}

function templateDocumentEditUrl(templateDocumentId = state.templateDocument?.id || boot.templateDocumentId) {
  return `/template-documents/${encodeURIComponent(templateDocumentId || "")}/edit`;
}

function templateDocumentPrintUrl(templateDocumentId = state.templateDocument?.id || boot.templateDocumentId) {
  return `/template-documents/${encodeURIComponent(templateDocumentId || "")}/print`;
}

function parseTemplatePayloadText(rawText = state.templatePayloadText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText || "{}");
  } catch (error) {
    throw new Error(`JSON を解釈できません: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON の最上位は object にしてください。");
  }
  if (!state.templateDocument) {
    return parsed;
  }
  return normalizeTemplatePayload(
    state.templateDocument.document_family,
    state.templateDocument.template_key,
    parsed,
  );
}

function templateDocumentPayloadFromState() {
  if (!state.templateDocument) {
    return { title: "", payload: {} };
  }
  const payload = parseTemplatePayloadText();
  return {
    title: templateDocumentAutoTitle(
      state.templateDocument.document_family,
      state.templateDocument.template_key,
      payload,
    ),
    payload,
  };
}

function clearTemplatePreviewWarning() {
  state.warning = "";
  state.templatePreviewMissingBindings = [];
}

function templatePreviewBlockingMessage(document = state.templateDocument) {
  const familyLabel = familyDefinition(document?.document_family || SHOGAI_KYOSAI_FAMILY_KEY).label;
  return `${familyLabel}のプレビューと帳票PDF出力はまだ実行できません。左の契約者入力を埋めてください。`;
}

function renderTemplatePreviewMissingList(bindings = state.templatePreviewMissingBindings) {
  if (!bindings.length) {
    return "";
  }
  return bindings
    .map(
      (binding) => `
        <li>
          ${binding.rowLabel ? `<span class="badge badge--draft">${escapeHtml(binding.rowLabel)}</span>` : ""}
          <span>${escapeHtml(binding.description)}</span>
          ${binding.key ? `<code>${escapeHtml(binding.key)}</code>` : ""}
        </li>
      `,
    )
    .join("");
}

function renderTemplatePayloadWarningMarkup() {
  if (!state.templatePreviewMissingBindings.length) {
    return "";
  }
  return `
    <div class="template-warning-card" aria-live="polite">
      <strong>プレビュー前に入力が必要です</strong>
      <p>次の必須項目を各行で埋めると、右のプレビューと帳票PDF出力を再開できます。</p>
      <ul class="template-warning-list">
        ${renderTemplatePreviewMissingList()}
      </ul>
    </div>
  `;
}

function applyTemplatePreviewWarning(missingBindings, document = state.templateDocument) {
  state.warning = templatePreviewBlockingMessage(document);
  state.templatePreviewMissingBindings = missingBindings.map((binding) => ({
    key: binding.key,
    description: binding.description,
    rowIndex: Number.isInteger(binding.rowIndex) ? binding.rowIndex : null,
    rowLabel: binding.rowLabel || "",
  }));
}

function templatePreviewIssuesByRow() {
  return state.templatePreviewMissingBindings.reduce((map, issue) => {
    if (!Number.isInteger(issue.rowIndex)) {
      return map;
    }
    const current = map.get(issue.rowIndex) || [];
    current.push(issue);
    map.set(issue.rowIndex, current);
    return map;
  }, new Map());
}

function templatePreviewInvalidRowCount() {
  const rowCount = templatePreviewIssuesByRow().size;
  if (rowCount > 0) {
    return rowCount;
  }
  return state.templatePreviewMissingBindings.length ? 1 : 0;
}

function updateTemplatePreviewWarningDom() {
  document.querySelector("#template-preview-warning-flash")?.replaceChildren();
  const flashHost = document.querySelector("#template-preview-warning-flash");
  if (flashHost) {
    flashHost.innerHTML = state.warning
      ? `<div class="flash flash--warning">${escapeHtml(state.warning)}</div>`
      : "";
  }

  const cardHost = document.querySelector("#template-payload-warning");
  if (cardHost) {
    cardHost.innerHTML = renderTemplatePayloadWarningMarkup();
  }

  const downloadButton = document.querySelector("#download-notice-pdf-button");
  if (downloadButton && (boot.view === "template-edit" || boot.view === "template-print")) {
    downloadButton.disabled = state.templatePreviewMissingBindings.length > 0;
  }
}

function selectedIndexFamily() {
  return normalizeFamilyKey(state.activeFamily || boot.familyTab || ISSUE_FAMILY_KEY);
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

function fileExtensionFromMimeType(mimeType = "") {
  const normalized = String(mimeType || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  const knownExtensions = {
    "image/apng": "apng",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/tiff": "tiff",
    "image/webp": "webp",
  };
  if (knownExtensions[normalized]) {
    return knownExtensions[normalized];
  }
  if (!normalized.startsWith("image/")) {
    return "bin";
  }
  const fallback = normalized.slice("image/".length).replace(/[^a-z0-9]+/g, "");
  return fallback || "img";
}

function clipboardTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function clipboardFileName(mimeType = "") {
  return `clipboard-${clipboardTimestamp()}.${fileExtensionFromMimeType(mimeType)}`;
}

function ensureNamedFile(fileOrBlob, fallbackName = clipboardFileName(fileOrBlob?.type)) {
  if (fileOrBlob instanceof File && fileOrBlob.name) {
    return fileOrBlob;
  }
  return new File([fileOrBlob], fallbackName, {
    type: fileOrBlob?.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}

function firstClipboardImageFileFromDataTransfer(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  for (const item of items) {
    if (item.kind !== "file" || !String(item.type || "").toLowerCase().startsWith("image/")) {
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      return ensureNamedFile(file, clipboardFileName(file.type));
    }
  }

  const files = Array.from(dataTransfer?.files || []);
  const file = files.find((candidate) =>
    String(candidate.type || "").toLowerCase().startsWith("image/"),
  );
  return file ? ensureNamedFile(file, clipboardFileName(file.type)) : null;
}

async function firstClipboardImageFileFromNavigator() {
  if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") {
    const error = new Error("clipboard-read-unsupported");
    error.code = "clipboard-read-unsupported";
    throw error;
  }

  const clipboardItems = await navigator.clipboard.read();
  for (const clipboardItem of clipboardItems) {
    const imageType = Array.from(clipboardItem.types || []).find((type) =>
      String(type || "").toLowerCase().startsWith("image/"),
    );
    if (!imageType) {
      continue;
    }
    const blob = await clipboardItem.getType(imageType);
    return ensureNamedFile(blob, clipboardFileName(imageType));
  }

  const error = new Error("clipboard-image-missing");
  error.code = "clipboard-image-missing";
  throw error;
}

function clipboardReadFailureMessage(error) {
  if (error?.code === "clipboard-read-unsupported") {
    return "このブラウザでは Clipboard ボタン取得が使えません。添付欄を選択して Ctrl+V / Cmd+V で貼り付けしてください。";
  }
  if (error?.code === "clipboard-image-missing") {
    return "Clipboard に画像がありません。画像をコピーしてから、添付欄を選択して Ctrl+V / Cmd+V で貼り付けしてください。";
  }
  return "Clipboard から画像を取得できませんでした。添付欄を選択して Ctrl+V / Cmd+V で貼り付けしてください。";
}

async function uploadAttachmentFile(itemId, file, successMessage = "資料を追加しました。") {
  if (!itemId || !file) {
    return false;
  }

  state.error = "";
  state.notice = "";
  renderEditor();

  try {
    const normalizedFile = ensureNamedFile(file, clipboardFileName(file.type));
    const formData = new FormData();
    formData.append("file", normalizedFile, normalizedFile.name);
    const documentPayload = await api(`/api/items/${itemId}/attachments`, {
      method: "POST",
      body: formData,
    });
    state.issue = normalizeIssue(documentPayload.issue);
    state.blocks = documentPayload.blocks.map(normalizeBlock);
    state.notice = successMessage;
    ensureSelectedAttachment();
    return true;
  } catch (error) {
    if (await syncIssueAfterReadonlyConflict(error)) {
      return false;
    }
    state.error = error.message;
    return false;
  } finally {
    renderEditor();
  }
}

async function uploadClipboardImageFromPaste(itemId, clipboardEvent) {
  if (!itemId) {
    return false;
  }

  const file = firstClipboardImageFileFromDataTransfer(clipboardEvent.clipboardData);
  if (!file) {
    state.notice = "";
    state.error = "Clipboard に画像がありません。画像をコピーしてから、添付欄で貼り付けしてください。";
    renderEditor();
    return false;
  }

  return uploadAttachmentFile(itemId, file, "Clipboard の画像を追加しました。");
}

async function uploadClipboardImageFromButton(itemId) {
  if (!itemId) {
    return false;
  }

  state.error = "";
  state.notice = "";

  try {
    const file = await firstClipboardImageFileFromNavigator();
    return await uploadAttachmentFile(itemId, file, "Clipboard の画像を追加しました。");
  } catch (error) {
    state.error = clipboardReadFailureMessage(error);
    renderEditor();
    return false;
  }
}

function clipboardPasteItemIdFromNode(node) {
  if (!(node instanceof Element)) {
    return "";
  }
  return node.closest("[data-paste-item-id]")?.getAttribute("data-paste-item-id") || "";
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

async function apiBinary(path, options = {}) {
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
  return response.arrayBuffer();
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

function renderAttachmentList(item, blockIndex, itemIndex, readOnly = issueEditorReadOnly()) {
  const attachments = item.attachments || [];
  const itemId = item.id ? escapeHtml(item.id) : "";
  const thumbScalePercent = normalizeItemThumbnailScalePercent(item.thumb_scale_percent);
  const thumbScaleDisabled = readOnly || !attachments.length;
  const uploadDisabled = readOnly || !item.id;
  const pasteDisabled = readOnly || !item.id;
  const uploadLabel = readOnly
    ? "発行済みのため資料変更できません"
    : item.id
      ? "PDF / 画像を追加"
      : "保存後に資料追加できます";
  const pasteHelp = readOnly
    ? "発行済みのため貼り付けできません"
    : item.id
      ? "Ctrl+V / Cmd+V で画像を追加"
      : "保存後に貼り付けできます";
  const attachmentHint = readOnly
    ? "発行済みの案内では資料の追加・削除はできません。原本閲覧だけ利用できます。"
    : "Clipboard は画像のみ対応、複数画像がある場合は先頭1枚だけ登録します。";
  const items = attachments.length
    ? attachments
        .map(
          (attachment) => `
            <li class="attachment-item ${attachment.id === state.selectedAttachmentId ? "is-selected" : ""}">
              <button class="attachment-preview-button" type="button" data-preview-attachment="${attachment.id}">
                <span>${escapeHtml(attachment.original_filename)}</span>
                <small>${escapeHtml(attachment.display_kind.toUpperCase())}</small>
              </button>
              <button class="ghost-button ghost-button--danger" type="button" data-delete-attachment="${attachment.id}" ${disabledAttr(readOnly)}>削除</button>
            </li>
          `,
        )
        .join("")
    : `<li class="attachment-empty">資料なし</li>`;

  return `
    <div class="attachment-block">
      <div class="attachment-scale-row ${thumbScaleDisabled ? "is-disabled" : ""}">
        <span class="attachment-scale-label">紙面サムネ</span>
        <input
          class="attachment-scale-slider"
          data-item-thumb-scale="${blockIndex}:${itemIndex}"
          type="range"
          min="${ITEM_THUMBNAIL_SCALE_LIMITS.min}"
          max="${ITEM_THUMBNAIL_SCALE_LIMITS.max}"
          step="${ITEM_THUMBNAIL_SCALE_LIMITS.step}"
          value="${thumbScalePercent}"
          ${disabledAttr(thumbScaleDisabled)}
        >
        <span class="attachment-scale-value" data-item-thumb-scale-value="${blockIndex}:${itemIndex}">${escapeHtml(`${thumbScalePercent}%`)}</span>
      </div>
      <div class="attachment-input-grid">
        <label class="upload-dropzone ${uploadDisabled ? "is-disabled" : ""}">
          <input data-upload-item-id="${itemId}" type="file" accept="application/pdf,image/*" ${disabledAttr(uploadDisabled)}>
          <span>${uploadLabel}</span>
        </label>
        <div
          class="attachment-paste-target ${pasteDisabled ? "is-disabled" : ""}"
          data-paste-item-id="${itemId}"
          tabindex="${pasteDisabled ? "-1" : "0"}"
          aria-disabled="${pasteDisabled ? "true" : "false"}"
        >
          <strong>ここで貼り付け</strong>
          <small>${pasteHelp}</small>
        </div>
        <button
          class="ghost-button attachment-clipboard-button"
          type="button"
          data-clipboard-upload-item-id="${itemId}"
          data-paste-item-id="${itemId}"
          ${disabledAttr(pasteDisabled)}
        >
          Clipboardから追加
        </button>
      </div>
      <p class="attachment-hint">${attachmentHint}</p>
      <ul class="attachment-list">${items}</ul>
    </div>
  `;
}

function renderSupplementRows(item, blockIndex, itemIndex, readOnly = issueEditorReadOnly()) {
  if (!item.supplements.length) {
    return `<div class="empty-state empty-state--compact">補足行はまだありません。</div>`;
  }

  return item.supplements
    .map(
      (supplement, supplementIndex) => `
        <div class="supplement-row">
          <div class="supplement-toolbar">
            <span class="supplement-index">補足 ${supplementIndex + 1}</span>
            <div class="block-toolbar-actions">
              <button class="ghost-button" type="button" data-move-supplement="${blockIndex}:${itemIndex}:${supplementIndex}" data-direction="up" ${disabledAttr(readOnly || supplementIndex === 0)}>上へ</button>
              <button class="ghost-button" type="button" data-move-supplement="${blockIndex}:${itemIndex}:${supplementIndex}" data-direction="down" ${disabledAttr(readOnly || supplementIndex === item.supplements.length - 1)}>下へ</button>
              <button class="ghost-button ghost-button--danger" type="button" data-remove-supplement="${blockIndex}:${itemIndex}:${supplementIndex}" ${disabledAttr(readOnly)}>削除</button>
            </div>
          </div>
          <div class="supplement-inputs">
            <select data-item-supplement-field="tone" data-block-index="${blockIndex}" data-item-index="${itemIndex}" data-supplement-index="${supplementIndex}" ${disabledAttr(readOnly)}>
              ${itemSupplementToneOptions(supplement.tone)}
            </select>
            <textarea data-item-supplement-field="content" data-block-index="${blockIndex}" data-item-index="${itemIndex}" data-supplement-index="${supplementIndex}" placeholder="提出先や問い合わせ先など" ${disabledAttr(readOnly)}>${escapeHtml(supplement.content)}</textarea>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderItemCard(block, blockIndex, item, itemIndex, readOnly = issueEditorReadOnly()) {
  const itemIndexLabel = itemHasVisibleContent(item) ? `${itemMarker(itemIndex)} 項目` : "項目";
  return `
    <section class="item-card">
      <div class="item-toolbar">
        <span class="item-index">${itemIndexLabel}</span>
        <div class="block-toolbar-actions">
          <button class="ghost-button" type="button" data-move-item="${blockIndex}:${itemIndex}" data-direction="up" ${disabledAttr(readOnly || itemIndex === 0)}>上へ</button>
          <button class="ghost-button" type="button" data-move-item="${blockIndex}:${itemIndex}" data-direction="down" ${disabledAttr(readOnly || itemIndex === block.items.length - 1)}>下へ</button>
          <button class="ghost-button ghost-button--danger" type="button" data-remove-item="${blockIndex}:${itemIndex}" ${disabledAttr(readOnly)}>削除</button>
        </div>
      </div>
      <div class="form-grid form-grid--block">
        <div class="field field--wide">
          <label>項目見出し</label>
          <input data-item-field="heading" data-block-index="${blockIndex}" data-item-index="${itemIndex}" value="${escapeHtml(item.heading)}" placeholder="例: 令和7年産 水稲〜" ${disabledAttr(readOnly)}>
        </div>
        <div class="field field--wide">
          <label>本文</label>
          <textarea data-item-field="body" data-block-index="${blockIndex}" data-item-index="${itemIndex}" placeholder="記入方法や説明を書きます。" ${disabledAttr(readOnly)}>${escapeHtml(item.body)}</textarea>
        </div>
        <div class="field">
          <label>対象者</label>
          <input data-item-field="audience_label" data-block-index="${blockIndex}" data-item-index="${itemIndex}" value="${escapeHtml(item.audience_label)}" placeholder="全員 / 一部 / 希望者" ${disabledAttr(readOnly)}>
        </div>
        <div class="field">
          <label>期限</label>
          <input data-item-field="due_date" data-block-index="${blockIndex}" data-item-index="${itemIndex}" type="date" value="${escapeHtml(item.due_date)}" ${disabledAttr(readOnly)}>
        </div>
        <div class="field field--wide">
          <label>対象者/期限の並び</label>
          <select data-item-field="meta_layout" data-block-index="${blockIndex}" data-item-index="${itemIndex}" ${disabledAttr(readOnly)}>
            ${itemMetaLayoutOptions(item.meta_layout)}
          </select>
          <p class="field-hint">補足行は常に別行です。ここでは対象者と期限だけを同じ行にするか決めます。</p>
        </div>
        <div class="field field--wide">
          <div class="field-header">
            <label>補足行</label>
            <button class="ghost-button" type="button" data-add-supplement="${blockIndex}:${itemIndex}" ${disabledAttr(readOnly)}>補足行を追加</button>
          </div>
          <div class="supplement-stack">${renderSupplementRows(item, blockIndex, itemIndex, readOnly)}</div>
          <p class="field-hint">赤は提出/注意、青は問い合わせ/補足案内。本文の下に入力順で縦積み表示します。</p>
        </div>
      </div>
      <div class="field">
        <label>資料</label>
        ${renderAttachmentList(item, blockIndex, itemIndex, readOnly)}
      </div>
    </section>
  `;
}

function renderPdfPreviewMarkup({
  title,
  badge,
  emptyCopy,
  downloadLabel = "PDFを出力",
  previewAriaLabel = "PDF プレビュー",
  previewAltPrefix = "PDFプレビュー",
  placeholderMarkup = "",
  statusText = "",
  downloadDisabled = false,
} = {}) {
  const previewStatus =
    statusText ||
    (state.previewPending
      ? "PDF を組版中…"
      : state.previewReadyAt
        ? `更新済み ${escapeHtml(state.previewReadyAt)}`
        : "保存前でも右で案内PDFを確認できます");
  const resolvedPlaceholderMarkup =
    placeholderMarkup || `<p>${escapeHtml(emptyCopy || "ここに生成済みのPDFが表示されます。")}</p>`;

  return `
    <div class="preview-heading">
      <strong>${escapeHtml(title || "印刷プレビュー")}</strong>
      <span class="badge badge--accent">${escapeHtml(badge || "A4固定")}</span>
    </div>
    <div class="pdf-stage">
      <div id="notice-preview-pages" class="pdf-preview-pages" aria-label="${escapeHtml(previewAriaLabel)}">${renderPreviewPagesMarkup(previewAltPrefix)}</div>
      <div class="pdf-stage-placeholder ${state.previewImages.length ? "is-hidden" : ""}" id="notice-preview-placeholder">
        ${resolvedPlaceholderMarkup}
      </div>
      <div class="pdf-stage-overlay ${state.previewPending ? "is-visible" : ""}" id="notice-preview-overlay">PDF を生成しています…</div>
    </div>
    <div class="preview-footer">
      <span class="preview-status" id="notice-preview-status">${previewStatus}</span>
      <div class="preview-actions">
        <button class="ghost-button" type="button" id="refresh-preview-button">再生成</button>
        <button class="primary-button" type="button" id="download-notice-pdf-button" ${downloadDisabled ? "disabled" : ""}>${escapeHtml(downloadLabel)}</button>
      </div>
    </div>
  `;
}

function renderNoticePreviewMarkup() {
  return renderPdfPreviewMarkup({
    title: "印刷プレビュー",
    badge: "A4固定",
    emptyCopy: "ここに生成済みの案内PDFが表示されます。",
    downloadLabel: "案内PDFを出力",
    previewAriaLabel: "常会案内 PDF プレビュー",
    previewAltPrefix: "常会案内プレビュー",
  });
}

function renderTemplateDocumentPreviewMarkup() {
  const previewBlocked = state.templatePreviewMissingBindings.length > 0;
  const placeholderMarkup = previewBlocked
    ? `
        <p>左の契約者入力を埋めると、ここに生成済みの農作業傷害共済 PDF を表示できます。</p>
        <ul class="template-warning-list template-warning-list--preview">
          ${renderTemplatePreviewMissingList()}
        </ul>
      `
    : "";
  return renderPdfPreviewMarkup({
    title: "帳票プレビュー",
    badge: "SVG bind",
    emptyCopy: "ここに生成済みの農作業傷害共済 PDF が表示されます。",
    downloadLabel: "帳票PDFを出力",
    previewAriaLabel: "農作業傷害共済 PDF プレビュー",
    previewAltPrefix: "農作業傷害共済プレビュー",
    placeholderMarkup,
    statusText: previewBlocked ? "必須項目を入力するとプレビューを生成できます" : "",
    downloadDisabled: previewBlocked,
  });
}

function renderPaperFontScaleControls(disabled = false) {
  const rows = PAPER_FONT_SCALE_ORDER.map((category) => {
    const value = state.paperFontScale[category];
    const atMin = value <= PAPER_FONT_SCALE_LIMITS.min;
    const atMax = value >= PAPER_FONT_SCALE_LIMITS.max;
    return `
      <div class="font-scale-row">
        <span class="font-scale-label">${escapeHtml(paperFontScaleLabels[category])}</span>
        <div class="font-scale-actions">
          <button class="ghost-button" type="button" data-font-scale-adjust="${category}:-1" ${disabledAttr(disabled || atMin)}>-</button>
          <span class="font-scale-value">${escapeHtml(`${value}%`)}</span>
          <button class="ghost-button" type="button" data-font-scale-adjust="${category}:1" ${disabledAttr(disabled || atMax)}>+</button>
        </div>
      </div>
    `;
  }).join("");

  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">文字サイズ</h2>
          <p class="card-copy">${escapeHtml(disabled ? "発行済みの案内では変更できません。下書き側でのみ調整してください。" : "紙面そのものの文字倍率です。現在の見た目を 80% 基準として扱い、このブラウザ全体で共有します。")}</p>
        </div>
        <button class="ghost-button" type="button" id="reset-paper-font-scale-button" ${disabledAttr(disabled)}>標準に戻す</button>
      </div>
      <div class="font-scale-grid">${rows}</div>
    </section>
  `;
}

function renderPreviewPagesMarkup(altPrefix = "PDFプレビュー") {
  if (!state.previewImages.length) {
    return "";
  }
  return state.previewImages
    .map(
      (src, index) => `
        <div class="pdf-preview-page">
          <img class="pdf-preview-image" src="${src}" alt="${escapeHtml(`${altPrefix} ${index + 1}ページ目`)}">
        </div>
      `,
    )
    .join("");
}

function renderIssueCards() {
  return state.issues.length
    ? state.issues
        .map((issue) => {
          const editHref = `/issues/${encodeURIComponent(issue.id)}/edit`;
          const deleteDisabled = isIssuePublished(issue);
          const deleteAttributes = deleteDisabled
            ? ' disabled title="発行済みの案内は削除できません"'
            : "";
          const statusLabel = issueStatusLabel(issue.status);
          const statusBadgeClass = issueStatusBadgeClass(issue.status);
          const entryLabel = issuePrimaryLinkLabel(issue);
          return `
            <article class="issue-card">
              <div class="issue-card-head">
                <div>
                  <h2 class="issue-card-title">${escapeHtml(issue.title)}</h2>
                  <div class="issue-card-meta">
                    <span class="badge badge--accent">${escapeHtml(issueTypeLabels[issue.issue_type] || issue.issue_type)}</span>
                    <span class="badge ${statusBadgeClass}">${escapeHtml(statusLabel)}</span>
                  </div>
                </div>
                <span class="issue-card-stat">${escapeHtml(monthLabel(issue.issue_month ? issue.issue_month.slice(0, 7) : ""))}</span>
              </div>
              <p class="issue-card-copy">場所: ${escapeHtml(issue.place || "未設定")} / ブロック数: ${issue.block_count}</p>
              <div class="issue-card-footer">
                <span class="issue-card-stat">${escapeHtml(issuePublishedStat(issue))}</span>
                <div class="issue-card-actions">
                  <a class="issue-link" href="${editHref}">${entryLabel}</a>
                  <button class="ghost-button" type="button" data-duplicate-issue="${escapeHtml(issue.id)}">複製</button>
                  <button class="ghost-button ghost-button--danger" type="button" data-delete-issue="${escapeHtml(issue.id)}"${deleteAttributes}>削除</button>
                </div>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">まだ案内はありません。左の作成ボタンから最初の号を起こしてください。</div>`;
}

function renderIssueThumbnailCards() {
  return state.issues.length
    ? state.issues
        .map((issue) => {
          const editHref = `/issues/${encodeURIComponent(issue.id)}/edit`;
          const month = monthLabel(issue.issue_month ? issue.issue_month.slice(0, 7) : "");
          const entryLabel = issuePrimaryLinkLabel(issue);
          const statusLabel = issueStatusLabel(issue.status);
          return `
            <article class="issue-thumb-tile">
              <div class="issue-thumb-caption">
                <div class="issue-thumb-copy">
                  <p class="issue-thumb-kicker">${escapeHtml(`${month} / ${statusLabel}`)}</p>
                  <h3 class="issue-thumb-title">${escapeHtml(issue.title)}</h3>
                </div>
                <a class="issue-link issue-thumb-edit" href="${editHref}">${entryLabel}</a>
              </div>
              <a class="issue-thumb-media ${issue.thumbnail_url ? "" : "has-error"}" href="${editHref}" data-issue-thumb-media>
                ${
                  issue.thumbnail_url
                    ? `<img class="issue-thumb-image" data-issue-thumbnail loading="lazy" decoding="async" src="${escapeHtml(issue.thumbnail_url)}" alt="${escapeHtml(`${issue.title || "案内"} の1ページ目サムネ`)}">`
                    : ""
                }
                <span class="issue-thumb-placeholder issue-thumb-placeholder--loading">紙面を読込中</span>
                <span class="issue-thumb-placeholder issue-thumb-placeholder--error">サムネを表示できません</span>
              </a>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">まだ案内はありません。左の作成ボタンから最初の号を起こしてください。</div>`;
}

function renderIssueListModeToggle() {
  return `
    <div class="view-mode-toggle" role="group" aria-label="既存の案内の表示モード">
      ${[
        ["thumb", "サムネ表示"],
        ["detail", "詳細表示"],
      ]
        .map(
          ([value, label]) => `
            <button
              class="view-mode-button ${state.issueListMode === value ? "is-active" : ""}"
              type="button"
              aria-pressed="${state.issueListMode === value ? "true" : "false"}"
              data-issue-list-mode="${value}"
            >${label}</button>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderTemplateDocumentCards() {
  const documents = state.templateDocuments.filter(
    (document) => document.document_family === SHOGAI_KYOSAI_FAMILY_KEY,
  );
  return documents.length
    ? documents
        .map((document) => `
          <article class="issue-card issue-card--template">
            <div class="issue-card-head">
              <div>
                <h2 class="issue-card-title">${escapeHtml(document.title)}</h2>
                <div class="issue-card-meta">
                  <span class="badge badge--accent">${escapeHtml(familyDefinition(document.document_family).label)}</span>
                  <span class="badge badge--draft">${escapeHtml(templateLabel(document.document_family, document.template_key))}</span>
                </div>
              </div>
              <span class="issue-card-stat">${escapeHtml(document.template_version)}</span>
            </div>
            <p class="issue-card-copy">テンプレ: ${escapeHtml(document.template_asset_path)} / 入力済み: ${escapeHtml(`${document.row_count || 0}件`)} / 更新: ${escapeHtml(document.updated_at || "未保存")}</p>
            <div class="issue-card-footer">
              <span class="issue-card-stat">${escapeHtml(document.status)}</span>
              <div class="issue-card-actions">
                <a class="issue-link" href="${templateDocumentEditUrl(document.id)}">編集へ</a>
                <button class="ghost-button ghost-button--danger" type="button" data-delete-template-document="${escapeHtml(document.id)}">削除</button>
              </div>
            </div>
          </article>
        `)
        .join("")
    : `<div class="empty-state">まだ帳票はありません。左の作成ボタンから最初の帳票を起こしてください。</div>`;
}

function renderIssueFamilyPanel() {
  const isThumbMode = state.issueListMode === "thumb";
  const issueListMarkup = isThumbMode ? renderIssueThumbnailCards() : renderIssueCards();
  return `
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
          <div class="panel-heading panel-heading--issues">
            <div>
              <h2 class="section-title">既存の案内</h2>
              <p class="section-copy">サムネで紙面を見渡すか、詳細で管理操作まで見るかを切り替えられます。</p>
            </div>
            ${renderIssueListModeToggle()}
          </div>
          <div class="${isThumbMode ? "issue-thumb-grid" : "list-grid"}" data-issue-list-surface="${isThumbMode ? "thumb" : "detail"}">${issueListMarkup}</div>
        </div>
      </div>
    </section>
  `;
}

function renderTemplateFamilyPanel() {
  const templates = familyTemplateDefinitions(SHOGAI_KYOSAI_FAMILY_KEY);
  return `
    <section class="workspace index-layout">
      <div class="panel">
        <div class="panel-inner">
          <h2 class="section-title">新しい帳票を起こす</h2>
          <p class="section-copy">テンプレ固定の SVG 帳票へ契約者行を積み上げ、1行1ページの PDF をまとめて出します。</p>
          <div class="create-grid">
            ${templates
              .map(
                (definition) => `
                  <button class="create-button" data-create-template-document="${escapeHtml(definition.template_key)}">
                    <strong>${escapeHtml(definition.label)}</strong>
                    <span>テンプレ版 ${escapeHtml(definition.template_version)} / SVG 正本 ${escapeHtml(definition.template_asset_path)}</span>
                  </button>
                `,
              )
              .join("")}
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-inner">
          <h2 class="section-title">既存の帳票</h2>
          <p class="section-copy">契約者行を保持しながら、複数ページの SVG bind プレビューと PDF 出力を繰り返せます。</p>
          <div class="list-grid">${renderTemplateDocumentCards()}</div>
        </div>
      </div>
    </section>
  `;
}

function renderIndex() {
  const activeFamily = selectedIndexFamily();
  const family = familyDefinition(activeFamily);

  app.innerHTML = `
    <main class="shell">
      <header class="masthead">
        <div class="brand-block">
          <span class="eyebrow">JOKAI COMPOSER</span>
          <h1 class="page-title">文書ファミリーを選ぶ</h1>
          <p class="page-lead">常会案内と農作業傷害共済を同じアプリで管理しつつ、保存モデルは混ぜない方針です。</p>
        </div>
        <aside class="status-panel">
          <div class="status-grid">
            <div class="status-kv">
              <span class="status-label">Database</span>
              <span class="status-value">${escapeHtml(state.meta?.database_url || "読込中")}</span>
            </div>
            <div class="status-kv">
              <span class="status-label">Runtime Temp</span>
              <span class="status-value">${escapeHtml(state.meta?.runtime_dir || "読込中")}</span>
            </div>
            <div class="status-kv">
              <span class="status-label">Migrations</span>
              <span class="status-value">${escapeHtml((state.meta?.applied_migrations || []).join(", ") || "なし")}</span>
            </div>
          </div>
        </aside>
      </header>

      <section class="family-switcher">
        <div class="family-tabs" role="tablist" aria-label="文書ファミリー">
          ${[ISSUE_FAMILY_KEY, SHOGAI_KYOSAI_FAMILY_KEY]
            .map((familyKey) => {
              const definition = familyDefinition(familyKey);
              const selected = familyKey === activeFamily;
              return `
                <button
                  class="family-tab ${selected ? "is-active" : ""}"
                  type="button"
                  role="tab"
                  aria-selected="${selected ? "true" : "false"}"
                  data-family-tab="${escapeHtml(familyKey)}"
                >
                  <strong>${escapeHtml(definition.label)}</strong>
                  <span>${escapeHtml(definition.lead)}</span>
                </button>
              `;
            })
            .join("")}
        </div>
        <div class="family-hero">
          <span class="eyebrow">${escapeHtml(family.eyebrow)}</span>
          <h2 class="section-title">${escapeHtml(family.label)}</h2>
          <p class="section-copy">${escapeHtml(family.lead)}</p>
        </div>
      </section>

      ${state.error ? `<div class="flash flash--error">${escapeHtml(state.error)}</div>` : ""}
      ${state.notice ? `<div class="flash flash--info">${escapeHtml(state.notice)}</div>` : ""}

      ${activeFamily === ISSUE_FAMILY_KEY ? renderIssueFamilyPanel() : renderTemplateFamilyPanel()}
    </main>
  `;

  app.querySelectorAll("[data-family-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextFamily = normalizeFamilyKey(button.getAttribute("data-family-tab"));
      state.activeFamily = nextFamily;
      window.history.replaceState(null, "", familyIndexPath(nextFamily));
      renderIndex();
    });
  });

  app.querySelectorAll("[data-issue-list-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.issueListMode = normalizeIssueListMode(button.getAttribute("data-issue-list-mode"));
      persistIssueListMode();
      renderIndex();
    });
  });

  bindIssueThumbnailEvents(app);

  app.querySelectorAll("[data-create-issue]").forEach((button) => {
    button.addEventListener("click", async () => {
      const issueType = button.getAttribute("data-create-issue");
      await createIssue(issueType);
    });
  });

  app.querySelectorAll("[data-duplicate-issue]").forEach((button) => {
    button.addEventListener("click", async () => {
      const issueId = button.getAttribute("data-duplicate-issue");
      if (!issueId) {
        return;
      }
      await duplicateIssue(issueId);
    });
  });

  app.querySelectorAll("[data-delete-issue]").forEach((button) => {
    button.addEventListener("click", async () => {
      const issueId = button.getAttribute("data-delete-issue");
      if (!issueId || button.disabled) {
        return;
      }
      await deleteIssue(issueId);
    });
  });

  app.querySelectorAll("[data-create-template-document]").forEach((button) => {
    button.addEventListener("click", async () => {
      const templateKey = button.getAttribute("data-create-template-document");
      await createTemplateDocument(SHOGAI_KYOSAI_FAMILY_KEY, templateKey);
    });
  });

  app.querySelectorAll("[data-delete-template-document]").forEach((button) => {
    button.addEventListener("click", async () => {
      const templateDocumentId = button.getAttribute("data-delete-template-document");
      if (!templateDocumentId) {
        return;
      }
      await deleteTemplateDocument(templateDocumentId);
    });
  });
}

function bindIssueThumbnailEvents(root = document) {
  root.querySelectorAll("[data-issue-thumbnail]").forEach((image) => {
    const media = image.closest("[data-issue-thumb-media]");
    if (!media) {
      return;
    }
    const markReady = () => {
      media.classList.add("is-ready");
      media.classList.remove("has-error");
    };
    const markError = () => {
      media.classList.add("has-error");
      media.classList.remove("is-ready");
    };
    image.addEventListener("load", markReady, { once: true });
    image.addEventListener("error", markError, { once: true });
    if (image.complete) {
      if (image.naturalWidth > 0) {
        markReady();
      } else {
        markError();
      }
    }
  });
}

function renderEditor(skipPreview = false) {
  if (!state.issue) {
    renderLoading("編集画面を準備中です", "対象の号を取得しています。");
    return;
  }

  const issue = state.issue;
  const editorReadOnly = issueEditorReadOnly(issue);
  const blockMarkup = state.blocks.length
    ? state.blocks
        .map(
          (block, index) => `
            <section class="block-card">
              <div class="block-toolbar">
                <span class="block-index">${index + 1}. ${escapeHtml(block.heading || blockKindLabels[block.block_kind] || "大項目")}</span>
                <div class="block-toolbar-actions">
                  <button class="ghost-button" type="button" data-move-block="${index}" data-direction="up" ${disabledAttr(editorReadOnly || index === 0)}>上へ</button>
                  <button class="ghost-button" type="button" data-move-block="${index}" data-direction="down" ${disabledAttr(editorReadOnly || index === state.blocks.length - 1)}>下へ</button>
                  <button class="ghost-button ghost-button--danger" type="button" data-remove-block="${index}" ${disabledAttr(editorReadOnly)}>削除</button>
                </div>
              </div>
              <div class="form-grid form-grid--block">
                <div class="field">
                  <label>SECTION KIND</label>
                  <select data-block-field="block_kind" data-block-index="${index}" ${disabledAttr(editorReadOnly)}>
                    ${blockKindOptions(block.block_kind)}
                  </select>
                </div>
                <div class="field field--wide">
                  <label>大項目見出し</label>
                  <input data-block-field="heading" data-block-index="${index}" value="${escapeHtml(block.heading)}" placeholder="例: 9月度提出物 / 配布物" ${disabledAttr(editorReadOnly)}>
                </div>
              </div>
              <div class="block-items">
                <div class="item-list-header">
                  <strong>小項目</strong>
                  <button class="ghost-button" type="button" data-add-item="${index}" ${disabledAttr(editorReadOnly)}>項目を追加</button>
                </div>
                <div class="item-stack">
                  ${
                    block.items.length
                      ? block.items.map((item, itemIndex) => renderItemCard(block, index, item, itemIndex, editorReadOnly)).join("")
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
          <h1 class="page-title">${escapeHtml(editorReadOnly ? "常会案内を閲覧する" : "常会案内を編集する")}</h1>
          <p class="page-lead">${escapeHtml(editorReadOnly ? "この号は発行済みです。内容確認と印刷はできますが、修正は複製した新しい下書きで行います。" : "右側の A4 正本プレビューは、実際に生成した案内PDFそのものです。")}</p>
        </div>
        <aside class="status-panel status-panel--editor">
          <div class="status-grid status-grid--editor">
            <div class="status-kv">
              <span class="status-label">Issue</span>
              <span class="status-value">${escapeHtml(issue.id)}</span>
            </div>
            <div class="status-kv">
              <span class="status-label">State</span>
              <span class="status-value" id="save-state-text">${escapeHtml(editorSaveStateText())}</span>
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
          ${renderIssueNavigationLink(state.issueNavigation.newer, "newer")}
          ${renderIssueNavigationLink(state.issueNavigation.older, "older")}
          <span class="badge badge--accent">${escapeHtml(issueTypeLabels[issue.issue_type] || issue.issue_type)}</span>
          <span class="badge ${issueStatusBadgeClass(issue.status)}">${escapeHtml(issueStatusLabel(issue.status))}</span>
          <span class="issue-card-stat">${escapeHtml(issuePublishedStat(issue))}</span>
        </div>
        <div class="editor-actions-group editor-actions-group--primary">
          <a class="ghost-link" href="/issues/${escapeHtml(issue.id)}/print" target="_blank" rel="noreferrer">印刷画面</a>
          <button class="ghost-button" type="button" id="reload-issue-button">再読込</button>
          ${
            editorReadOnly
              ? '<button class="primary-button" type="button" id="duplicate-issue-button">複製して編集</button>'
              : `
                  <button class="ghost-button" type="button" id="publish-issue-button" ${disabledAttr(state.saving || state.publishing)}>発行する</button>
                  <button class="primary-button" type="button" id="save-issue-button" ${disabledAttr(state.saving || state.publishing)}>保存する</button>
                `
          }
        </div>
      </div>

      ${state.error ? `<div class="flash flash--error">${escapeHtml(state.error)}</div>` : ""}
      ${state.notice ? `<div class="flash flash--info">${escapeHtml(state.notice)}</div>` : ""}
      ${renderIssueReadonlyBanner(issue)}

      <section class="workspace editor-layout">
        <div class="editor-column">
          <section class="card">
            <h2 class="card-title">号の骨格</h2>
            <p class="card-copy">タイトル、日時、場所、注記。ここが紙面の印象を決めます。</p>
            <div class="form-grid">
              <div class="issue-meta-row">
                <div class="field">
                  <label>ISSUE TYPE</label>
                  <select data-issue-field="issue_type" ${disabledAttr(editorReadOnly)}>${issueTypeOptions(issue.issue_type)}</select>
                </div>
                <div class="field">
                  <label>対象月</label>
                  <input data-issue-field="issue_month" type="month" value="${escapeHtml(issue.issue_month)}" ${disabledAttr(editorReadOnly)}>
                </div>
                <div class="field">
                  <label>開催日</label>
                  <input data-issue-field="meeting_date" type="date" value="${escapeHtml(issue.meeting_date)}" ${disabledAttr(editorReadOnly)}>
                </div>
                <div class="field">
                  <label>開始時刻</label>
                  <input data-issue-field="meeting_time" type="time" value="${escapeHtml(issue.meeting_time)}" ${disabledAttr(editorReadOnly)}>
                </div>
              </div>
              <div class="field field--wide">
                <label>タイトル</label>
                <input data-issue-field="title" value="${escapeHtml(issue.title)}" placeholder="例: 平古場生産組合 常会の案内" ${disabledAttr(editorReadOnly)}>
              </div>
              <div class="field field--wide">
                <label>議題見出し</label>
                <input data-issue-field="agenda_label" value="${escapeHtml(issue.agenda_label)}" placeholder="例: 常会事項 / 総会事項" ${disabledAttr(editorReadOnly)}>
              </div>
              <div class="field field--wide">
                <label>場所</label>
                <input data-issue-field="place" value="${escapeHtml(issue.place)}" placeholder="例: 平古場自治公民館" ${disabledAttr(editorReadOnly)}>
              </div>
              <div class="field field--wide">
                <label>上部注記</label>
                <textarea data-issue-field="header_note" placeholder="田祈祷、忘年会、開始時刻の訂正など" ${disabledAttr(editorReadOnly)}>${escapeHtml(issue.header_note)}</textarea>
              </div>
              <div class="field field--wide">
                <label>最終ページ左下メモ</label>
                <textarea data-issue-field="footer_note" placeholder="★提出書類は、常会当日か10月25日(土)までに、組合長に提出して下さい" ${disabledAttr(editorReadOnly)}>${escapeHtml(issue.footer_note)}</textarea>
                <p class="field-hint">最終ページだけに表示されます。右下の連絡先「平古場生産組合 / 組合長 古川 豊 / ☎090-7581-7819」は毎回自動で入ります。</p>
              </div>
            </div>
          </section>

          ${renderPaperFontScaleControls(editorReadOnly)}

          <section class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">本文セクション</h2>
                <p class="card-copy">大項目の下に複数の小項目を持たせ、各小項目ごとに右脇サムネを付けます。</p>
              </div>
              <div class="add-row">
                <button class="ghost-button" type="button" data-add-block="agenda" ${disabledAttr(editorReadOnly)}>議題</button>
                <button class="ghost-button" type="button" data-add-block="submission" ${disabledAttr(editorReadOnly)}>提出物</button>
                <button class="ghost-button" type="button" data-add-block="distribution" ${disabledAttr(editorReadOnly)}>配布物</button>
                <button class="ghost-button" type="button" data-add-block="info" ${disabledAttr(editorReadOnly)}>案内事項</button>
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
  if (!skipPreview) {
    schedulePreview("render-editor");
  }
}

function renderTemplateLedgerRow(document, definition, row, rowIndex, rowIssues = []) {
  const rowFilled = templateRowHasAnyValue(document.document_family, document.template_key, row);
  const issueSummary = rowIssues.map((issue) => issue.description).join(" / ");
  return `
    <article class="template-ledger-card ${rowIssues.length ? "is-invalid" : ""}">
      <div class="template-ledger-row">
        <div class="template-row-stamp">
          <strong>${rowIndex + 1}</strong>
          <small>${rowFilled ? "入力中" : "空欄"}</small>
        </div>
        ${definition.bindings
          .map(
            (binding) => `
              <label class="template-ledger-cell" data-cell-key="${escapeHtml(binding.key)}">
                <span class="template-ledger-mobile-label">${escapeHtml(binding.description)}</span>
                <input
                  type="text"
                  aria-label="${escapeHtml(binding.description)}"
                  inputmode="${escapeHtml(binding.inputmode || "text")}"
                  placeholder="${escapeHtml(binding.placeholder || binding.description)}"
                  value="${escapeHtml(row[binding.key] || "")}"
                  data-template-row-index="${rowIndex}"
                  data-template-row-field="${escapeHtml(binding.key)}"
                >
              </label>
            `,
          )
          .join("")}
        <button
          class="ghost-button ghost-button--danger template-row-remove"
          type="button"
          data-remove-template-row="${rowIndex}"
          aria-label="${escapeHtml(`${rowIndex + 1}行目を削除`)}"
        >
          -
        </button>
      </div>
      ${
        rowIssues.length
          ? `
            <div class="template-row-note">
              <strong>${escapeHtml(`${rowIssues.length}項目不足`)}</strong>
              <span>${escapeHtml(issueSummary)}</span>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderTemplateLedgerMarkup(document, definition) {
  const rows = templateDocumentRows(document);
  const issuesByRow = templatePreviewIssuesByRow();
  if (!rows.length) {
    return `
      <div class="empty-state empty-state--compact template-ledger-empty">
        <p>まだ契約者行がありません。追加してから一括 PDF を組み立てます。</p>
        <button class="primary-button" type="button" data-add-template-row>1件目を追加</button>
      </div>
    `;
  }

  return `
    <div class="template-ledger-scroll">
      <div class="template-ledger-head" aria-hidden="true">
        <span>行</span>
        ${definition.bindings.map((binding) => `<span>${escapeHtml(binding.description)}</span>`).join("")}
        <span>削除</span>
      </div>
      <div class="template-ledger-body">
        ${rows
          .map((row, rowIndex) =>
            renderTemplateLedgerRow(document, definition, row, rowIndex, issuesByRow.get(rowIndex) || []),
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderTemplateDocumentEditor(skipPreview = false) {
  if (!state.templateDocument) {
    renderLoading("帳票編集画面を準備中です", "対象の帳票を取得しています。");
    return;
  }

  const document = state.templateDocument;
  const definition = templateDefinition(document.document_family, document.template_key);
  const rows = templateDocumentRows(document);
  const activeRowCount = templateDocumentRowCount(document);
  const invalidRowCount = templatePreviewInvalidRowCount();
  const bindingRows = definition.bindings
    .map(
      (binding) => `
        <div class="binding-row">
          <code>${escapeHtml(binding.key)}</code>
          <span>${escapeHtml(binding.description)}</span>
        </div>
      `,
    )
    .join("");

  app.innerHTML = `
    <main class="shell shell--wide shell--editor">
      <header class="masthead masthead--editor">
        <div class="brand-block">
          <span class="eyebrow">TEMPLATE EDITOR</span>
          <h1 class="page-title">農作業傷害共済を編集する</h1>
          <p class="page-lead">左で契約者行を積み上げ、右で 1行1ページの実PDFをまとめて確認します。</p>
        </div>
        <aside class="status-panel status-panel--editor">
          <div class="status-grid status-grid--editor">
            <div class="status-kv">
              <span class="status-label">Document</span>
              <span class="status-value">${escapeHtml(document.id)}</span>
            </div>
            <div class="status-kv">
              <span class="status-label">State</span>
              <span class="status-value" id="save-state-text">${state.saving ? "保存中…" : state.dirty ? "未保存の変更あり" : "保存済み"}</span>
            </div>
            <div class="status-kv">
              <span class="status-label">Template</span>
              <span class="status-value">${escapeHtml(`${definition.label} / ${document.template_version}`)}</span>
            </div>
          </div>
        </aside>
      </header>

      <div class="editor-actions">
        <div class="editor-actions-group">
          <a class="ghost-link" href="/template-documents">一覧へ戻る</a>
          <span class="badge badge--accent">${escapeHtml(familyDefinition(document.document_family).label)}</span>
          <span class="badge badge--draft">${escapeHtml(definition.label)}</span>
        </div>
        <div class="editor-actions-group editor-actions-group--primary">
          <a class="ghost-link" href="${templateDocumentPrintUrl(document.id)}" target="_blank" rel="noreferrer">印刷画面</a>
          <button class="ghost-button" type="button" id="reload-template-document-button">再読込</button>
          <button class="primary-button" type="button" id="save-template-document-button">保存する</button>
        </div>
      </div>

      ${state.error ? `<div class="flash flash--error">${escapeHtml(state.error)}</div>` : ""}
      <div id="template-preview-warning-flash">${state.warning ? `<div class="flash flash--warning">${escapeHtml(state.warning)}</div>` : ""}</div>
      ${state.notice ? `<div class="flash flash--info">${escapeHtml(state.notice)}</div>` : ""}

      <section class="workspace editor-layout editor-layout--template">
        <div class="editor-column">
          <section class="card template-summary-card">
            <div class="card-header">
              <div>
                <h2 class="card-title">帳票の骨格</h2>
                <p class="card-copy">タイトルは PDF 出力日と入力済み件数で自動命名します。1行でも必須漏れがあると一括出力は止まります。</p>
              </div>
              <span class="badge badge--accent" id="template-row-count-badge">${escapeHtml(`${activeRowCount}件入力済み`)}</span>
            </div>
            <div class="template-summary-hero">
              <div class="template-summary-copy">
                <span class="status-label">AUTO TITLE</span>
                <strong class="template-auto-title" id="template-auto-title">${escapeHtml(document.title)}</strong>
              </div>
              <div class="template-kpi-grid">
                <div class="template-kpi-card">
                  <span>全行</span>
                  <strong id="template-total-rows">${rows.length}</strong>
                </div>
                <div class="template-kpi-card">
                  <span>入力済み</span>
                  <strong id="template-active-rows">${activeRowCount}</strong>
                </div>
                <div class="template-kpi-card ${invalidRowCount ? "is-warning" : ""}" id="template-invalid-rows-card">
                  <span>要補完</span>
                  <strong id="template-invalid-rows">${invalidRowCount}</strong>
                </div>
              </div>
            </div>
            <div class="form-grid">
              <div class="field">
                <label>ファミリー</label>
                <input value="${escapeHtml(familyDefinition(document.document_family).label)}" disabled>
              </div>
              <div class="field">
                <label>テンプレ</label>
                <input value="${escapeHtml(definition.label)}" disabled>
              </div>
              <div class="field">
                <label>SVG 正本</label>
                <input value="${escapeHtml(document.template_asset_path)}" disabled>
              </div>
              <div class="field">
                <label>版</label>
                <input value="${escapeHtml(document.template_version)}" disabled>
              </div>
            </div>
          </section>

          <section class="card template-ledger-panel">
            <div class="card-header">
              <div>
                <h2 class="card-title">契約者入力</h2>
                <p class="card-copy">下の 1 行がそのまま PDF 1 ページになります。右端の <code>-</code> で削除、上の追加で行を増やします。</p>
              </div>
              <div class="editor-actions-group">
                <button class="ghost-button" type="button" id="reset-template-payload-button">行を初期化</button>
                <button class="primary-button" type="button" data-add-template-row>契約者を追加</button>
              </div>
            </div>
            <div id="template-payload-warning">${renderTemplatePayloadWarningMarkup()}</div>
            ${renderTemplateLedgerMarkup(document, definition)}
          </section>

          <section class="card">
            <div class="card-header">
              <div>
                <h2 class="card-title">詳細 JSON</h2>
                <p class="card-copy">フォームと同じ内容です。必要なときだけ直接調整できます。</p>
              </div>
              <span class="badge badge--draft">advanced</span>
            </div>
            <div class="field field--wide">
              <label>PAYLOAD JSON</label>
              <textarea id="template-document-payload" class="json-editor" spellcheck="false">${escapeHtml(state.templatePayloadText)}</textarea>
              <p class="field-hint">最上位は object 固定です。通常は上の契約者入力を使ってください。</p>
            </div>
          </section>

          <section class="card">
            <h2 class="card-title">binding キー</h2>
            <p class="card-copy">この v1 は SVG 上で見えている <code>$...</code> 箇所だけを bind 対象にしています。</p>
            <div class="binding-grid">${bindingRows}</div>
          </section>
        </div>

        <aside class="preview-column">
          <section class="preview-panel">
            ${renderTemplateDocumentPreviewMarkup()}
          </section>
        </aside>
      </section>
    </main>
  `;

  bindTemplateDocumentEvents();
  if (!skipPreview) {
    schedulePreview("render-template-editor");
  }
}

function renderPrintPage(skipPreview = false) {
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
  if (!skipPreview) {
    schedulePreview("render-print");
  }
}

function renderTemplateDocumentPrintPage(skipPreview = false) {
  if (!state.templateDocument) {
    renderLoading("印刷紙面を準備中です", "保存済みの帳票を読込んでいます。");
    return;
  }

  const document = state.templateDocument;
  const activeRowCount = templateDocumentRowCount(document);
  app.innerHTML = `
    <main class="print-shell-app">
      <header class="print-header">
        <div>
          <span class="eyebrow">TEMPLATE PRINT</span>
          <h1 class="print-title">${escapeHtml(document.title || "農作業傷害共済")}</h1>
          <p class="print-copy">${escapeHtml(templateLabel(document.document_family, document.template_key))} / ${escapeHtml(document.template_version)} / ${escapeHtml(`${activeRowCount}ページ予定`)}</p>
        </div>
        <div class="preview-actions">
          <a class="ghost-link" href="${templateDocumentEditUrl(document.id)}">編集へ戻る</a>
        </div>
      </header>
      <section class="print-preview-panel">
        ${renderTemplateDocumentPreviewMarkup()}
      </section>
    </main>
  `;

  bindPrintEvents();
  if (!skipPreview) {
    schedulePreview("render-template-print");
  }
}

function updatePreviewDom() {
  const pages = document.querySelector("#notice-preview-pages");
  const placeholder = document.querySelector("#notice-preview-placeholder");
  const overlay = document.querySelector("#notice-preview-overlay");
  const status = document.querySelector("#notice-preview-status");
  const templatePreviewBlocked =
    (boot.view === "template-edit" || boot.view === "template-print") &&
    state.templatePreviewMissingBindings.length > 0;

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
      : templatePreviewBlocked
        ? "必須項目を入力するとプレビューを生成できます"
        : state.previewReadyAt
          ? `更新済み ${state.previewReadyAt}`
          : "保存前でも右で案内PDFを確認できます";
  }
  updateTemplatePreviewWarningDom();
}

async function rasterizePreview(bytes, { useIssuePreviewCache = true } = {}) {
  const formData = new FormData();
  formData.append("file", new Blob([bytes], { type: "application/pdf" }), "preview.pdf");
  if (!state.dirty && state.issue?.id) {
    formData.append("cache_issue_id", state.issue.id);
    formData.append("cache_font_scale_key", currentIssuePreviewFontScaleCacheKey());
    if (!useIssuePreviewCache) {
      formData.append("cache_bypass", "1");
    }
  }
  return api("/api/preview-renders", {
    method: "POST",
    body: formData,
  });
}

function currentIssuePreviewFontScaleCacheKey(fontScale = state.paperFontScale) {
  const normalized = normalizePaperFontScale(fontScale);
  return PAPER_FONT_SCALE_ORDER
    .map((category) => `${category}:${normalized[category]}`)
    .join("|");
}

async function fetchCachedIssuePreviewImages(issueId = state.issue?.id || boot.issueId) {
  if (!issueId) {
    return { images: [] };
  }
  return api(
    `/api/issues/${encodeURIComponent(issueId)}/preview-cache?font_scale_key=${encodeURIComponent(currentIssuePreviewFontScaleCacheKey())}`,
  );
}

async function hydrateCachedIssuePreview(issueId = state.issue?.id || boot.issueId) {
  if (!issueId) {
    state.previewImages = [];
    state.previewReadyAt = "";
    return false;
  }
  try {
    const preview = await fetchCachedIssuePreviewImages(issueId);
    const images = Array.isArray(preview.images) ? preview.images : [];
    state.previewImages = images;
    state.previewReadyAt = images.length
      ? new Date().toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "";
    return images.length > 0;
  } catch {
    state.previewImages = [];
    state.previewReadyAt = "";
    return false;
  }
}

async function fetchTemplateDocumentPreviewImages(templateDocumentId = state.templateDocument?.id || boot.templateDocumentId) {
  return api(`/api/template-documents/${encodeURIComponent(templateDocumentId)}/preview-images`);
}

async function fetchTemplateDocumentPdfBytes(templateDocumentId = state.templateDocument?.id || boot.templateDocumentId) {
  return apiBinary(`/api/template-documents/${encodeURIComponent(templateDocumentId)}/print-pdf`);
}

function schedulePreview(reason = "") {
  const previewableView =
    boot.view === "edit" ||
    boot.view === "print" ||
    boot.view === "template-edit" ||
    boot.view === "template-print";
  if (!previewableView) {
    return;
  }
  if (!state.issue && !state.templateDocument) {
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
  if (!state.issue && !state.templateDocument) {
    return;
  }

  const isTemplatePreview = boot.view === "template-edit" || boot.view === "template-print";
  state.previewPending = true;
  updatePreviewDom();
  const generation = ++state.previewGeneration;

  try {
    let bytes;
    if (isTemplatePreview) {
      const payload = parseTemplatePayloadText();
      if (boot.view === "template-edit" && state.dirty) {
        const saved = await saveTemplateDocumentEditor({
          renderBefore: false,
          renderAfter: false,
          noticeMessage: "",
          clearNotice: true,
        });
        if (!saved) {
          state.previewPending = false;
          renderTemplateDocumentEditor(true);
          return;
        }
      }
      const missingBindings = missingTemplatePayloadKeys(
        state.templateDocument.document_family,
        state.templateDocument.template_key,
        payload,
      );
      if (missingBindings.length) {
        if (generation !== state.previewGeneration) {
          return;
        }
        applyTemplatePreviewWarning(missingBindings, state.templateDocument);
        clearPreviewErrorMessage();
        state.previewPending = false;
        state.previewBytes = null;
        state.previewImages = [];
        state.previewReadyAt = "";
        if (boot.view === "template-edit") {
          renderTemplateDocumentEditor(true);
        } else {
          renderTemplateDocumentPrintPage(true);
        }
        return;
      }
      clearTemplatePreviewWarning();
      const preview = await fetchTemplateDocumentPreviewImages();
      if (generation !== state.previewGeneration) {
        return;
      }
      state.previewBytes = null;
      state.previewImages = Array.isArray(preview.images) ? preview.images : [];
      state.previewPending = false;
      state.previewReadyAt = new Date().toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      clearPreviewErrorMessage();
      updatePreviewDom();

      if (forceDownload) {
        const pdfBytes = await fetchTemplateDocumentPdfBytes();
        if (generation !== state.previewGeneration) {
          return;
        }
        downloadBytes(pdfBytes, currentPdfFileName());
      }
      return;
    } else {
      ({ bytes } = await buildNoticePdfDocument(state.issue, state.blocks, state.paperFontScale));
    }
    if (generation !== state.previewGeneration) {
      return;
    }

    clearTemplatePreviewWarning();
    state.previewBytes = bytes;
    const preview = await rasterizePreview(bytes, {
      useIssuePreviewCache: reason !== "manual-refresh",
    });
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
    clearPreviewErrorMessage();
    updatePreviewDom();

    if (forceDownload) {
      downloadBytes(bytes, currentPdfFileName());
    }
  } catch (error) {
    if (generation !== state.previewGeneration) {
      return;
    }
    clearTemplatePreviewWarning();
    state.previewPending = false;
    state.previewImages = [];
    state.error = `プレビュー生成に失敗しました: ${error.message}`;
    updatePreviewDom();
    if (boot.view === "edit") {
      renderEditor();
    } else if (boot.view === "template-edit") {
      renderTemplateDocumentEditor(true);
    } else if (boot.view === "print") {
      renderPrintPage();
    } else if (boot.view === "template-print") {
      renderTemplateDocumentPrintPage(true);
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

function currentPdfFileName() {
  if (!state.templateDocument) {
    return pdfFileName(state.issue);
  }
  try {
    return templateDocumentPdfFileName(state.templateDocument, parseTemplatePayloadText());
  } catch {
    return templateDocumentPdfFileName(state.templateDocument, state.templateDocument.payload);
  }
}

async function downloadNoticePdf() {
  if (state.templateDocument) {
    let payload;
    try {
      payload = parseTemplatePayloadText();
    } catch (error) {
      clearTemplatePreviewWarning();
      state.error = error.message;
      renderTemplateDocumentEditor(true);
      return;
    }
    if (state.dirty) {
      const saved = await saveTemplateDocumentEditor({
        renderBefore: false,
        renderAfter: false,
        noticeMessage: "",
        clearNotice: true,
      });
      if (!saved) {
        renderTemplateDocumentEditor(true);
        return;
      }
    }
    const missingBindings = missingTemplatePayloadKeys(
      state.templateDocument.document_family,
      state.templateDocument.template_key,
      payload,
    );
    if (missingBindings.length) {
      applyTemplatePreviewWarning(missingBindings, state.templateDocument);
      renderTemplateDocumentEditor(true);
      return;
    }
    try {
      state.error = "";
      const bytes = await fetchTemplateDocumentPdfBytes();
      downloadBytes(bytes, currentPdfFileName());
    } catch (error) {
      state.error = `帳票PDFの出力に失敗しました: ${error.message}`;
      renderTemplateDocumentEditor(true);
    }
    return;
  }
  if (state.previewBytes) {
    downloadBytes(state.previewBytes, currentPdfFileName());
    return;
  }
  await generatePreview("download", { forceDownload: true });
}

function updateSaveStateText() {
  const node = document.querySelector("#save-state-text");
  if (!node) {
    return;
  }
  node.textContent = editorSaveStateText();
}

function updateTemplateDocumentSummaryDom() {
  if (!state.templateDocument) {
    return;
  }
  const totalRows = templateDocumentRows(state.templateDocument).length;
  const activeRows = templateDocumentRowCount(state.templateDocument);
  const invalidRows = templatePreviewInvalidRowCount();

  const titleNode = document.querySelector("#template-auto-title");
  if (titleNode) {
    titleNode.textContent = state.templateDocument.title;
  }
  const badgeNode = document.querySelector("#template-row-count-badge");
  if (badgeNode) {
    badgeNode.textContent = `${activeRows}件入力済み`;
  }
  const totalRowsNode = document.querySelector("#template-total-rows");
  if (totalRowsNode) {
    totalRowsNode.textContent = String(totalRows);
  }
  const activeRowsNode = document.querySelector("#template-active-rows");
  if (activeRowsNode) {
    activeRowsNode.textContent = String(activeRows);
  }
  const invalidRowsNode = document.querySelector("#template-invalid-rows");
  if (invalidRowsNode) {
    invalidRowsNode.textContent = String(invalidRows);
  }
  document.querySelector("#template-invalid-rows-card")?.classList.toggle("is-warning", invalidRows > 0);
}

function markDirty() {
  if (boot.view === "edit" && isIssuePublished()) {
    return;
  }
  state.dirty = true;
  state.notice = "";
  updateSaveStateText();
}

function clearPreviewErrorMessage() {
  if (!String(state.error || "").startsWith("プレビュー生成に失敗しました:")) {
    return;
  }
  state.error = "";
  const flash = document.querySelector(".flash--error");
  if (flash && String(flash.textContent || "").startsWith("プレビュー生成に失敗しました:")) {
    flash.remove();
  }
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

  document.querySelector("#duplicate-issue-button")?.addEventListener("click", async () => {
    if (!state.issue?.id) {
      return;
    }
    await duplicateIssue(state.issue.id, { renderCurrentView: true });
  });

  document.querySelectorAll("[data-preview-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedAttachmentId = button.getAttribute("data-preview-attachment") || "";
      renderEditor();
    });
  });

  if (issueEditorReadOnly()) {
    return;
  }

  document.querySelector("#save-issue-button")?.addEventListener("click", async () => {
    await saveEditor();
  });

  document.querySelector("#publish-issue-button")?.addEventListener("click", async () => {
    await publishIssueFromEditor();
  });

  document.querySelector("#reset-paper-font-scale-button")?.addEventListener("click", () => {
    resetPaperFontScale();
    renderEditor();
  });

  document.querySelectorAll("[data-font-scale-adjust]").forEach((button) => {
    button.addEventListener("click", () => {
      const [category, deltaRaw] = String(button.getAttribute("data-font-scale-adjust")).split(":");
      if (!PAPER_FONT_SCALE_ORDER.includes(category)) {
        return;
      }
      adjustPaperFontScale(category, Number(deltaRaw || 0));
      renderEditor();
    });
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

  document.querySelectorAll("[data-item-thumb-scale]").forEach((node) => {
    const [blockIndex, itemIndex] = String(node.getAttribute("data-item-thumb-scale"))
      .split(":")
      .map((value) => Number(value));
    const handler = (event) => {
      const value = normalizeItemThumbnailScalePercent(event.currentTarget.value);
      state.blocks[blockIndex].items[itemIndex].thumb_scale_percent = value;
      const valueNode = document.querySelector(
        `[data-item-thumb-scale-value="${blockIndex}:${itemIndex}"]`,
      );
      if (valueNode) {
        valueNode.textContent = `${value}%`;
      }
      markDirty();
      schedulePreview("item-thumb-scale");
    };
    node.addEventListener("input", handler);
    node.addEventListener("change", handler);
  });

  document.querySelectorAll("[data-add-supplement]").forEach((button) => {
    button.addEventListener("click", () => {
      const [blockIndex, itemIndex] = String(button.getAttribute("data-add-supplement"))
        .split(":")
        .map((value) => Number(value));
      state.blocks[blockIndex].items[itemIndex].supplements.push(initialItemSupplement());
      markDirty();
      renderEditor();
    });
  });

  document.querySelectorAll("[data-item-supplement-field]").forEach((node) => {
    const field = node.getAttribute("data-item-supplement-field");
    const blockIndex = Number(node.getAttribute("data-block-index"));
    const itemIndex = Number(node.getAttribute("data-item-index"));
    const supplementIndex = Number(node.getAttribute("data-supplement-index"));
    const handler = (event) => {
      state.blocks[blockIndex].items[itemIndex].supplements[supplementIndex][field] = event.currentTarget.value;
      markDirty();
      schedulePreview(`supplement-${field}`);
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

  document.querySelectorAll("[data-remove-supplement]").forEach((button) => {
    button.addEventListener("click", () => {
      const [blockIndex, itemIndex, supplementIndex] = String(button.getAttribute("data-remove-supplement"))
        .split(":")
        .map((value) => Number(value));
      state.blocks[blockIndex].items[itemIndex].supplements.splice(supplementIndex, 1);
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

  document.querySelectorAll("[data-move-supplement]").forEach((button) => {
    button.addEventListener("click", () => {
      const [blockIndex, itemIndex, supplementIndex] = String(button.getAttribute("data-move-supplement"))
        .split(":")
        .map((value) => Number(value));
      const direction = button.getAttribute("data-direction");
      const supplements = state.blocks[blockIndex].items[itemIndex].supplements;
      const targetIndex = direction === "up" ? supplementIndex - 1 : supplementIndex + 1;
      if (targetIndex < 0 || targetIndex >= supplements.length) {
        return;
      }
      const [supplement] = supplements.splice(supplementIndex, 1);
      supplements.splice(targetIndex, 0, supplement);
      markDirty();
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
        if (await syncIssueAfterReadonlyConflict(error)) {
          renderEditor();
          return;
        }
        state.error = error.message;
      }
      renderEditor();
    });
  });

  document.querySelectorAll("[data-paste-item-id]").forEach((node) => {
    node.addEventListener("click", () => {
      if (node instanceof HTMLElement && node.getAttribute("aria-disabled") !== "true") {
        node.focus();
      }
    });
  });

  document.querySelectorAll("[data-clipboard-upload-item-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const itemId = button.getAttribute("data-clipboard-upload-item-id") || "";
      await uploadClipboardImageFromButton(itemId);
    });
  });

  document.querySelectorAll("[data-upload-item-id]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const itemId = input.getAttribute("data-upload-item-id") || "";
      const file = event.currentTarget.files?.[0];
      if (!itemId || !file) {
        return;
      }
      await uploadAttachmentFile(itemId, file);
    });
  });
}

function bindTemplateDocumentEvents() {
  bindPreviewButtons();

  document.querySelector("#reload-template-document-button")?.addEventListener("click", async () => {
    await loadTemplateDocumentEditor();
  });

  document.querySelector("#save-template-document-button")?.addEventListener("click", async () => {
    await saveTemplateDocumentEditor();
  });

  document.querySelector("#reset-template-payload-button")?.addEventListener("click", () => {
    if (!state.templateDocument) {
      return;
    }
    setTemplateDocumentPayload(defaultTemplatePayload(
      state.templateDocument.document_family,
      state.templateDocument.template_key,
    ));
    markDirty();
    renderTemplateDocumentEditor();
  });

  document.querySelectorAll("[data-add-template-row]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.templateDocument) {
        return;
      }
      const rows = templateDocumentRows(state.templateDocument);
      rows.push(blankTemplatePayloadRow(state.templateDocument.document_family, state.templateDocument.template_key));
      setTemplateDocumentPayload({ rows });
      markDirty();
      renderTemplateDocumentEditor(true);
      schedulePreview("template-row-add");
    });
  });

  document.querySelectorAll("[data-remove-template-row]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.templateDocument) {
        return;
      }
      const rowIndex = Number(button.getAttribute("data-remove-template-row"));
      const rows = templateDocumentRows(state.templateDocument).filter((_, index) => index !== rowIndex);
      setTemplateDocumentPayload({ rows });
      markDirty();
      renderTemplateDocumentEditor(true);
      schedulePreview("template-row-remove");
    });
  });

  document.querySelectorAll("[data-template-row-field]").forEach((input) => {
    input.addEventListener("input", (event) => {
      if (!state.templateDocument) {
        return;
      }
      const rowIndex = Number(event.currentTarget.getAttribute("data-template-row-index"));
      const field = event.currentTarget.getAttribute("data-template-row-field");
      if (!field) {
        return;
      }
      const rows = templateDocumentRows(state.templateDocument);
      if (!rows[rowIndex]) {
        return;
      }
      rows[rowIndex][field] = event.currentTarget.value;
      setTemplateDocumentPayload({ rows });
      const payloadEditor = document.querySelector("#template-document-payload");
      if (payloadEditor) {
        payloadEditor.value = state.templatePayloadText;
      }
      markDirty();
      updateTemplateDocumentSummaryDom();
      schedulePreview(`template-row-${field}`);
    });
  });

  document.querySelector("#template-document-payload")?.addEventListener("input", (event) => {
    state.templatePayloadText = event.currentTarget.value;
    try {
      if (!state.templateDocument) {
        return;
      }
      state.templateDocument.payload = parseTemplatePayloadText(event.currentTarget.value);
      syncTemplateDocumentTitle();
      updateTemplateDocumentSummaryDom();
    } catch {
      // Keep the raw text as-is until save/preview validation runs.
    }
    markDirty();
    schedulePreview("template-json");
  });

  document.querySelector("#template-document-payload")?.addEventListener("change", (event) => {
    if (!state.templateDocument) {
      return;
    }
    try {
      setTemplateDocumentPayload(parseTemplatePayloadText(event.currentTarget.value));
      renderTemplateDocumentEditor(true);
    } catch {
      // Ignore invalid JSON on blur; save/preview will surface the error.
    }
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

async function createTemplateDocument(documentFamily, templateKey) {
  state.error = "";
  state.notice = "";
  renderIndex();
  try {
    const response = await api("/api/template-documents", {
      method: "POST",
      body: {
        document_family: documentFamily,
        template_key: templateKey,
      },
    });
    window.location.href = templateDocumentEditUrl(response.id);
  } catch (error) {
    state.error = error.message;
    renderIndex();
  }
}

async function duplicateIssue(issueId, { renderCurrentView = false } = {}) {
  state.error = "";
  state.notice = "";
  if (renderCurrentView) {
    renderEditor();
  } else {
    renderIndex();
  }
  try {
    const response = await api(`/api/issues/${encodeURIComponent(issueId)}/duplicate`, {
      method: "POST",
    });
    window.location.href = `/issues/${encodeURIComponent(response.id)}/edit`;
  } catch (error) {
    state.error = error.message;
    if (renderCurrentView) {
      renderEditor();
    } else {
      renderIndex();
    }
  }
}

async function deleteIssue(issueId) {
  if (!window.confirm("この案内を削除しますか？添付資料も含めて元に戻せません。")) {
    return;
  }

  state.error = "";
  state.notice = "";
  renderIndex();
  try {
    await api(`/api/issues/${encodeURIComponent(issueId)}`, {
      method: "DELETE",
    });
    state.issues = state.issues.filter((issue) => issue.id !== issueId);
    state.notice = "案内を削除しました。";
  } catch (error) {
    state.error = error.message;
  }
  renderIndex();
}

async function deleteTemplateDocument(templateDocumentId) {
  if (!window.confirm("この帳票を削除しますか？JSON 下書きも元に戻せません。")) {
    return;
  }

  state.error = "";
  state.notice = "";
  renderIndex();
  try {
    await api(`/api/template-documents/${encodeURIComponent(templateDocumentId)}`, {
      method: "DELETE",
    });
    state.templateDocuments = state.templateDocuments.filter(
      (document) => document.id !== templateDocumentId,
    );
    state.notice = "帳票を削除しました。";
  } catch (error) {
    state.error = error.message;
  }
  renderIndex();
}

async function loadIndex() {
  state.loading = true;
  renderLoading("文書ファミリーを読込中です", "常会案内と農作業傷害共済の一覧を準備しています。");
  try {
    const [meta, issues, templateDocuments] = await Promise.all([
      api("/api/meta"),
      api("/api/issues"),
      api("/api/template-documents"),
    ]);
    state.meta = meta;
    state.issues = issues.map(normalizeIssueListItem);
    state.templateDocuments = templateDocuments.map(normalizeTemplateDocument);
    state.activeFamily = normalizeFamilyKey(boot.familyTab || state.activeFamily);
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
  state.issueNavigation = normalizeIssueNavigation(documentPayload.navigation);
  state.blocks = documentPayload.blocks.map(normalizeBlock);
  ensureSelectedAttachment();
}

async function loadTemplateDocument() {
  const response = await api(`/api/template-documents/${boot.templateDocumentId}`);
  state.templateDocument = normalizeTemplateDocument(response.document);
  syncTemplatePayloadTextFromDocument();
}

async function loadEditor() {
  state.loading = true;
  state.error = "";
  state.notice = "";
  state.publishing = false;
  clearTemplatePreviewWarning();
  renderLoading("編集画面を読込中です", "対象の号と block 群を取得しています。");
  try {
    const [meta, , hydratedFromCache] = await Promise.all([
      api("/api/meta"),
      loadIssueDocument(),
      hydrateCachedIssuePreview(),
    ]);
    state.meta = meta;
    state.loading = false;
    state.dirty = false;
    state.previewBytes = null;
    renderEditor(hydratedFromCache);
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
    const [, hydratedFromCache] = await Promise.all([
      loadIssueDocument(),
      hydrateCachedIssuePreview(),
    ]);
    state.loading = false;
    state.previewBytes = null;
    renderPrintPage(hydratedFromCache);
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    app.innerHTML = `<main class="print-shell-app"><div class="flash flash--error">${escapeHtml(error.message)}</div></main>`;
  }
}

async function loadTemplateDocumentEditor() {
  state.loading = true;
  state.error = "";
  state.notice = "";
  clearTemplatePreviewWarning();
  renderLoading("帳票編集画面を読込中です", "契約者行と SVG テンプレ情報を取得しています。");
  try {
    const [meta] = await Promise.all([api("/api/meta"), loadTemplateDocument()]);
    state.meta = meta;
    state.loading = false;
    state.dirty = false;
    state.previewBytes = null;
    state.previewImages = [];
    state.previewReadyAt = "";
    renderTemplateDocumentEditor();
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    renderTemplateDocumentEditor();
  }
}

async function loadTemplateDocumentPrint() {
  state.loading = true;
  clearTemplatePreviewWarning();
  renderLoading("印刷紙面を読込中です", "保存済みの帳票データを取得しています。");
  try {
    await loadTemplateDocument();
    state.loading = false;
    state.previewBytes = null;
    state.previewImages = [];
    state.previewReadyAt = "";
    renderTemplateDocumentPrintPage();
  } catch (error) {
    state.loading = false;
    state.error = error.message;
    app.innerHTML = `<main class="print-shell-app"><div class="flash flash--error">${escapeHtml(error.message)}</div></main>`;
  }
}

async function saveEditor() {
  if (!boot.issueId || state.saving || state.publishing) {
    return false;
  }
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
    state.issueNavigation = normalizeIssueNavigation(documentPayload.navigation);
    state.blocks = documentPayload.blocks.map(normalizeBlock);
    ensureSelectedAttachment();
    state.dirty = false;
    state.notice = "保存しました。";
    return true;
  } catch (error) {
    if (await syncIssueAfterReadonlyConflict(error)) {
      return false;
    }
    state.error = error.message;
    return false;
  } finally {
    state.saving = false;
    renderEditor();
  }
}

async function publishIssueFromEditor() {
  if (!boot.issueId || state.saving || state.publishing || issueEditorReadOnly()) {
    return false;
  }
  if (!window.confirm("この案内を発行しますか？発行後はこの画面から直接編集できず、修正は複製して新しい下書きで行います。")) {
    return false;
  }

  state.publishing = true;
  state.error = "";
  state.notice = "";
  renderEditor();

  try {
    if (state.dirty) {
      const saved = await saveEditor();
      if (!saved) {
        return false;
      }
    }

    const documentPayload = await api(`/api/issues/${boot.issueId}/publish`, {
      method: "POST",
    });
    state.issue = normalizeIssue(documentPayload.issue);
    state.issueNavigation = normalizeIssueNavigation(documentPayload.navigation);
    state.blocks = documentPayload.blocks.map(normalizeBlock);
    ensureSelectedAttachment();
    state.dirty = false;
    state.notice = "案内を発行しました。以後の修正は複製して新しい下書きで行ってください。";
    return true;
  } catch (error) {
    if (await syncIssueAfterReadonlyConflict(error)) {
      return false;
    }
    state.error = error.message;
    return false;
  } finally {
    state.publishing = false;
    renderEditor();
  }
}

async function saveTemplateDocumentEditor({
  renderBefore = true,
  renderAfter = true,
  noticeMessage = "保存しました。",
  clearNotice = true,
} = {}) {
  if (!boot.templateDocumentId || state.saving || !state.templateDocument) {
    return false;
  }
  let payload;
  try {
    payload = parseTemplatePayloadText();
  } catch (error) {
    clearTemplatePreviewWarning();
    state.error = error.message;
    renderTemplateDocumentEditor(true);
    return false;
  }
  setTemplateDocumentPayload(payload);

  state.saving = true;
  state.error = "";
  if (clearNotice) {
    state.notice = "";
  }
  if (renderBefore) {
    renderTemplateDocumentEditor(true);
  } else {
    updateSaveStateText();
  }
  try {
    const response = await api(`/api/template-documents/${boot.templateDocumentId}`, {
      method: "PUT",
      body: {
        title: state.templateDocument.title,
        payload: state.templateDocument.payload,
      },
    });
    state.templateDocument = normalizeTemplateDocument(response.document);
    syncTemplatePayloadTextFromDocument();
    state.templateDocuments = state.templateDocuments
      .filter((document) => document.id !== state.templateDocument.id)
      .concat(state.templateDocument)
      .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
    state.dirty = false;
    state.notice = noticeMessage;
    updateSaveStateText();
    return true;
  } catch (error) {
    state.error = error.message;
    updateSaveStateText();
    return false;
  } finally {
    state.saving = false;
    if (renderAfter) {
      renderTemplateDocumentEditor();
    } else {
      updateSaveStateText();
    }
  }
}

async function openPrintPageFromEditor() {
  if ((boot.view !== "edit" && boot.view !== "template-edit") || printShortcutPending || state.publishing) {
    return;
  }
  if (!state.issue?.id && !boot.issueId && !state.templateDocument?.id && !boot.templateDocumentId) {
    return;
  }

  printShortcutPending = true;
  try {
    if (state.dirty) {
      const saved =
        boot.view === "template-edit" ? await saveTemplateDocumentEditor() : await saveEditor();
      if (!saved) {
        return;
      }
    }
    window.location.href =
      boot.view === "template-edit" ? templateDocumentPrintUrl() : printPageUrl();
  } finally {
    printShortcutPending = false;
  }
}

window.addEventListener("beforeunload", (event) => {
  if (state.dirty && (boot.view === "edit" || boot.view === "template-edit")) {
    event.preventDefault();
    event.returnValue = "";
  }
});

window.addEventListener("keydown", (event) => {
  const isPrintShortcut =
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    String(event.key || "").toLowerCase() === "p";
  if (!isPrintShortcut || (boot.view !== "edit" && boot.view !== "template-edit")) {
    return;
  }
  event.preventDefault();
  void openPrintPageFromEditor();
});

window.addEventListener("paste", (event) => {
  if (boot.view !== "edit" || isIssuePublished()) {
    return;
  }
  const itemId =
    clipboardPasteItemIdFromNode(event.target) ||
    clipboardPasteItemIdFromNode(document.activeElement);
  if (!itemId) {
    return;
  }
  event.preventDefault();
  void uploadClipboardImageFromPaste(itemId, event);
});

window.addEventListener("storage", (event) => {
  if (event.key !== paperFontScaleStorageKey) {
    return;
  }
  state.paperFontScale = loadPaperFontScale();
  if (boot.view === "edit" && state.issue) {
    renderEditor();
  } else if (boot.view === "print" && state.issue) {
    schedulePreview("storage-font-scale");
  }
});

if (boot.view === "edit" && boot.issueId) {
  loadEditor();
} else if (boot.view === "print" && boot.issueId) {
  loadPrint();
} else if (boot.view === "template-edit" && boot.templateDocumentId) {
  loadTemplateDocumentEditor();
} else if (boot.view === "template-print" && boot.templateDocumentId) {
  loadTemplateDocumentPrint();
} else {
  loadIndex();
}
