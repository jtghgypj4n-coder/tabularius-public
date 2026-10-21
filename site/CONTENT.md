# Tabularius website: content draft

Status: draft for review. Look and motion wait on reference sites; the images are
placeholders and new ones are needed.
Audience: every developer and every solution that uses .fmp12 files, not one
company's files. Facts below come from the repo README and docs; nothing
promises dates or prices.

## Page structure

1. Hero (looping animation)
2. "Bring your file" (conversion)
3. "It looks like your layouts" (web client)
4. "Your scripts run" (scripts, debugger, time travel)
5. "AI that knows your solution" (MCP + assistant)
6. "Built for teams" (hosting, accounts, security)
7. "Never locked in" (Data API compatibility, data export)
8. Trial sign-up
9. Footer

## 1. Hero

Headline options:
- **Opens and hosts .fmp12 files. Built for AI.**
- **Your .fmp12 solution. Open, hosted, AI-native.**
- **Drop in a .fmp12. Get a modern app.**

Sub-line: Tabularius opens your existing .fmp12 files, hosts them, runs
their layouts, scripts and calculations, and gives AI a safe way in.
Open source.

Primary button: **Join the trial**. Secondary: **See what it does** (scrolls).

Hero animation idea (seamless loop, about 10 s): a .fmp12 file drops in;
its tables, relationships and layouts unfold out of it; a layout renders as
a live web window; a question is typed to the assistant and a found set
lights up; everything folds back into the file icon, which is frame 1.

## 2. Bring your file

**Drop in a .fmp12 and it is hosted.** A conversion report lists what won't work yet.
Tabularius reads tables, fields, relationships, layouts, scripts, value
lists, custom functions, accounts, privilege sets, records and container
files straight from an unencrypted .fmp12. A plain-English conversion guide
lists what works, what works differently, and the built-in replacement for
each.

Animation: file icon splits into labelled layers (Tables, Layouts, Scripts,
Calcs, Accounts) that slot into a server.

## 3. It looks like your layouts

**Your layouts, in any browser.**
Theme styles, portals, tab and slide controls, popovers, button bars,
conditional formatting, hide conditions, value lists, form, list and table
view, sub-summaries. Browse, Find, Layout mode. Phones and tablets too.

Animation: wireframe of a layout fills in with styles, a portal scrolls,
a tab control switches.

## 4. Your scripts run

**Server-side scripts, a real debugger, and time travel.**
Scripts run by name, from buttons, triggers, the Data API and MCP.
The debugger steps through on a scratch copy so nothing real changes.
Record run steps backwards and forwards through a whole script.
Tests live with the file. A linter catches loops that can't end.
Some BaseElements and MBS functions run as built-in code; other plug-in calls are listed in the conversion report.

Animation: script lines highlight in sequence; a scrubber rewinds them.

## 5. AI that knows your solution

**Built-in MCP server. An assistant that respects privileges.**
Any MCP client (Claude, and others) can explore schema, find and edit
records, explain a calculation's value, say why a portal is empty, check
what a rename would break, document the whole solution, and draft
scripts and formulas, all as the signed-in account. In the app: Find with
AI, charts and dashboards from a sentence, data clean-up you approve, "Why
did this script fail?", and automations tested on a copy first.
AI can be switched off per file, and personal data can be pseudonymized.

Animation: a question types itself; a find request fills in; a chart grows.

## 6. Built for teams

**Host it on a server you already own.**
Record locking so two people never overwrite each other, live updates in every window, daily online
backups, Docker or one-command service install. Accounts and privilege
sets carry over; add passkeys, SSO, an access review and "test this
account".

## 7. Never locked in

**Speaks the Data API your integrations already call. Your data comes out whenever you want it.**
A Data API-compatible REST endpoint (a conformance suite checks it against Claris's guide), so existing integrations should keep working; the docs list what differs.
Take your data out as SQLite, SQL or CSV, and the design as text files, at any time. Writing a .fmp12 back is not possible yet. MIT licence; SQLite underneath.

## 8. Trial sign-up

**Help shape it. Join the trial.**
Fields: name, email, role (independent developer / in-house developer /
consultancy / business owner), size of solution (files, rough record count), plug-ins
used, what you'd test first (free text).
Note under button: We'll only email you about the trial.

## 9. Footer

Tabularius is not affiliated with Claris International Inc. FileMaker is a
trademark of Claris International Inc. MIT licensed.
