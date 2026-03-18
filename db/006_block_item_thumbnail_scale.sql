alter table block_items
  add column if not exists thumb_scale_percent integer not null default 100;

update block_items
set thumb_scale_percent = 100
where thumb_scale_percent is null;

alter table block_items
  drop constraint if exists block_items_thumb_scale_percent_check;

alter table block_items
  add constraint block_items_thumb_scale_percent_check
  check (
    thumb_scale_percent between 80 and 200
    and ((thumb_scale_percent - 80) % 5 = 0)
  );
