# JOKAI DB Setup (PostgreSQL)

## Environment
`DATABASE_URL=postgresql://postgres:postgres@10.0.0.100:5432/jokai`

`DATABASE_ADMIN_URL=postgresql://postgres:postgres@10.0.0.100:5432/postgres`

`JOKAI_STORAGE_DIR=./data`

## Primary commands
`./db-init.sh`

`./db-migrate.sh`

`./db-status.sh`

`./db-reset.sh`

`./run-web.sh`

`./watch-run-server.sh`

## Direct schema apply
`DATABASE_URL=postgresql://postgres:postgres@10.0.0.100:5432/jokai ./db/apply.sh`

## Notes
- `db init` creates the database if it does not already exist, then applies every `db/*.sql` migration in filename order.
- `db migrate` only applies pending SQL files.
- `db reset` is destructive and requires `--yes`.
- `watch-run-server.sh` follows the `jab` pattern and watches `src`, `db`, `build.rs`, and `Cargo.toml`.
