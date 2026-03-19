import { generate } from "@pdfme/generator";
import { mm2pt } from "@pdfme/common";
import { svg } from "@pdfme/schemas";

import {
  missingTemplatePayloadKeys,
  normalizeTemplatePayload,
  templatePayloadRows,
  templateDefinition,
  templateDocumentAutoTitle,
} from "./template-doc-registry.js";

const BODY_FONT_NAME = "JokaiBody";
const BODY_BOLD_FONT_NAME = "JokaiBodyBold";
const TITLE_FONT_NAME = "JokaiTitle";
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const INKSCAPE_NS = "http://www.inkscape.org/namespaces/inkscape";
const TOKEN_PATTERN = /\$[A-Za-z_][A-Za-z0-9_]*/g;
const SVG_FONT_CACHE_KEY = "template-doc-svg-embedded-fonts";

let fontPromise = null;

function isValidSvgString(svgString) {
  return (
    typeof svgString === "string" &&
    svgString.includes("<svg") &&
    svgString.includes("</svg>")
  );
}

const svgWithFonts = {
  ...svg,
  pdf: async (arg) => {
    const { page, schema, value, options, _cache } = arg;
    if (!value || !isValidSvgString(value)) {
      return;
    }
    if (!_cache.has(SVG_FONT_CACHE_KEY)) {
      const sourceFonts = options?.fonts || options?.font || {};
      const embeddedFonts = {};
      for (const [fontName, fontEntry] of Object.entries(sourceFonts)) {
        if (!fontEntry?.data) {
          continue;
        }
        embeddedFonts[fontName] = await page.doc.embedFont(fontEntry.data);
      }
      _cache.set(SVG_FONT_CACHE_KEY, embeddedFonts);
    }
    const embeddedFonts = _cache.get(SVG_FONT_CACHE_KEY) || {};
    const pageHeight = page.getHeight();
    const width = mm2pt(schema.width);
    const height = mm2pt(schema.height);
    const x = mm2pt(schema.position.x);
    const y = pageHeight - mm2pt(schema.position.y) - height;
    await page.drawSvg(value, {
      x,
      y: y + height,
      width,
      height,
      fonts: embeddedFonts,
    });
  },
};

async function loadFonts() {
  if (!fontPromise) {
    fontPromise = Promise.all([
      fetch("/assets/fonts/body.ttf").then((response) => response.arrayBuffer()),
      fetch("/assets/fonts/body-bold.ttf").then((response) => response.arrayBuffer()),
      fetch("/assets/fonts/title.ttf").then((response) => response.arrayBuffer()),
    ]).then(([bodyFont, bodyBoldFont, titleFont]) => ({
      [BODY_FONT_NAME]: { data: bodyFont, fallback: true },
      [BODY_BOLD_FONT_NAME]: { data: bodyBoldFont },
      [TITLE_FONT_NAME]: { data: titleFont },
    }));
  }

  return fontPromise;
}

function replaceTemplateTokens(svgDocument, payload) {
  const textNodes = [];
  const walker = svgDocument.createTreeWalker(svgDocument, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach((node) => {
    if (!String(node.nodeValue || "").includes("$")) {
      return;
    }
    node.nodeValue = String(node.nodeValue || "").replace(TOKEN_PATTERN, (match) => {
      const value = payload[match.slice(1)];
      return value == null ? "" : String(value);
    });
  });
}

function applySvgFontDefaults(svgDocument) {
  const root = svgDocument.documentElement;
  root.setAttribute("font-family", BODY_FONT_NAME);
  root.setAttribute("width", `${A4_WIDTH_MM}mm`);
  root.setAttribute("height", `${A4_HEIGHT_MM}mm`);
  root.querySelectorAll("text, tspan").forEach((element) => {
    if (!element.getAttribute("font-family")) {
      element.setAttribute("font-family", BODY_FONT_NAME);
    }
  });
}

function collectBindingAnchors(svgDocument) {
  return Array.from(svgDocument.querySelectorAll("*")).filter((element) => {
    return (
      element.getAttributeNS(INKSCAPE_NS, "label") ||
      element.getAttribute("inkscape:label")
    );
  });
}

function renderTemplateSvg(documentFamily, templateKey, payloadInput = {}) {
  const definition = templateDefinition(documentFamily, templateKey);
  const rows = templatePayloadRows(documentFamily, templateKey, payloadInput);
  if (!rows.length) {
    throw new Error("PDF生成に必要な行がありません。");
  }
  const payload = rows[0];
  const missing = missingTemplatePayloadKeys(documentFamily, templateKey, { rows: [payload] });
  if (missing.length) {
    throw new Error(
      `PDF生成に必要なキーが不足しています: ${missing.map((binding) => binding.key).join(", ")}`,
    );
  }

  const parsed = new DOMParser().parseFromString(definition.svg_source, "image/svg+xml");
  if (parsed.querySelector("parsererror")) {
    throw new Error("SVG テンプレートの解析に失敗しました。");
  }

  applySvgFontDefaults(parsed);
  replaceTemplateTokens(parsed, payload);

  const bindingAnchors = collectBindingAnchors(parsed);
  bindingAnchors.forEach((element) => {
    const label =
      element.getAttributeNS(INKSCAPE_NS, "label") || element.getAttribute("inkscape:label") || "";
    if (!label.startsWith("bind:")) {
      return;
    }
    element.setAttribute("data-bind", label.slice("bind:".length));
  });

  return {
    definition,
    payload,
    svgString: new XMLSerializer().serializeToString(parsed.documentElement),
  };
}

function sanitizePdfFilePart(value, fallback) {
  const sanitized = String(value ?? "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || fallback;
}

export function templateDocumentPdfFileName(document, payloadInput = document?.payload || {}) {
  const title = sanitizePdfFilePart(
    templateDocumentAutoTitle(document?.document_family, document?.template_key, payloadInput),
    "template-document",
  );
  return `${title}.pdf`;
}

export async function buildTemplateDocumentPdfDocument(document, payloadInput = document?.payload || {}) {
  const rows = templatePayloadRows(document.document_family, document.template_key, payloadInput);
  if (!rows.length) {
    throw new Error("PDF生成に必要な行がありません。");
  }
  const renderedRows = rows.map((row) =>
    renderTemplateSvg(document.document_family, document.template_key, { rows: [row] }),
  );
  const { definition } = renderedRows[0];
  const font = await loadFonts();
  const template = {
    basePdf: { width: A4_WIDTH_MM, height: A4_HEIGHT_MM, padding: [0, 0, 0, 0] },
    schemas: renderedRows.map(({ svgString }) => [
      {
        name: "template-svg",
        type: "svg",
        position: { x: 0, y: 0 },
        width: A4_WIDTH_MM,
        height: A4_HEIGHT_MM,
        content: svgString,
        readOnly: true,
      },
    ]),
  };

  const bytes = await generate({
    template,
    inputs: renderedRows.map(() => ({})),
    plugins: {
      svg: svgWithFonts,
    },
    options: {
      font,
      fonts: font,
      title: templateDocumentAutoTitle(
        document.document_family,
        document.template_key,
        payloadInput,
      ),
      subject: definition.label,
      lang: "ja",
    },
  });

  return {
    bytes,
    template,
    svgStrings: renderedRows.map(({ svgString }) => svgString),
    payload: normalizeTemplatePayload(document.document_family, document.template_key, payloadInput),
  };
}
