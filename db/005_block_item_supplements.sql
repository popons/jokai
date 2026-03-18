create table if not exists block_item_supplements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references block_items(id) on delete cascade,
  sort_order integer not null,
  tone text not null default 'red',
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(item_id, sort_order)
);

alter table block_item_supplements
  drop constraint if exists block_item_supplements_tone_check;

alter table block_item_supplements
  add constraint block_item_supplements_tone_check
  check (tone in ('red', 'blue'));

drop trigger if exists block_item_supplements_touch_updated_at on block_item_supplements;
create trigger block_item_supplements_touch_updated_at
before update on block_item_supplements
for each row
execute function touch_updated_at();

create index if not exists idx_block_item_supplements_item_id_sort_order
on block_item_supplements(item_id, sort_order);

insert into block_item_supplements (
  item_id,
  sort_order,
  tone,
  content
)
select
  bi.id,
  1,
  'red',
  bi.note
from block_items bi
where bi.note <> ''
  and not exists (
    select 1
    from block_item_supplements bis
    where bis.item_id = bi.id
  );
