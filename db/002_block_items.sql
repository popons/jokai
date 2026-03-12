create table if not exists block_items (
  id uuid primary key default gen_random_uuid(),
  block_id uuid not null references blocks(id) on delete cascade,
  sort_order integer not null,
  heading text not null default '',
  body text not null default '',
  audience_label text not null default '',
  due_date date,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(block_id, sort_order)
);

drop trigger if exists block_items_touch_updated_at on block_items;
create trigger block_items_touch_updated_at
before update on block_items
for each row
execute function touch_updated_at();

alter table attachments
  add column if not exists item_id uuid references block_items(id) on delete cascade;

alter table attachments
  drop constraint if exists attachments_block_id_sort_order_key;

drop index if exists idx_attachments_block_id_sort_order;

create unique index if not exists idx_attachments_block_sort_legacy
on attachments(block_id, sort_order)
where item_id is null;

create unique index if not exists idx_attachments_item_sort
on attachments(item_id, sort_order)
where item_id is not null;

create index if not exists idx_block_items_block_id_sort_order
on block_items(block_id, sort_order);

create index if not exists idx_attachments_item_id
on attachments(item_id);

insert into block_items (
  block_id,
  sort_order,
  heading,
  body,
  audience_label,
  due_date,
  note
)
select
  b.id,
  1,
  '',
  b.body,
  b.audience_label,
  b.due_date,
  b.note
from blocks b
where not exists (
  select 1
  from block_items bi
  where bi.block_id = b.id
)
and (
  b.body <> ''
  or b.audience_label <> ''
  or b.due_date is not null
  or b.note <> ''
);

update attachments a
set item_id = bi.id
from block_items bi
where a.block_id = bi.block_id
  and bi.sort_order = 1
  and a.item_id is null;
