import { generate } from "@pdfme/generator";
import { BLANK_A4_PDF } from "@pdfme/common";
import { image, text } from "@pdfme/schemas";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MM_TO_PX = 96 / 25.4;
const PT_TO_PX = 96 / 72;
const BODY_FONT_FAMILY = '"Yu Gothic", "Hiragino Sans", sans-serif';
const TITLE_FONT_FAMILY = '"Yu Mincho", "Hiragino Mincho ProN", serif';
const BODY_FONT_NAME = "JokaiBody";
const BODY_BOLD_FONT_NAME = "JokaiBodyBold";
const TITLE_FONT_NAME = "JokaiTitle";
const COLOR_BLACK = "#111111";
const COLOR_RED = "#d0261a";
const FOOTER_CONTACT_LINES = ["平古場生産組合", "組合長　古川 豊", "☎090-7581-7819"];
const FOOTER_GAP_ABOVE_MM = 4.5;
const BLANK_PAGE_PADDING_BOTTOM_MM = Array.isArray(BLANK_A4_PDF.padding)
  ? Number(BLANK_A4_PDF.padding[2] || 0)
  : 0;
// Keep footer boxes above pdfme's blank-page bottom padding.
const FOOTER_BOX_SLACK_MM = 0.6;
const FOOTER_BOTTOM_MARGIN_MM = BLANK_PAGE_PADDING_BOTTOM_MM + FOOTER_BOX_SLACK_MM;
const FOOTER_LEFT_X = 14;
const FOOTER_LEFT_WIDTH = 128;
const FOOTER_RIGHT_X = 152;
const FOOTER_RIGHT_WIDTH = 42;
const FOOTER_NOTE_FONT_SIZE = 9;
const FOOTER_NOTE_LINE_HEIGHT = 1.22;
const FOOTER_CONTACT_FONT_SIZE = 8.6;
const FOOTER_CONTACT_LINE_HEIGHT = 1.22;
const PLUGINS = {
  Text: text,
  Image: image,
};

const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");
const fontCache = new Map();
const attachmentDataUrlCache = new Map();

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
  const date = issue.meeting_date ? dateLabel(issue.meeting_date) : "日付未設定";
  const time = issue.meeting_time ? ` 午後${toJapaneseTime(issue.meeting_time)}時より` : "";
  return `日時 ${date}${time}`;
}

function toJapaneseTime(value) {
  const [hoursRaw, minutesRaw] = String(value || "").split(":");
  const hours = Number(hoursRaw || 0);
  const minutes = Number(minutesRaw || 0);
  if (!minutes) {
    return String(hours);
  }
  return `${hours}時${minutes}分`;
}

function labelForBlockKind(blockKind) {
  switch (blockKind) {
    case "agenda":
      return "常会事項";
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

let fontPromise = null;

async function loadFonts() {
  if (!fontPromise) {
    fontPromise = Promise.all([
      fetch("/assets/fonts/body.ttf").then((response) => response.arrayBuffer()),
      fetch("/assets/fonts/body-bold.ttf").then((response) => response.arrayBuffer()),
      fetch("/assets/fonts/title.ttf").then((response) => response.arrayBuffer()),
    ]).then(([body, bodyBold, title]) => ({
      [BODY_FONT_NAME]: { data: body, fallback: true },
      [BODY_BOLD_FONT_NAME]: { data: bodyBold },
      [TITLE_FONT_NAME]: { data: title },
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
      fetch(url)
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
                return {
                  dataUrl: await dataUrlFromUrl(
                    attachment.thumbnail_url,
                    attachment.display_kind === "pdf" ? "PDF" : "IMAGE",
                  ),
                  filename: attachment.original_filename || `資料${index + 1}`,
                };
              }
              return {
                dataUrl: svgDataUrl("FILE", "#d7d7d7"),
                filename: attachment.original_filename || `資料${index + 1}`,
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

function computeFooterLayout(issue) {
  const noteText = normalizeText(issue.footer_note);
  const noteBlock = wrapText(noteText, {
    widthMm: FOOTER_LEFT_WIDTH,
    fontSizePt: FOOTER_NOTE_FONT_SIZE,
    lineHeight: FOOTER_NOTE_LINE_HEIGHT,
    fontFamily: BODY_FONT_FAMILY,
  });
  const noteLines = noteBlock.lines || [];
  const contactHeight = textBlockHeightMm(
    FOOTER_CONTACT_FONT_SIZE,
    FOOTER_CONTACT_LINE_HEIGHT,
    FOOTER_CONTACT_LINES.length,
  );
  const contentHeight = Math.max(noteBlock.heightMm, contactHeight, 0);
  return {
    noteText,
    noteLines,
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

function addContinuationMarker(page) {
  page.push(
    createTextSchema({
      name: `continued-${page.length}`,
      x: 16,
      y: A4_HEIGHT_MM - 12,
      width: 40,
      height: 4,
      content: "次頁へ続く",
      fontSize: 8,
      fontName: BODY_BOLD_FONT_NAME,
      fontColor: COLOR_RED,
    }),
  );
}

function addFinalPageFooter(page, issue, footerLayout) {
  const noteText = normalizeText(issue.footer_note);
  if (noteText) {
    page.push(
      createTextSchema({
        name: `footer-note-${page.length}`,
        x: FOOTER_LEFT_X,
        y: footerLayout.footerTop + Math.max(0, footerLayout.contentHeight - footerLayout.noteHeight),
        width: FOOTER_LEFT_WIDTH,
        height: footerLayout.noteHeight + 0.5,
        content: noteText,
        fontName: BODY_BOLD_FONT_NAME,
        fontSize: FOOTER_NOTE_FONT_SIZE,
        lineHeight: FOOTER_NOTE_LINE_HEIGHT,
        fontColor: COLOR_RED,
      }),
    );
  }

  const lineHeightMm = textBlockHeightMm(FOOTER_CONTACT_FONT_SIZE, FOOTER_CONTACT_LINE_HEIGHT, 1);
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
        fontSize: FOOTER_CONTACT_FONT_SIZE,
        lineHeight: FOOTER_CONTACT_LINE_HEIGHT,
        alignment: "right",
      }),
    );
  });
}

function addFirstPageHeader(page, issue) {
  const title = normalizeText(issue.title) || "平古場生産組合　常会の案内";
  page.push(
    createTextSchema({
      name: `title-${page.length}`,
      x: 12,
      y: 10,
      width: 138,
      height: 12,
      content: title,
      fontName: TITLE_FONT_NAME,
      fontSize: 15.5,
      lineHeight: 1.1,
    }),
  );
  page.push(
    createTextSchema({
      name: `meeting-${page.length}`,
      x: 14,
      y: 24,
      width: 132,
      height: 6,
      content: meetingLine(issue),
      fontName: BODY_BOLD_FONT_NAME,
      fontSize: 9.4,
      lineHeight: 1.3,
    }),
  );
  page.push(
    createTextSchema({
      name: `place-${page.length}`,
      x: 14,
      y: 31,
      width: 132,
      height: 5,
      content: `場所　${normalizeText(issue.place) || "未設定"}`,
      fontSize: 8.8,
      lineHeight: 1.2,
    }),
  );
  page.push(
    createTextSchema({
      name: `month-${page.length}`,
      x: 14,
      y: 37,
      width: 132,
      height: 5,
      content: normalizeText(issue.issue_month) ? `対象月　${monthLabel(issue.issue_month)}` : "",
      fontSize: 8.8,
      lineHeight: 1.2,
    }),
  );

  if (normalizeText(issue.header_note)) {
    const noteBlock = wrapText(issue.header_note, {
      widthMm: 132,
      fontSizePt: 8.6,
      lineHeight: 1.25,
      fontFamily: BODY_FONT_FAMILY,
    });
    page.push(
      createTextSchema({
        name: `note-${page.length}`,
        x: 22,
        y: 45,
        width: 124,
        height: Math.max(noteBlock.heightMm + 1.2, 5),
        content: normalizeText(issue.header_note),
        fontSize: 8.6,
        fontName: BODY_BOLD_FONT_NAME,
        lineHeight: 1.25,
        fontColor: COLOR_RED,
      }),
    );
    return 45 + Math.max(noteBlock.heightMm + 2.4, 7.5);
  }

  page.push(
    createTextSchema({
      name: `main-heading-${page.length}`,
      x: 12,
      y: 53,
      width: 60,
      height: 6,
      content: "常会事項",
      fontName: BODY_BOLD_FONT_NAME,
      fontSize: 12,
      lineHeight: 1.1,
    }),
  );

  return 61;
}

function addContinuationHeader(page, issue, pageNumber) {
  page.push(
    createTextSchema({
      name: `continuation-title-${page.length}`,
      x: 12,
      y: 10,
      width: 140,
      height: 9,
      content: `${normalizeText(issue.title) || "常会案内"}（続き ${pageNumber}頁）`,
      fontName: TITLE_FONT_NAME,
      fontSize: 11.8,
      lineHeight: 1.1,
    }),
  );
  return 24;
}

function itemMarker(index) {
  const markers = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];
  return markers[index] || `${index + 1}.`;
}

function normalizeItemRows(block) {
  if (Array.isArray(block.items) && block.items.length) {
    return block.items;
  }
  return [
    {
      id: "",
      heading: "",
      body: "",
      audience_label: "",
      due_date: "",
      note: "",
      sort_order: 1,
      attachments: [],
    },
  ];
}

function computeSectionHeadingGeometry(block, index) {
  const sectionTitle = `${index + 1}. ${block.heading || labelForBlockKind(block.block_kind)}`;
  const titleBlock = wrapText(sectionTitle, {
    widthMm: 128,
    fontSizePt: 10.8,
    lineHeight: 1.18,
    fontFamily: BODY_FONT_FAMILY,
  });
  return {
    height: Math.max(titleBlock.heightMm + 0.8, 5.8),
    content: sectionTitle,
  };
}

function computeItemGeometry(item, assets, itemIndex) {
  const titleText = normalizeText(item.heading)
    ? `${itemMarker(itemIndex)} ${normalizeText(item.heading)}`
    : itemMarker(itemIndex);
  const headingBlock = wrapText(titleText, {
    widthMm: 110,
    fontSizePt: 9.4,
    lineHeight: 1.2,
    fontFamily: BODY_FONT_FAMILY,
  });
  const bodyBlock = wrapText(item.body, {
    widthMm: 110,
    fontSizePt: 8.35,
    lineHeight: 1.34,
    fontFamily: BODY_FONT_FAMILY,
  });
  const metaParts = [
    normalizeText(item.note),
    normalizeText(item.audience_label) ? `対象者:${normalizeText(item.audience_label)}` : "",
    item.due_date ? `期限:${dateLabel(item.due_date)}` : "",
  ].filter(Boolean);
  const metaText = metaParts.join(" ");
  const metaBlock = wrapText(metaText, {
    widthMm: 110,
    fontSizePt: 8.3,
    lineHeight: 1.2,
    fontFamily: BODY_FONT_FAMILY,
  });

  const mainHeight =
    Math.max(
      4.8,
      headingBlock.heightMm +
        (bodyBlock.heightMm ? bodyBlock.heightMm + 1.1 : 0) +
        (metaBlock.heightMm ? metaBlock.heightMm + 0.8 : 0),
    ) + 1.1;

  const sideHeight = assets.length ? assets.length * 16.6 + Math.max(0, assets.length - 1) * 2.6 : 0;
  return {
    titleText,
    headingText: headingBlock,
    bodyText: bodyBlock,
    metaText,
    metaHeight: metaBlock.heightMm,
    rowHeight: Math.max(mainHeight, sideHeight, 8.4),
  };
}

function addSectionHeading(page, block, index, rowTop) {
  const { content, height } = computeSectionHeadingGeometry(block, index);
  page.push(
    createTextSchema({
      name: `section-${page.length}`,
      x: 14,
      y: rowTop,
      width: 132,
      height,
      content,
      fontName: BODY_BOLD_FONT_NAME,
      fontSize: 10.8,
      lineHeight: 1.18,
    }),
  );
  return height + 1.2;
}

function addItemRow(page, block, item, assets, itemIndex, rowTop) {
  const sideX = 146;
  const headingX = 18;
  const { titleText, headingText, bodyText, metaText, metaHeight, rowHeight } = computeItemGeometry(
    item,
    assets,
    itemIndex,
  );

  page.push(
    createTextSchema({
      name: `item-heading-${page.length}`,
      x: headingX,
      y: rowTop,
      width: 110,
      height: Math.max(headingText.heightMm + 0.4, 4.6),
      content: titleText,
      fontName: BODY_FONT_NAME,
      fontSize: 9.4,
      lineHeight: 1.2,
    }),
  );

  let cursorY = rowTop + Math.max(headingText.heightMm, 4.6) + 0.5;
  if (bodyText.heightMm) {
    page.push(
      createTextSchema({
        name: `item-body-${page.length}`,
        x: headingX,
        y: cursorY,
        width: 110,
        height: bodyText.heightMm + 0.5,
        content: normalizeText(item.body),
        fontSize: 8.35,
        lineHeight: 1.34,
      }),
    );
    cursorY += bodyText.heightMm + 0.7;
  }

  if (metaText) {
    page.push(
      createTextSchema({
        name: `item-meta-${page.length}`,
        x: headingX,
        y: cursorY,
        width: 110,
        height: metaHeight + 0.5,
        content: metaText,
        fontSize: 8.3,
        fontName: BODY_BOLD_FONT_NAME,
        lineHeight: 1.2,
        fontColor: COLOR_RED,
      }),
    );
  }

  assets.forEach((asset, assetIndex) => {
    const itemTop = rowTop + assetIndex * 19.2;
    page.push(
      createImageSchema({
        name: `thumb-${page.length}`,
        x: sideX,
        y: itemTop,
        width: 22,
        height: 13.2,
        content: asset.dataUrl,
      }),
    );
    page.push(
      createTextSchema({
        name: `thumb-label-${page.length}`,
        x: sideX + 24.4,
        y: itemTop + 0.3,
        width: 24,
        height: 11,
        content: `【${labelForBlockKind(block.block_kind)}】\n対象者:${normalizeText(item.audience_label) || "全員"}`,
        fontSize: 7.4,
        fontName: BODY_BOLD_FONT_NAME,
        lineHeight: 1.22,
        fontColor: COLOR_RED,
      }),
    );
  });

  return rowHeight;
}

function buildTemplate(issue, blocks, attachmentAssets) {
  const footerLayout = computeFooterLayout(issue);
  const pages = [];
  let page = createPageTemplate();
  pages.push(page);
  let cursorY = addFirstPageHeader(page, issue) + 2.8;
  let printedCount = 0;

  blocks.forEach((block, index) => {
    const items = normalizeItemRows(block);
    const firstAssets = attachmentAssets.get(attachmentAssetKey(block, items[0])) || [];
    const estimatedFirstRow =
      computeSectionHeadingGeometry(block, index).height +
      computeItemGeometry(items[0], firstAssets, 0).rowHeight +
      4;
    const remaining = A4_HEIGHT_MM - 16 - cursorY;
    if (remaining < estimatedFirstRow && index > 0) {
      addContinuationMarker(page);
      page = createPageTemplate();
      pages.push(page);
      cursorY = addContinuationHeader(page, issue, pages.length) + 2;
    }

    cursorY += addSectionHeading(page, block, index, cursorY);

    items.forEach((item, itemIndex) => {
      const assets = attachmentAssets.get(attachmentAssetKey(block, item)) || [];
      const rowHeight = computeItemGeometry(item, assets, itemIndex).rowHeight;
      if (A4_HEIGHT_MM - 16 - cursorY < rowHeight && itemIndex > 0) {
        addContinuationMarker(page);
        page = createPageTemplate();
        pages.push(page);
        cursorY = addContinuationHeader(page, issue, pages.length) + 2;
        cursorY += addSectionHeading(page, block, index, cursorY);
      }
      const actualHeight = addItemRow(page, block, item, assets, itemIndex, cursorY);
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
        fontSize: 9.5,
        lineHeight: 1.2,
      }),
    );
  }

  addFinalPageFooter(page, issue, footerLayout);

  return {
    basePdf: BLANK_A4_PDF,
    schemas: pages,
  };
}

function buildPdfTitle(issue) {
  return normalizeText(issue.title) || "jokai-notice";
}

export function pdfFileName(issue) {
  const base = buildPdfTitle(issue)
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .trim();
  return `${base || "jokai-notice"}.pdf`;
}

export async function buildNoticePdfDocument(issue, blocks) {
  const [font, attachmentAssets] = await Promise.all([loadFonts(), buildAttachmentAssets(blocks)]);
  const template = buildTemplate(issue, blocks, attachmentAssets);
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
    template,
  };
}
