# Visual regression baselines

Run `npm run test:visual` to compare the core client and admin console screens
with the committed PNG baselines. To accept intentional rendering changes, run
`npm run test:visual -- --update`; it prints an added, changed, unchanged and
removed file list before writing the new images. Review the PNG changes in
`packages/web/test/visual-regression/` with that list.

Each kind of computer draws text its own way (anti-aliasing, hinting), so the
baselines are kept per platform, in `packages/web/test/visual-regression/darwin/`
and `.../linux/` (the name is `process.platform`). Make or update a platform's set
on a computer of that kind: the Mac runners run the check, so the `darwin` set is
made on a Mac, and a computer with no set of its own fails and says so. The
captures use the Arimo and Cousine fonts in `packages/scripts/fonts` instead of
whatever the computer has installed, so two Macs with different system fonts draw
the same page.

The seeded `Visual` solution is built in a temporary folder for each run. The
browser clock is fixed to 2027-01-01 UTC, and captures use Chromium at device
scale 1 with animations and caret rendering disabled. Client screens and the
admin dashboard are cropped to the 1280×900, 1024×768 or 390×844 viewport; the
Backups and Audit log images crop to those sections at the same viewport widths.
Each capture is made in light and dark themes.
The set covers sign-in, list, form, table, find, preview, Layout mode, Manage
Database, a confirmation dialog, the admin dashboard, backups and the audit
log.

Comparison allows a maximum per-channel RGBA difference of 8 and fails when
more than 1.5% of pixels differ. Failed runs write magenta pixel-diff PNGs and
the actual screenshot to a temporary `tabularius-visual-diffs-*` directory.
The budget is 500 KiB per image and 24 MiB for the full 72-image set; screenshots
stay PNG and viewport-cropped to keep review artifacts compact.
