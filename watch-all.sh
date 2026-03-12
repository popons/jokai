#!/usr/bin/zsh

RUSTFLAG=-Awarnings bacon check  --headless &
RUSTFLAG=-Awarnings bacon test   --headless &
RUSTFLAG=-Awarnings bacon clippy --headless &

wait
