# Rust text tools (example plug-in)

A complete Tabularius plug-in written in Rust and compiled to WebAssembly. It adds three functions to calculations:
`Ex_Slug ( text )`, `Ex_WordCount ( text )` and `Ex_Add ( a ; b )`. [Writing your own plug-in](../../../docs/writing-a-plugin.md)
explains the contract; `src/lib.rs` is commented to be copied.

## Using it without Rust

`main.wasm` is built and kept here. Copy `plugin.json` and `main.wasm` to `<data folder>/plugins/rust-text-tools/` and turn it on
with `tabularius plugins <data folder> enable <database> org.tabularius.example.rust-text-tools`.

## Building it

You need a Rust toolchain (<https://rustup.rs>, any recent stable release) with the WebAssembly target. Nothing else: the crate has no dependencies,
so the build needs no network after the toolchain is installed.

```sh
rustup target add wasm32-unknown-unknown
examples/plugins/rust-text-tools/build.sh      # writes main.wasm beside plugin.json
```

`build.sh` runs `cargo build --release --target wasm32-unknown-unknown` and copies the result over `main.wasm`. A test builds it in a scratch
copy and compares its answers with the kept `main.wasm`; it is skipped, with the reason printed, on a computer without the toolchain or the target.
