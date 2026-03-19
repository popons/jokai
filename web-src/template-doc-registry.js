import shogaiKyosaiJoinRenewalSvg from "../20260319-templ-shogai-kyosai.svg?raw";

export const ISSUE_FAMILY_KEY = "issues";
export const SHOGAI_KYOSAI_FAMILY_KEY = "shogai_kyosai";
export const SHOGAI_KYOSAI_JOIN_RENEWAL_TEMPLATE_KEY = "join_renewal";

const TEMPLATE_DEFINITIONS = [
  {
    document_family: SHOGAI_KYOSAI_FAMILY_KEY,
    template_key: SHOGAI_KYOSAI_JOIN_RENEWAL_TEMPLATE_KEY,
    label: "加入更新調査",
    title_prefix: "農作業中傷害共済 加入更新調査",
    template_asset_path: "20260319-templ-shogai-kyosai.svg",
    template_version: "20260319",
    svg_source: shogaiKyosaiJoinRenewalSvg,
    bindings: [
      {
        key: "contract_holder",
        label: "contract_holder_name",
        description: "契約者名",
        required: true,
        placeholder: "例: 古川 司朗",
        inputmode: "text",
      },
      {
        key: "age_previous",
        label: "response_age_previous_year",
        description: "応答日前年齢",
        required: true,
        placeholder: "例: 47",
        inputmode: "numeric",
      },
      {
        key: "age_current",
        label: "response_age_current_year",
        description: "契約応答日時年齢",
        required: true,
        placeholder: "例: 48",
        inputmode: "numeric",
      },
      {
        key: "ending_disability",
        label: "ending_disability_amount",
        description: "終了契約の死亡・後遺症傷害",
        required: true,
        placeholder: "例: 500万円",
        inputmode: "text",
      },
      {
        key: "ending_medical",
        label: "ending_medical_amount",
        description: "終了契約の治療共済金額",
        required: true,
        placeholder: "例: 5,000円",
        inputmode: "text",
      },
      {
        key: "ending_date",
        label: "ending_contract_date",
        description: "終了契約の契約日",
        required: true,
        placeholder: "例: 06/05",
        inputmode: "text",
      },
      {
        key: "ending_premium",
        label: "ending_premium_amount",
        description: "終了契約の共済掛金",
        required: true,
        placeholder: "例: 18,950円",
        inputmode: "text",
      },
    ],
  },
];

const templateDefinitionMap = new Map(
  TEMPLATE_DEFINITIONS.map((definition) => [
    `${definition.document_family}:${definition.template_key}`,
    Object.freeze({
      ...definition,
      bindings: Object.freeze(definition.bindings.map((binding) => Object.freeze({ ...binding }))),
    }),
  ]),
);

export const FAMILY_DEFINITIONS = Object.freeze({
  [ISSUE_FAMILY_KEY]: Object.freeze({
    key: ISSUE_FAMILY_KEY,
    label: "常会案内",
    eyebrow: "JOKAI NOTICE",
    lead: "いつもの常会案内を作成し、本文 block と資料サムネを整えるファミリーです。",
    index_path: "/issues",
  }),
  [SHOGAI_KYOSAI_FAMILY_KEY]: Object.freeze({
    key: SHOGAI_KYOSAI_FAMILY_KEY,
    label: "農作業傷害共済",
    eyebrow: "TEMPLATE DOCUMENT",
    lead: "SVG テンプレに JSON を bind して、固定帳票 PDF を出力するファミリーです。",
    index_path: "/template-documents",
  }),
});

export function normalizeFamilyKey(value) {
  return value === SHOGAI_KYOSAI_FAMILY_KEY ? SHOGAI_KYOSAI_FAMILY_KEY : ISSUE_FAMILY_KEY;
}

export function familyDefinition(familyKey) {
  return FAMILY_DEFINITIONS[normalizeFamilyKey(familyKey)];
}

export function familyIndexPath(familyKey) {
  return familyDefinition(familyKey).index_path;
}

export function templateDefinition(documentFamily, templateKey) {
  return (
    templateDefinitionMap.get(`${documentFamily}:${templateKey}`) ||
    templateDefinitionMap.get(
      `${SHOGAI_KYOSAI_FAMILY_KEY}:${SHOGAI_KYOSAI_JOIN_RENEWAL_TEMPLATE_KEY}`,
    )
  );
}

export function familyTemplateDefinitions(documentFamily) {
  return TEMPLATE_DEFINITIONS.filter((definition) => definition.document_family === documentFamily).map(
    (definition) => templateDefinition(definition.document_family, definition.template_key),
  );
}

export function blankTemplatePayloadRow(documentFamily, templateKey) {
  const definition = templateDefinition(documentFamily, templateKey);
  return Object.fromEntries(definition.bindings.map((binding) => [binding.key, ""]));
}

export function defaultTemplatePayload(documentFamily, templateKey) {
  return {
    rows: [blankTemplatePayloadRow(documentFamily, templateKey)],
  };
}

function normalizeTemplatePayloadRow(definition, row = {}) {
  return Object.fromEntries(
    definition.bindings.map((binding) => [
      binding.key,
      String(row?.[binding.key] ?? "").replace(/\r\n/g, "\n"),
    ]),
  );
}

export function templatePayloadRows(documentFamily, templateKey, payload = {}) {
  const definition = templateDefinition(documentFamily, templateKey);
  if (Array.isArray(payload?.rows)) {
    return payload.rows.map((row) => normalizeTemplatePayloadRow(definition, row));
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return [normalizeTemplatePayloadRow(definition, payload)];
  }
  return [blankTemplatePayloadRow(documentFamily, templateKey)];
}

export function templateRowHasAnyValue(documentFamily, templateKey, row = {}) {
  return templateDefinition(documentFamily, templateKey).bindings.some(
    (binding) => String(row?.[binding.key] ?? "").trim() !== "",
  );
}

export function normalizeTemplatePayload(documentFamily, templateKey, payload = {}) {
  return {
    rows: templatePayloadRows(documentFamily, templateKey, payload),
  };
}

export function templatePayloadActiveRowCount(documentFamily, templateKey, payload = {}) {
  return templatePayloadRows(documentFamily, templateKey, payload).filter((row) =>
    templateRowHasAnyValue(documentFamily, templateKey, row),
  ).length;
}

export function missingTemplatePayloadKeys(documentFamily, templateKey, payload = {}) {
  const definition = templateDefinition(documentFamily, templateKey);
  const rows = templatePayloadRows(documentFamily, templateKey, payload);
  if (!rows.length) {
    return [
      {
        rowIndex: null,
        rowLabel: "行なし",
        key: "rows",
        description: "契約者行を1件以上追加してください",
      },
    ];
  }
  return rows.flatMap((row, rowIndex) =>
    definition.bindings
      .filter((binding) => binding.required && !String(row?.[binding.key] ?? "").trim())
      .map((binding) => ({
        rowIndex,
        rowLabel: `${rowIndex + 1}行目`,
        key: binding.key,
        description: binding.description,
      })),
  );
}

export function templatePayloadText(documentFamily, templateKey, payload = {}) {
  return JSON.stringify(normalizeTemplatePayload(documentFamily, templateKey, payload), null, 2);
}

function templateTitleDate(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function templateDocumentAutoTitle(documentFamily, templateKey, payload = {}, now = new Date()) {
  const definition = templateDefinition(documentFamily, templateKey);
  return `${definition.title_prefix} / ${templateTitleDate(now)} / ${templatePayloadActiveRowCount(documentFamily, templateKey, payload)}件`;
}

export function templateLabel(documentFamily, templateKey) {
  return templateDefinition(documentFamily, templateKey).label;
}
