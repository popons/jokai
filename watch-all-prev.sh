#!/bin/zsh

export CARGO_TERM_COLOR=always
export WSLENV=$WSLENV:RUSTFLAGS/w

# Check if running on WSL1 (kernel contains Microsoft/WSL but not WSL2)
KERNEL=$(uname -r)
if echo "$KERNEL" | grep -qE '(Microsoft|WSL)' && echo "$KERNEL" | grep -qv 'WSL2'; then
    POLL_FLAG="--poll"
else
    POLL_FLAG=""
fi

cargo watch -w src -w Cargo.toml $POLL_FLAG --use-shell=zsh -s 'set -o pipefail; \
    RUSTFLAGS=-Awarnings cargo check --workspace --color=always 2>&1 | tee >(descseq > build-error.txt) && \
    RUSTFLAGS=-Awarnings cargo test --workspace -- --color always 2>&1 | tee >(descseq > test-error.txt) && \
    RUSTFLAGS=-Awarnings cargo clippy --workspace --color=always 2>&1 | tee >(descseq > clippy-error.txt)'

