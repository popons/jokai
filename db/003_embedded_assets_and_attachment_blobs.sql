alter table attachments
  rename column original_path to legacy_original_path;

alter table attachments
  rename column thumbnail_path to legacy_thumbnail_path;

alter table attachments
  alter column legacy_original_path set default '';

alter table attachments
  alter column legacy_thumbnail_path set default '';

alter table issues
  add column if not exists source_version bigint not null default 1;

alter table issues
  add column if not exists published_source_version bigint;

alter table issues
  add column if not exists published_layout_version text;

alter table issues
  add column if not exists published_font_version text;

alter table issues
  add column if not exists published_renderer_version text;

create table if not exists attachment_original_contents (
  attachment_id uuid primary key references attachments(id) on delete cascade,
  content bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists attachment_thumbnail_caches (
  attachment_id uuid primary key references attachments(id) on delete cascade,
  mime_type text not null,
  content bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function issue_set_publication_versions()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and old.status <> 'published' then
    new.published_at = coalesce(new.published_at, now());
    new.published_source_version = coalesce(new.published_source_version, new.source_version);
    new.published_layout_version = coalesce(nullif(new.published_layout_version, ''), 'notice-pdf-layout-v2');
    new.published_font_version = coalesce(nullif(new.published_font_version, ''), 'noto-sans-jp-v1');
    new.published_renderer_version = coalesce(nullif(new.published_renderer_version, ''), 'pdfme-raster-v2');
  elsif new.status = 'published' and old.status = 'published' then
    new.published_source_version = old.published_source_version;
    new.published_layout_version = old.published_layout_version;
    new.published_font_version = old.published_font_version;
    new.published_renderer_version = old.published_renderer_version;
  end if;
  return new;
end;
$$;

drop trigger if exists issues_set_publication_versions on issues;
create trigger issues_set_publication_versions
before update on issues
for each row
execute function issue_set_publication_versions();

drop trigger if exists attachment_original_contents_touch_updated_at on attachment_original_contents;
create trigger attachment_original_contents_touch_updated_at
before update on attachment_original_contents
for each row
execute function touch_updated_at();

drop trigger if exists attachment_thumbnail_caches_touch_updated_at on attachment_thumbnail_caches;
create trigger attachment_thumbnail_caches_touch_updated_at
before update on attachment_thumbnail_caches
for each row
execute function touch_updated_at();
