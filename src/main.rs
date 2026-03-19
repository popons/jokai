/* use  **************************************************************************************************/

use axum::{
  Json, Router,
  extract::{DefaultBodyLimit, Multipart, Path as RoutePath, State},
  http::{StatusCode, header},
  response::{Html, IntoResponse},
  routing::{delete, get, post},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use chrono::{DateTime, Local, Utc};
use clap::{ArgAction, Args, Parser, Subcommand, ValueHint};
use color_eyre::eyre::{Context, Result, bail, eyre};
use include_dir::{Dir, include_dir};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio_postgres::{Client, NoTls};
use tracing::{error, info};
use tracing_error::ErrorLayer;
use tracing_subscriber::{EnvFilter, prelude::*};
use url::Url;

/* mod  **************************************************************************************************/

/* type alias  *******************************************************************************************/

type ApiResult<T> = std::result::Result<Json<T>, (StatusCode, String)>;

/* global const  *****************************************************************************************/

const BUILD_TIMESTAMP_UTC: &str = env!("BUILD_TIMESTAMP_UTC");
const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@10.0.0.100:5432/jokai";
const DEFAULT_DATABASE_ADMIN_URL: &str = "postgresql://postgres:postgres@10.0.0.100:5432/postgres";
const DEFAULT_BIND: &str = "0.0.0.0:12040";
const DEFAULT_MEETING_PLACE: &str = "平古場自治公民館";
const MIGRATION_TABLE: &str = "app_schema_migrations";
const FRONTEND_APP_CSS: &str = "app.css";
const FRONTEND_APP_JS: &str = "app.js";
const FRONTEND_FONT_BODY: &str = "body.ttf";
const FRONTEND_FONT_BODY_BOLD: &str = "body-bold.ttf";
const FRONTEND_FONT_TITLE: &str = "title.ttf";
const CURRENT_LAYOUT_VERSION: &str = "notice-pdf-layout-v2";
const CURRENT_FONT_VERSION: &str = "noto-sans-jp-static-v2";
const CURRENT_RENDERER_VERSION: &str = "pdfme-raster-v2";
const FAMILY_TAB_ISSUES: &str = "issues";
const TEMPLATE_DOCUMENT_FAMILY_SHOGAI_KYOSAI: &str = "shogai_kyosai";
const TEMPLATE_DOCUMENT_KEY_JOIN_RENEWAL: &str = "join_renewal";
const TEMPLATE_DOCUMENT_ASSET_PATH_SHOGAI_KYOSAI: &str = "20260319-templ-shogai-kyosai.svg";
const TEMPLATE_DOCUMENT_VERSION_SHOGAI_KYOSAI: &str = "20260319";
const TEMPLATE_DOCUMENT_STATUS_DRAFT: &str = "draft";
const NOTICE_PREVIEW_RENDER_DPI: u16 = 216;
static EMBEDDED_FRONTEND_DIST: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/web-dist");
static EMBEDDED_PAPER_FONT_BODY_BYTES: &[u8] = include_bytes!(concat!(
  env!("CARGO_MANIFEST_DIR"),
  "/bundled-assets/fonts/NotoSansJP-Regular.ttf"
));
static EMBEDDED_PAPER_FONT_BODY_BOLD_BYTES: &[u8] = include_bytes!(concat!(
  env!("CARGO_MANIFEST_DIR"),
  "/bundled-assets/fonts/NotoSansJP-Bold.ttf"
));
static EMBEDDED_PAPER_FONT_TITLE_BYTES: &[u8] = include_bytes!(concat!(
  env!("CARGO_MANIFEST_DIR"),
  "/bundled-assets/fonts/NotoSansJP-Bold.ttf"
));
static EMBEDDED_TEMPLATE_DOCUMENT_SVG_SHOGAI_KYOSAI: &str = include_str!(concat!(
  env!("CARGO_MANIFEST_DIR"),
  "/20260319-templ-shogai-kyosai.svg"
));

/* trait  ************************************************************************************************/

/* enum  *************************************************************************************************/

#[derive(Debug, Subcommand)]
enum Commands {
  Web(WebArgs),
  Db(DbCli),
}

#[derive(Debug, Subcommand)]
enum DbCommand {
  Init(DbArgs),
  Migrate(DbArgs),
  Status(DbArgs),
  Reset(DbResetArgs),
}

/* struct  ***********************************************************************************************/

#[derive(Debug, Parser)]
#[command(disable_version_flag = true)]
struct Cli {
  #[arg(short = 'V', long = "version", action = ArgAction::SetTrue)]
  version: bool,
  #[command(subcommand)]
  command: Option<Commands>,
}

#[derive(Debug, Args)]
struct WebArgs {
  #[arg(long, env = "DATABASE_URL", default_value = DEFAULT_DATABASE_URL)]
  database_url: String,
  #[arg(long, env = "JOKAI_BIND", default_value = DEFAULT_BIND)]
  bind: String,
}

#[derive(Debug, Args)]
struct DbCli {
  #[command(subcommand)]
  command: DbCommand,
}

#[derive(Debug, Clone, Args)]
struct DbArgs {
  #[arg(long, env = "DATABASE_URL", default_value = DEFAULT_DATABASE_URL)]
  database_url: String,
  #[arg(
    long,
    env = "DATABASE_ADMIN_URL",
    default_value = DEFAULT_DATABASE_ADMIN_URL
  )]
  admin_database_url: String,
  #[arg(long, env = "JOKAI_LEGACY_STORAGE_DIR", value_hint = ValueHint::DirPath)]
  legacy_storage_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Args)]
struct DbResetArgs {
  #[command(flatten)]
  common: DbArgs,
  #[arg(long, action = ArgAction::SetTrue)]
  yes: bool,
}

#[derive(Debug, Clone)]
struct AppState {
  client: Arc<Client>,
  runtime_dir: PathBuf,
  database_url_redacted: String,
  applied_migrations: Arc<Vec<String>>,
  #[allow(dead_code)]
  loopback_base_url: String,
  #[allow(dead_code)]
  pdf_browser_cmd: Option<String>,
  pdftoppm_cmd: Option<String>,
}

#[derive(Debug, Serialize)]
struct MetaResponse {
  app: &'static str,
  database_url: String,
  runtime_dir: String,
  applied_migrations: Vec<String>,
}

#[derive(Debug, Serialize)]
struct IssueListItem {
  id: String,
  issue_type: String,
  status: String,
  title: String,
  issue_month: Option<String>,
  place: String,
  published_at: Option<String>,
  block_count: i64,
}

#[derive(Debug, Serialize)]
struct IssueDocumentResponse {
  issue: IssueDocumentIssue,
  blocks: Vec<IssueDocumentBlock>,
}

#[derive(Debug, Serialize)]
struct IssueDocumentIssue {
  id: String,
  issue_type: String,
  status: String,
  title: String,
  issue_month: Option<String>,
  meeting_date: Option<String>,
  meeting_time: Option<String>,
  place: String,
  header_note: String,
  footer_note: String,
  published_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct IssueDocumentBlock {
  id: String,
  block_kind: String,
  heading: String,
  sort_order: i32,
  items: Vec<IssueDocumentItem>,
}

#[derive(Debug, Serialize)]
struct IssueDocumentItem {
  id: String,
  heading: String,
  body: String,
  audience_label: String,
  due_date: Option<String>,
  note: String,
  supplements: Vec<IssueDocumentItemSupplement>,
  meta_layout: String,
  thumb_scale_percent: i32,
  sort_order: i32,
  attachments: Vec<IssueDocumentAttachment>,
}

#[derive(Debug, Serialize)]
struct IssueDocumentItemSupplement {
  id: String,
  tone: String,
  content: String,
  sort_order: i32,
}

#[derive(Debug, Serialize)]
struct IssueDocumentAttachment {
  id: String,
  original_filename: String,
  mime_type: String,
  display_kind: String,
  thumbnail_url: String,
  content_url: String,
}

#[derive(Debug)]
struct AttachmentStorageMetadata {
  mime_type: String,
  legacy_original_path: String,
  legacy_thumbnail_path: String,
}

#[derive(Debug, Deserialize)]
struct CreateIssuePayload {
  issue_type: String,
}

#[derive(Debug, Serialize)]
struct CreateIssueResponse {
  id: String,
}

#[derive(Debug, Serialize)]
struct DeleteIssueResponse {
  id: String,
}

#[derive(Debug, Serialize)]
struct DuplicateIssueResponse {
  id: String,
}

#[derive(Debug, Serialize)]
struct TemplateDocumentListItem {
  id: String,
  document_family: String,
  template_key: String,
  status: String,
  title: String,
  template_asset_path: String,
  template_version: String,
  row_count: usize,
  updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct TemplateDocumentResponse {
  document: TemplateDocumentDetail,
}

#[derive(Debug, Serialize)]
struct TemplateDocumentDetail {
  id: String,
  document_family: String,
  template_key: String,
  status: String,
  title: String,
  template_asset_path: String,
  template_version: String,
  row_count: usize,
  payload: serde_json::Value,
  created_at: Option<String>,
  updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateTemplateDocumentPayload {
  document_family: String,
  template_key: String,
}

#[derive(Debug, Deserialize)]
struct SaveTemplateDocumentPayload {
  title: String,
  payload: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct CreateTemplateDocumentResponse {
  id: String,
}

#[derive(Debug, Serialize)]
struct DeleteTemplateDocumentResponse {
  id: String,
}

#[derive(Debug, Serialize)]
struct PreviewRenderResponse {
  images: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SaveIssuePayload {
  issue_type: String,
  title: String,
  #[serde(default)]
  issue_month: String,
  #[serde(default)]
  meeting_date: String,
  #[serde(default)]
  meeting_time: String,
  #[serde(default)]
  place: String,
  #[serde(default)]
  header_note: String,
  #[serde(default)]
  footer_note: String,
  #[serde(default)]
  blocks: Vec<SaveBlockPayload>,
}

#[derive(Debug, Deserialize)]
struct SaveBlockPayload {
  #[allow(dead_code)]
  #[serde(default)]
  id: Option<String>,
  block_kind: String,
  #[serde(default)]
  heading: String,
  #[serde(default)]
  items: Vec<SaveItemPayload>,
}

#[derive(Debug, Deserialize)]
struct SaveItemPayload {
  #[serde(default)]
  id: Option<String>,
  #[serde(default)]
  heading: String,
  #[serde(default)]
  body: String,
  #[serde(default)]
  audience_label: String,
  #[serde(default)]
  due_date: String,
  #[serde(default)]
  note: String,
  #[serde(default)]
  supplements: Vec<SaveItemSupplementPayload>,
  #[serde(default)]
  meta_layout: String,
  #[serde(default = "default_item_thumb_scale_percent")]
  thumb_scale_percent: i32,
}

#[derive(Debug, Deserialize)]
struct SaveItemSupplementPayload {
  #[serde(default)]
  tone: String,
  #[serde(default)]
  content: String,
}

#[derive(Debug, Clone)]
struct NormalizedItemSupplement {
  tone: String,
  content: String,
}

#[derive(Debug, Clone, Copy)]
struct TemplateDocumentDescriptor {
  document_family: &'static str,
  template_key: &'static str,
  title_prefix: &'static str,
  template_asset_path: &'static str,
  template_version: &'static str,
}

#[derive(Debug, Clone, Copy)]
struct TemplateBindingDefinition {
  key: &'static str,
  description: &'static str,
}

/* unsafe impl standard traits  **************************************************************************/

/* impl standard traits  *********************************************************************************/

/* impl custom traits  ***********************************************************************************/

/* impl  *************************************************************************************************/

/* fn  ***************************************************************************************************/

fn init_tracing() -> Result<()> {
  if env::var("RUST_LOG").is_err() {
    unsafe {
      env::set_var("RUST_LOG", "info");
    }
  }

  let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

  tracing_subscriber::registry()
    .with(env_filter)
    .with(tracing_subscriber::fmt::layer())
    .with(ErrorLayer::default())
    .try_init()?;

  Ok(())
}

fn local_build_timestamp() -> Result<String> {
  let built_utc = DateTime::parse_from_rfc3339(BUILD_TIMESTAMP_UTC)?.with_timezone(&Utc);
  let built_local = built_utc.with_timezone(&Local);
  Ok(built_local.format("%Y-%m-%dT%H:%M:%S%:z").to_string())
}

fn version_output() -> Result<String> {
  Ok(format!(
    "{} {} (built {})",
    env!("CARGO_PKG_NAME"),
    env!("CARGO_PKG_VERSION"),
    local_build_timestamp()?
  ))
}

fn has_version_flag() -> bool {
  env::args_os().any(|arg| arg == OsStr::new("-V") || arg == OsStr::new("--version"))
}

fn manifest_db_dir() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join("db")
}

fn asset_content_type(path: &Path) -> &'static str {
  match path
    .extension()
    .and_then(|ext| ext.to_str())
    .unwrap_or_default()
  {
    "js" => "text/javascript; charset=utf-8",
    "css" => "text/css; charset=utf-8",
    "svg" => "image/svg+xml",
    "png" => "image/png",
    "jpg" | "jpeg" => "image/jpeg",
    "woff2" => "font/woff2",
    "woff" => "font/woff",
    "ttf" => "font/ttf",
    _ => "application/octet-stream",
  }
}

fn embedded_frontend_file(path: &str) -> Option<&'static include_dir::File<'static>> {
  EMBEDDED_FRONTEND_DIST.get_file(path).or_else(|| {
    let nested = format!("assets/{path}");
    EMBEDDED_FRONTEND_DIST.get_file(&nested)
  })
}

fn bundled_font_bytes(file_name: &str) -> Result<&'static [u8]> {
  match file_name {
    FRONTEND_FONT_BODY => Ok(EMBEDDED_PAPER_FONT_BODY_BYTES),
    FRONTEND_FONT_BODY_BOLD => Ok(EMBEDDED_PAPER_FONT_BODY_BOLD_BYTES),
    FRONTEND_FONT_TITLE => Ok(EMBEDDED_PAPER_FONT_TITLE_BYTES),
    _ => bail!("unknown frontend font `{file_name}`"),
  }
}

fn default_runtime_dir() -> PathBuf {
  env::temp_dir().join("jokai-runtime")
}

fn ensure_runtime_dirs(runtime_dir: &Path) -> Result<()> {
  fs::create_dir_all(runtime_dir.join("generated")).with_context(|| {
    format!(
      "failed to create {}",
      runtime_dir.join("generated").display()
    )
  })?;
  fs::create_dir_all(preview_render_root(runtime_dir)).with_context(|| {
    format!(
      "failed to create {}",
      preview_render_root(runtime_dir).display()
    )
  })?;
  Ok(())
}

fn quote_ident(input: &str) -> Result<String> {
  if input.is_empty() {
    bail!("identifier must not be empty");
  }

  if input
    .chars()
    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
  {
    return Ok(format!("\"{input}\""));
  }

  bail!("unsupported identifier `{input}`; use only [A-Za-z0-9_]");
}

fn database_name_from_url(database_url: &str) -> Result<String> {
  let parsed = Url::parse(database_url)
    .with_context(|| format!("failed to parse DATABASE_URL `{database_url}`"))?;
  let db_name = parsed
    .path_segments()
    .and_then(|segments| segments.filter(|segment| !segment.is_empty()).next_back())
    .ok_or_else(|| eyre!("DATABASE_URL `{database_url}` is missing a database name"))?;
  Ok(db_name.to_string())
}

fn redact_database_url(database_url: &str) -> String {
  match Url::parse(database_url) {
    Ok(mut parsed) => {
      if parsed.password().is_some() {
        let _ = parsed.set_password(Some("****"));
      }
      parsed.to_string()
    }
    Err(_) => "<invalid DATABASE_URL>".to_string(),
  }
}

fn migration_files(db_dir: &Path) -> Result<Vec<PathBuf>> {
  let mut files = fs::read_dir(db_dir)
    .with_context(|| format!("failed to read {}", db_dir.display()))?
    .filter_map(|entry| entry.ok())
    .map(|entry| entry.path())
    .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("sql"))
    .collect::<Vec<_>>();
  files.sort();
  Ok(files)
}

fn api_bad_request(message: impl Into<String>) -> (StatusCode, String) {
  (StatusCode::BAD_REQUEST, message.into())
}

fn api_not_found(message: impl Into<String>) -> (StatusCode, String) {
  (StatusCode::NOT_FOUND, message.into())
}

fn api_conflict(message: impl Into<String>) -> (StatusCode, String) {
  (StatusCode::CONFLICT, message.into())
}

fn api_internal(message: impl Into<String>) -> (StatusCode, String) {
  (StatusCode::INTERNAL_SERVER_ERROR, message.into())
}

fn validate_issue_type(issue_type: &str) -> std::result::Result<(), (StatusCode, String)> {
  match issue_type {
    "normal" | "correction" | "no_meeting" | "one_off" => Ok(()),
    _ => Err(api_bad_request(format!(
      "unsupported issue_type `{issue_type}`"
    ))),
  }
}

fn validate_block_kind(block_kind: &str) -> std::result::Result<(), (StatusCode, String)> {
  match block_kind {
    "agenda" | "submission" | "distribution" | "info" | "freeform" => Ok(()),
    _ => Err(api_bad_request(format!(
      "unsupported block_kind `{block_kind}`"
    ))),
  }
}

fn default_issue_title(issue_type: &str) -> &'static str {
  match issue_type {
    "normal" => "平古場生産組合 常会の案内",
    "correction" => "平古場生産組合 常会のご案内（訂正）",
    "no_meeting" => "平古場生産組合 常会の案内",
    "one_off" => "単発案内",
    _ => "新規案内",
  }
}

fn duplicate_issue_title(title: &str) -> String {
  let trimmed = title.trim();
  if trimmed.is_empty() {
    return "案内（複製）".to_string();
  }
  format!("{trimmed}（複製）")
}

fn resolve_template_document_descriptor(
  document_family: &str,
  template_key: &str,
) -> std::result::Result<TemplateDocumentDescriptor, (StatusCode, String)> {
  match (document_family, template_key) {
    (TEMPLATE_DOCUMENT_FAMILY_SHOGAI_KYOSAI, TEMPLATE_DOCUMENT_KEY_JOIN_RENEWAL) => {
      Ok(TemplateDocumentDescriptor {
        document_family: TEMPLATE_DOCUMENT_FAMILY_SHOGAI_KYOSAI,
        template_key: TEMPLATE_DOCUMENT_KEY_JOIN_RENEWAL,
        title_prefix: "農作業中傷害共済 加入更新調査",
        template_asset_path: TEMPLATE_DOCUMENT_ASSET_PATH_SHOGAI_KYOSAI,
        template_version: TEMPLATE_DOCUMENT_VERSION_SHOGAI_KYOSAI,
      })
    }
    _ => Err(api_bad_request(format!(
      "unsupported template document `{document_family}/{template_key}`"
    ))),
  }
}

fn default_template_document_payload(descriptor: TemplateDocumentDescriptor) -> serde_json::Value {
  match (descriptor.document_family, descriptor.template_key) {
    (TEMPLATE_DOCUMENT_FAMILY_SHOGAI_KYOSAI, TEMPLATE_DOCUMENT_KEY_JOIN_RENEWAL) => json!({
      "rows": [blank_template_document_row_payload(descriptor)],
    }),
    _ => json!({}),
  }
}

fn template_document_bindings(
  descriptor: TemplateDocumentDescriptor,
) -> &'static [TemplateBindingDefinition] {
  const SHOGAI_KYOSAI_JOIN_RENEWAL_BINDINGS: [TemplateBindingDefinition; 7] = [
    TemplateBindingDefinition {
      key: "contract_holder",
      description: "契約者名",
    },
    TemplateBindingDefinition {
      key: "age_previous",
      description: "応答日前年齢",
    },
    TemplateBindingDefinition {
      key: "age_current",
      description: "契約応答日時年齢",
    },
    TemplateBindingDefinition {
      key: "ending_disability",
      description: "終了契約の死亡・後遺症傷害",
    },
    TemplateBindingDefinition {
      key: "ending_medical",
      description: "終了契約の治療共済金額",
    },
    TemplateBindingDefinition {
      key: "ending_date",
      description: "終了契約の契約日",
    },
    TemplateBindingDefinition {
      key: "ending_premium",
      description: "終了契約の共済掛金",
    },
  ];

  match (descriptor.document_family, descriptor.template_key) {
    (TEMPLATE_DOCUMENT_FAMILY_SHOGAI_KYOSAI, TEMPLATE_DOCUMENT_KEY_JOIN_RENEWAL) => {
      &SHOGAI_KYOSAI_JOIN_RENEWAL_BINDINGS
    }
    _ => &[],
  }
}

fn template_document_svg_source(
  descriptor: TemplateDocumentDescriptor,
) -> std::result::Result<&'static str, (StatusCode, String)> {
  match (descriptor.document_family, descriptor.template_key) {
    (TEMPLATE_DOCUMENT_FAMILY_SHOGAI_KYOSAI, TEMPLATE_DOCUMENT_KEY_JOIN_RENEWAL) => {
      Ok(EMBEDDED_TEMPLATE_DOCUMENT_SVG_SHOGAI_KYOSAI)
    }
    _ => Err(api_bad_request(format!(
      "unsupported template document `{}/{}`",
      descriptor.document_family, descriptor.template_key
    ))),
  }
}

fn template_payload_display_value(payload: &serde_json::Value, key: &str) -> String {
  payload
    .get(key)
    .and_then(|value| value.as_str())
    .unwrap_or_default()
    .replace("\r\n", "\n")
}

fn blank_template_document_row_payload(
  descriptor: TemplateDocumentDescriptor,
) -> serde_json::Value {
  serde_json::Value::Object(
    template_document_bindings(descriptor)
      .iter()
      .map(|binding| {
        (
          binding.key.to_string(),
          serde_json::Value::String(String::new()),
        )
      })
      .collect(),
  )
}

fn normalize_template_document_row_payload(
  descriptor: TemplateDocumentDescriptor,
  payload: &serde_json::Value,
) -> serde_json::Value {
  serde_json::Value::Object(
    template_document_bindings(descriptor)
      .iter()
      .map(|binding| {
        (
          binding.key.to_string(),
          serde_json::Value::String(template_payload_display_value(payload, binding.key)),
        )
      })
      .collect(),
  )
}

fn template_document_row_has_any_value(
  descriptor: TemplateDocumentDescriptor,
  payload: &serde_json::Value,
) -> bool {
  template_document_bindings(descriptor)
    .iter()
    .any(|binding| {
      !template_payload_display_value(payload, binding.key)
        .trim()
        .is_empty()
    })
}

fn template_document_rows_from_payload(
  descriptor: TemplateDocumentDescriptor,
  payload: &serde_json::Value,
) -> Vec<serde_json::Value> {
  if let Some(rows) = payload.get("rows").and_then(|value| value.as_array()) {
    return rows
      .iter()
      .map(|row| normalize_template_document_row_payload(descriptor, row))
      .collect();
  }

  if payload.is_object() {
    return vec![normalize_template_document_row_payload(descriptor, payload)];
  }

  Vec::new()
}

fn normalize_template_document_payload(
  descriptor: TemplateDocumentDescriptor,
  payload: &serde_json::Value,
) -> serde_json::Value {
  json!({
    "rows": template_document_rows_from_payload(descriptor, payload),
  })
}

fn template_document_row_count(
  descriptor: TemplateDocumentDescriptor,
  payload: &serde_json::Value,
) -> usize {
  template_document_rows_from_payload(descriptor, payload)
    .into_iter()
    .filter(|row| template_document_row_has_any_value(descriptor, row))
    .count()
}

fn validate_template_document_payload(
  descriptor: TemplateDocumentDescriptor,
  payload: &serde_json::Value,
) -> std::result::Result<Vec<serde_json::Value>, (StatusCode, String)> {
  let rows = template_document_rows_from_payload(descriptor, payload);
  if rows.is_empty() {
    return Err(api_conflict(
      "帳票の生成に必要な契約者行がありません。1件以上追加してください。",
    ));
  }

  let mut missing = Vec::new();
  for (row_index, row) in rows.iter().enumerate() {
    for binding in template_document_bindings(descriptor) {
      if template_payload_display_value(row, binding.key)
        .trim()
        .is_empty()
      {
        missing.push(format!(
          "{}行目: {} ({})",
          row_index + 1,
          binding.description,
          binding.key
        ));
      }
    }
  }

  if !missing.is_empty() {
    return Err(api_conflict(format!(
      "帳票の生成に必要な項目が不足しています: {}",
      missing.join(", ")
    )));
  }

  Ok(rows)
}

fn missing_template_document_bindings(
  descriptor: TemplateDocumentDescriptor,
  payload: &serde_json::Value,
) -> Vec<TemplateBindingDefinition> {
  template_document_bindings(descriptor)
    .iter()
    .copied()
    .filter(|binding| {
      template_payload_display_value(payload, binding.key)
        .trim()
        .is_empty()
    })
    .collect()
}

fn html_escape_text(value: &str) -> String {
  value
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
    .replace('\'', "&#39;")
}

fn xml_escape_text(value: &str) -> String {
  value
    .replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
}

fn render_template_document_svg_markup(
  descriptor: TemplateDocumentDescriptor,
  payload: &serde_json::Value,
) -> std::result::Result<String, (StatusCode, String)> {
  let missing = missing_template_document_bindings(descriptor, payload);
  if !missing.is_empty() {
    let summary = missing
      .into_iter()
      .map(|binding| format!("{} ({})", binding.description, binding.key))
      .collect::<Vec<_>>()
      .join(", ");
    return Err(api_conflict(format!(
      "帳票の生成に必要な項目が不足しています: {summary}"
    )));
  }

  let mut svg = template_document_svg_source(descriptor)?.to_string();
  for binding in template_document_bindings(descriptor) {
    let token = format!("${}", binding.key);
    let value = xml_escape_text(&template_payload_display_value(payload, binding.key));
    svg = svg.replace(&token, &value);
  }
  Ok(svg)
}

fn default_template_document_title(
  descriptor: TemplateDocumentDescriptor,
  payload: &serde_json::Value,
) -> String {
  format!(
    "{} / {} / {}件",
    descriptor.title_prefix,
    Local::now().format("%Y-%m-%d"),
    template_document_row_count(descriptor, payload)
  )
}

fn normalize_template_document_title(
  _raw_title: &str,
  descriptor: TemplateDocumentDescriptor,
  payload: &serde_json::Value,
) -> String {
  default_template_document_title(descriptor, payload)
}

fn normalize_month_value(raw: &str) -> String {
  let trimmed = raw.trim();
  if trimmed.len() == 7 {
    return format!("{trimmed}-01");
  }
  trimmed.to_string()
}

const ITEM_META_LAYOUT_STACKED: &str = "stacked";
const ITEM_META_LAYOUT_SAME_LINE: &str = "same_line";
const ITEM_SUPPLEMENT_TONE_RED: &str = "red";
const ITEM_SUPPLEMENT_TONE_BLUE: &str = "blue";
const ITEM_THUMB_SCALE_PERCENT_MIN: i32 = 80;
const ITEM_THUMB_SCALE_PERCENT_MAX: i32 = 200;
const ITEM_THUMB_SCALE_PERCENT_STEP: i32 = 5;
const ITEM_THUMB_SCALE_PERCENT_DEFAULT: i32 = 100;

fn normalize_item_meta_layout(raw: &str) -> &'static str {
  if raw.trim() == ITEM_META_LAYOUT_SAME_LINE {
    ITEM_META_LAYOUT_SAME_LINE
  } else {
    ITEM_META_LAYOUT_STACKED
  }
}

fn default_item_thumb_scale_percent() -> i32 {
  ITEM_THUMB_SCALE_PERCENT_DEFAULT
}

fn normalize_item_thumb_scale_percent(raw: i32) -> i32 {
  let rounded = ((raw - ITEM_THUMB_SCALE_PERCENT_MIN) as f32 / ITEM_THUMB_SCALE_PERCENT_STEP as f32)
    .round() as i32
    * ITEM_THUMB_SCALE_PERCENT_STEP
    + ITEM_THUMB_SCALE_PERCENT_MIN;
  rounded.clamp(ITEM_THUMB_SCALE_PERCENT_MIN, ITEM_THUMB_SCALE_PERCENT_MAX)
}

fn normalize_item_supplement_tone(raw: &str) -> &'static str {
  if raw.trim() == ITEM_SUPPLEMENT_TONE_BLUE {
    ITEM_SUPPLEMENT_TONE_BLUE
  } else {
    ITEM_SUPPLEMENT_TONE_RED
  }
}

fn legacy_item_supplements(note: &str) -> Vec<IssueDocumentItemSupplement> {
  let content = note.trim();
  if content.is_empty() {
    return Vec::new();
  }

  vec![IssueDocumentItemSupplement {
    id: String::new(),
    tone: ITEM_SUPPLEMENT_TONE_RED.to_string(),
    content: content.to_string(),
    sort_order: 1,
  }]
}

fn legacy_note_from_supplements(supplements: &[IssueDocumentItemSupplement]) -> String {
  supplements
    .iter()
    .find(|supplement| supplement.tone == ITEM_SUPPLEMENT_TONE_RED)
    .map(|supplement| supplement.content.clone())
    .unwrap_or_default()
}

fn normalize_save_item_supplements(
  supplements: &[SaveItemSupplementPayload],
  legacy_note: &str,
) -> Vec<NormalizedItemSupplement> {
  let mut normalized = supplements
    .iter()
    .filter_map(|supplement| {
      let content = supplement.content.trim();
      if content.is_empty() {
        return None;
      }

      Some(NormalizedItemSupplement {
        tone: normalize_item_supplement_tone(&supplement.tone).to_string(),
        content: content.to_string(),
      })
    })
    .collect::<Vec<_>>();

  if normalized.is_empty() {
    let legacy_note = legacy_note.trim();
    if !legacy_note.is_empty() {
      normalized.push(NormalizedItemSupplement {
        tone: ITEM_SUPPLEMENT_TONE_RED.to_string(),
        content: legacy_note.to_string(),
      });
    }
  }

  normalized
}

async fn replace_item_supplements(
  client: &Client,
  item_id: &str,
  supplements: &[NormalizedItemSupplement],
) -> std::result::Result<(), tokio_postgres::Error> {
  client
    .execute(
      "delete from block_item_supplements where item_id::text = $1",
      &[&item_id],
    )
    .await?;

  for (index, supplement) in supplements.iter().enumerate() {
    let sort_order = index as i32 + 1;
    client
      .execute(
        "insert into block_item_supplements (item_id, sort_order, tone, content)
         values ((select id from block_items where id::text = $1), $2, $3, $4)",
        &[&item_id, &sort_order, &supplement.tone, &supplement.content],
      )
      .await?;
  }

  Ok(())
}

fn attachment_display_kind(mime_type: &str) -> &'static str {
  if mime_type.contains("pdf") {
    "pdf"
  } else if mime_type.starts_with("image/") {
    "image"
  } else {
    "other"
  }
}

fn sanitize_filename(name: &str) -> String {
  let mut value = name
    .chars()
    .map(|ch| {
      if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
        ch
      } else {
        '_'
      }
    })
    .collect::<String>();

  if value.is_empty() {
    value = "upload.bin".to_string();
  }

  value
}

fn unique_upload_stem() -> String {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis()
    .to_string()
}

fn preview_render_root(runtime_dir: &Path) -> PathBuf {
  runtime_dir.join("preview-renders")
}

fn remove_issue_runtime_artifacts(runtime_dir: &Path, issue_id: &str) {
  let _ = fs::remove_dir_all(issue_generated_dir(runtime_dir, issue_id));
}

fn template_document_generated_dir(runtime_dir: &Path, template_document_id: &str) -> PathBuf {
  runtime_dir
    .join("generated")
    .join("template-documents")
    .join(template_document_id)
}

fn sanitize_pdf_download_name(name: &str, fallback: &str) -> String {
  let value = name
    .trim()
    .chars()
    .map(|ch| {
      if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
        '_'
      } else {
        ch
      }
    })
    .collect::<String>()
    .trim()
    .trim_matches('.')
    .to_string();

  if value.is_empty() {
    fallback.to_string()
  } else {
    value
  }
}

fn app_shell(
  view: &str,
  issue_id: Option<&str>,
  template_document_id: Option<&str>,
  print_mode: bool,
  family_tab: Option<&str>,
) -> Html<String> {
  let issue_id_attr = issue_id.unwrap_or("");
  let template_document_id_attr = template_document_id.unwrap_or("");
  let family_tab_attr = family_tab.unwrap_or(FAMILY_TAB_ISSUES);
  let page_title = match view {
    "edit" => "jokai editor",
    "print" => "jokai print",
    "template-edit" => "jokai template editor",
    "template-print" => "jokai template print",
    _ => "jokai composer",
  };
  let print_attr = if print_mode { "1" } else { "0" };
  let asset_version = BUILD_TIMESTAMP_UTC;

  Html(format!(
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{page_title}</title><link rel=\"stylesheet\" href=\"/assets/app.css?v={asset_version}\"></head><body data-print-mode=\"{print_attr}\"><div id=\"app\" data-view=\"{view}\" data-issue-id=\"{issue_id_attr}\" data-template-document-id=\"{template_document_id_attr}\" data-family-tab=\"{family_tab_attr}\" data-print-mode=\"{print_attr}\"></div><script type=\"module\" src=\"/assets/app.js?v={asset_version}\"></script></body></html>"
  ))
}

fn template_document_print_html(
  document: &TemplateDocumentDetail,
  descriptor: TemplateDocumentDescriptor,
  svg_markups: &[String],
) -> Html<String> {
  let resolved_title = default_template_document_title(descriptor, &document.payload);
  let title = html_escape_text(&resolved_title);
  let document_id = html_escape_text(&document.id);
  let edit_url = format!("/template-documents/{}/edit", document_id);
  let pdf_api_url = format!("/api/template-documents/{}/print-pdf", document_id);
  let download_name_json = serde_json::to_string(&format!(
    "{}.pdf",
    sanitize_pdf_download_name(&resolved_title, "template-document")
  ))
  .unwrap_or_else(|_| "\"template-document.pdf\"".to_string());
  let page_count = svg_markups.len();
  let pages_markup = svg_markups
    .iter()
    .enumerate()
    .map(|(index, svg_markup)| {
      format!(
        "<article class=\"template-print-paper\"><div class=\"template-print-page-label\">Page {}</div>{}</article>",
        index + 1,
        svg_markup
      )
    })
    .collect::<Vec<_>>()
    .join("");

  Html(format!(
    r#"<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>{title}</title>
    <style>
      @page {{
        size: A4;
        margin: 0;
      }}
      :root {{
        color-scheme: light;
      }}
      * {{
        box-sizing: border-box;
      }}
      html,
      body {{
        margin: 0;
        padding: 0;
        background: #eef2f7;
        font-family: "Yu Gothic UI", "Yu Gothic", "Hiragino Sans", sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }}
      .template-print-shell {{
        min-height: 100vh;
        padding: 18px;
      }}
      .template-print-toolbar {{
        width: min(100%, 1180px);
        margin: 0 auto 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }}
      .template-print-toolbar h1 {{
        margin: 0;
        font-size: 16px;
      }}
      .template-print-toolbar p {{
        margin: 4px 0 0;
        color: #5b6470;
        font-size: 13px;
      }}
      .template-print-actions {{
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }}
      .template-print-actions a,
      .template-print-actions button {{
        border: 1px solid rgba(76, 101, 153, 0.18);
        border-radius: 999px;
        background: #fff;
        color: #1c2740;
        padding: 9px 14px;
        text-decoration: none;
        font: inherit;
        cursor: pointer;
      }}
      .template-print-actions button {{
        background: linear-gradient(180deg, #6f8ff5 0%, #4f73e3 100%);
        color: #fff;
        border-color: rgba(68, 99, 190, 0.45);
      }}
      .template-print-stage {{
        width: min(100%, 1180px);
        margin: 0 auto;
        display: grid;
        gap: 18px;
        justify-items: center;
      }}
      .template-print-paper {{
        width: 210mm;
        min-height: 297mm;
        position: relative;
        background: #fff;
        box-shadow: 0 18px 50px rgba(34, 47, 78, 0.14);
        break-inside: avoid;
        page-break-inside: avoid;
      }}
      .template-print-paper svg {{
        display: block;
        width: 210mm;
        height: 297mm;
      }}
      .template-print-page-label {{
        position: absolute;
        top: 10px;
        right: 14px;
        padding: 4px 9px;
        border-radius: 999px;
        background: rgba(28, 39, 64, 0.08);
        color: #51607b;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }}
      @media print {{
        html,
        body {{
          background: #fff;
        }}
        .template-print-shell {{
          padding: 0;
        }}
        .template-print-toolbar {{
          display: none;
        }}
        .template-print-stage,
        .template-print-paper {{
          width: 210mm;
          margin: 0;
        }}
        .template-print-stage {{
          display: block;
        }}
        .template-print-paper {{
          box-shadow: none;
        }}
        .template-print-page-label {{
          display: none;
        }}
      }}
    </style>
  </head>
  <body>
    <main class="template-print-shell">
      <header class="template-print-toolbar">
        <div>
          <h1>{title}</h1>
          <p>{family_label} / テンプレ版 {template_version} / {page_count}ページ</p>
        </div>
        <div class="template-print-actions">
          <a href="{edit_url}">編集へ戻る</a>
          <button type="button" id="download-template-pdf">帳票PDFを出力</button>
        </div>
      </header>
      <section class="template-print-stage">
        {pages_markup}
      </section>
    </main>
    <script>
      const downloadButton = document.getElementById("download-template-pdf");
      if (downloadButton) {{
        downloadButton.addEventListener("click", async () => {{
          downloadButton.disabled = true;
          try {{
            const response = await fetch("{pdf_api_url}");
            if (!response.ok) {{
              throw new Error(await response.text() || `HTTP ${{response.status}}`);
            }}
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = {download_name_json};
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }} catch (error) {{
            window.alert(error.message || "帳票PDFを出力できませんでした。");
          }} finally {{
            downloadButton.disabled = false;
          }}
        }});
      }}
    </script>
  </body>
</html>"#,
    family_label = html_escape_text("農作業傷害共済"),
    template_version = html_escape_text(descriptor.template_version),
    page_count = page_count,
    pages_markup = pages_markup,
  ))
}

fn template_document_error_html(title: &str, message: &str, edit_url: &str) -> Html<String> {
  Html(format!(
    r#"<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>{title}</title>
    <style>
      html, body {{
        margin: 0;
        min-height: 100%;
        background: #f4f6fa;
        font-family: "Yu Gothic UI", "Yu Gothic", "Hiragino Sans", sans-serif;
      }}
      main {{
        width: min(100%, 880px);
        margin: 0 auto;
        padding: 28px 20px;
      }}
      .error-card {{
        border-radius: 22px;
        border: 1px solid rgba(196, 58, 43, 0.14);
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 18px 48px rgba(31, 45, 75, 0.08);
        padding: 24px 26px;
      }}
      .error-card h1 {{
        margin: 0 0 8px;
        font-size: 22px;
      }}
      .error-card p {{
        margin: 0 0 16px;
        color: #5b6470;
        line-height: 1.7;
      }}
      .error-card a {{
        display: inline-flex;
        align-items: center;
        min-height: 40px;
        padding: 0 14px;
        border-radius: 999px;
        border: 1px solid rgba(76, 101, 153, 0.18);
        background: #fff;
        color: #1c2740;
        text-decoration: none;
      }}
    </style>
  </head>
  <body>
    <main>
      <section class="error-card">
        <h1>{title}</h1>
        <p>{message}</p>
        <a href="{edit_url}">編集へ戻る</a>
      </section>
    </main>
  </body>
</html>"#,
    title = html_escape_text(title),
    message = html_escape_text(message),
    edit_url = html_escape_text(edit_url),
  ))
}

fn find_working_command(candidates: &[&str]) -> Option<String> {
  for candidate in candidates {
    let status = ProcessCommand::new("sh")
      .arg("-lc")
      .arg(format!("command -v {candidate} >/dev/null 2>&1"))
      .status();
    if status.map(|value| value.success()).unwrap_or(false) {
      return Some((*candidate).to_string());
    }
  }
  None
}

fn google_chrome_command() -> Option<String> {
  if let Ok(value) = env::var("JOKAI_PDF_BROWSER_CMD") {
    if !value.trim().is_empty() {
      return Some(value);
    }
  }
  for candidate in [
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe",
  ] {
    if Path::new(candidate).exists() {
      return Some(candidate.to_string());
    }
  }
  find_working_command(&[
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
  ])
}

fn pdftoppm_command() -> Option<String> {
  if let Ok(value) = env::var("JOKAI_PDFTOPPM_CMD") {
    if !value.trim().is_empty() {
      return Some(value);
    }
  }
  find_working_command(&["pdftoppm", "pdftocairo"])
}

#[allow(dead_code)]
fn path_for_browser_output(browser_cmd: &str, output_path: &Path) -> String {
  if browser_cmd.ends_with(".exe") {
    let display = output_path.display().to_string();
    if let Some(rest) = display.strip_prefix("/mnt/") {
      let mut parts = rest.splitn(2, '/');
      if let (Some(drive), Some(path_rest)) = (parts.next(), parts.next()) {
        let drive_letter = drive.to_uppercase();
        return format!("{}:\\{}", drive_letter, path_rest.replace('/', "\\"));
      }
    }
  }

  output_path.display().to_string()
}

#[allow(dead_code)]
fn windows_temp_dir() -> Option<PathBuf> {
  if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
    let path = PathBuf::from(local_app_data);
    if path.exists() {
      return Some(path);
    }
  }

  let user = env::var("USER").unwrap_or_else(|_| "fuse".to_string());
  let fallback = PathBuf::from("/mnt/c/Users")
    .join(user)
    .join("AppData")
    .join("Local")
    .join("Temp");
  if fallback.exists() {
    return Some(fallback);
  }

  None
}

async fn fetch_attachment_storage_metadata(
  client: &Client,
  attachment_id: &str,
) -> std::result::Result<Option<AttachmentStorageMetadata>, tokio_postgres::Error> {
  let row = client
    .query_opt(
      "select
         mime_type,
         coalesce(legacy_original_path, ''),
         coalesce(legacy_thumbnail_path, '')
       from attachments
       where id::text = $1",
      &[&attachment_id],
    )
    .await?;

  Ok(row.map(|row| AttachmentStorageMetadata {
    mime_type: row.get::<_, String>(0),
    legacy_original_path: row.get::<_, String>(1),
    legacy_thumbnail_path: row.get::<_, String>(2),
  }))
}

fn read_legacy_attachment_file(
  storage_dir: &Path,
  relative_path: &str,
) -> std::result::Result<Option<Vec<u8>>, (StatusCode, String)> {
  let trimmed = relative_path.trim();
  if trimmed.is_empty() {
    return Ok(None);
  }

  let absolute_path = storage_dir.join(trimmed);
  if !absolute_path.exists() {
    return Ok(None);
  }

  let bytes = fs::read(&absolute_path)
    .map_err(|err| api_internal(format!("failed to read {}: {err}", absolute_path.display())))?;
  if bytes.is_empty() {
    return Ok(None);
  }
  Ok(Some(bytes))
}

async fn upsert_attachment_original_content(
  client: &Client,
  attachment_id: &str,
  bytes: &[u8],
) -> std::result::Result<(), (StatusCode, String)> {
  client
    .execute(
      "insert into attachment_original_contents (attachment_id, content)
       values ((select id from attachments where id::text = $1), $2)
       on conflict (attachment_id)
       do update set content = excluded.content, updated_at = now()",
      &[&attachment_id, &bytes],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;
  Ok(())
}

async fn upsert_attachment_thumbnail_cache(
  client: &Client,
  attachment_id: &str,
  mime_type: &str,
  bytes: &[u8],
) -> std::result::Result<(), (StatusCode, String)> {
  client
    .execute(
      "insert into attachment_thumbnail_caches (attachment_id, mime_type, content)
       values ((select id from attachments where id::text = $1), $2, $3)
       on conflict (attachment_id)
       do update set mime_type = excluded.mime_type, content = excluded.content, updated_at = now()",
      &[&attachment_id, &mime_type, &bytes],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;
  Ok(())
}

async fn fetch_attachment_original_bytes(
  state: &AppState,
  attachment_id: &str,
) -> std::result::Result<(String, Vec<u8>), (StatusCode, String)> {
  let metadata = fetch_attachment_storage_metadata(&state.client, attachment_id)
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("attachment not found"))?;

  let stored = state
    .client
    .query_opt(
      "select content
       from attachment_original_contents
       where attachment_id = (select id from attachments where id::text = $1)",
      &[&attachment_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  if let Some(row) = stored {
    let bytes = row.get::<_, Vec<u8>>(0);
    if !bytes.is_empty() {
      return Ok((metadata.mime_type, bytes));
    }
  }

  let Some(bytes) =
    read_legacy_attachment_file(&state.runtime_dir, &metadata.legacy_original_path)?
  else {
    return Err(api_internal(
      "attachment original is missing from database and legacy storage",
    ));
  };

  upsert_attachment_original_content(&state.client, attachment_id, &bytes).await?;
  Ok((metadata.mime_type, bytes))
}

async fn fetch_attachment_thumbnail_cache(
  state: &AppState,
  attachment_id: &str,
) -> std::result::Result<Option<(String, Vec<u8>)>, (StatusCode, String)> {
  let row = state
    .client
    .query_opt(
      "select mime_type, content
       from attachment_thumbnail_caches
       where attachment_id = (select id from attachments where id::text = $1)",
      &[&attachment_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  Ok(row.map(|row| (row.get::<_, String>(0), row.get::<_, Vec<u8>>(1))))
}

fn legacy_thumbnail_mime_type(metadata: &AttachmentStorageMetadata) -> String {
  if attachment_display_kind(&metadata.mime_type) == "pdf" {
    "image/png".to_string()
  } else {
    metadata.mime_type.clone()
  }
}

fn render_pdf_thumbnail_png(
  state: &AppState,
  attachment_id: &str,
  pdf_bytes: &[u8],
) -> std::result::Result<Vec<u8>, (StatusCode, String)> {
  let Some(pdftoppm_cmd) = &state.pdftoppm_cmd else {
    return Err(api_internal(
      "pdftoppm is required to build PDF thumbnails but was not found",
    ));
  };

  let job_dir = preview_render_root(&state.runtime_dir).join(format!("{attachment_id}-thumb"));
  let _ = fs::remove_dir_all(&job_dir);
  fs::create_dir_all(&job_dir).map_err(|err| api_internal(err.to_string()))?;

  let input_pdf = job_dir.join("input.pdf");
  let output_prefix = job_dir.join("thumb");
  let output_png = job_dir.join("thumb.png");
  fs::write(&input_pdf, pdf_bytes).map_err(|err| api_internal(err.to_string()))?;

  let status = ProcessCommand::new(pdftoppm_cmd)
    .arg("-png")
    .arg("-singlefile")
    .arg("-f")
    .arg("1")
    .arg("-scale-to")
    .arg("220")
    .arg(&input_pdf)
    .arg(&output_prefix)
    .status()
    .map_err(|err| api_internal(format!("failed to launch pdftoppm: {err}")))?;

  if !status.success() {
    let _ = fs::remove_dir_all(&job_dir);
    return Err(api_internal("pdftoppm failed while generating thumbnail"));
  }

  let png_bytes = fs::read(&output_png).map_err(|err| {
    api_internal(format!(
      "failed to read generated thumbnail {}: {err}",
      output_png.display()
    ))
  })?;
  let _ = fs::remove_dir_all(&job_dir);
  Ok(png_bytes)
}

async fn fetch_attachment_thumbnail_bytes(
  state: &AppState,
  attachment_id: &str,
) -> std::result::Result<(String, Vec<u8>), (StatusCode, String)> {
  let metadata = fetch_attachment_storage_metadata(&state.client, attachment_id)
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("attachment not found"))?;

  if let Some((mime_type, bytes)) = fetch_attachment_thumbnail_cache(state, attachment_id).await? {
    if !bytes.is_empty() {
      return Ok((mime_type, bytes));
    }
  }

  if let Some(bytes) =
    read_legacy_attachment_file(&state.runtime_dir, &metadata.legacy_thumbnail_path)?
  {
    let mime_type = legacy_thumbnail_mime_type(&metadata);
    upsert_attachment_thumbnail_cache(&state.client, attachment_id, &mime_type, &bytes).await?;
    return Ok((mime_type, bytes));
  }

  if attachment_display_kind(&metadata.mime_type) != "pdf" {
    let (mime_type, bytes) = fetch_attachment_original_bytes(state, attachment_id).await?;
    upsert_attachment_thumbnail_cache(&state.client, attachment_id, &mime_type, &bytes).await?;
    return Ok((mime_type, bytes));
  }

  let (_, original_bytes) = fetch_attachment_original_bytes(state, attachment_id).await?;
  let png_bytes = render_pdf_thumbnail_png(state, attachment_id, &original_bytes)?;
  upsert_attachment_thumbnail_cache(&state.client, attachment_id, "image/png", &png_bytes).await?;
  Ok(("image/png".to_string(), png_bytes))
}

async fn backfill_legacy_attachment_storage(client: &Client, storage_dir: &Path) -> Result<usize> {
  let rows = client
    .query(
      "select
         a.id::text,
         a.mime_type,
         coalesce(a.legacy_original_path, ''),
         coalesce(a.legacy_thumbnail_path, ''),
         oc.attachment_id is not null,
         tc.attachment_id is not null,
         coalesce(octet_length(oc.content), 0),
         coalesce(octet_length(tc.content), 0)
       from attachments a
       left join attachment_original_contents oc on oc.attachment_id = a.id
       left join attachment_thumbnail_caches tc on tc.attachment_id = a.id
       where oc.attachment_id is null
          or coalesce(octet_length(oc.content), 0) = 0
          or (
            (tc.attachment_id is null or coalesce(octet_length(tc.content), 0) = 0)
            and coalesce(a.legacy_thumbnail_path, '') <> ''
          )",
      &[],
    )
    .await?;

  let mut migrated_rows = 0usize;
  for row in rows {
    let attachment_id = row.get::<_, String>(0);
    let mime_type = row.get::<_, String>(1);
    let legacy_original_path = row.get::<_, String>(2);
    let legacy_thumbnail_path = row.get::<_, String>(3);
    let has_original = row.get::<_, bool>(4);
    let has_thumbnail = row.get::<_, bool>(5);
    let original_len = row.get::<_, i32>(6);
    let thumbnail_len = row.get::<_, i32>(7);

    if !has_original || original_len == 0 {
      if let Some(bytes) = read_legacy_attachment_file(storage_dir, &legacy_original_path)
        .map_err(|err| eyre!(err.1))?
      {
        client
          .execute(
            "insert into attachment_original_contents (attachment_id, content)
             values ((select id from attachments where id::text = $1), $2)
             on conflict (attachment_id)
             do update set content = excluded.content, updated_at = now()",
            &[&attachment_id, &bytes],
          )
          .await?;
        migrated_rows += 1;
      }
    }

    if !has_thumbnail || thumbnail_len == 0 {
      if let Some(bytes) = read_legacy_attachment_file(storage_dir, &legacy_thumbnail_path)
        .map_err(|err| eyre!(err.1))?
      {
        let cache_mime = if attachment_display_kind(&mime_type) == "pdf" {
          "image/png".to_string()
        } else {
          mime_type.clone()
        };
        client
          .execute(
            "insert into attachment_thumbnail_caches (attachment_id, mime_type, content)
             values ((select id from attachments where id::text = $1), $2, $3)
             on conflict (attachment_id)
             do update set mime_type = excluded.mime_type, content = excluded.content, updated_at = now()",
            &[&attachment_id, &cache_mime, &bytes],
          )
          .await?;
        migrated_rows += 1;
      }
    }
  }

  Ok(migrated_rows)
}

async fn run_legacy_backfill_if_configured(client: &Client, args: &DbArgs) -> Result<usize> {
  let Some(legacy_storage_dir) = &args.legacy_storage_dir else {
    return Ok(0);
  };

  if !legacy_storage_dir.exists() {
    bail!(
      "legacy storage dir does not exist: {}",
      legacy_storage_dir.display()
    );
  }

  backfill_legacy_attachment_storage(client, legacy_storage_dir).await
}

async fn connect_postgres(url: &str) -> Result<Client> {
  let (client, connection) = tokio_postgres::connect(url, NoTls)
    .await
    .with_context(|| format!("failed to connect to {}", redact_database_url(url)))?;

  tokio::spawn(async move {
    if let Err(err) = connection.await {
      error!("postgres connection error: {err}");
    }
  });

  Ok(client)
}

async fn ensure_database_exists(args: &DbArgs) -> Result<String> {
  let database_name = database_name_from_url(&args.database_url)?;
  let database_ident = quote_ident(&database_name)?;
  let admin = connect_postgres(&args.admin_database_url).await?;
  let exists = admin
    .query_opt(
      "select 1 from pg_database where datname = $1",
      &[&database_name],
    )
    .await?
    .is_some();

  if !exists {
    admin
      .execute(&format!("create database {database_ident}"), &[])
      .await
      .with_context(|| format!("failed to create database `{database_name}`"))?;
  }

  Ok(database_name)
}

async fn apply_migrations(client: &Client, db_dir: &Path) -> Result<Vec<String>> {
  client
    .batch_execute(&format!(
      "create table if not exists {MIGRATION_TABLE} (
         name text primary key,
         applied_at timestamptz not null default now()
       )"
    ))
    .await?;

  let applied_rows = client
    .query(
      &format!("select name from {MIGRATION_TABLE} order by name"),
      &[],
    )
    .await?;
  let applied = applied_rows
    .into_iter()
    .map(|row| row.get::<_, String>(0))
    .collect::<BTreeSet<_>>();

  let mut applied_now = Vec::new();
  for path in migration_files(db_dir)? {
    let name = path
      .file_name()
      .and_then(|value| value.to_str())
      .ok_or_else(|| eyre!("invalid migration file name: {}", path.display()))?
      .to_string();

    if applied.contains(&name) {
      continue;
    }

    let sql =
      fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))?;
    client
      .batch_execute(&sql)
      .await
      .with_context(|| format!("failed to apply migration {}", path.display()))?;
    client
      .execute(
        &format!("insert into {MIGRATION_TABLE} (name) values ($1)"),
        &[&name],
      )
      .await?;
    applied_now.push(name);
  }

  Ok(applied_now)
}

async fn list_applied_migrations(client: &Client) -> Result<Vec<String>> {
  let exists = client
    .query_opt(
      "select 1 from information_schema.tables where table_schema = 'public' and table_name = $1",
      &[&MIGRATION_TABLE],
    )
    .await?
    .is_some();

  if !exists {
    return Ok(Vec::new());
  }

  let rows = client
    .query(
      &format!("select name from {MIGRATION_TABLE} order by name"),
      &[],
    )
    .await?;

  Ok(
    rows
      .into_iter()
      .map(|row| row.get::<_, String>(0))
      .collect(),
  )
}

async fn ensure_attachment_thumbnail(
  state: &AppState,
  attachment_id: &str,
) -> std::result::Result<(String, Vec<u8>), (StatusCode, String)> {
  fetch_attachment_thumbnail_bytes(state, attachment_id).await
}

#[allow(dead_code)]
fn issue_generated_dir(runtime_dir: &Path, issue_id: &str) -> PathBuf {
  runtime_dir.join("generated").join(issue_id)
}

#[allow(dead_code)]
fn render_print_page_pdf_file(
  browser_cmd: String,
  print_url: String,
  browser_output_path: PathBuf,
) -> std::result::Result<(), String> {
  let browser_output_arg = path_for_browser_output(&browser_cmd, &browser_output_path);
  let _ = fs::remove_file(&browser_output_path);

  let mut child = ProcessCommand::new(&browser_cmd)
    .arg("--headless=new")
    .arg("--disable-gpu")
    .arg("--no-sandbox")
    .arg("--disable-dev-shm-usage")
    .arg("--disable-crash-reporter")
    .arg("--no-first-run")
    .arg("--no-default-browser-check")
    .arg("--virtual-time-budget=5000")
    .arg("--print-to-pdf-no-header")
    .arg(format!("--print-to-pdf={browser_output_arg}"))
    .arg(&print_url)
    .spawn()
    .map_err(|err| format!("failed to launch browser: {err}"))?;

  let mut pdf_ready = false;
  for _ in 0..40 {
    if browser_output_path.exists() {
      let metadata = fs::metadata(&browser_output_path).map_err(|err| err.to_string())?;
      if metadata.len() > 0 {
        pdf_ready = true;
        break;
      }
    }

    if let Some(status) = child
      .try_wait()
      .map_err(|err| format!("failed to inspect browser process: {err}"))?
    {
      if !status.success() {
        return Err("browser PDF generation failed".to_string());
      }
    }

    std::thread::sleep(std::time::Duration::from_millis(500));
  }

  let _ = child.kill();
  let _ = child.wait();

  if !pdf_ready {
    return Err("browser PDF generation timed out".to_string());
  }

  Ok(())
}

#[allow(dead_code)]
async fn generate_issue_pdf(
  state: &AppState,
  issue_id: &str,
) -> std::result::Result<Vec<u8>, (StatusCode, String)> {
  let Some(browser_cmd) = &state.pdf_browser_cmd else {
    return Err(api_internal(
      "google-chrome/chromium is required for notice PDF generation but was not found",
    ));
  };

  let output_dir = issue_generated_dir(&state.runtime_dir, issue_id);
  fs::create_dir_all(&output_dir).map_err(|err| api_internal(err.to_string()))?;
  let file_name = format!("notice-{}.pdf", unique_upload_stem());
  let output_path = output_dir.join(&file_name);
  let browser_output_path_native = if browser_cmd.ends_with(".exe") {
    windows_temp_dir()
      .unwrap_or_else(|| output_dir.clone())
      .join(&file_name)
  } else {
    output_path.clone()
  };
  let print_url = format!("{}/issues/{issue_id}/print", state.loopback_base_url);
  tokio::task::spawn_blocking({
    let browser_cmd = browser_cmd.clone();
    let print_url = print_url.clone();
    let browser_output_path_native = browser_output_path_native.clone();
    move || render_print_page_pdf_file(browser_cmd, print_url, browser_output_path_native)
  })
  .await
  .map_err(|err| api_internal(format!("failed to join PDF worker: {err}")))?
  .map_err(api_internal)?;

  let bytes = fs::read(&browser_output_path_native).map_err(|err| api_internal(err.to_string()))?;
  if browser_output_path_native != output_path {
    fs::copy(&browser_output_path_native, &output_path)
      .map_err(|err| api_internal(err.to_string()))?;
  }
  let relative_path = output_path
    .strip_prefix(&state.runtime_dir)
    .map(|path| path.to_string_lossy().to_string())
    .unwrap_or_else(|_| output_path.to_string_lossy().to_string());

  state
    .client
    .execute(
      "insert into generated_files (issue_id, file_kind, storage_path)
       values ((select id from issues where id::text = $1), 'pdf', $2)",
      &[&issue_id, &relative_path],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  Ok(bytes)
}

async fn generate_template_document_pdf(
  state: &AppState,
  template_document_id: &str,
) -> std::result::Result<Vec<u8>, (StatusCode, String)> {
  let Some(browser_cmd) = &state.pdf_browser_cmd else {
    return Err(api_internal(
      "google-chrome/chromium is required for 農作業傷害共済 の印刷とPDF出力 but was not found",
    ));
  };

  let document = fetch_template_document(&state.client, template_document_id)
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("template document not found"))?;
  let descriptor = resolve_template_document_descriptor(
    &document.document.document_family,
    &document.document.template_key,
  )?;
  let _rows = validate_template_document_payload(descriptor, &document.document.payload)?;

  let output_dir = template_document_generated_dir(&state.runtime_dir, template_document_id);
  fs::create_dir_all(&output_dir).map_err(|err| api_internal(err.to_string()))?;
  let file_name = format!("template-document-{}.pdf", unique_upload_stem());
  let output_path = output_dir.join(&file_name);
  let browser_output_path_native = if browser_cmd.ends_with(".exe") {
    windows_temp_dir()
      .unwrap_or_else(|| output_dir.clone())
      .join(&file_name)
  } else {
    output_path.clone()
  };
  let print_url = format!(
    "{}/template-documents/{template_document_id}/print",
    state.loopback_base_url
  );
  tokio::task::spawn_blocking({
    let browser_cmd = browser_cmd.clone();
    let print_url = print_url.clone();
    let browser_output_path_native = browser_output_path_native.clone();
    move || render_print_page_pdf_file(browser_cmd, print_url, browser_output_path_native)
  })
  .await
  .map_err(|err| api_internal(format!("failed to join template PDF worker: {err}")))?
  .map_err(api_internal)?;

  let bytes = fs::read(&browser_output_path_native).map_err(|err| api_internal(err.to_string()))?;
  if browser_output_path_native != output_path {
    fs::copy(&browser_output_path_native, &output_path)
      .map_err(|err| api_internal(err.to_string()))?;
  }

  Ok(bytes)
}

fn rasterize_pdf_bytes_to_images(
  state: &AppState,
  pdf_bytes: &[u8],
) -> std::result::Result<Vec<String>, (StatusCode, String)> {
  let Some(pdftoppm_cmd) = &state.pdftoppm_cmd else {
    return Err(api_internal(
      "pdftoppm is required for preview rendering but was not found",
    ));
  };

  let job_dir = preview_render_root(&state.runtime_dir).join(unique_upload_stem());
  fs::create_dir_all(&job_dir).map_err(|err| api_internal(err.to_string()))?;
  let input_pdf = job_dir.join("preview.pdf");
  let output_prefix = job_dir.join("page");
  fs::write(&input_pdf, pdf_bytes).map_err(|err| api_internal(err.to_string()))?;

  let status = ProcessCommand::new(pdftoppm_cmd)
    .arg("-png")
    .arg("-r")
    .arg(NOTICE_PREVIEW_RENDER_DPI.to_string())
    .arg(&input_pdf)
    .arg(&output_prefix)
    .status()
    .map_err(|err| api_internal(format!("failed to launch pdftoppm: {err}")))?;

  if !status.success() {
    let _ = fs::remove_dir_all(&job_dir);
    return Err(api_internal(
      "pdftoppm failed while generating preview images",
    ));
  }

  let mut pages = fs::read_dir(&job_dir)
    .map_err(|err| api_internal(err.to_string()))?
    .filter_map(|entry| entry.ok())
    .map(|entry| entry.path())
    .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("png"))
    .collect::<Vec<_>>();
  pages.sort_by_key(|path| {
    path
      .file_stem()
      .and_then(|stem| stem.to_str())
      .and_then(|stem| stem.rsplit('-').next())
      .and_then(|suffix| suffix.parse::<u32>().ok())
      .unwrap_or(0)
  });

  if pages.is_empty() {
    let _ = fs::remove_dir_all(&job_dir);
    return Err(api_internal("preview rasterizer did not produce images"));
  }

  let images = pages
    .into_iter()
    .map(|path| {
      fs::read(&path)
        .map(|bytes| format!("data:image/png;base64,{}", BASE64_STANDARD.encode(bytes)))
        .map_err(|err| api_internal(format!("failed to read {}: {err}", path.display())))
    })
    .collect::<std::result::Result<Vec<_>, _>>()?;

  let _ = fs::remove_dir_all(&job_dir);
  Ok(images)
}

async fn fetch_issue_document(
  client: &Client,
  issue_id: &str,
) -> std::result::Result<Option<IssueDocumentResponse>, tokio_postgres::Error> {
  let issue_id = issue_id.to_string();
  let issue_row = client
    .query_opt(
      "select
         id::text,
         issue_type,
         status,
         title,
         to_char(issue_month, 'YYYY-MM-DD'),
         to_char(meeting_date, 'YYYY-MM-DD'),
         to_char(meeting_time, 'HH24:MI'),
        place,
        header_note,
        footer_note,
        to_char(published_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
       from issues
       where id::text = $1",
      &[&issue_id],
    )
    .await?;

  let Some(issue_row) = issue_row else {
    return Ok(None);
  };

  let block_rows = client
    .query(
      "select
         id::text,
         block_kind,
         heading,
         body,
         audience_label,
         to_char(due_date, 'YYYY-MM-DD'),
         note,
         sort_order
       from blocks
       where issue_id::text = $1
       order by sort_order asc, created_at asc",
      &[&issue_id],
    )
    .await?;

  let item_rows = client
    .query(
      "select
         id::text,
         block_id::text,
         heading,
         body,
         audience_label,
         to_char(due_date, 'YYYY-MM-DD'),
         note,
         coalesce(meta_layout, 'stacked'),
         coalesce(thumb_scale_percent, 100),
         sort_order
       from block_items
       where block_id in (
         select id
         from blocks
         where issue_id::text = $1
       )
       order by sort_order asc, created_at asc",
      &[&issue_id],
    )
    .await?;

  let supplement_rows = client
    .query(
      "select
         id::text,
         item_id::text,
         tone,
         content,
         sort_order
       from block_item_supplements
       where item_id in (
         select id
         from block_items
         where block_id in (
           select id
           from blocks
           where issue_id::text = $1
         )
       )
       order by item_id asc, sort_order asc, created_at asc",
      &[&issue_id],
    )
    .await?;

  let attachment_rows = client
    .query(
      "select
         id::text,
         block_id::text,
         coalesce(item_id::text, ''),
         original_filename,
         mime_type
       from attachments
       where issue_id::text = $1
       order by sort_order asc, created_at asc",
      &[&issue_id],
    )
    .await?;

  let mut supplements_by_item = BTreeMap::<String, Vec<IssueDocumentItemSupplement>>::new();
  for row in supplement_rows {
    let item_id = row.get::<_, String>(1);
    supplements_by_item
      .entry(item_id)
      .or_default()
      .push(IssueDocumentItemSupplement {
        id: row.get::<_, String>(0),
        tone: normalize_item_supplement_tone(&row.get::<_, String>(2)).to_string(),
        content: row.get::<_, String>(3),
        sort_order: row.get::<_, i32>(4),
      });
  }

  let mut attachments_by_item = BTreeMap::<String, Vec<IssueDocumentAttachment>>::new();
  let mut legacy_attachments_by_block = BTreeMap::<String, Vec<IssueDocumentAttachment>>::new();
  for row in attachment_rows {
    let attachment_id = row.get::<_, String>(0);
    let block_id = row.get::<_, String>(1);
    let item_id = row.get::<_, String>(2);
    let attachment = IssueDocumentAttachment {
      id: attachment_id.clone(),
      original_filename: row.get::<_, String>(3),
      mime_type: row.get::<_, String>(4),
      display_kind: attachment_display_kind(&row.get::<_, String>(4)).to_string(),
      thumbnail_url: format!("/api/attachments/{attachment_id}/thumbnail"),
      content_url: format!("/api/attachments/{attachment_id}/content"),
    };
    if item_id.is_empty() {
      legacy_attachments_by_block
        .entry(block_id)
        .or_default()
        .push(attachment);
    } else {
      attachments_by_item
        .entry(item_id)
        .or_default()
        .push(attachment);
    }
  }

  let mut items_by_block = BTreeMap::<String, Vec<IssueDocumentItem>>::new();
  for row in item_rows {
    let item_id = row.get::<_, String>(0);
    let block_id = row.get::<_, String>(1);
    let legacy_note = row.get::<_, String>(6);
    let supplements = supplements_by_item
      .remove(&item_id)
      .filter(|values| !values.is_empty())
      .unwrap_or_else(|| legacy_item_supplements(&legacy_note));
    let item = IssueDocumentItem {
      id: item_id.clone(),
      heading: row.get::<_, String>(2),
      body: row.get::<_, String>(3),
      audience_label: row.get::<_, String>(4),
      due_date: row.get::<_, Option<String>>(5),
      note: legacy_note_from_supplements(&supplements),
      supplements,
      meta_layout: normalize_item_meta_layout(&row.get::<_, String>(7)).to_string(),
      thumb_scale_percent: normalize_item_thumb_scale_percent(row.get::<_, i32>(8)),
      sort_order: row.get::<_, i32>(9),
      attachments: attachments_by_item.remove(&item_id).unwrap_or_default(),
    };
    items_by_block.entry(block_id).or_default().push(item);
  }

  let issue = IssueDocumentIssue {
    id: issue_row.get::<_, String>(0),
    issue_type: issue_row.get::<_, String>(1),
    status: issue_row.get::<_, String>(2),
    title: issue_row.get::<_, String>(3),
    issue_month: issue_row.get::<_, Option<String>>(4),
    meeting_date: issue_row.get::<_, Option<String>>(5),
    meeting_time: issue_row.get::<_, Option<String>>(6),
    place: issue_row.get::<_, String>(7),
    header_note: issue_row.get::<_, String>(8),
    footer_note: issue_row.get::<_, String>(9),
    published_at: issue_row.get::<_, Option<String>>(10),
  };

  let blocks = block_rows
    .into_iter()
    .map(|row| {
      let block_id = row.get::<_, String>(0);
      let mut items = items_by_block.remove(&block_id).unwrap_or_default();
      if items.is_empty() {
        let legacy_body = row.get::<_, String>(3);
        let legacy_audience_label = row.get::<_, String>(4);
        let legacy_due_date = row.get::<_, Option<String>>(5);
        let legacy_note = row.get::<_, String>(6);
        let supplements = legacy_item_supplements(&legacy_note);
        let attachments = legacy_attachments_by_block
          .remove(&block_id)
          .unwrap_or_default();
        if !attachments.is_empty()
          || !legacy_body.is_empty()
          || !legacy_audience_label.is_empty()
          || legacy_due_date.is_some()
          || !legacy_note.is_empty()
        {
          items.push(IssueDocumentItem {
            id: String::new(),
            heading: String::new(),
            body: legacy_body,
            audience_label: legacy_audience_label,
            due_date: legacy_due_date,
            note: legacy_note_from_supplements(&supplements),
            supplements,
            meta_layout: ITEM_META_LAYOUT_STACKED.to_string(),
            thumb_scale_percent: ITEM_THUMB_SCALE_PERCENT_DEFAULT,
            sort_order: 1,
            attachments,
          });
        }
      }
      IssueDocumentBlock {
        id: block_id,
        block_kind: row.get::<_, String>(1),
        heading: row.get::<_, String>(2),
        sort_order: row.get::<_, i32>(7),
        items,
      }
    })
    .collect::<Vec<_>>();

  Ok(Some(IssueDocumentResponse { issue, blocks }))
}

async fn fetch_template_document(
  client: &Client,
  template_document_id: &str,
) -> std::result::Result<Option<TemplateDocumentResponse>, tokio_postgres::Error> {
  let row = client
    .query_opt(
      "select
         id::text,
         document_family,
         template_key,
         status,
         title,
         template_asset_path,
         template_version,
         payload,
         to_char(created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
         to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
       from template_documents
       where id::text = $1",
      &[&template_document_id],
    )
    .await?;

  let Some(row) = row else {
    return Ok(None);
  };

  let document_family = row.get::<_, String>(1);
  let template_key = row.get::<_, String>(2);
  let descriptor = match resolve_template_document_descriptor(&document_family, &template_key) {
    Ok(descriptor) => descriptor,
    Err((_, message)) => unreachable!("invalid template document in DB: {message}"),
  };
  let payload =
    normalize_template_document_payload(descriptor, &row.get::<_, serde_json::Value>(7));
  let title = default_template_document_title(descriptor, &payload);

  Ok(Some(TemplateDocumentResponse {
    document: TemplateDocumentDetail {
      id: row.get::<_, String>(0),
      document_family,
      template_key,
      status: row.get::<_, String>(3),
      title,
      template_asset_path: row.get::<_, String>(5),
      template_version: row.get::<_, String>(6),
      row_count: template_document_row_count(descriptor, &payload),
      payload,
      created_at: row.get::<_, Option<String>>(8),
      updated_at: row.get::<_, Option<String>>(9),
    },
  }))
}

async fn run_db_init(args: DbArgs) -> Result<()> {
  let database_name = ensure_database_exists(&args).await?;
  let client = connect_postgres(&args.database_url).await?;
  let applied_now = apply_migrations(&client, &manifest_db_dir()).await?;
  let backfilled = run_legacy_backfill_if_configured(&client, &args).await?;

  println!("database: {database_name}");
  println!("database_url: {}", redact_database_url(&args.database_url));
  println!(
    "legacy_storage_dir: {}",
    args
      .legacy_storage_dir
      .as_ref()
      .map(|path| path.display().to_string())
      .unwrap_or_else(|| "<none>".to_string())
  );
  println!("attachment_backfilled_rows: {backfilled}");
  if applied_now.is_empty() {
    println!("migrations_applied: 0");
  } else {
    println!("migrations_applied: {}", applied_now.len());
    for name in applied_now {
      println!("  - {name}");
    }
  }

  Ok(())
}

async fn run_db_migrate(args: DbArgs) -> Result<()> {
  let client = connect_postgres(&args.database_url).await?;
  let applied_now = apply_migrations(&client, &manifest_db_dir()).await?;
  let backfilled = run_legacy_backfill_if_configured(&client, &args).await?;

  println!("database_url: {}", redact_database_url(&args.database_url));
  println!(
    "legacy_storage_dir: {}",
    args
      .legacy_storage_dir
      .as_ref()
      .map(|path| path.display().to_string())
      .unwrap_or_else(|| "<none>".to_string())
  );
  println!("attachment_backfilled_rows: {backfilled}");
  if applied_now.is_empty() {
    println!("migrations_applied: 0");
  } else {
    println!("migrations_applied: {}", applied_now.len());
    for name in applied_now {
      println!("  - {name}");
    }
  }

  Ok(())
}

async fn run_db_status(args: DbArgs) -> Result<()> {
  let database_name = database_name_from_url(&args.database_url)?;
  let admin = connect_postgres(&args.admin_database_url).await?;
  let exists = admin
    .query_opt(
      "select 1 from pg_database where datname = $1",
      &[&database_name],
    )
    .await?
    .is_some();

  println!("database: {database_name}");
  println!("database_url: {}", redact_database_url(&args.database_url));
  println!(
    "admin_database_url: {}",
    redact_database_url(&args.admin_database_url)
  );
  println!(
    "legacy_storage_dir: {}",
    args
      .legacy_storage_dir
      .as_ref()
      .map(|path| path.display().to_string())
      .unwrap_or_else(|| "<none>".to_string())
  );
  println!("database_exists: {exists}");

  if !exists {
    return Ok(());
  }

  let client = connect_postgres(&args.database_url).await?;
  let migrations = list_applied_migrations(&client).await?;
  println!("applied_migrations: {}", migrations.len());
  for name in migrations {
    println!("  - {name}");
  }

  Ok(())
}

async fn run_db_reset(args: DbResetArgs) -> Result<()> {
  if !args.yes {
    bail!("db reset is destructive; pass --yes to continue");
  }

  let database_name = database_name_from_url(&args.common.database_url)?;
  let database_ident = quote_ident(&database_name)?;
  let admin = connect_postgres(&args.common.admin_database_url).await?;

  admin
    .execute(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      &[&database_name],
    )
    .await?;
  admin
    .execute(&format!("drop database if exists {database_ident}"), &[])
    .await
    .with_context(|| format!("failed to drop database `{database_name}`"))?;

  run_db_init(args.common).await
}

async fn index_page() -> impl IntoResponse {
  app_shell("index", None, None, false, Some(FAMILY_TAB_ISSUES))
}

async fn issues_index_page() -> impl IntoResponse {
  app_shell("index", None, None, false, Some(FAMILY_TAB_ISSUES))
}

async fn template_documents_index_page() -> impl IntoResponse {
  app_shell(
    "index",
    None,
    None,
    false,
    Some(TEMPLATE_DOCUMENT_FAMILY_SHOGAI_KYOSAI),
  )
}

async fn issue_edit_page(RoutePath(issue_id): RoutePath<String>) -> impl IntoResponse {
  app_shell(
    "edit",
    Some(&issue_id),
    None,
    false,
    Some(FAMILY_TAB_ISSUES),
  )
}

async fn issue_print_page(RoutePath(issue_id): RoutePath<String>) -> impl IntoResponse {
  app_shell(
    "print",
    Some(&issue_id),
    None,
    true,
    Some(FAMILY_TAB_ISSUES),
  )
}

async fn template_document_edit_page(
  RoutePath(template_document_id): RoutePath<String>,
) -> impl IntoResponse {
  app_shell(
    "template-edit",
    None,
    Some(&template_document_id),
    false,
    Some(TEMPLATE_DOCUMENT_FAMILY_SHOGAI_KYOSAI),
  )
}

async fn template_document_print_page(
  State(state): State<Arc<AppState>>,
  RoutePath(template_document_id): RoutePath<String>,
) -> impl IntoResponse {
  let edit_url = format!("/template-documents/{template_document_id}/edit");
  let Some(_browser_cmd) = &state.pdf_browser_cmd else {
    return (
      StatusCode::CONFLICT,
      template_document_error_html(
        "農作業傷害共済を印刷できません",
        "google-chrome または chromium が見つからないため、この帳票の正本印刷画面を開けません。JOKAI_PDF_BROWSER_CMD を含む Chrome 系の設定を確認してください。",
        &edit_url,
      ),
    )
      .into_response();
  };

  let document = match fetch_template_document(&state.client, &template_document_id).await {
    Ok(Some(document)) => document,
    Ok(None) => {
      return (
        StatusCode::NOT_FOUND,
        template_document_error_html(
          "帳票が見つかりません",
          "指定された帳票は存在しません。",
          &edit_url,
        ),
      )
        .into_response();
    }
    Err(err) => {
      return (
        StatusCode::INTERNAL_SERVER_ERROR,
        template_document_error_html(
          "帳票印刷画面の準備に失敗しました",
          &format!("template document の読込に失敗しました: {err}"),
          &edit_url,
        ),
      )
        .into_response();
    }
  };

  let descriptor = match resolve_template_document_descriptor(
    &document.document.document_family,
    &document.document.template_key,
  ) {
    Ok(descriptor) => descriptor,
    Err((status, message)) => {
      return (
        status,
        template_document_error_html("帳票印刷画面の準備に失敗しました", &message, &edit_url),
      )
        .into_response();
    }
  };

  let rows = match validate_template_document_payload(descriptor, &document.document.payload) {
    Ok(rows) => rows,
    Err((status, message)) => {
      return (
        status,
        template_document_error_html("帳票印刷画面の準備に失敗しました", &message, &edit_url),
      )
        .into_response();
    }
  };

  let mut svg_markups = Vec::with_capacity(rows.len());
  for row in rows {
    let svg_markup = match render_template_document_svg_markup(descriptor, &row) {
      Ok(svg_markup) => svg_markup,
      Err((status, message)) => {
        return (
          status,
          template_document_error_html("帳票印刷画面の準備に失敗しました", &message, &edit_url),
        )
          .into_response();
      }
    };
    svg_markups.push(svg_markup);
  }

  template_document_print_html(&document.document, descriptor, &svg_markups).into_response()
}

async fn healthz() -> impl IntoResponse {
  "ok"
}

async fn app_css() -> std::result::Result<impl IntoResponse, (StatusCode, String)> {
  let bytes = embedded_frontend_file(FRONTEND_APP_CSS)
    .ok_or_else(|| api_internal("embedded app.css is missing"))?
    .contents()
    .to_vec();
  Ok((
    [
      (header::CONTENT_TYPE, "text/css; charset=utf-8"),
      (header::CACHE_CONTROL, "no-store"),
    ],
    bytes,
  ))
}

async fn app_js() -> std::result::Result<impl IntoResponse, (StatusCode, String)> {
  let bytes = embedded_frontend_file(FRONTEND_APP_JS)
    .ok_or_else(|| api_internal("embedded app.js is missing"))?
    .contents()
    .to_vec();
  Ok((
    [
      (header::CONTENT_TYPE, "text/javascript; charset=utf-8"),
      (header::CACHE_CONTROL, "no-store"),
    ],
    bytes,
  ))
}

async fn font_asset(
  RoutePath(file_name): RoutePath<String>,
) -> std::result::Result<impl IntoResponse, (StatusCode, String)> {
  let bytes = bundled_font_bytes(&file_name)
    .map_err(|err| api_not_found(err.to_string()))?
    .to_vec();
  Ok((
    [
      (header::CONTENT_TYPE, "application/octet-stream"),
      (header::CACHE_CONTROL, "no-store"),
    ],
    bytes,
  ))
}

async fn frontend_asset(
  RoutePath(asset_path): RoutePath<String>,
) -> std::result::Result<impl IntoResponse, (StatusCode, String)> {
  let asset =
    embedded_frontend_file(&asset_path).ok_or_else(|| api_not_found("asset not found"))?;
  let bytes = asset.contents().to_vec();
  Ok((
    [
      (
        header::CONTENT_TYPE,
        asset_content_type(Path::new(asset.path())),
      ),
      (header::CACHE_CONTROL, "no-store"),
    ],
    bytes,
  ))
}

async fn api_preview_rasterize(
  State(state): State<Arc<AppState>>,
  mut multipart: Multipart,
) -> ApiResult<PreviewRenderResponse> {
  let mut pdf_bytes = None;
  while let Some(field) = multipart
    .next_field()
    .await
    .map_err(|err| api_internal(err.to_string()))?
  {
    if field.name() == Some("file") {
      let bytes = field
        .bytes()
        .await
        .map_err(|err| api_internal(err.to_string()))?;
      pdf_bytes = Some(bytes);
      break;
    }
  }

  let Some(pdf_bytes) = pdf_bytes else {
    return Err(api_bad_request("preview PDF file is missing"));
  };
  let images = rasterize_pdf_bytes_to_images(&state, pdf_bytes.as_ref())?;
  Ok(Json(PreviewRenderResponse { images }))
}

async fn api_template_document_preview_images(
  State(state): State<Arc<AppState>>,
  RoutePath(template_document_id): RoutePath<String>,
) -> ApiResult<PreviewRenderResponse> {
  let pdf_bytes = generate_template_document_pdf(&state, &template_document_id).await?;
  let images = rasterize_pdf_bytes_to_images(&state, &pdf_bytes)?;
  Ok(Json(PreviewRenderResponse { images }))
}

async fn api_template_document_print_pdf(
  State(state): State<Arc<AppState>>,
  RoutePath(template_document_id): RoutePath<String>,
) -> std::result::Result<impl IntoResponse, (StatusCode, String)> {
  let document = fetch_template_document(&state.client, &template_document_id)
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("template document not found"))?;
  let file_name = format!(
    "{}.pdf",
    sanitize_pdf_download_name(document.document.title.trim(), "template-document")
  );
  let bytes = generate_template_document_pdf(&state, &template_document_id).await?;
  let mut headers = header::HeaderMap::new();
  headers.insert(
    header::CONTENT_TYPE,
    header::HeaderValue::from_static("application/pdf"),
  );
  headers.insert(
    header::CACHE_CONTROL,
    header::HeaderValue::from_static("no-store"),
  );
  headers.insert(
    header::CONTENT_DISPOSITION,
    header::HeaderValue::from_str(&format!(
      "attachment; filename=\"{}\"",
      sanitize_filename(&file_name)
    ))
    .map_err(|err| api_internal(err.to_string()))?,
  );
  Ok((headers, bytes))
}

async fn api_meta(State(state): State<Arc<AppState>>) -> impl IntoResponse {
  Json(MetaResponse {
    app: "jokai",
    database_url: state.database_url_redacted.clone(),
    runtime_dir: state.runtime_dir.display().to_string(),
    applied_migrations: state.applied_migrations.as_ref().clone(),
  })
}

async fn api_issues(State(state): State<Arc<AppState>>) -> ApiResult<Vec<IssueListItem>> {
  let rows = state
    .client
    .query(
      "select
         i.id::text,
         i.issue_type,
         i.status,
         i.title,
         to_char(i.issue_month, 'YYYY-MM-DD'),
         i.place,
         to_char(i.published_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
         count(b.id)::bigint
       from issues i
       left join blocks b on b.issue_id = i.id
       group by i.id, i.issue_type, i.status, i.title, i.issue_month, i.place, i.published_at, i.created_at
       order by i.issue_month desc nulls last, i.created_at desc
       limit 100",
      &[],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let issues = rows
    .into_iter()
    .map(|row| IssueListItem {
      id: row.get::<_, String>(0),
      issue_type: row.get::<_, String>(1),
      status: row.get::<_, String>(2),
      title: row.get::<_, String>(3),
      issue_month: row.get::<_, Option<String>>(4),
      place: row.get::<_, String>(5),
      published_at: row.get::<_, Option<String>>(6),
      block_count: row.get::<_, i64>(7),
    })
    .collect::<Vec<_>>();

  Ok(Json(issues))
}

async fn api_create_issue(
  State(state): State<Arc<AppState>>,
  Json(payload): Json<CreateIssuePayload>,
) -> ApiResult<CreateIssueResponse> {
  validate_issue_type(&payload.issue_type)?;

  let row = state
    .client
    .query_one(
      "insert into issues (issue_type, status, title, issue_month, place)
       values ($1, 'draft', $2, date_trunc('month', current_date)::date, $3)
       returning id::text",
      &[
        &payload.issue_type,
        &default_issue_title(&payload.issue_type),
        &DEFAULT_MEETING_PLACE,
      ],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  Ok(Json(CreateIssueResponse { id: row.get(0) }))
}

async fn api_template_documents(
  State(state): State<Arc<AppState>>,
) -> ApiResult<Vec<TemplateDocumentListItem>> {
  let rows = state
    .client
    .query(
      "select
         id::text,
         document_family,
         template_key,
         status,
         title,
         template_asset_path,
         template_version,
         payload,
         to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
       from template_documents
       order by updated_at desc, created_at desc
       limit 100",
      &[],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let documents = rows
    .into_iter()
    .map(|row| {
      let document_family = row.get::<_, String>(1);
      let template_key = row.get::<_, String>(2);
      let descriptor = match resolve_template_document_descriptor(&document_family, &template_key) {
        Ok(descriptor) => descriptor,
        Err((_, message)) => unreachable!("invalid template document in DB: {message}"),
      };
      let payload =
        normalize_template_document_payload(descriptor, &row.get::<_, serde_json::Value>(7));
      TemplateDocumentListItem {
        id: row.get::<_, String>(0),
        document_family,
        template_key,
        status: row.get::<_, String>(3),
        title: default_template_document_title(descriptor, &payload),
        template_asset_path: row.get::<_, String>(5),
        template_version: row.get::<_, String>(6),
        row_count: template_document_row_count(descriptor, &payload),
        updated_at: row.get::<_, Option<String>>(8),
      }
    })
    .collect::<Vec<_>>();

  Ok(Json(documents))
}

async fn api_create_template_document(
  State(state): State<Arc<AppState>>,
  Json(payload): Json<CreateTemplateDocumentPayload>,
) -> ApiResult<CreateTemplateDocumentResponse> {
  let descriptor =
    resolve_template_document_descriptor(&payload.document_family, &payload.template_key)?;
  let default_payload = default_template_document_payload(descriptor);
  let title = default_template_document_title(descriptor, &default_payload);

  let row = state
    .client
    .query_one(
      "insert into template_documents (
         document_family,
         template_key,
         status,
         title,
         template_asset_path,
         template_version,
         payload
       )
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id::text",
      &[
        &descriptor.document_family,
        &descriptor.template_key,
        &TEMPLATE_DOCUMENT_STATUS_DRAFT,
        &title,
        &descriptor.template_asset_path,
        &descriptor.template_version,
        &default_payload,
      ],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  Ok(Json(CreateTemplateDocumentResponse { id: row.get(0) }))
}

async fn api_template_document_detail(
  State(state): State<Arc<AppState>>,
  RoutePath(template_document_id): RoutePath<String>,
) -> ApiResult<TemplateDocumentResponse> {
  let document = fetch_template_document(&state.client, &template_document_id)
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("template document not found"))?;

  Ok(Json(document))
}

async fn api_template_document_save(
  State(state): State<Arc<AppState>>,
  RoutePath(template_document_id): RoutePath<String>,
  Json(payload): Json<SaveTemplateDocumentPayload>,
) -> ApiResult<TemplateDocumentResponse> {
  let row = state
    .client
    .query_opt(
      "select document_family, template_key, status
       from template_documents
       where id::text = $1",
      &[&template_document_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let Some(row) = row else {
    return Err(api_not_found("template document not found"));
  };

  let descriptor =
    resolve_template_document_descriptor(&row.get::<_, String>(0), &row.get::<_, String>(1))?;
  let _status = row.get::<_, String>(2);
  let normalized_payload = normalize_template_document_payload(descriptor, &payload.payload);
  let title = normalize_template_document_title(&payload.title, descriptor, &normalized_payload);

  state
    .client
    .execute(
      "update template_documents
       set title = $1,
           payload = $2
       where id::text = $3",
      &[&title, &normalized_payload, &template_document_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let document = fetch_template_document(&state.client, &template_document_id)
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("template document not found after save"))?;

  Ok(Json(document))
}

async fn api_template_document_delete(
  State(state): State<Arc<AppState>>,
  RoutePath(template_document_id): RoutePath<String>,
) -> ApiResult<DeleteTemplateDocumentResponse> {
  let exists = state
    .client
    .query_opt(
      "select 1 from template_documents where id::text = $1",
      &[&template_document_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .is_some();

  if !exists {
    return Err(api_not_found("template document not found"));
  }

  state
    .client
    .execute(
      "delete from template_documents where id::text = $1",
      &[&template_document_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  Ok(Json(DeleteTemplateDocumentResponse {
    id: template_document_id,
  }))
}

async fn api_issue_detail(
  State(state): State<Arc<AppState>>,
  RoutePath(issue_id): RoutePath<String>,
) -> ApiResult<IssueDocumentResponse> {
  let document = fetch_issue_document(&state.client, &issue_id)
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("issue not found"))?;

  Ok(Json(document))
}

async fn api_issue_save(
  State(state): State<Arc<AppState>>,
  RoutePath(issue_id): RoutePath<String>,
  Json(payload): Json<SaveIssuePayload>,
) -> ApiResult<IssueDocumentResponse> {
  validate_issue_type(&payload.issue_type)?;
  if payload.title.trim().is_empty() {
    return Err(api_bad_request("title must not be empty"));
  }
  for block in &payload.blocks {
    validate_block_kind(&block.block_kind)?;
  }

  let status_row = state
    .client
    .query_opt(
      "select status from issues where id::text = $1",
      &[&issue_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let Some(status_row) = status_row else {
    return Err(api_not_found("issue not found"));
  };

  let current_status: String = status_row.get(0);
  if current_status == "published" {
    return Err(api_conflict("公開済みの案内は現在の画面から編集できません"));
  }

  let issue_month = normalize_month_value(&payload.issue_month);
  let meeting_date = payload.meeting_date.trim().to_string();
  let meeting_time = payload.meeting_time.trim().to_string();
  let place = payload.place.trim().to_string();
  let header_note = payload.header_note.trim().to_string();
  let footer_note = payload.footer_note.trim().to_string();
  let title = payload.title.trim().to_string();

  state
    .client
    .execute(
      "update issues
       set issue_type = $1,
           title = $2,
           issue_month = nullif($3, '')::date,
           meeting_date = nullif($4, '')::date,
           meeting_time = nullif($5, '')::time,
           place = $6,
           header_note = $7,
           footer_note = $8,
           source_version = source_version + 1
       where id::text = $9",
      &[
        &payload.issue_type,
        &title,
        &issue_month,
        &meeting_date,
        &meeting_time,
        &place,
        &header_note,
        &footer_note,
        &issue_id,
      ],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let existing_block_rows = state
    .client
    .query(
      "select id::text from blocks where issue_id::text = $1 order by sort_order asc",
      &[&issue_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;
  let existing_block_ids = existing_block_rows
    .into_iter()
    .map(|row| row.get::<_, String>(0))
    .collect::<BTreeSet<_>>();
  let mut retained_block_ids = BTreeSet::new();

  for (index, block) in payload.blocks.iter().enumerate() {
    let sort_order = index as i32 + 1;
    let heading = block.heading.trim().to_string();
    let maybe_block_id = block
      .id
      .as_deref()
      .map(str::trim)
      .filter(|id| !id.is_empty());

    let resolved_block_id = if let Some(block_id) = maybe_block_id {
      if existing_block_ids.contains(block_id) {
        state
          .client
          .execute(
            "update blocks
             set sort_order = $1,
                 block_kind = $2,
                 heading = $3,
                 body = '',
                 audience_label = '',
                 due_date = null,
                 note = ''
             where id::text = $4 and issue_id::text = $5",
            &[
              &sort_order,
              &block.block_kind,
              &heading,
              &block_id,
              &issue_id,
            ],
          )
          .await
          .map_err(|err| api_internal(err.to_string()))?;
        retained_block_ids.insert(block_id.to_string());
        block_id.to_string()
      } else {
        let inserted_block = state
          .client
          .query_one(
            "insert into blocks (
               issue_id,
               sort_order,
               block_kind,
               heading,
               body,
               audience_label,
               due_date,
               note
             )
             values (
               (select id from issues where id::text = $1),
               $2,
               $3,
               $4,
               '',
               '',
               null,
               ''
             )
             returning id::text",
            &[&issue_id, &sort_order, &block.block_kind, &heading],
          )
          .await
          .map_err(|err| api_internal(err.to_string()))?;
        let inserted_id = inserted_block.get::<_, String>(0);
        retained_block_ids.insert(inserted_id.clone());
        inserted_id
      }
    } else {
      let inserted_block = state
        .client
        .query_one(
          "insert into blocks (
             issue_id,
             sort_order,
             block_kind,
             heading,
             body,
             audience_label,
             due_date,
             note
           )
           values (
             (select id from issues where id::text = $1),
             $2,
             $3,
             $4,
             '',
             '',
             null,
             ''
           )
           returning id::text",
          &[&issue_id, &sort_order, &block.block_kind, &heading],
        )
        .await
        .map_err(|err| api_internal(err.to_string()))?;
      let inserted_id = inserted_block.get::<_, String>(0);
      retained_block_ids.insert(inserted_id.clone());
      inserted_id
    };

    let existing_item_rows = state
      .client
      .query(
        "select id::text
         from block_items
         where block_id::text = $1
         order by sort_order asc, created_at asc",
        &[&resolved_block_id],
      )
      .await
      .map_err(|err| api_internal(err.to_string()))?;
    let existing_item_ids = existing_item_rows
      .into_iter()
      .map(|row| row.get::<_, String>(0))
      .collect::<BTreeSet<_>>();
    let mut retained_item_ids = BTreeSet::new();

    for (item_index, item) in block.items.iter().enumerate() {
      let item_sort_order = item_index as i32 + 1;
      let item_heading = item.heading.trim().to_string();
      let item_body = item.body.trim().to_string();
      let item_audience_label = item.audience_label.trim().to_string();
      let item_due_date = item.due_date.trim().to_string();
      let item_supplements = normalize_save_item_supplements(&item.supplements, &item.note);
      let item_meta_layout = normalize_item_meta_layout(&item.meta_layout).to_string();
      let item_thumb_scale_percent = normalize_item_thumb_scale_percent(item.thumb_scale_percent);
      let maybe_item_id = item
        .id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());

      let resolved_item_id = if let Some(item_id) = maybe_item_id {
        if existing_item_ids.contains(item_id) {
          state
            .client
            .execute(
              "update block_items
               set sort_order = $1,
                   heading = $2,
                   body = $3,
                   audience_label = $4,
                   due_date = nullif($5, '')::date,
                   note = '',
                   meta_layout = $6,
                   thumb_scale_percent = $7
               where id::text = $8 and block_id::text = $9",
              &[
                &item_sort_order,
                &item_heading,
                &item_body,
                &item_audience_label,
                &item_due_date,
                &item_meta_layout,
                &item_thumb_scale_percent,
                &item_id,
                &resolved_block_id,
              ],
            )
            .await
            .map_err(|err| api_internal(err.to_string()))?;
          retained_item_ids.insert(item_id.to_string());
          item_id.to_string()
        } else {
          let inserted_item = state
            .client
            .query_one(
              "insert into block_items (
                 block_id,
                 sort_order,
                 heading,
                 body,
                 audience_label,
                 due_date,
                 note,
                 meta_layout,
                 thumb_scale_percent
               )
               values (
                 (select id from blocks where id::text = $1),
                 $2,
                 $3,
                 $4,
                 $5,
                 nullif($6, '')::date,
                 '',
                 $7,
                 $8
               )
               returning id::text",
              &[
                &resolved_block_id,
                &item_sort_order,
                &item_heading,
                &item_body,
                &item_audience_label,
                &item_due_date,
                &item_meta_layout,
                &item_thumb_scale_percent,
              ],
            )
            .await
            .map_err(|err| api_internal(err.to_string()))?;
          let inserted_id = inserted_item.get::<_, String>(0);
          retained_item_ids.insert(inserted_id.clone());
          inserted_id
        }
      } else {
        let inserted_item = state
          .client
          .query_one(
            "insert into block_items (
               block_id,
               sort_order,
               heading,
               body,
               audience_label,
               due_date,
               note,
               meta_layout,
               thumb_scale_percent
             )
             values (
               (select id from blocks where id::text = $1),
               $2,
               $3,
               $4,
               $5,
               nullif($6, '')::date,
               '',
               $7,
               $8
             )
             returning id::text",
            &[
              &resolved_block_id,
              &item_sort_order,
              &item_heading,
              &item_body,
              &item_audience_label,
              &item_due_date,
              &item_meta_layout,
              &item_thumb_scale_percent,
            ],
          )
          .await
          .map_err(|err| api_internal(err.to_string()))?;
        let inserted_id = inserted_item.get::<_, String>(0);
        retained_item_ids.insert(inserted_id.clone());
        inserted_id
      };

      replace_item_supplements(&state.client, &resolved_item_id, &item_supplements)
        .await
        .map_err(|err| api_internal(err.to_string()))?;
    }

    for existing_item_id in existing_item_ids {
      if retained_item_ids.contains(&existing_item_id) {
        continue;
      }

      state
        .client
        .execute(
          "delete from block_items where id::text = $1 and block_id::text = $2",
          &[&existing_item_id, &resolved_block_id],
        )
        .await
        .map_err(|err| api_internal(err.to_string()))?;
    }
  }

  for existing_block_id in existing_block_ids {
    if retained_block_ids.contains(&existing_block_id) {
      continue;
    }

    state
      .client
      .execute(
        "delete from blocks where id::text = $1 and issue_id::text = $2",
        &[&existing_block_id, &issue_id],
      )
      .await
      .map_err(|err| api_internal(err.to_string()))?;
  }

  let document = fetch_issue_document(&state.client, &issue_id)
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("issue not found after save"))?;

  Ok(Json(document))
}

async fn duplicate_issue_children(
  state: &Arc<AppState>,
  source_issue_id: &str,
  duplicated_issue_id: &str,
) -> std::result::Result<(), (StatusCode, String)> {
  let block_rows = state
    .client
    .query(
      "select
         id::text,
         block_kind,
         heading,
         body,
         audience_label,
         to_char(due_date, 'YYYY-MM-DD'),
         note,
         sort_order
       from blocks
       where issue_id::text = $1
       order by sort_order asc, created_at asc",
      &[&source_issue_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let item_rows = state
    .client
    .query(
      "select
         id::text,
         block_id::text,
         heading,
         body,
         audience_label,
         to_char(due_date, 'YYYY-MM-DD'),
         note,
         coalesce(meta_layout, 'stacked'),
         coalesce(thumb_scale_percent, 100),
         sort_order
       from block_items
       where block_id in (
         select id
         from blocks
         where issue_id::text = $1
       )
       order by sort_order asc, created_at asc",
      &[&source_issue_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let supplement_rows = state
    .client
    .query(
      "select
         id::text,
         item_id::text,
         tone,
         content,
         sort_order
       from block_item_supplements
       where item_id in (
         select id
         from block_items
         where block_id in (
           select id
           from blocks
           where issue_id::text = $1
         )
       )
       order by item_id asc, sort_order asc, created_at asc",
      &[&source_issue_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let attachment_rows = state
    .client
    .query(
      "select
         id::text,
         block_id::text,
         item_id::text,
         sort_order,
         original_filename,
         mime_type,
         legacy_original_path,
         legacy_thumbnail_path,
         page_count,
         width,
         height
       from attachments
       where issue_id::text = $1
       order by sort_order asc, created_at asc",
      &[&source_issue_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let mut supplements_by_item = BTreeMap::<String, Vec<IssueDocumentItemSupplement>>::new();
  for row in supplement_rows {
    let item_id = row.get::<_, String>(1);
    supplements_by_item
      .entry(item_id)
      .or_default()
      .push(IssueDocumentItemSupplement {
        id: row.get::<_, String>(0),
        tone: normalize_item_supplement_tone(&row.get::<_, String>(2)).to_string(),
        content: row.get::<_, String>(3),
        sort_order: row.get::<_, i32>(4),
      });
  }

  let mut duplicated_block_ids = BTreeMap::<String, String>::new();
  for row in block_rows {
    let source_block_id = row.get::<_, String>(0);
    let duplicated_block_row = state
      .client
      .query_one(
        "insert into blocks (
           issue_id,
           sort_order,
           block_kind,
           heading,
           body,
           audience_label,
           due_date,
           note
         )
         values (
           (select id from issues where id::text = $1),
           $2,
           $3,
           $4,
           $5,
           $6,
           nullif($7, '')::date,
           $8
         )
         returning id::text",
        &[
          &duplicated_issue_id,
          &row.get::<_, i32>(7),
          &row.get::<_, String>(1),
          &row.get::<_, String>(2),
          &row.get::<_, String>(3),
          &row.get::<_, String>(4),
          &row.get::<_, Option<String>>(5).unwrap_or_default(),
          &row.get::<_, String>(6),
        ],
      )
      .await
      .map_err(|err| api_internal(err.to_string()))?;
    duplicated_block_ids.insert(source_block_id, duplicated_block_row.get::<_, String>(0));
  }

  let mut duplicated_item_ids = BTreeMap::<String, String>::new();
  for row in item_rows {
    let source_item_id = row.get::<_, String>(0);
    let source_block_id = row.get::<_, String>(1);
    let legacy_note = row.get::<_, String>(6);
    let duplicated_block_id = duplicated_block_ids
      .get(&source_block_id)
      .cloned()
      .ok_or_else(|| api_internal("missing duplicated block while duplicating items"))?;

    let duplicated_item_row = state
      .client
      .query_one(
        "insert into block_items (
           block_id,
           sort_order,
           heading,
           body,
           audience_label,
           due_date,
           note,
           meta_layout,
           thumb_scale_percent
         )
         values (
           (select id from blocks where id::text = $1),
           $2,
           $3,
           $4,
           $5,
           nullif($6, '')::date,
           '',
           $7,
           $8
         )
         returning id::text",
        &[
          &duplicated_block_id,
          &row.get::<_, i32>(9),
          &row.get::<_, String>(2),
          &row.get::<_, String>(3),
          &row.get::<_, String>(4),
          &row.get::<_, Option<String>>(5).unwrap_or_default(),
          &normalize_item_meta_layout(&row.get::<_, String>(7)).to_string(),
          &normalize_item_thumb_scale_percent(row.get::<_, i32>(8)),
        ],
      )
      .await
      .map_err(|err| api_internal(err.to_string()))?;
    let duplicated_item_id = duplicated_item_row.get::<_, String>(0);
    duplicated_item_ids.insert(source_item_id.clone(), duplicated_item_id.clone());

    let supplements = supplements_by_item
      .remove(&source_item_id)
      .filter(|values| !values.is_empty())
      .unwrap_or_else(|| legacy_item_supplements(&legacy_note));
    for (supplement_index, supplement) in supplements.iter().enumerate() {
      let sort_order = supplement_index as i32 + 1;
      state
        .client
        .execute(
          "insert into block_item_supplements (item_id, sort_order, tone, content)
           values ((select id from block_items where id::text = $1), $2, $3, $4)",
          &[
            &duplicated_item_id,
            &sort_order,
            &normalize_item_supplement_tone(&supplement.tone).to_string(),
            &supplement.content,
          ],
        )
        .await
        .map_err(|err| api_internal(err.to_string()))?;
    }
  }

  for row in attachment_rows {
    let source_attachment_id = row.get::<_, String>(0);
    let source_block_id = row.get::<_, String>(1);
    let source_item_id = row.get::<_, Option<String>>(2);
    let sort_order = row.get::<_, i32>(3);
    let original_filename = row.get::<_, String>(4);
    let mime_type = row.get::<_, String>(5);
    let legacy_original_path = row.get::<_, String>(6);
    let legacy_thumbnail_path = row.get::<_, String>(7);
    let page_count = row.get::<_, Option<i32>>(8);
    let width = row.get::<_, Option<i32>>(9);
    let height = row.get::<_, Option<i32>>(10);

    let duplicated_block_id = duplicated_block_ids
      .get(&source_block_id)
      .cloned()
      .ok_or_else(|| api_internal("missing duplicated block while duplicating attachments"))?;
    let duplicated_item_id = source_item_id
      .as_ref()
      .map(|value| {
        duplicated_item_ids
          .get(value)
          .cloned()
          .ok_or_else(|| api_internal("missing duplicated item while duplicating attachments"))
      })
      .transpose()?;

    let duplicated_attachment_id = insert_attachment_metadata(
      &state.client,
      duplicated_issue_id,
      &duplicated_block_id,
      duplicated_item_id.as_deref(),
      sort_order,
      &original_filename,
      &mime_type,
      "",
      "",
      page_count,
      width,
      height,
    )
    .await?;

    let (_, original_bytes) =
      fetch_attachment_original_bytes(state.as_ref(), &source_attachment_id).await?;
    upsert_attachment_original_content(&state.client, &duplicated_attachment_id, &original_bytes)
      .await?;

    if let Some((thumb_mime, thumb_bytes)) =
      fetch_attachment_thumbnail_cache(state.as_ref(), &source_attachment_id).await?
    {
      upsert_attachment_thumbnail_cache(
        &state.client,
        &duplicated_attachment_id,
        &thumb_mime,
        &thumb_bytes,
      )
      .await?;
    } else if let Ok((thumb_mime, legacy_thumb_bytes)) =
      fetch_attachment_thumbnail_bytes(state.as_ref(), &source_attachment_id).await
    {
      upsert_attachment_thumbnail_cache(
        &state.client,
        &duplicated_attachment_id,
        &thumb_mime,
        &legacy_thumb_bytes,
      )
      .await?;
    } else if attachment_display_kind(&mime_type) != "pdf" {
      upsert_attachment_thumbnail_cache(
        &state.client,
        &duplicated_attachment_id,
        &mime_type,
        &original_bytes,
      )
      .await?;
    }

    let _ = legacy_original_path;
    let _ = legacy_thumbnail_path;
  }

  Ok(())
}

async fn api_issue_delete(
  State(state): State<Arc<AppState>>,
  RoutePath(issue_id): RoutePath<String>,
) -> ApiResult<DeleteIssueResponse> {
  let status_row = state
    .client
    .query_opt(
      "select status from issues where id::text = $1",
      &[&issue_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let Some(status_row) = status_row else {
    return Err(api_not_found("issue not found"));
  };

  let status = status_row.get::<_, String>(0);
  if status == "published" {
    return Err(api_conflict("公開済みの案内は削除できません"));
  }

  state
    .client
    .execute("delete from issues where id::text = $1", &[&issue_id])
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  remove_issue_runtime_artifacts(&state.runtime_dir, &issue_id);

  Ok(Json(DeleteIssueResponse { id: issue_id }))
}

async fn api_issue_duplicate(
  State(state): State<Arc<AppState>>,
  RoutePath(issue_id): RoutePath<String>,
) -> ApiResult<DuplicateIssueResponse> {
  let source_issue_row = state
    .client
    .query_opt(
      "select
         issue_type,
         title,
         to_char(issue_month, 'YYYY-MM-DD'),
         to_char(meeting_date, 'YYYY-MM-DD'),
         to_char(meeting_time, 'HH24:MI'),
         place,
         header_note,
         footer_note,
         correction_of_issue_id::text
       from issues
       where id::text = $1",
      &[&issue_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("issue not found"))?;

  let issue_type = source_issue_row.get::<_, String>(0);
  let source_title = source_issue_row.get::<_, String>(1);
  let issue_month = source_issue_row
    .get::<_, Option<String>>(2)
    .unwrap_or_default();
  let meeting_date = source_issue_row
    .get::<_, Option<String>>(3)
    .unwrap_or_default();
  let meeting_time = source_issue_row
    .get::<_, Option<String>>(4)
    .unwrap_or_default();
  let place = source_issue_row.get::<_, String>(5);
  let header_note = source_issue_row.get::<_, String>(6);
  let footer_note = source_issue_row.get::<_, String>(7);
  let correction_of_issue_id = source_issue_row.get::<_, Option<String>>(8);
  let duplicated_title = duplicate_issue_title(&source_title);

  let duplicated_issue_row = state
    .client
    .query_one(
      "insert into issues (
         issue_type,
         status,
         title,
         issue_month,
         meeting_date,
         meeting_time,
         place,
         header_note,
         footer_note,
         correction_of_issue_id,
         published_at
       )
       values (
         $1,
         'draft',
         $2,
         nullif($3, '')::date,
         nullif($4, '')::date,
         nullif($5, '')::time,
         $6,
         $7,
         $8,
         nullif($9, '')::uuid,
         null
       )
       returning id::text",
      &[
        &issue_type,
        &duplicated_title,
        &issue_month,
        &meeting_date,
        &meeting_time,
        &place,
        &header_note,
        &footer_note,
        &correction_of_issue_id.unwrap_or_default(),
      ],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;
  let duplicated_issue_id = duplicated_issue_row.get::<_, String>(0);

  if let Err(err) = duplicate_issue_children(&state, &issue_id, &duplicated_issue_id).await {
    let _ = state
      .client
      .execute(
        "delete from issues where id::text = $1",
        &[&duplicated_issue_id],
      )
      .await;
    remove_issue_runtime_artifacts(&state.runtime_dir, &duplicated_issue_id);
    return Err(err);
  }

  Ok(Json(DuplicateIssueResponse {
    id: duplicated_issue_id,
  }))
}

async fn ensure_first_item_for_block(
  state: &Arc<AppState>,
  block_id: &str,
) -> std::result::Result<(String, String), (StatusCode, String)> {
  let row = state
    .client
    .query_opt(
      "select bi.id::text, b.issue_id::text
       from block_items bi
       join blocks b on b.id = bi.block_id
       where bi.block_id::text = $1
       order by bi.sort_order asc, bi.created_at asc
       limit 1",
      &[&block_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  if let Some(row) = row {
    return Ok((row.get::<_, String>(0), row.get::<_, String>(1)));
  }

  let block_row = state
    .client
    .query_opt(
      "select issue_id::text from blocks where id::text = $1",
      &[&block_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("block not found"))?;
  let issue_id = block_row.get::<_, String>(0);
  let inserted = state
    .client
    .query_one(
      "insert into block_items (block_id, sort_order, heading, body, audience_label, note)
       values ((select id from blocks where id::text = $1), 1, '', '', '', '')
       returning id::text",
      &[&block_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;
  Ok((inserted.get::<_, String>(0), issue_id))
}

async fn insert_attachment_metadata(
  client: &Client,
  issue_id: &str,
  block_id: &str,
  item_id: Option<&str>,
  sort_order: i32,
  original_filename: &str,
  mime_type: &str,
  legacy_original_path: &str,
  legacy_thumbnail_path: &str,
  page_count: Option<i32>,
  width: Option<i32>,
  height: Option<i32>,
) -> std::result::Result<String, (StatusCode, String)> {
  let inserted = client
    .query_one(
      "insert into attachments (
         issue_id,
         block_id,
         item_id,
         sort_order,
         original_filename,
         mime_type,
         legacy_original_path,
         legacy_thumbnail_path,
         page_count,
         width,
         height
       )
       values (
         (select id from issues where id::text = $1),
         (select id from blocks where id::text = $2),
         case
           when $3::text is null or $3::text = '' then null
           else (select id from block_items where id::text = $3)
         end,
         $4,
         $5,
         $6,
         $7,
         $8,
         $9,
         $10,
         $11
       )
       returning id::text",
      &[
        &issue_id,
        &block_id,
        &item_id,
        &sort_order,
        &original_filename,
        &mime_type,
        &legacy_original_path,
        &legacy_thumbnail_path,
        &page_count,
        &width,
        &height,
      ],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  Ok(inserted.get::<_, String>(0))
}

async fn store_attachment_upload(
  state: &AppState,
  issue_id: &str,
  block_id: &str,
  item_id: &str,
  filename: &str,
  mime_type: &str,
  bytes: &[u8],
) -> std::result::Result<(), (StatusCode, String)> {
  let sort_row = state
    .client
    .query_one(
      "select coalesce(max(sort_order), 0) + 1 from attachments where item_id::text = $1",
      &[&item_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;
  let sort_order = sort_row.get::<_, i32>(0);

  let attachment_id = insert_attachment_metadata(
    &state.client,
    issue_id,
    block_id,
    Some(item_id),
    sort_order,
    filename,
    mime_type,
    "",
    "",
    None,
    None,
    None,
  )
  .await?;

  upsert_attachment_original_content(&state.client, &attachment_id, bytes).await?;

  if attachment_display_kind(mime_type) != "pdf" {
    upsert_attachment_thumbnail_cache(&state.client, &attachment_id, mime_type, bytes).await?;
  }

  Ok(())
}

async fn api_item_attachment_upload(
  State(state): State<Arc<AppState>>,
  RoutePath(item_id): RoutePath<String>,
  mut multipart: Multipart,
) -> ApiResult<IssueDocumentResponse> {
  let item_row = state
    .client
    .query_opt(
      "select bi.block_id::text, b.issue_id::text
       from block_items bi
       join blocks b on b.id = bi.block_id
       where bi.id::text = $1",
      &[&item_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("item not found"))?;
  let block_id = item_row.get::<_, String>(0);
  let issue_id = item_row.get::<_, String>(1);

  let mut uploaded = false;
  while let Some(field) = multipart
    .next_field()
    .await
    .map_err(|err| api_internal(err.to_string()))?
  {
    let filename = field
      .file_name()
      .map(sanitize_filename)
      .unwrap_or_else(|| "upload.bin".to_string());
    let mime_type = field
      .content_type()
      .map(|mime| mime.to_string())
      .unwrap_or_else(|| "application/octet-stream".to_string());
    let bytes = field
      .bytes()
      .await
      .map_err(|err| api_internal(err.to_string()))?;

    store_attachment_upload(
      &state,
      &issue_id,
      &block_id,
      &item_id,
      &filename,
      &mime_type,
      bytes.as_ref(),
    )
    .await?;
    uploaded = true;
  }

  if !uploaded {
    return Err(api_bad_request("upload file is missing"));
  }

  let document = fetch_issue_document(&state.client, &issue_id)
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("issue not found after attachment upload"))?;

  Ok(Json(document))
}

async fn api_block_attachment_upload(
  State(state): State<Arc<AppState>>,
  RoutePath(block_id): RoutePath<String>,
  mut multipart: Multipart,
) -> ApiResult<IssueDocumentResponse> {
  let (item_id, issue_id) = ensure_first_item_for_block(&state, &block_id).await?;

  let mut uploaded = false;
  while let Some(field) = multipart
    .next_field()
    .await
    .map_err(|err| api_internal(err.to_string()))?
  {
    let filename = field
      .file_name()
      .map(sanitize_filename)
      .unwrap_or_else(|| "upload.bin".to_string());
    let mime_type = field
      .content_type()
      .map(|mime| mime.to_string())
      .unwrap_or_else(|| "application/octet-stream".to_string());
    let bytes = field
      .bytes()
      .await
      .map_err(|err| api_internal(err.to_string()))?;

    store_attachment_upload(
      &state,
      &issue_id,
      &block_id,
      &item_id,
      &filename,
      &mime_type,
      bytes.as_ref(),
    )
    .await?;
    uploaded = true;
  }

  if !uploaded {
    return Err(api_bad_request("upload file is missing"));
  }

  let document = fetch_issue_document(&state.client, &issue_id)
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("issue not found after attachment upload"))?;

  Ok(Json(document))
}

async fn api_attachment_delete(
  State(state): State<Arc<AppState>>,
  RoutePath(attachment_id): RoutePath<String>,
) -> ApiResult<IssueDocumentResponse> {
  let attachment_row = state
    .client
    .query_opt(
      "select issue_id::text from attachments where id::text = $1",
      &[&attachment_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("attachment not found"))?;

  let issue_id = attachment_row.get::<_, String>(0);

  state
    .client
    .execute(
      "delete from attachments where id::text = $1",
      &[&attachment_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let document = fetch_issue_document(&state.client, &issue_id)
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("issue not found after attachment delete"))?;

  Ok(Json(document))
}

async fn api_attachment_content(
  State(state): State<Arc<AppState>>,
  RoutePath(attachment_id): RoutePath<String>,
) -> std::result::Result<impl IntoResponse, (StatusCode, String)> {
  let (mime_type, bytes) = fetch_attachment_original_bytes(&state, &attachment_id).await?;

  Ok(([(header::CONTENT_TYPE, mime_type)], bytes))
}

async fn api_attachment_thumbnail(
  State(state): State<Arc<AppState>>,
  RoutePath(attachment_id): RoutePath<String>,
) -> std::result::Result<impl IntoResponse, (StatusCode, String)> {
  let (mime_type, bytes) = ensure_attachment_thumbnail(&state, &attachment_id).await?;
  Ok(([(header::CONTENT_TYPE, mime_type)], bytes))
}

async fn api_issue_print_pdf(
  State(_state): State<Arc<AppState>>,
  RoutePath(issue_id): RoutePath<String>,
) -> impl IntoResponse {
  api_conflict(format!(
    "サーバ側の print-pdf は廃止しました。/issues/{issue_id}/edit または /issues/{issue_id}/print を開いて、ブラウザ側の `案内PDFを出力` を使ってください。"
  ))
}

async fn shutdown_signal() {
  let _ = tokio::signal::ctrl_c().await;
}

async fn run_web(args: WebArgs) -> Result<()> {
  let runtime_dir = default_runtime_dir();
  ensure_runtime_dirs(&runtime_dir)?;
  let client = Arc::new(connect_postgres(&args.database_url).await?);
  let applied_now = apply_migrations(&client, &manifest_db_dir()).await?;
  let applied_migrations = Arc::new(list_applied_migrations(&client).await?);
  let bind = args
    .bind
    .parse::<SocketAddr>()
    .with_context(|| format!("failed to parse bind address `{}`", args.bind))?;

  let loopback_base_url = format!("http://127.0.0.1:{}", bind.port());

  let state = Arc::new(AppState {
    client,
    runtime_dir: runtime_dir.clone(),
    database_url_redacted: redact_database_url(&args.database_url),
    applied_migrations,
    loopback_base_url,
    pdf_browser_cmd: google_chrome_command(),
    pdftoppm_cmd: pdftoppm_command(),
  });

  let app = Router::new()
    .route("/", get(index_page))
    .route("/issues", get(issues_index_page))
    .route("/issues/{id}/edit", get(issue_edit_page))
    .route("/issues/{id}/print", get(issue_print_page))
    .route("/template-documents", get(template_documents_index_page))
    .route(
      "/template-documents/{id}/edit",
      get(template_document_edit_page),
    )
    .route(
      "/template-documents/{id}/print",
      get(template_document_print_page),
    )
    .route("/assets/app.css", get(app_css))
    .route("/assets/app.js", get(app_js))
    .route("/assets/fonts/{file_name}", get(font_asset))
    .route("/assets/{*path}", get(frontend_asset))
    .route("/healthz", get(healthz))
    .route("/api/meta", get(api_meta))
    .route(
      "/api/preview-renders",
      axum::routing::post(api_preview_rasterize),
    )
    .route("/api/issues", get(api_issues).post(api_create_issue))
    .route(
      "/api/issues/{id}",
      get(api_issue_detail)
        .put(api_issue_save)
        .delete(api_issue_delete),
    )
    .route("/api/issues/{id}/duplicate", post(api_issue_duplicate))
    .route(
      "/api/template-documents",
      get(api_template_documents).post(api_create_template_document),
    )
    .route(
      "/api/template-documents/{id}",
      get(api_template_document_detail)
        .put(api_template_document_save)
        .delete(api_template_document_delete),
    )
    .route(
      "/api/template-documents/{id}/preview-images",
      get(api_template_document_preview_images),
    )
    .route(
      "/api/template-documents/{id}/print-pdf",
      get(api_template_document_print_pdf),
    )
    .route(
      "/api/blocks/{id}/attachments",
      axum::routing::post(api_block_attachment_upload),
    )
    .route(
      "/api/items/{id}/attachments",
      axum::routing::post(api_item_attachment_upload),
    )
    .route("/api/issues/{id}/print-pdf", get(api_issue_print_pdf))
    .route("/api/attachments/{id}", delete(api_attachment_delete))
    .route("/api/attachments/{id}/content", get(api_attachment_content))
    .route(
      "/api/attachments/{id}/thumbnail",
      get(api_attachment_thumbnail),
    )
    // Reference PDFs can exceed axum's default 2 MiB body limit.
    .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
    .with_state(state);

  let listener = TcpListener::bind(bind)
    .await
    .with_context(|| format!("failed to bind {bind}"))?;
  if !applied_now.is_empty() {
    info!(
      "applied {} database migrations on web startup",
      applied_now.len()
    );
  }
  info!(
    "paper versions layout={} font={} renderer={}",
    CURRENT_LAYOUT_VERSION, CURRENT_FONT_VERSION, CURRENT_RENDERER_VERSION
  );
  info!("runtime temp dir: {}", runtime_dir.display());
  info!("jokai web listening on http://{bind}");
  axum::serve(listener, app)
    .with_graceful_shutdown(shutdown_signal())
    .await?;
  Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
  color_eyre::install()?;
  if has_version_flag() {
    println!("{}", version_output()?);
    return Ok(());
  }

  let cli = Cli::parse();
  if cli.version {
    println!("{}", version_output()?);
    return Ok(());
  }

  init_tracing()?;

  match cli.command {
    Some(Commands::Web(args)) => run_web(args).await?,
    Some(Commands::Db(DbCli { command })) => match command {
      DbCommand::Init(args) => run_db_init(args).await?,
      DbCommand::Migrate(args) => run_db_migrate(args).await?,
      DbCommand::Status(args) => run_db_status(args).await?,
      DbCommand::Reset(args) => run_db_reset(args).await?,
    },
    None => {
      println!("{}", version_output()?);
      println!("subcommands: web | db init | db migrate | db status | db reset --yes");
    }
  }

  Ok(())
}

/* async fn  *********************************************************************************************/

/* test for pri ******************************************************************************************/

/* test for pub ******************************************************************************************/
