alter table block_items
  add column if not exists meta_layout text not null default 'stacked';

update block_items
set meta_layout = 'stacked'
where meta_layout not in ('same_line', 'stacked');

alter table block_items
  drop constraint if exists block_items_meta_layout_check;

alter table block_items
  add constraint block_items_meta_layout_check
  check (meta_layout in ('same_line', 'stacked'));
