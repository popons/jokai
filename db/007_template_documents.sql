create table if not exists template_documents (
  id uuid primary key default gen_random_uuid(),
  document_family text not null check (document_family in ('shogai_kyosai')),
  template_key text not null check (template_key in ('join_renewal')),
  status text not null default 'draft' check (status in ('draft')),
  title text not null,
  template_asset_path text not null,
  template_version text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_template_documents_family_updated_at
on template_documents(document_family, updated_at desc);

create index if not exists idx_template_documents_template_key
on template_documents(template_key);

drop trigger if exists template_documents_touch_updated_at on template_documents;
create trigger template_documents_touch_updated_at
before update on template_documents
for each row
execute function touch_updated_at();
