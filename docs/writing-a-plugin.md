# Writing your own plug-in

A Tabularius plug-in adds functions to FileMaker calculations, like a FileMaker plug-in does, without anything to
install on a computer: it is a folder with a `plugin.json` and one code file, and it runs inside the server's
sandbox. Write it in JavaScript, or in anything that compiles to WebAssembly (Rust, C, Zig, Go).

This page is the short way in. [Moving a solution](moving-a-solution.md#adding-plug-ins-early) has the full list of
what a plug-in may ask the server for (files, web requests, mail, secrets) and how an admin turns one on.

## What you make

```
my-plugin/
  plugin.json     who it is, the functions it adds, what it asks to be allowed
  main.js         or main.wasm
```

`plugin.json`:

<!-- plugin-file: plugin.json -->
```json
{
  "id": "org.example.my-plugin",
  "name": "My plug-in",
  "version": "1.0.0",
  "api": "^1.0",
  "publisher": "Example Ltd",
  "runtime": "js",
  "main": "main.js",
  "functions": [
    { "name": "My_Greet", "min": 1, "max": 1, "pure": true }
  ]
}
```

- `api` is the plug-in API range you were written for. This Tabularius offers API 1.0, so `^1.0`, `~1.0`, `>=1.0`,
  `1.x` and `1.0` all fit; a plug-in that asks for another major (`^2.0`) or a newer minor (`^1.1`) is refused with a
  message saying so, and one whose `api` isn't a range at all (`latest`) is refused the same way.
- `id` is reverse-DNS and unique. `version` is `1.2.3`. `runtime` is `js` (the default) or `wasm`.
- Each function has a FileMaker name (case doesn't matter), the fewest and most arguments it takes, and `pure: true`
  when the same arguments always give the same answer and it asks the server for nothing (such a function may be
  used in stored calculations and cached summaries or aggregates). The host refuses all host calls from functions
  declared pure. Any files, network, mail or secrets permission makes every function in that plug-in volatile,
  even one declared pure. Built-in compatibility functions default to volatile; only explicitly audited pure
  BaseElements functions may be cached. MBS calls are volatile because they also update session error state.
- `permissions` is where it asks for more: `files`, `network` hosts, `mail`, `secrets`, a `timeoutMs` (250 by default)
  and `memoryMb` (64 by default). The host uses `min(memoryMb, 64)` MB for the V8 old-space heap, including runtime overhead,
  and WebAssembly linear memory. Accepted requests range from 8 to 1024 MB, but cannot raise this host's 64 MB ceiling.
  The JavaScript budget is not all available for plug-in data: at 8 MB, retaining about 4 MiB can already fail.
  The sandbox also checks total resident memory (RSS) and ArrayBuffer backing storage before and after every call
  and on a 50 ms timer, stopping when either exceeds the granted budget plus 64 MiB of fixed runtime headroom.
  Because synchronous plug-in code blocks the child's timer, the parent worker additionally samples child RSS
  every 50 ms while a call runs (Linux `/proc`, macOS/Unix `ps`, Windows `tasklist`, when available).
  A violation fails the call with the memory error and puts that function on a 30-second cooldown. These are
  sampled checks, not an OS memory quota: transient allocations can overshoot, and untouched ArrayBuffers are
  checked when the call returns even if they have not become resident. Each plug-in code identity and budget has
  a separate process; another plug-in's retained memory cannot consume its budget. Active sandboxes, including
  the custom-function sandbox, are reused without a fixed slot count. A sandbox idle for at least 60 seconds is
  reclaimed, so idle expiry, timeout or a crash can discard retained state. These budgets and the idle pool apply
  separately to each server process (including each cluster worker), not to the host as a whole; there is no
  aggregate host memory cap, and total memory grows with the number of active keys and server processes.
  An admin can see the requested permissions before turning a plug-in on.
- In-process integrations should supply a stable `PluginCall.cacheKey` covering code and captured configuration to
  share cached results across installations. Without it, installations get distinct keys: function source and the
  manifest cannot identify closure values, bound arguments or native implementations safely.
- To stand in for a function of a FileMaker plug-in a solution already calls, also give it `owner` (the plug-in's
  four-character id) and `index`. Calls decoded from the .fmp12 file then run your function.

## In JavaScript

`main.js` defines `functions`. Each gets the call's arguments (text and numbers; dates as ISO text) and returns the answer:

<!-- plugin-file: main.js -->
```js
const functions = {
  My_Greet(name) {
    return 'Hello, ' + name + '!';
  },
};
```

Returning nothing gives an empty result; throwing, running past the time limit, using more memory than `memoryMb`
allows, or returning more than the memory budget can hold makes the FileMaker function give `?` (the calculation
error is 1200, and its message names the plug-in, the function and the reason, such as `org.example.my-plugin/My_Greet took longer than 250 ms`).
The server keeps answering, other plug-ins are not affected, and the function that failed is left alone for 30 seconds
before it is called again. There is no `require`, no `process` and no `fetch`: files, web requests, mail and secrets come through
`tabularius.files`, `tabularius.http`, `tabularius.mail` and `tabularius.secrets`, and only as far as `permissions` allows.

## In WebAssembly

A WebAssembly plug-in computes and nothing else: the module imports nothing, so it cannot read files or reach the
network. In return it can be written in any language and is fast. The contract is three things:

1. The module exports `memory`, and a function `alloc ( length )` that returns the address of `length` bytes.
   Tabularius calls it at the start of every call, so it is also the place to forget the last call's memory.
2. It exports one function for each FileMaker function, named as in `plugin.json`: `Name ( address, length )`.
   At `address` are the arguments as a JSON array, like `["Hello, World!"]` or `[2,3.5]`.
3. That function returns the address and length of its answer packed in one 64-bit number, `address * 2^32 + length`.
   The answer is JSON: `"text"`, `42`, `true`, `null` or an object. Returning 0 is an error (`?`).

[`examples/plugins/rust-text-tools`](../examples/plugins/rust-text-tools) is a complete, commented Rust example
with three functions (`Ex_Slug`, `Ex_WordCount`, `Ex_Add`) and no dependencies. Copy it and change the three
functions at the end of `src/lib.rs`. To build it:

```sh
rustup target add wasm32-unknown-unknown
examples/plugins/rust-text-tools/build.sh      # writes main.wasm
```

The built `main.wasm` is kept in the repository so the plug-in can be tried without Rust.

## Trying it

Copy the folder (just `plugin.json` and the code file) into the server's data folder as `plugins/my-plugin/`, then:

<!-- docs-example: illustrative -->
```sh
tabularius plugins <data folder> list
tabularius plugins <data folder> enable <database> org.example.my-plugin
```

Restart the server (it reads the plug-ins folder when it starts) and use the function in a calculation:
`My_Greet ( "Ann" )`. A plug-in is on for a database only after an admin enables it; the console's Plug-ins page does
the same as the commands. Tests of your own can load a plug-in folder with `readPlugin` and a `PluginRegistry`, as
`packages/plugins/test/example-wasm.test.ts` does.

## Sharing it

`tabularius plugins <data folder> keygen key.pem` makes a signing key and `pack my-plugin --key key.pem` makes a
`.ohplugin` file other people install with `plugins <data folder> install`. They are shown the publisher's
fingerprint and must trust it first. See [Plug-in packages and signing](moving-a-solution.md#plug-in-packages-and-signing).
A package is installed whole or not at all: it is unpacked beside the plug-ins and swapped in, the old version is put
back if the swap fails, and the publisher is trusted only once the install has finished, so an install that stops
(a package signed by someone other than the publisher of the plug-in already there needs `--replace`, say) trusts nobody. A newer package from the same
publisher replaces the old version without it; `--replace` is for another publisher's package, or a folder that was copied into `plugins/` by hand. `pack` takes a folder of files only, so pack a folder with `plugin.json` and the code file, not the Rust project.
