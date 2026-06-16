import { generate } from "@pdfme/generator";
import { BLANK_A4_PDF } from "@pdfme/common";
import { image, text } from "@pdfme/schemas";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MM_TO_PX = 96 / 25.4;
const PT_TO_PX = 96 / 72;
const BODY_FONT_FAMILY = '"Yu Gothic", "Hiragino Sans", sans-serif';
const TITLE_FONT_FAMILY = '"Yu Gothic", "Hiragino Sans", sans-serif';
const BODY_FONT_NAME = "JokaiBody";
const BODY_BOLD_FONT_NAME = "JokaiBodyBold";
const TITLE_FONT_NAME = "JokaiTitle";
export const NOTICE_RENDER_VERSION = "notice-pdf-layout-v4|noto-sans-jp-static-v2|pdfme-raster-v3";
const DEFAULT_AGENDA_LABEL = "常会事項";
const NOTICE_RENDER_OPTION_DEFAULTS = Object.freeze({
  blockShowItemMarkers: Object.freeze({}),
});
const ITEM_META_LAYOUT_STACKED = "stacked";
const ITEM_META_LAYOUT_SAME_LINE = "same_line";
const ITEM_SUPPLEMENT_TONE_RED = "red";
const ITEM_SUPPLEMENT_TONE_BLUE = "blue";
const COLOR_BLACK = "#000000";
const COLOR_RED = "#d0261a";
const COLOR_BLUE = "#1f4fd8";
const FOOTER_CONTACT_LINES = ["平古場生産組合", "組合長　古川 豊", "☎090-7581-7819"];
const FOOTER_GAP_ABOVE_MM = 4.5;
const BLANK_PAGE_PADDING_BOTTOM_MM = Array.isArray(BLANK_A4_PDF.padding)
  ? Number(BLANK_A4_PDF.padding[2] || 0)
  : 0;
const BLANK_PAGE_PADDING_TOP_MM = Array.isArray(BLANK_A4_PDF.padding) ? Number(BLANK_A4_PDF.padding[0] || 0) : 0;
// Keep footer boxes above pdfme's blank-page bottom padding.
const FOOTER_BOX_SLACK_MM = 0.6;
const FOOTER_BOTTOM_MARGIN_MM = BLANK_PAGE_PADDING_BOTTOM_MM + FOOTER_BOX_SLACK_MM;
const FOOTER_LEFT_X = 14;
const FOOTER_RIGHT_X = 152;
const FOOTER_RIGHT_WIDTH = 42;
const FOOTER_NOTE_GAP_BEFORE_CONTACT_MM = 1.2;
const FOOTER_NOTE_FONT_SIZE = 9;
const FOOTER_NOTE_LINE_HEIGHT = 1.22;
const FOOTER_CONTACT_FONT_SIZE = 8.6;
const FOOTER_CONTACT_LINE_HEIGHT = 1.22;
const CONTINUATION_MARKER_BOTTOM_GAP_MM = 0.6;
const HEADER_TITLE_X = 12;
const HEADER_TITLE_Y = 10;
// Intentionally wider than the visible page so long notice titles do not auto-wrap.
const HEADER_TITLE_SINGLE_LINE_WIDTH_MM = 400;
export const ITEM_THUMBNAIL_SCALE_DEFAULT_PERCENT = 100;
export const ITEM_THUMBNAIL_SCALE_LIMITS = Object.freeze({
  min: 80,
  max: 200,
  step: 5,
});
const THUMB_BASE_X = 146;
const THUMB_BASE_WIDTH_MM = 22;
const THUMB_BASE_HEIGHT_MM = 13.2;
const THUMB_BASE_RIGHT_X = THUMB_BASE_X + THUMB_BASE_WIDTH_MM;
const THUMB_LABEL_X = THUMB_BASE_X + 24.4;
const THUMB_LABEL_WIDTH_MM = 24;
const TEXT_RIGHT_GAP_BEFORE_LABEL_MM = 1.2;

function normalizeBasePath(value = "") {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw || raw === "/") {
    return "";
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function appUrl(path = "/") {
  const value = String(path || "/");
  if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(value)) {
    return value;
  }
  const basePath = normalizeBasePath(document.querySelector("#app")?.dataset.basePath || "");
  const normalizedPath = value.startsWith("/") ? value : `/${value}`;
  if (!basePath || normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`)) {
    return normalizedPath;
  }
  return normalizedPath === "/" ? `${basePath}/` : `${basePath}${normalizedPath}`;
}
const THUMB_SLOT_HEIGHT_MM = 16.6;
const THUMB_SLOT_GAP_MM = 2.6;
const TEXT_HALO_COLOR = "#ffffff";
const TEXT_HALO_OFFSETS_MM = Object.freeze([
  [-0.64, 0],
  [0.64, 0],
  [0, -0.64],
  [0, 0.64],
  [-0.48, -0.48],
  [0.48, -0.48],
  [-0.48, 0.48],
  [0.48, 0.48],
]);
export const PAPER_FONT_SCALE_ORDER = Object.freeze([
  "title",
  "header",
  "h1",
  "h2",
  "body",
  "footer",
]);
export const PAPER_FONT_SCALE_DEFAULT_PERCENT = 80;
export const PAPER_FONT_SCALE_LIMITS = Object.freeze({
  min: 70,
  max: 150,
  step: 5,
});
export const PAPER_FONT_SCALE_DEFAULTS = Object.freeze(
  Object.fromEntries(PAPER_FONT_SCALE_ORDER.map((category) => [category, PAPER_FONT_SCALE_DEFAULT_PERCENT])),
);
const PLUGINS = {
  Text: text,
  Image: image,
};

const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const fontCache = new Map();
const attachmentDataUrlCache = new Map();
const attachmentDimensionCache = new Map();

function mmToPx(value) {
  return value * MM_TO_PX;
}

function ptToPx(value) {
  return value * PT_TO_PX;
}

function pxToMm(value) {
  return value / MM_TO_PX;
}

function textBlockHeightMm(fontSizePt, lineHeight, lineCount) {
  if (!lineCount) {
    return 0;
  }
  return pxToMm(ptToPx(fontSizePt) * lineHeight * lineCount);
}

function clampPaperFontScaleValue(value) {
  const rounded =
    Math.round(Number(value || PAPER_FONT_SCALE_DEFAULT_PERCENT) / PAPER_FONT_SCALE_LIMITS.step) *
    PAPER_FONT_SCALE_LIMITS.step;
  return Math.min(PAPER_FONT_SCALE_LIMITS.max, Math.max(PAPER_FONT_SCALE_LIMITS.min, rounded));
}

function clampItemThumbnailScaleValue(value) {
  const numeric = Number(value);
  const normalized = Number.isFinite(numeric) ? numeric : ITEM_THUMBNAIL_SCALE_DEFAULT_PERCENT;
  const rounded =
    Math.round((normalized - ITEM_THUMBNAIL_SCALE_LIMITS.min) / ITEM_THUMBNAIL_SCALE_LIMITS.step) *
      ITEM_THUMBNAIL_SCALE_LIMITS.step +
    ITEM_THUMBNAIL_SCALE_LIMITS.min;
  return Math.min(ITEM_THUMBNAIL_SCALE_LIMITS.max, Math.max(ITEM_THUMBNAIL_SCALE_LIMITS.min, rounded));
}

export function normalizeItemThumbnailScalePercent(value) {
  return clampItemThumbnailScaleValue(value);
}

export function normalizePaperFontScale(raw = {}) {
  return Object.fromEntries(
    PAPER_FONT_SCALE_ORDER.map((category) => [
      category,
      clampPaperFontScaleValue(raw?.[category] ?? PAPER_FONT_SCALE_DEFAULTS[category]),
    ]),
  );
}

export function itemHasVisibleContent(
  item,
  attachmentCount = Array.isArray(item?.attachments) ? item.attachments.length : 0,
) {
  return Boolean(
    normalizeText(item?.heading) ||
      normalizeText(item?.body) ||
      normalizeItemSupplements(item).length ||
      buildItemMetaLines(item).length ||
      attachmentCount > 0,
  );
}

function paperFontScaleFactor(fontScale, category) {
  return (fontScale[category] || PAPER_FONT_SCALE_DEFAULT_PERCENT) / PAPER_FONT_SCALE_DEFAULT_PERCENT;
}

function scalePaperFont(fontScale, category, baseFontSize) {
  return Number((baseFontSize * paperFontScaleFactor(fontScale, category)).toFixed(2));
}

function buildPaperTypography(fontScaleInput) {
  const fontScale = normalizePaperFontScale(fontScaleInput);
  return {
    fontScale,
    title: {
      primary: scalePaperFont(fontScale, "title", 15.5),
      continuation: scalePaperFont(fontScale, "title", 11.8),
      lineHeight: 1.1,
    },
    header: {
      meeting: scalePaperFont(fontScale, "header", 9.4),
      place: scalePaperFont(fontScale, "header", 8.8),
      note: scalePaperFont(fontScale, "header", 8.6),
      lineHeight: {
        meeting: 1.3,
        place: 1.2,
        note: 1.25,
      },
    },
    h1: {
      main: scalePaperFont(fontScale, "h1", 12),
      section: scalePaperFont(fontScale, "h1", 10.8),
      lineHeight: {
        main: 1.1,
        section: 1.18,
      },
    },
    h2: {
      item: scalePaperFont(fontScale, "h2", 9.4),
      lineHeight: 1.2,
    },
    body: {
      copy: scalePaperFont(fontScale, "body", 8.35),
      meta: scalePaperFont(fontScale, "body", 8.3),
      sideLabel: scalePaperFont(fontScale, "body", 7.4),
      empty: scalePaperFont(fontScale, "body", 9.5),
      continuation: scalePaperFont(fontScale, "body", 8),
      lineHeight: {
        copy: 1.34,
        meta: 1.2,
        sideLabel: 1.22,
        empty: 1.2,
        continuation: 1.2,
      },
    },
    footer: {
      note: scalePaperFont(fontScale, "footer", FOOTER_NOTE_FONT_SIZE),
      contact: scalePaperFont(fontScale, "footer", FOOTER_CONTACT_FONT_SIZE),
      lineHeight: {
        note: FOOTER_NOTE_LINE_HEIGHT,
        contact: FOOTER_CONTACT_LINE_HEIGHT,
      },
    },
  };
}

function svgDataUrl(label, accent = "#c9c9c9") {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="190" viewBox="0 0 320 190">
      <rect width="320" height="190" rx="10" fill="#fafafa" stroke="${accent}" stroke-width="6"/>
      <line x1="0" y1="50" x2="320" y2="50" stroke="#ececec" stroke-width="2"/>
      <line x1="0" y1="100" x2="320" y2="100" stroke="#ececec" stroke-width="2"/>
      <line x1="0" y1="145" x2="320" y2="145" stroke="#ececec" stroke-width="2"/>
      <text x="160" y="104" font-size="20" font-family="Arial, sans-serif" text-anchor="middle" fill="#8d8d8d">${label}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function normalizeMetaValue(value) {
  return normalizeText(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function normalizeItemMetaLayout(value) {
  return value === ITEM_META_LAYOUT_SAME_LINE ? ITEM_META_LAYOUT_SAME_LINE : ITEM_META_LAYOUT_STACKED;
}

function normalizeItemSupplementTone(value) {
  return value === ITEM_SUPPLEMENT_TONE_BLUE ? ITEM_SUPPLEMENT_TONE_BLUE : ITEM_SUPPLEMENT_TONE_RED;
}

function normalizeItemSupplements(item) {
  if (Array.isArray(item.supplements) && item.supplements.length) {
    return item.supplements
      .map((supplement, index) => ({
        id: supplement.id || "",
        tone: normalizeItemSupplementTone(supplement.tone),
        content: normalizeText(supplement.content),
        sort_order: supplement.sort_order || index + 1,
      }))
      .filter((supplement) => supplement.content);
  }

  const legacyNote = normalizeText(item.note);
  if (!legacyNote) {
    return [];
  }

  return [
    {
      id: "",
      tone: ITEM_SUPPLEMENT_TONE_RED,
      content: legacyNote,
      sort_order: 1,
    },
  ];
}

function supplementColor(tone) {
  return normalizeItemSupplementTone(tone) === ITEM_SUPPLEMENT_TONE_BLUE ? COLOR_BLUE : COLOR_RED;
}

function dateLabel(value) {
  if (!value) {
    return "";
  }
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) {
    return String(value);
  }
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function meetingDateLabel(value) {
  if (!value) {
    return "";
  }
  const [yearRaw, monthRaw, dayRaw] = String(value).split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) {
    return dateLabel(value);
  }
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const weekday = weekdays[new Date(year, month - 1, day).getDay()] || "";
  return `${year}年${month}月${day}日${weekday ? `(${weekday})` : ""}`;
}

function monthLabel(value) {
  if (!value) {
    return "";
  }
  const raw = String(value).slice(0, 7);
  const [year, month] = raw.split("-");
  if (!year || !month) {
    return raw;
  }
  return `${year}年${Number(month)}月`;
}

function meetingLine(issue) {
  if (!issue.meeting_date && !issue.meeting_time) {
    return "日時 未設定";
  }
  const date = issue.meeting_date ? meetingDateLabel(issue.meeting_date) : "日付未設定";
  const time = issue.meeting_time ? ` ${toJapaneseTime(issue.meeting_time)}より` : "";
  return `日時 ${date}${time}`;
}

function toJapaneseTime(value) {
  const [hoursRaw, minutesRaw] = String(value || "").split(":");
  const hours = Number(hoursRaw || 0);
  const minutes = Number(minutesRaw || 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return String(value || "");
  }

  const minuteText = minutes ? `${minutes}分` : "";
  if (hours === 0) {
    return `午前0時${minuteText}`;
  }
  if (hours < 12) {
    return `午前${hours}時${minuteText}`;
  }
  if (hours === 12) {
    return minutes ? `午後0時${minuteText}` : "正午";
  }
  return `午後${hours - 12}時${minuteText}`;
}

function mainHeadingLabel(issue) {
  return issue.issue_type === "no_meeting" ? "案内事項" : agendaLabel(issue);
}

function agendaLabel(issue) {
  return normalizeText(issue?.agenda_label) || DEFAULT_AGENDA_LABEL;
}

function labelForBlockKind(blockKind, issue) {
  switch (blockKind) {
    case "agenda":
      return agendaLabel(issue);
    case "submission":
      return "提出物";
    case "distribution":
      return "配布物";
    case "info":
      return "案内事項";
    default:
      return "資料";
  }
}

function measureTextWidth(textValue, fontPx, fontFamily) {
  if (!context) {
    return 0;
  }
  const key = `${fontPx}:${fontFamily}:${textValue}`;
  if (fontCache.has(key)) {
    return fontCache.get(key);
  }
  context.font = `${fontPx}px ${fontFamily}`;
  const width = context.measureText(textValue).width;
  fontCache.set(key, width);
  return width;
}

function wrapLine(textValue, maxWidthPx, fontPx, fontFamily) {
  const source = Array.from(textValue);
  const lines = [];
  let current = "";

  for (const char of source) {
    if (!current) {
      current = char;
      continue;
    }
    const candidate = `${current}${char}`;
    if (measureTextWidth(candidate, fontPx, fontFamily) <= maxWidthPx) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = char.trim() ? char : char.trimStart?.() || char;
  }

  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [""];
}

function wrapText(textValue, { widthMm, fontSizePt, lineHeight, fontFamily }) {
  const raw = normalizeText(textValue);
  if (!raw) {
    return { lines: [], heightMm: 0 };
  }
  const maxWidthPx = mmToPx(widthMm);
  const fontPx = ptToPx(fontSizePt);
  const paragraphs = raw.split("\n");
  const lines = [];

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    lines.push(...wrapLine(paragraph, maxWidthPx, fontPx, fontFamily));
  }

  const lineHeightPx = fontPx * lineHeight;
  return {
    lines,
    heightMm: pxToMm(lines.length * lineHeightPx),
  };
}

function createTextSchema({
  name,
  x,
  y,
  width,
  height,
  content,
  fontName = BODY_FONT_NAME,
  fontSize = 9,
  lineHeight = 1.35,
  fontColor = COLOR_BLACK,
  alignment = "left",
  opacity = 1,
}) {
  return {
    name,
    type: "text",
    readOnly: true,
    content,
    position: { x, y },
    width,
    height,
    fontName,
    fontSize,
    lineHeight,
    fontColor,
    alignment,
    verticalAlignment: "top",
    characterSpacing: 0,
    opacity,
    rotate: 0,
    backgroundColor: "",
  };
}

function createImageSchema({ name, x, y, width, height, content, opacity = 1 }) {
  return {
    name,
    type: "image",
    readOnly: true,
    content,
    position: { x, y },
    width,
    height,
    opacity,
    rotate: 0,
  };
}

function mmPrecise(value) {
  return Number(value.toFixed(2));
}

function textRightLimitMm() {
  return THUMB_LABEL_X - TEXT_RIGHT_GAP_BEFORE_LABEL_MM;
}

function textWidthFromX(x) {
  return mmPrecise(textRightLimitMm() - x);
}

function footerNoteWidthMm() {
  return mmPrecise(FOOTER_RIGHT_X - FOOTER_NOTE_GAP_BEFORE_CONTACT_MM - FOOTER_LEFT_X);
}

function bottomPaddingLimitMm() {
  return mmPrecise(A4_HEIGHT_MM - BLANK_PAGE_PADDING_BOTTOM_MM);
}

function bottomSafeY(height, gap = 0) {
  return mmPrecise(Math.max(BLANK_PAGE_PADDING_TOP_MM, bottomPaddingLimitMm() - height - gap));
}

function clampSchemaY(value) {
  return Math.max(BLANK_PAGE_PADDING_TOP_MM, mmPrecise(value));
}

function pushTextSchema(page, options, { halo = false } = {}) {
  if (halo) {
    TEXT_HALO_OFFSETS_MM.forEach(([dx, dy], index) => {
      page.push(
        createTextSchema({
          ...options,
          name: `${options.name}-halo-${index}`,
          x: mmPrecise(options.x + dx),
          y: clampSchemaY(options.y + dy),
          fontColor: TEXT_HALO_COLOR,
        }),
      );
    });
  }
  page.push(createTextSchema(options));
}

let fontPromise = null;

async function loadFonts() {
  if (!fontPromise) {
    fontPromise = Promise.all([
      fetch(appUrl("/assets/fonts/body.ttf")).then((response) => response.arrayBuffer()),
      fetch(appUrl("/assets/fonts/body-bold.ttf")).then((response) => response.arrayBuffer()),
      fetch(appUrl("/assets/fonts/title.ttf")).then((response) => response.arrayBuffer()),
    ]).then(([bodyFont, bodyBoldFont, titleFont]) => ({
      [BODY_FONT_NAME]: { data: bodyFont, fallback: true },
      [BODY_BOLD_FONT_NAME]: { data: bodyBoldFont },
      [TITLE_FONT_NAME]: { data: titleFont },
    }));
  }

  return fontPromise;
}

async function dataUrlFromUrl(url, fallbackLabel) {
  if (!url) {
    return svgDataUrl(fallbackLabel);
  }
  if (!attachmentDataUrlCache.has(url)) {
    attachmentDataUrlCache.set(
      url,
      fetch(appUrl(url))
        .then((response) => response.blob())
        .then(
          (blob) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () => reject(reader.error || new Error("failed to read blob"));
              reader.onload = () => resolve(reader.result || svgDataUrl(fallbackLabel));
              reader.readAsDataURL(blob);
            }),
        )
        .catch(() => svgDataUrl(fallbackLabel)),
    );
  }
  return attachmentDataUrlCache.get(url);
}

async function measureImageDataUrl(dataUrl) {
  if (!dataUrl) {
    return null;
  }
  if (!attachmentDimensionCache.has(dataUrl)) {
    attachmentDimensionCache.set(
      dataUrl,
      new Promise((resolve) => {
        if (typeof Image === "undefined") {
          resolve(null);
          return;
        }
        const image = new Image();
        let settled = false;
        const finish = (result) => {
          if (settled) {
            return;
          }
          settled = true;
          window.clearTimeout(timeoutId);
          resolve(result);
        };
        const timeoutId = window.setTimeout(() => finish(null), 2000);
        image.onload = () => {
          const width = Number(image.naturalWidth || image.width || 0);
          const height = Number(image.naturalHeight || image.height || 0);
          if (width > 0 && height > 0) {
            finish({ width, height, aspectRatio: width / height });
            return;
          }
          finish(null);
        };
        image.onerror = () => finish(null);
        image.src = dataUrl;
      }),
    );
  }
  return attachmentDimensionCache.get(dataUrl);
}

function attachmentAssetKey(block, item) {
  return item.id || `${block.id || block.sort_order}:${item.sort_order}`;
}

async function buildAttachmentAssets(blocks) {
  const results = new Map();
  await Promise.all(
    blocks.map(async (block) => {
      await Promise.all(
        (block.items || []).map(async (item) => {
          const rows = await Promise.all(
            (item.attachments || []).map(async (attachment, index) => {
              if (attachment.display_kind === "pdf" || attachment.display_kind === "image") {
                const dataUrl = await dataUrlFromUrl(
                  attachment.thumbnail_url,
                  attachment.display_kind === "pdf" ? "PDF" : "IMAGE",
                );
                const measured = await measureImageDataUrl(dataUrl);
                return {
                  dataUrl,
                  filename: attachment.original_filename || `資料${index + 1}`,
                  aspectRatio: measured?.aspectRatio || null,
                };
              }
              return {
                dataUrl: svgDataUrl("FILE", "#d7d7d7"),
                filename: attachment.original_filename || `資料${index + 1}`,
                aspectRatio: 320 / 190,
              };
            }),
          );
          results.set(attachmentAssetKey(block, item), rows);
        }),
      );
    }),
  );
  return results;
}

function createPageTemplate() {
  return [];
}

function fitSizeWithinBox(aspectRatio, boxWidth, boxHeight) {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return {
      width: boxWidth,
      height: boxHeight,
    };
  }
  const boxRatio = boxWidth / boxHeight;
  if (aspectRatio > boxRatio) {
    return {
      width: boxWidth,
      height: boxWidth / aspectRatio,
    };
  }
  return {
    width: boxHeight * aspectRatio,
    height: boxHeight,
  };
}

function thumbnailDrawGeometry(asset, scaleFactor) {
  const fitted = fitSizeWithinBox(asset?.aspectRatio, THUMB_BASE_WIDTH_MM, THUMB_BASE_HEIGHT_MM);
  const width = mmPrecise(fitted.width * scaleFactor);
  const height = mmPrecise(fitted.height * scaleFactor);
  return {
    width,
    height,
    x: mmPrecise(THUMB_BASE_RIGHT_X - width),
  };
}

function computeFooterLayout(issue, typography) {
  const noteText = normalizeText(issue.footer_note);
  const noteWidth = footerNoteWidthMm();
  const noteBlock = wrapText(noteText, {
    widthMm: noteWidth,
    fontSizePt: typography.footer.note,
    lineHeight: typography.footer.lineHeight.note,
    fontFamily: BODY_FONT_FAMILY,
  });
  const noteLines = noteBlock.lines || [];
  const contactHeight = textBlockHeightMm(
    typography.footer.contact,
    typography.footer.lineHeight.contact,
    FOOTER_CONTACT_LINES.length,
  );
  const contentHeight = Math.max(noteBlock.heightMm, contactHeight, 0);
  return {
    noteText,
    noteLines,
    noteWidth,
    noteHeight: noteBlock.heightMm,
    contactHeight,
    contentHeight,
    reservedHeight: FOOTER_GAP_ABOVE_MM + contentHeight + FOOTER_BOTTOM_MARGIN_MM,
    footerTop: A4_HEIGHT_MM - FOOTER_BOTTOM_MARGIN_MM - contentHeight,
  };
}

function contentBottomLimit(footerLayout) {
  return A4_HEIGHT_MM - footerLayout.reservedHeight;
}

function addContinuationMarker(page, typography) {
  const continuationHeight = textBlockHeightMm(
    typography.body.continuation,
    typography.body.lineHeight.continuation,
    1,
  );
  const markerHeight = continuationHeight + 0.4;
  page.push(
    createTextSchema({
      name: `continued-${page.length}`,
      x: 16,
      y: bottomSafeY(markerHeight, CONTINUATION_MARKER_BOTTOM_GAP_MM),
      width: 40,
      height: markerHeight,
      content: "次頁へ続く",
      fontSize: typography.body.continuation,
      fontName: BODY_BOLD_FONT_NAME,
      fontColor: COLOR_RED,
      lineHeight: typography.body.lineHeight.continuation,
    }),
  );
}

function addFinalPageFooter(page, issue, footerLayout, typography) {
  const noteText = normalizeText(issue.footer_note);
  if (noteText) {
    page.push(
      createTextSchema({
        name: `footer-note-${page.length}`,
        x: FOOTER_LEFT_X,
        y: footerLayout.footerTop + Math.max(0, footerLayout.contentHeight - footerLayout.noteHeight),
        width: footerLayout.noteWidth,
        height: footerLayout.noteHeight + 0.5,
        content: noteText,
        fontName: BODY_BOLD_FONT_NAME,
        fontSize: typography.footer.note,
        lineHeight: typography.footer.lineHeight.note,
        fontColor: COLOR_RED,
      }),
    );
  }

  const lineHeightMm = textBlockHeightMm(
    typography.footer.contact,
    typography.footer.lineHeight.contact,
    1,
  );
  const contactTop =
    footerLayout.footerTop + Math.max(0, footerLayout.contentHeight - footerLayout.contactHeight);

  FOOTER_CONTACT_LINES.forEach((line, index) => {
    page.push(
      createTextSchema({
        name: `footer-contact-${page.length}`,
        x: FOOTER_RIGHT_X,
        y: contactTop + lineHeightMm * index,
        width: FOOTER_RIGHT_WIDTH,
        height: lineHeightMm + 0.4,
        content: line,
        fontName: BODY_BOLD_FONT_NAME,
        fontSize: typography.footer.contact,
        lineHeight: typography.footer.lineHeight.contact,
        alignment: "right",
      }),
    );
  });
}

function addFirstPageHeader(page, issue, typography) {
  const title = normalizeText(issue.title) || "平古場生産組合　常会の案内";
  const noteText = normalizeText(issue.header_note);
  const isNoMeeting = issue.issue_type === "no_meeting";
  const titleHeight = textBlockHeightMm(typography.title.primary, typography.title.lineHeight, 1);
  pushTextSchema(
    page,
    {
      name: `title-${page.length}`,
      x: HEADER_TITLE_X,
      y: HEADER_TITLE_Y,
      width: HEADER_TITLE_SINGLE_LINE_WIDTH_MM,
      height: Math.max(titleHeight + 0.8, 12),
      content: title,
      fontName: TITLE_FONT_NAME,
      fontSize: typography.title.primary,
      lineHeight: typography.title.lineHeight,
    },
    { halo: true },
  );
  let cursorY = HEADER_TITLE_Y + Math.max(titleHeight + 2.6, 14);
  if (!isNoMeeting) {
    const meetingHeight = textBlockHeightMm(typography.header.meeting, typography.header.lineHeight.meeting, 1);
    pushTextSchema(
      page,
      {
        name: `meeting-${page.length}`,
        x: 14,
        y: cursorY,
        width: 132,
        height: meetingHeight + 0.7,
        content: meetingLine(issue),
        fontName: BODY_BOLD_FONT_NAME,
        fontSize: typography.header.meeting,
        lineHeight: typography.header.lineHeight.meeting,
      },
      { halo: true },
    );
    cursorY += Math.max(meetingHeight + 1.4, 7);
  }

  if (noteText) {
    const noteWidth = isNoMeeting ? 132 : 124;
    const noteX = isNoMeeting ? 14 : 22;
    const noteBlock = wrapText(noteText, {
      widthMm: noteWidth,
      fontSizePt: typography.header.note,
      lineHeight: typography.header.lineHeight.note,
      fontFamily: BODY_FONT_FAMILY,
    });
    pushTextSchema(
      page,
      {
        name: `note-${page.length}`,
        x: noteX,
        y: cursorY,
        width: noteWidth,
        height: Math.max(noteBlock.heightMm + 1.2, 5),
        content: noteText,
        fontSize: typography.header.note,
        fontName: BODY_BOLD_FONT_NAME,
        lineHeight: typography.header.lineHeight.note,
        fontColor: COLOR_RED,
      },
      { halo: true },
    );
    cursorY += Math.max(noteBlock.heightMm + 1.8, 6.4);
  }

  if (!isNoMeeting) {
    const placeHeight = textBlockHeightMm(typography.header.place, typography.header.lineHeight.place, 1);
    pushTextSchema(
      page,
      {
        name: `place-${page.length}`,
        x: 14,
        y: cursorY,
        width: 132,
        height: placeHeight + 0.6,
        content: `場所　${normalizeText(issue.place) || "未設定"}`,
        fontSize: typography.header.place,
        lineHeight: typography.header.lineHeight.place,
      },
      { halo: true },
    );
    cursorY += Math.max(placeHeight + 1.8, 8.4);
  } else {
    cursorY += noteText ? 1.6 : 4.4;
  }

  const mainHeadingHeight = textBlockHeightMm(typography.h1.main, typography.h1.lineHeight.main, 1);
  const mainHeadingX = 12;
  pushTextSchema(
    page,
    {
      name: `main-heading-${page.length}`,
      x: mainHeadingX,
      y: cursorY,
      width: textWidthFromX(mainHeadingX),
      height: mainHeadingHeight + 0.8,
      content: mainHeadingLabel(issue),
      fontName: BODY_BOLD_FONT_NAME,
      fontSize: typography.h1.main,
      lineHeight: typography.h1.lineHeight.main,
    },
    { halo: true },
  );

  return cursorY + Math.max(mainHeadingHeight + 2.2, 8);
}

function addContinuationHeader(page, issue, pageNumber, typography) {
  const content = `${normalizeText(issue.title) || "常会案内"}（続き ${pageNumber}頁）`;
  const titleHeight = textBlockHeightMm(typography.title.continuation, typography.title.lineHeight, 1);
  pushTextSchema(
    page,
    {
      name: `continuation-title-${page.length}`,
      x: HEADER_TITLE_X,
      y: HEADER_TITLE_Y,
      width: HEADER_TITLE_SINGLE_LINE_WIDTH_MM,
      height: Math.max(titleHeight + 0.8, 9),
      content,
      fontName: TITLE_FONT_NAME,
      fontSize: typography.title.continuation,
      lineHeight: typography.title.lineHeight,
    },
    { halo: true },
  );
  return HEADER_TITLE_Y + Math.max(titleHeight + 3.2, 14);
}

function itemMarker(index) {
  const markers = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];
  return markers[index] || `${index + 1}.`;
}

function normalizeNoticeBlockShowItemMarkers(value = {}) {
  const normalized = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return normalized;
  }
  Object.entries(value).forEach(([key, markerVisible]) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) {
      return;
    }
    normalized[normalizedKey] = markerVisible !== false;
  });
  return normalized;
}

function normalizeNoticeRenderOptions(options = NOTICE_RENDER_OPTION_DEFAULTS) {
  return {
    blockShowItemMarkers: normalizeNoticeBlockShowItemMarkers(options?.blockShowItemMarkers),
  };
}

function noticeRenderBlockKey(block, index) {
  return String(block?.id || block?.editor_key || `index:${index}`).trim();
}

function blockShowItemMarkers(renderOptions, block, index) {
  const blockKey = noticeRenderBlockKey(block, index);
  if (blockKey && Object.prototype.hasOwnProperty.call(renderOptions.blockShowItemMarkers, blockKey)) {
    return renderOptions.blockShowItemMarkers[blockKey] !== false;
  }
  return block?.show_item_markers !== false;
}

function normalizeItemRows(block) {
  if (Array.isArray(block.items) && block.items.length) {
    return block.items.map((item) => ({
      ...item,
      thumb_scale_percent: normalizeItemThumbnailScalePercent(item.thumb_scale_percent),
    }));
  }
  return [
    {
      id: "",
      heading: "",
      body: "",
      audience_label: "",
      due_date: "",
      note: "",
      supplements: [],
      meta_layout: ITEM_META_LAYOUT_STACKED,
      thumb_scale_percent: ITEM_THUMBNAIL_SCALE_DEFAULT_PERCENT,
      sort_order: 1,
      attachments: [],
    },
  ];
}

function buildItemMetaLines(item) {
  const lines = [
    normalizeMetaValue(item.audience_label) ? `対象者:${normalizeMetaValue(item.audience_label)}` : "",
    item.due_date ? `期限:${dateLabel(item.due_date)}` : "",
  ].filter(Boolean);
  if (normalizeItemMetaLayout(item.meta_layout) === ITEM_META_LAYOUT_SAME_LINE) {
    return lines.length ? [lines.join(" ")] : [];
  }
  return lines;
}

function formatIndentedCopyText(value) {
  return normalizeText(value)
    .split("\n")
    .map((line) => (line ? `　${line}` : ""))
    .join("\n");
}

function buildItemSupplementLayouts(item, typography) {
  return normalizeItemSupplements(item).map((supplement) => {
    const formattedContent = formatIndentedCopyText(supplement.content);
    const block = wrapText(formattedContent, {
      widthMm: textWidthFromX(18),
      fontSizePt: typography.body.meta,
      lineHeight: typography.body.lineHeight.meta,
      fontFamily: BODY_FONT_FAMILY,
    });
    return {
      ...supplement,
      formattedContent,
      heightMm: block.heightMm,
    };
  });
}

function computeSectionHeadingGeometry(block, index, typography, issue) {
  const sectionTitle = `${index + 1}. ${block.heading || labelForBlockKind(block.block_kind, issue)}`;
  const titleBlock = wrapText(sectionTitle, {
    widthMm: textWidthFromX(14),
    fontSizePt: typography.h1.section,
    lineHeight: typography.h1.lineHeight.section,
    fontFamily: BODY_FONT_FAMILY,
  });
  return {
    height: Math.max(titleBlock.heightMm + 0.8, 5.8),
    content: sectionTitle,
  };
}

function buildItemTitleText(item, assetCount, itemIndex, showItemMarkers) {
  if (!itemHasVisibleContent(item, assetCount)) {
    return "";
  }
  const headingText = normalizeText(item.heading);
  if (!showItemMarkers) {
    return headingText;
  }
  const marker = itemMarker(itemIndex);
  return headingText ? `${marker} ${headingText}` : marker;
}

function computeItemGeometry(item, assets, itemIndex, typography, showItemMarkers) {
  const bodyTextWidthMm = textWidthFromX(18);
  const titleText = buildItemTitleText(item, assets.length, itemIndex, showItemMarkers);
  const headingLayout = wrapText(titleText, {
    widthMm: bodyTextWidthMm,
    fontSizePt: typography.h2.item,
    lineHeight: typography.h2.lineHeight,
    fontFamily: BODY_FONT_FAMILY,
  });
  const headingHeight = titleText ? Math.max(headingLayout.heightMm, 4.6) : 0;
  const bodyText = formatIndentedCopyText(item.body);
  const bodyBlock = wrapText(bodyText, {
    widthMm: bodyTextWidthMm,
    fontSizePt: typography.body.copy,
    lineHeight: typography.body.lineHeight.copy,
    fontFamily: BODY_FONT_FAMILY,
  });
  const supplementLayouts = buildItemSupplementLayouts(item, typography);
  const supplementHeight = supplementLayouts.reduce(
    (sum, supplement, index) =>
      sum + supplement.heightMm + (index === supplementLayouts.length - 1 ? 0.2 : 0.8),
    0,
  );
  const metaText = formatIndentedCopyText(buildItemMetaLines(item).join("\n"));
  const metaBlock = wrapText(metaText, {
    widthMm: bodyTextWidthMm,
    fontSizePt: typography.body.meta,
    lineHeight: typography.body.lineHeight.meta,
    fontFamily: BODY_FONT_FAMILY,
  });

  const mainHeight =
    Math.max(
      4.8,
      headingHeight +
        (bodyBlock.heightMm ? bodyBlock.heightMm + 1.1 : 0) +
        (supplementHeight ? supplementHeight + 0.8 : 0) +
        (metaBlock.heightMm ? metaBlock.heightMm + 0.8 : 0),
    ) + 1.1;

  const sideHeight = assets.length
    ? assets.length * THUMB_SLOT_HEIGHT_MM + Math.max(0, assets.length - 1) * THUMB_SLOT_GAP_MM
    : 0;
  return {
    titleText,
    headingLayout,
    headingHeight,
    bodyText,
    bodyLayout: bodyBlock,
    supplementLayouts,
    metaText,
    metaHeight: metaBlock.heightMm,
    rowHeight: Math.max(mainHeight, sideHeight, 8.4),
  };
}

function addSectionHeading(page, block, index, rowTop, typography, issue) {
  const { content, height } = computeSectionHeadingGeometry(block, index, typography, issue);
  const sectionX = 14;
  pushTextSchema(
    page,
    {
      name: `section-${page.length}`,
      x: sectionX,
      y: rowTop,
      width: textWidthFromX(sectionX),
      height,
      content,
      fontName: BODY_BOLD_FONT_NAME,
      fontSize: typography.h1.section,
      lineHeight: typography.h1.lineHeight.section,
    },
    { halo: true },
  );
  return height + 1.2;
}

function addItemRow(page, block, item, assets, itemIndex, rowTop, typography, issue, showItemMarkers) {
  const headingX = 18;
  const textWidth = textWidthFromX(headingX);
  const thumbScale = normalizeItemThumbnailScalePercent(item.thumb_scale_percent) / 100;
  const { titleText, headingHeight, bodyText, bodyLayout, supplementLayouts, metaText, metaHeight, rowHeight } =
    computeItemGeometry(item, assets, itemIndex, typography, showItemMarkers);

  const thumbnailSchemas = assets.map((asset, assetIndex) => {
    const itemTop = rowTop + assetIndex * (THUMB_SLOT_HEIGHT_MM + THUMB_SLOT_GAP_MM);
    const geometry = thumbnailDrawGeometry(asset, thumbScale);
    return createImageSchema({
      name: `thumb-${page.length}-bg-${assetIndex}`,
      x: geometry.x,
      y: itemTop,
      width: geometry.width,
      height: geometry.height,
      content: asset.dataUrl,
    });
  });
  if (thumbnailSchemas.length) {
    page.unshift(...thumbnailSchemas);
  }

  if (titleText) {
    pushTextSchema(
      page,
      {
        name: `item-heading-${page.length}`,
        x: headingX,
        y: rowTop,
        width: textWidth,
        height: headingHeight + 0.4,
        content: titleText,
        fontName: BODY_FONT_NAME,
        fontSize: typography.h2.item,
        lineHeight: typography.h2.lineHeight,
      },
      { halo: true },
    );
  }

  let cursorY = rowTop + (headingHeight ? headingHeight + 0.5 : 0);
  if (bodyLayout.heightMm) {
    pushTextSchema(
      page,
      {
        name: `item-body-${page.length}`,
        x: headingX,
        y: cursorY,
        width: textWidth,
        height: bodyLayout.heightMm + 0.5,
        content: bodyText,
        fontSize: typography.body.copy,
        lineHeight: typography.body.lineHeight.copy,
      },
      { halo: true },
    );
    cursorY += bodyLayout.heightMm + 0.7;
  }

  supplementLayouts.forEach((supplement, supplementIndex) => {
    pushTextSchema(
      page,
      {
        name: `item-supplement-${page.length}`,
        x: headingX,
        y: cursorY,
        width: textWidth,
        height: supplement.heightMm + 0.5,
        content: supplement.formattedContent,
        fontSize: typography.body.meta,
        fontName: BODY_BOLD_FONT_NAME,
        lineHeight: typography.body.lineHeight.meta,
        fontColor: supplementColor(supplement.tone),
      },
      { halo: true },
    );
    cursorY += supplement.heightMm + (supplementIndex === supplementLayouts.length - 1 ? 0.2 : 0.8);
  });

  if (metaText) {
    pushTextSchema(
      page,
      {
        name: `item-meta-${page.length}`,
        x: headingX,
        y: cursorY,
        width: textWidth,
        height: metaHeight + 0.5,
        content: metaText,
        fontSize: typography.body.meta,
        fontName: BODY_BOLD_FONT_NAME,
        lineHeight: typography.body.lineHeight.meta,
        fontColor: COLOR_RED,
      },
      { halo: true },
    );
  }

  if (assets.length) {
    pushTextSchema(page, {
      name: `thumb-label-${page.length}`,
      x: THUMB_LABEL_X,
      y: rowTop + 0.3,
      width: THUMB_LABEL_WIDTH_MM,
      height: 11,
      content: `【${labelForBlockKind(block.block_kind, issue)}】\n対象者:${normalizeText(item.audience_label) || "全員"}`,
      fontSize: typography.body.sideLabel,
      fontName: BODY_BOLD_FONT_NAME,
      lineHeight: typography.body.lineHeight.sideLabel,
      fontColor: COLOR_RED,
    });
  }

  return rowHeight;
}

function buildTemplate(issue, blocks, attachmentAssets, fontScale, renderOptions) {
  const typography = buildPaperTypography(fontScale);
  const normalizedRenderOptions = normalizeNoticeRenderOptions(renderOptions);
  const footerLayout = computeFooterLayout(issue, typography);
  const pageBottomLimit = contentBottomLimit(footerLayout);
  const pages = [];
  let page = createPageTemplate();
  pages.push(page);
  let cursorY = addFirstPageHeader(page, issue, typography) + 2.8;
  let printedCount = 0;

  blocks.forEach((block, index) => {
    const showItemMarkers = blockShowItemMarkers(normalizedRenderOptions, block, index);
    const items = normalizeItemRows(block);
    const firstAssets = attachmentAssets.get(attachmentAssetKey(block, items[0])) || [];
    const estimatedFirstRow =
      computeSectionHeadingGeometry(block, index, typography, issue).height +
      computeItemGeometry(items[0], firstAssets, 0, typography, showItemMarkers).rowHeight +
      4;
    const remaining = pageBottomLimit - cursorY;
    if (remaining < estimatedFirstRow && index > 0) {
      addContinuationMarker(page, typography);
      page = createPageTemplate();
      pages.push(page);
      cursorY = addContinuationHeader(page, issue, pages.length, typography) + 2;
    }

    cursorY += addSectionHeading(page, block, index, cursorY, typography, issue);

    items.forEach((item, itemIndex) => {
      const assets = attachmentAssets.get(attachmentAssetKey(block, item)) || [];
      const rowHeight = computeItemGeometry(item, assets, itemIndex, typography, showItemMarkers).rowHeight;
      if (pageBottomLimit - cursorY < rowHeight && itemIndex > 0) {
        addContinuationMarker(page, typography);
        page = createPageTemplate();
        pages.push(page);
        cursorY = addContinuationHeader(page, issue, pages.length, typography) + 2;
        cursorY += addSectionHeading(page, block, index, cursorY, typography, issue);
      }
      const actualHeight = addItemRow(
        page,
        block,
        item,
        assets,
        itemIndex,
        cursorY,
        typography,
        issue,
        showItemMarkers,
      );
      cursorY += actualHeight + 2.8;
    });

    cursorY += 2.4;
    printedCount += 1;
  });

  if (!printedCount) {
    page.push(
      createTextSchema({
        name: `empty-${page.length}`,
        x: 18,
        y: cursorY,
        width: 132,
        height: 8,
        content: "まだ本文ブロックがありません。",
        fontSize: typography.body.empty,
        lineHeight: typography.body.lineHeight.empty,
      }),
    );
  }

  addFinalPageFooter(page, issue, footerLayout, typography);

  return {
    basePdf: BLANK_A4_PDF,
    schemas: pages,
  };
}

function buildPdfTitle(issue) {
  return normalizeText(issue.title) || "jokai-notice";
}

function buildPdfMonthPrefix(issue) {
  const issueMonth = normalizeText(issue.issue_month);
  if (issueMonth) {
    return issueMonth.slice(0, 7);
  }

  const meetingDate = normalizeText(issue.meeting_date);
  if (meetingDate) {
    return meetingDate.slice(0, 7);
  }

  return "";
}

function validateTemplate(template) {
  const maxBottom = bottomPaddingLimitMm();
  template.schemas.forEach((page, pageIndex) => {
    page.forEach((schema, schemaIndex) => {
      const values = {
        x: schema?.position?.x,
        y: schema?.position?.y,
        width: schema?.width,
        height: schema?.height,
      };
      const invalidKey = Object.entries(values).find(([, value]) => !Number.isFinite(value))?.[0];
      if (!invalidKey) {
        if (schema.position.y < BLANK_PAGE_PADDING_TOP_MM - 0.01) {
          throw new Error(
            `invalid schema ${schema?.name || `(page ${pageIndex + 1} schema ${schemaIndex + 1})`} field y: ${String(schema.position.y)} < top padding ${BLANK_PAGE_PADDING_TOP_MM}`,
          );
        }
        const bottom = Number(schema.position.y) + Number(schema.height);
        if (bottom > maxBottom + 0.01) {
          throw new Error(
            `invalid schema ${schema?.name || `(page ${pageIndex + 1} schema ${schemaIndex + 1})`} bottom: ${String(bottom)} > bottom padding limit ${maxBottom}`,
          );
        }
        return;
      }
      throw new Error(
        `invalid schema ${schema?.name || `(page ${pageIndex + 1} schema ${schemaIndex + 1})`} field ${invalidKey}: ${String(values[invalidKey])}`,
      );
    });
  });
}

function sanitizePdfFilePart(value, fallback) {
  const sanitized = normalizeText(value)
    .replace(/\s+/g, "-")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
  return sanitized || fallback;
}

export function pdfFileName(issue) {
  const monthPrefix = sanitizePdfFilePart(buildPdfMonthPrefix(issue), "");
  const titlePart = sanitizePdfFilePart(buildPdfTitle(issue), "jokai-notice");
  const base = monthPrefix ? `${monthPrefix}-${titlePart}` : titlePart;
  return `${base}.pdf`;
}

export async function buildNoticePdfDocument(
  issue,
  blocks,
  fontScale = PAPER_FONT_SCALE_DEFAULTS,
  renderOptions = NOTICE_RENDER_OPTION_DEFAULTS,
) {
  const [font, attachmentAssets] = await Promise.all([loadFonts(), buildAttachmentAssets(blocks)]);
  const template = buildTemplate(issue, blocks, attachmentAssets, fontScale, renderOptions);
  validateTemplate(template);
  const bytes = await generate({
    template,
    inputs: [{}],
    plugins: PLUGINS,
    options: {
      font,
      title: buildPdfTitle(issue),
      subject: "常会案内",
      lang: "ja",
    },
  });

  return {
    bytes,
    templatePageCount: template.schemas.length,
  };
}
