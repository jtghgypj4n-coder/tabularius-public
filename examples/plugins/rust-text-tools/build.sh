#!/bin/sh
# Builds main.wasm from src/lib.rs. Needs Rust with the WebAssembly target:
#   rustup target add wasm32-unknown-unknown
set -e
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/rust_text_tools.wasm main.wasm
ls -l main.wasm
