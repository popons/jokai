create table if not exists issue_thumbnail_caches (
  issue_id uuid primary key references issues(id) on delete cascade,
  source_version bigint not null,
  mime_type text not null,
  content bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists issue_thumbnail_caches_touch_updated_at on issue_thumbnail_caches;
create trigger issue_thumbnail_caches_touch_updated_at
before update on issue_thumbnail_caches
for each row
execute function touch_updated_at();
