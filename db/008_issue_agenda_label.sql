alter table issues
  add column if not exists agenda_label text not null default '常会事項';
