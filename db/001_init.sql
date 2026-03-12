create extension if not exists pgcrypto;

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists issues (
  id uuid primary key default gen_random_uuid(),
  issue_type text not null check (issue_type in ('normal', 'correction', 'no_meeting', 'one_off')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  title text not null,
  issue_month date,
  meeting_date date,
  meeting_time time,
  place text not null default '',
  header_note text not null default '',
  correction_of_issue_id uuid references issues(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  sort_order integer not null,
  block_kind text not null check (block_kind in ('agenda', 'submission', 'distribution', 'info', 'freeform')),
  heading text not null default '',
  body text not null default '',
  audience_label text not null default '',
  due_date date,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(issue_id, sort_order)
);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  block_id uuid not null references blocks(id) on delete cascade,
  sort_order integer not null,
  original_filename text not null,
  mime_type text not null,
  original_path text not null,
  thumbnail_path text not null,
  page_count integer,
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  unique(block_id, sort_order)
);

create table if not exists generated_files (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  file_kind text not null check (file_kind in ('pdf')),
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_issues_issue_month on issues(issue_month desc);
create index if not exists idx_issues_status on issues(status);
create index if not exists idx_issues_correction_of_issue_id on issues(correction_of_issue_id);
create index if not exists idx_blocks_issue_id_sort_order on blocks(issue_id, sort_order);
create index if not exists idx_attachments_issue_id on attachments(issue_id);
create index if not exists idx_attachments_block_id_sort_order on attachments(block_id, sort_order);
create index if not exists idx_generated_files_issue_id on generated_files(issue_id);

drop trigger if exists issues_touch_updated_at on issues;
create trigger issues_touch_updated_at
before update on issues
for each row
execute function touch_updated_at();

drop trigger if exists blocks_touch_updated_at on blocks;
create trigger blocks_touch_updated_at
before update on blocks
for each row
execute function touch_updated_at();
