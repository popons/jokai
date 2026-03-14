alter table issues
  add column if not exists footer_note text not null default '';
