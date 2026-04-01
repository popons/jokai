alter table issue_thumbnail_caches
add column if not exists render_version text not null default '';
