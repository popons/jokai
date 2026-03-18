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
use serde::{Deserialize, Serialize};
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
const DEFAULT_STORAGE_DIR: &str = "data";
const DEFAULT_MEETING_PLACE: &str = "平古場自治公民館";
const MIGRATION_TABLE: &str = "app_schema_migrations";
const FRONTEND_DIST_DIR: &str = "web-dist";
const FRONTEND_APP_CSS: &str = "app.css";
const FRONTEND_APP_JS: &str = "app.js";
const FRONTEND_FONT_BODY: &str = "body.ttf";
const FRONTEND_FONT_BODY_BOLD: &str = "body-bold.ttf";
const FRONTEND_FONT_TITLE: &str = "title.ttf";

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
  #[arg(
    long,
    env = "JOKAI_STORAGE_DIR",
    default_value = DEFAULT_STORAGE_DIR,
    value_hint = ValueHint::DirPath
  )]
  storage_dir: PathBuf,
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
  #[arg(
    long,
    env = "JOKAI_STORAGE_DIR",
    default_value = DEFAULT_STORAGE_DIR,
    value_hint = ValueHint::DirPath
  )]
  storage_dir: PathBuf,
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
  storage_dir: PathBuf,
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
  storage_dir: String,
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
  sort_order: i32,
  attachments: Vec<IssueDocumentAttachment>,
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

fn manifest_frontend_dist_dir() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join(FRONTEND_DIST_DIR)
}

fn frontend_asset_path(file_name: &str) -> PathBuf {
  manifest_frontend_dist_dir().join(file_name)
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

fn bundled_font_path(file_name: &str) -> Result<PathBuf> {
  let candidate = match file_name {
    FRONTEND_FONT_BODY => Some(PathBuf::from("/mnt/c/Windows/Fonts/YuGothic-Bold.ttf")),
    FRONTEND_FONT_BODY_BOLD => Some(PathBuf::from("/mnt/c/Windows/Fonts/YuGothic-Bold.ttf")),
    FRONTEND_FONT_TITLE => Some(PathBuf::from("/mnt/c/Windows/Fonts/yumin.ttf")),
    _ => None,
  }
  .ok_or_else(|| eyre!("unknown frontend font `{file_name}`"))?;

  if candidate.exists() {
    return Ok(candidate);
  }

  bail!("font asset `{file_name}` is unavailable on this host")
}

fn ensure_storage_dirs(storage_dir: &Path) -> Result<()> {
  fs::create_dir_all(storage_dir.join("issues"))
    .with_context(|| format!("failed to create {}", storage_dir.join("issues").display()))?;
  fs::create_dir_all(storage_dir.join("generated")).with_context(|| {
    format!(
      "failed to create {}",
      storage_dir.join("generated").display()
    )
  })?;
  fs::create_dir_all(preview_render_root(storage_dir)).with_context(|| {
    format!(
      "failed to create {}",
      preview_render_root(storage_dir).display()
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

fn normalize_month_value(raw: &str) -> String {
  let trimmed = raw.trim();
  if trimmed.len() == 7 {
    return format!("{trimmed}-01");
  }
  trimmed.to_string()
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

fn preview_render_root(storage_dir: &Path) -> PathBuf {
  storage_dir.join("preview-renders")
}

fn issue_storage_dir(storage_dir: &Path, issue_id: &str) -> PathBuf {
  storage_dir.join("issues").join(issue_id)
}

fn remove_issue_storage_artifacts(storage_dir: &Path, issue_id: &str) {
  let _ = fs::remove_dir_all(issue_storage_dir(storage_dir, issue_id));
  let _ = fs::remove_dir_all(issue_generated_dir(storage_dir, issue_id));
}

fn duplicate_attachment_relative_dir(
  issue_id: &str,
  block_id: &str,
  item_id: Option<&str>,
) -> PathBuf {
  PathBuf::from("issues")
    .join(issue_id)
    .join("attachments")
    .join(block_id)
    .join(
      item_id
        .filter(|value| !value.is_empty())
        .unwrap_or("legacy"),
    )
}

fn duplicate_attachment_relative_path(
  issue_id: &str,
  block_id: &str,
  item_id: Option<&str>,
  source_attachment_id: &str,
  source_relative_path: &str,
) -> PathBuf {
  let file_name = Path::new(source_relative_path)
    .file_name()
    .and_then(|value| value.to_str())
    .map(sanitize_filename)
    .unwrap_or_else(|| "attachment.bin".to_string());
  duplicate_attachment_relative_dir(issue_id, block_id, item_id)
    .join(format!("{source_attachment_id}-{file_name}"))
}

fn copy_storage_file(
  storage_dir: &Path,
  source_relative_path: &str,
  target_relative_path: &Path,
) -> std::result::Result<(), (StatusCode, String)> {
  let source_absolute = storage_dir.join(source_relative_path);
  if !source_absolute.exists() {
    return Err(api_internal(format!(
      "source file is missing while duplicating attachment: {source_relative_path}"
    )));
  }

  let target_absolute = storage_dir.join(target_relative_path);
  if let Some(parent) = target_absolute.parent() {
    fs::create_dir_all(parent).map_err(|err| {
      api_internal(format!(
        "failed to prepare attachment directory {}: {err}",
        parent.display()
      ))
    })?;
  }

  fs::copy(&source_absolute, &target_absolute).map_err(|err| {
    api_internal(format!(
      "failed to copy {} to {}: {err}",
      source_absolute.display(),
      target_absolute.display()
    ))
  })?;

  Ok(())
}

fn app_shell(view: &str, issue_id: Option<&str>, print_mode: bool) -> Html<String> {
  let issue_id_attr = issue_id.unwrap_or("");
  let page_title = match view {
    "edit" => "jokai editor",
    "print" => "jokai print",
    _ => "jokai composer",
  };
  let print_attr = if print_mode { "1" } else { "0" };
  let asset_version = BUILD_TIMESTAMP_UTC;

  Html(format!(
    "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{page_title}</title><link rel=\"stylesheet\" href=\"/assets/app.css?v={asset_version}\"></head><body data-print-mode=\"{print_attr}\"><div id=\"app\" data-view=\"{view}\" data-issue-id=\"{issue_id_attr}\" data-print-mode=\"{print_attr}\"></div><script type=\"module\" src=\"/assets/app.js?v={asset_version}\"></script></body></html>"
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
) -> std::result::Result<(String, String), (StatusCode, String)> {
  let row = state
    .client
    .query_opt(
      "select mime_type, original_path, thumbnail_path from attachments where id::text = $1",
      &[&attachment_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("attachment not found"))?;

  let mime_type = row.get::<_, String>(0);
  let original_path = row.get::<_, String>(1);
  let thumbnail_path = row.get::<_, String>(2);
  let display_kind = attachment_display_kind(&mime_type).to_string();

  if display_kind != "pdf" {
    return Ok((mime_type, original_path));
  }

  if !thumbnail_path.is_empty() && thumbnail_path != original_path {
    let absolute = state.storage_dir.join(&thumbnail_path);
    if absolute.exists() {
      return Ok(("image/png".to_string(), thumbnail_path));
    }
  }

  let Some(pdftoppm_cmd) = &state.pdftoppm_cmd else {
    return Err(api_internal(
      "pdftoppm is required to build PDF thumbnails but was not found",
    ));
  };

  let original_absolute = state.storage_dir.join(&original_path);
  let original_parent = Path::new(&original_path)
    .parent()
    .map(Path::to_path_buf)
    .unwrap_or_else(|| PathBuf::from("."));
  let relative_png = original_parent.join(format!("{}-thumb.png", attachment_id));
  let output_prefix = state
    .storage_dir
    .join(original_parent)
    .join(format!("{}-thumb", attachment_id));

  let status = ProcessCommand::new(pdftoppm_cmd)
    .arg("-png")
    .arg("-singlefile")
    .arg("-f")
    .arg("1")
    .arg("-scale-to")
    .arg("220")
    .arg(&original_absolute)
    .arg(&output_prefix)
    .status()
    .map_err(|err| api_internal(format!("failed to launch pdftoppm: {err}")))?;

  if !status.success() {
    return Err(api_internal("pdftoppm failed while generating thumbnail"));
  }

  let relative_png_text = relative_png.to_string_lossy().to_string();
  state
    .client
    .execute(
      "update attachments set thumbnail_path = $1 where id::text = $2",
      &[&relative_png_text, &attachment_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  Ok(("image/png".to_string(), relative_png_text))
}

#[allow(dead_code)]
fn issue_generated_dir(storage_dir: &Path, issue_id: &str) -> PathBuf {
  storage_dir.join("generated").join(issue_id)
}

#[allow(dead_code)]
fn render_issue_pdf_file(
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

  let output_dir = issue_generated_dir(&state.storage_dir, issue_id);
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
    move || render_issue_pdf_file(browser_cmd, print_url, browser_output_path_native)
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
    .strip_prefix(&state.storage_dir)
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
    let item = IssueDocumentItem {
      id: item_id.clone(),
      heading: row.get::<_, String>(2),
      body: row.get::<_, String>(3),
      audience_label: row.get::<_, String>(4),
      due_date: row.get::<_, Option<String>>(5),
      note: row.get::<_, String>(6),
      sort_order: row.get::<_, i32>(7),
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
            note: legacy_note,
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

async fn run_db_init(args: DbArgs) -> Result<()> {
  ensure_storage_dirs(&args.storage_dir)?;
  let database_name = ensure_database_exists(&args).await?;
  let client = connect_postgres(&args.database_url).await?;
  let applied_now = apply_migrations(&client, &manifest_db_dir()).await?;

  println!("database: {database_name}");
  println!("database_url: {}", redact_database_url(&args.database_url));
  println!("storage_dir: {}", args.storage_dir.display());
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

  println!("database_url: {}", redact_database_url(&args.database_url));
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
  println!("storage_dir: {}", args.storage_dir.display());
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
  app_shell("index", None, false)
}

async fn issue_edit_page(RoutePath(issue_id): RoutePath<String>) -> impl IntoResponse {
  app_shell("edit", Some(&issue_id), false)
}

async fn issue_print_page(RoutePath(issue_id): RoutePath<String>) -> impl IntoResponse {
  app_shell("print", Some(&issue_id), true)
}

async fn healthz() -> impl IntoResponse {
  "ok"
}

async fn app_css() -> std::result::Result<impl IntoResponse, (StatusCode, String)> {
  let bytes = fs::read(frontend_asset_path(FRONTEND_APP_CSS))
    .map_err(|err| api_internal(format!("failed to read web-dist/app.css: {err}")))?;
  Ok((
    [
      (header::CONTENT_TYPE, "text/css; charset=utf-8"),
      (header::CACHE_CONTROL, "no-store"),
    ],
    bytes,
  ))
}

async fn app_js() -> std::result::Result<impl IntoResponse, (StatusCode, String)> {
  let bytes = fs::read(frontend_asset_path(FRONTEND_APP_JS))
    .map_err(|err| api_internal(format!("failed to read web-dist/app.js: {err}")))?;
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
  let path = bundled_font_path(&file_name).map_err(|err| api_not_found(err.to_string()))?;
  let bytes = fs::read(&path)
    .map_err(|err| api_internal(format!("failed to read {}: {err}", path.display())))?;
  Ok(([(header::CONTENT_TYPE, "application/octet-stream")], bytes))
}

async fn frontend_asset(
  RoutePath(asset_path): RoutePath<String>,
) -> std::result::Result<impl IntoResponse, (StatusCode, String)> {
  let relative = PathBuf::from(&asset_path);
  let dist_dir = manifest_frontend_dist_dir();
  let mut full_path = dist_dir.join(&relative);
  if !full_path.exists() {
    full_path = dist_dir.join("assets").join(&relative);
  }
  if !full_path.starts_with(&dist_dir) {
    return Err(api_not_found("asset not found"));
  }
  let bytes = fs::read(&full_path)
    .map_err(|err| api_internal(format!("failed to read {}: {err}", full_path.display())))?;
  Ok((
    [
      (header::CONTENT_TYPE, asset_content_type(&full_path)),
      (header::CACHE_CONTROL, "no-store"),
    ],
    bytes,
  ))
}

async fn api_preview_rasterize(
  State(state): State<Arc<AppState>>,
  mut multipart: Multipart,
) -> ApiResult<PreviewRenderResponse> {
  let Some(pdftoppm_cmd) = &state.pdftoppm_cmd else {
    return Err(api_internal(
      "pdftoppm is required for notice preview rendering but was not found",
    ));
  };

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

  let job_dir = preview_render_root(&state.storage_dir).join(unique_upload_stem());
  fs::create_dir_all(&job_dir).map_err(|err| api_internal(err.to_string()))?;
  let input_pdf = job_dir.join("preview.pdf");
  let output_prefix = job_dir.join("page");
  fs::write(&input_pdf, pdf_bytes.as_ref()).map_err(|err| api_internal(err.to_string()))?;

  let command = pdftoppm_cmd.clone();
  let input_pdf_for_task = input_pdf.clone();
  let output_prefix_for_task = output_prefix.clone();
  tokio::task::spawn_blocking(move || {
    ProcessCommand::new(command)
      .arg("-png")
      .arg("-r")
      .arg("144")
      .arg(&input_pdf_for_task)
      .arg(&output_prefix_for_task)
      .status()
  })
  .await
  .map_err(|err| api_internal(format!("failed to join preview rasterizer: {err}")))?
  .map_err(|err| api_internal(format!("failed to launch pdftoppm: {err}")))
  .and_then(|status| {
    if status.success() {
      Ok(())
    } else {
      Err(api_internal(
        "pdftoppm failed while generating preview images",
      ))
    }
  })?;

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

  Ok(Json(PreviewRenderResponse { images }))
}

async fn api_meta(State(state): State<Arc<AppState>>) -> impl IntoResponse {
  Json(MetaResponse {
    app: "jokai",
    database_url: state.database_url_redacted.clone(),
    storage_dir: state.storage_dir.display().to_string(),
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
           footer_note = $8
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
      let item_note = item.note.trim().to_string();
      let maybe_item_id = item
        .id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());

      if let Some(item_id) = maybe_item_id {
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
                   note = $6
               where id::text = $7 and block_id::text = $8",
              &[
                &item_sort_order,
                &item_heading,
                &item_body,
                &item_audience_label,
                &item_due_date,
                &item_note,
                &item_id,
                &resolved_block_id,
              ],
            )
            .await
            .map_err(|err| api_internal(err.to_string()))?;
          retained_item_ids.insert(item_id.to_string());
          continue;
        }
      }

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
             note
           )
           values (
             (select id from blocks where id::text = $1),
             $2,
             $3,
             $4,
             $5,
             nullif($6, '')::date,
             $7
           )
           returning id::text",
          &[
            &resolved_block_id,
            &item_sort_order,
            &item_heading,
            &item_body,
            &item_audience_label,
            &item_due_date,
            &item_note,
          ],
        )
        .await
        .map_err(|err| api_internal(err.to_string()))?;
      retained_item_ids.insert(inserted_item.get::<_, String>(0));
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
         original_path,
         thumbnail_path,
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
           note
         )
         values (
           (select id from blocks where id::text = $1),
           $2,
           $3,
           $4,
           $5,
           nullif($6, '')::date,
           $7
         )
         returning id::text",
        &[
          &duplicated_block_id,
          &row.get::<_, i32>(7),
          &row.get::<_, String>(2),
          &row.get::<_, String>(3),
          &row.get::<_, String>(4),
          &row.get::<_, Option<String>>(5).unwrap_or_default(),
          &row.get::<_, String>(6),
        ],
      )
      .await
      .map_err(|err| api_internal(err.to_string()))?;
    duplicated_item_ids.insert(source_item_id, duplicated_item_row.get::<_, String>(0));
  }

  for row in attachment_rows {
    let source_attachment_id = row.get::<_, String>(0);
    let source_block_id = row.get::<_, String>(1);
    let source_item_id = row.get::<_, Option<String>>(2);
    let sort_order = row.get::<_, i32>(3);
    let original_filename = row.get::<_, String>(4);
    let mime_type = row.get::<_, String>(5);
    let original_path = row.get::<_, String>(6);
    let thumbnail_path = row.get::<_, String>(7);
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

    let duplicated_original_relative = duplicate_attachment_relative_path(
      duplicated_issue_id,
      &duplicated_block_id,
      duplicated_item_id.as_deref(),
      &source_attachment_id,
      &original_path,
    );
    copy_storage_file(
      &state.storage_dir,
      &original_path,
      &duplicated_original_relative,
    )?;

    let source_thumbnail_absolute = state.storage_dir.join(&thumbnail_path);
    let duplicated_thumbnail_relative = if thumbnail_path.is_empty()
      || thumbnail_path == original_path
      || !source_thumbnail_absolute.exists()
    {
      duplicated_original_relative.clone()
    } else {
      let duplicated_thumbnail_relative = duplicate_attachment_relative_path(
        duplicated_issue_id,
        &duplicated_block_id,
        duplicated_item_id.as_deref(),
        &format!("{source_attachment_id}-thumb"),
        &thumbnail_path,
      );
      copy_storage_file(
        &state.storage_dir,
        &thumbnail_path,
        &duplicated_thumbnail_relative,
      )?;
      duplicated_thumbnail_relative
    };

    let duplicated_original_text = duplicated_original_relative.to_string_lossy().to_string();
    let duplicated_thumbnail_text = duplicated_thumbnail_relative.to_string_lossy().to_string();

    state
      .client
      .execute(
        "insert into attachments (
           issue_id,
           block_id,
           item_id,
           sort_order,
           original_filename,
           mime_type,
           original_path,
           thumbnail_path,
           page_count,
           width,
           height
         )
         values (
           (select id from issues where id::text = $1),
           (select id from blocks where id::text = $2),
           (select id from block_items where id::text = $3),
           $4,
           $5,
           $6,
           $7,
           $8,
           $9,
           $10,
           $11
         )",
        &[
          &duplicated_issue_id,
          &duplicated_block_id,
          &duplicated_item_id,
          &sort_order,
          &original_filename,
          &mime_type,
          &duplicated_original_text,
          &duplicated_thumbnail_text,
          &page_count,
          &width,
          &height,
        ],
      )
      .await
      .map_err(|err| api_internal(err.to_string()))?;
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

  remove_issue_storage_artifacts(&state.storage_dir, &issue_id);

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
    remove_issue_storage_artifacts(&state.storage_dir, &duplicated_issue_id);
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

    let relative_dir = PathBuf::from("issues")
      .join(&issue_id)
      .join("attachments")
      .join(&block_id)
      .join(&item_id);
    let absolute_dir = state.storage_dir.join(&relative_dir);
    fs::create_dir_all(&absolute_dir).map_err(|err| api_internal(err.to_string()))?;

    let relative_path = relative_dir.join(format!("{}-{}", unique_upload_stem(), filename));
    let absolute_path = state.storage_dir.join(&relative_path);
    fs::write(&absolute_path, bytes.as_ref()).map_err(|err| api_internal(err.to_string()))?;

    let sort_row = state
      .client
      .query_one(
        "select coalesce(max(sort_order), 0) + 1 from attachments where item_id::text = $1",
        &[&item_id],
      )
      .await
      .map_err(|err| api_internal(err.to_string()))?;
    let sort_order = sort_row.get::<_, i32>(0);
    let relative_path_text = relative_path.to_string_lossy().to_string();

    state
      .client
      .execute(
        "insert into attachments (
           issue_id,
           block_id,
           item_id,
           sort_order,
           original_filename,
           mime_type,
           original_path,
           thumbnail_path
         )
         values (
           (select id from issues where id::text = $1),
           (select id from blocks where id::text = $2),
           (select id from block_items where id::text = $3),
           $4,
           $5,
           $6,
           $7,
           $7
         )",
        &[
          &issue_id,
          &block_id,
          &item_id,
          &sort_order,
          &filename,
          &mime_type,
          &relative_path_text,
        ],
      )
      .await
      .map_err(|err| api_internal(err.to_string()))?;
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

    let relative_dir = PathBuf::from("issues")
      .join(&issue_id)
      .join("attachments")
      .join(&block_id)
      .join(&item_id);
    let absolute_dir = state.storage_dir.join(&relative_dir);
    fs::create_dir_all(&absolute_dir).map_err(|err| api_internal(err.to_string()))?;

    let relative_path = relative_dir.join(format!("{}-{}", unique_upload_stem(), filename));
    let absolute_path = state.storage_dir.join(&relative_path);
    fs::write(&absolute_path, bytes.as_ref()).map_err(|err| api_internal(err.to_string()))?;

    let sort_row = state
      .client
      .query_one(
        "select coalesce(max(sort_order), 0) + 1 from attachments where item_id::text = $1",
        &[&item_id],
      )
      .await
      .map_err(|err| api_internal(err.to_string()))?;
    let sort_order = sort_row.get::<_, i32>(0);
    let relative_path_text = relative_path.to_string_lossy().to_string();

    state
      .client
      .execute(
        "insert into attachments (
           issue_id,
           block_id,
           item_id,
           sort_order,
           original_filename,
           mime_type,
           original_path,
           thumbnail_path
         )
         values (
           (select id from issues where id::text = $1),
           (select id from blocks where id::text = $2),
           (select id from block_items where id::text = $3),
           $4,
           $5,
           $6,
           $7,
           $7
         )",
        &[
          &issue_id,
          &block_id,
          &item_id,
          &sort_order,
          &filename,
          &mime_type,
          &relative_path_text,
        ],
      )
      .await
      .map_err(|err| api_internal(err.to_string()))?;
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
      "select issue_id::text, original_path, thumbnail_path from attachments where id::text = $1",
      &[&attachment_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("attachment not found"))?;

  let issue_id = attachment_row.get::<_, String>(0);
  let original_path = attachment_row.get::<_, String>(1);
  let thumbnail_path = attachment_row.get::<_, String>(2);

  state
    .client
    .execute(
      "delete from attachments where id::text = $1",
      &[&attachment_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?;

  let original_abs = state.storage_dir.join(&original_path);
  let thumbnail_abs = state.storage_dir.join(&thumbnail_path);
  let _ = fs::remove_file(original_abs);
  if thumbnail_path != original_path {
    let _ = fs::remove_file(thumbnail_abs);
  }

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
  let attachment_row = state
    .client
    .query_opt(
      "select mime_type, original_path from attachments where id::text = $1",
      &[&attachment_id],
    )
    .await
    .map_err(|err| api_internal(err.to_string()))?
    .ok_or_else(|| api_not_found("attachment not found"))?;

  let mime_type = attachment_row.get::<_, String>(0);
  let original_path = attachment_row.get::<_, String>(1);
  let absolute_path = state.storage_dir.join(&original_path);
  let bytes = fs::read(&absolute_path).map_err(|err| api_internal(err.to_string()))?;

  Ok(([(header::CONTENT_TYPE, mime_type)], bytes))
}

async fn api_attachment_thumbnail(
  State(state): State<Arc<AppState>>,
  RoutePath(attachment_id): RoutePath<String>,
) -> std::result::Result<impl IntoResponse, (StatusCode, String)> {
  let (mime_type, relative_path) = ensure_attachment_thumbnail(&state, &attachment_id).await?;
  let absolute_path = state.storage_dir.join(relative_path);
  let bytes = fs::read(&absolute_path).map_err(|err| api_internal(err.to_string()))?;
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
  ensure_storage_dirs(&args.storage_dir)?;
  let client = Arc::new(connect_postgres(&args.database_url).await?);
  let applied_migrations = Arc::new(list_applied_migrations(&client).await?);
  let bind = args
    .bind
    .parse::<SocketAddr>()
    .with_context(|| format!("failed to parse bind address `{}`", args.bind))?;

  let loopback_base_url = format!("http://127.0.0.1:{}", bind.port());

  let state = Arc::new(AppState {
    client,
    storage_dir: args.storage_dir.clone(),
    database_url_redacted: redact_database_url(&args.database_url),
    applied_migrations,
    loopback_base_url,
    pdf_browser_cmd: google_chrome_command(),
    pdftoppm_cmd: pdftoppm_command(),
  });

  let app = Router::new()
    .route("/", get(index_page))
    .route("/issues", get(index_page))
    .route("/issues/{id}/edit", get(issue_edit_page))
    .route("/issues/{id}/print", get(issue_print_page))
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
