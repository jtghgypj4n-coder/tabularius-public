# Walkthrough recorder

The recorder makes a standalone SVG from a short JSON step list. Its command starts a temporary local Tabularius server with an empty synthesised `Sample` solution, fixes the browser clock at 2026-01-01 12:00 UTC and its random seed, then deletes the server folder. Never point the library API at a server with personal or employer data. Walkthroughs for a richer task should build synthetic records or use an owned starter solution before calling `recordWalkthrough`.

Run the sample with a local Chromium:

```sh
node scripts/walkthrough.ts scripts/walkthrough-sample.json ./walkthrough-output
```

Set `TABULARIUS_CHROMIUM` to a Chromium binary if discovery does not find it. Output includes `recording.json` (captions, step numbers, cropped target rectangles, frame filenames), a cropped WebP per step, and one SVG. The SVG has real text captions, a step counter, a highlight ring, a moving cursor, and keyboard-operable previous, next and pause controls. Reduced motion starts paused and removes cursor movement. The SVG budget is **2,000,000 bytes**; assembly fails if it would exceed that size. Frames use WebP quality 40. On the admin console, the recorder pauses periodic updates after the initial status loads, keeping unsaved field values stable between frames.

A definition has an `id` made of lowercase letters, digits and hyphens and an ordered `steps` array. Each step needs `action`, `target` and `caption`. Targets are `{ "selector": "#id" }` or `{ "role": "button", "name": "Exact accessible name" }`; supported roles are button, link, textbox, searchbox and heading. `go` also needs a local absolute `path`; `type` and `press` need a `value`. Supported press values are Enter, Tab and Escape. `click` and `press` capture the target before the action, so the next frame shows its result. A missing or ambiguous target fails with its step number. Navigation outside the local server is rejected.
