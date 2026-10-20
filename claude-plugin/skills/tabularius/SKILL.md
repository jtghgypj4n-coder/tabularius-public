---
name: Tabularius
description: Work with a FileMaker solution hosted by Tabularius through its MCP tools. Use when the user wants to look at, search, change, import or clean up records, run or write scripts, understand or document a solution, check who can access what, or change a layout or the design of a hosted file.
---

# Working with a Tabularius solution

Tabularius hosts converted FileMaker (`.fmp12`) files. This plugin connects to its `/mcp` endpoint. Every tool runs as one account, in one file, inside that account's privilege set. You cannot get around those privileges, and you should never try to.

## Start safe

1. **Read before you write.** Start with `list_databases`, then `describe_database` (tables, fields, layouts, scripts, value lists) or the `tabularius://{database}/overview` resource. Then `describe_layout` for the layout you will use. Records are always read and written through a **layout**, as in FileMaker.
2. **Know who you are.** If the user's token is read-only, writes and script runs are refused: say so plainly, and don't look for another route. `explain_access` and `who_can_access` say what an account may do.
3. **Show before you change.** Find the records first and show the user what will change (record ids and the fields). For a change to many records, do one and confirm, then the rest.
4. **Ask before anything that cannot be undone.** `delete_record` cannot be undone. Scripts can create, change and delete records. Design changes alter the file. Get a clear yes for each, naming the thing.
5. **Prefer the dry run.** `change_design` takes `preview: true`; `draft_layout` previews by default; `try_design_change` runs the change on a throwaway copy; `plan_import` plans before `import_records`; `check_script` checks a script without running it.
6. **Use the undo that exists.** `undo_import`, `undo_data_fix` and `undo_stale_refresh` take back what their partners did. Say which one to use if the user wants to go back.

## Common jobs

**Find records.** `find_records` with `layout` and `query`: an array of requests, OR'd together; the fields in one request are AND'd. A request with `"omit": true` subtracts. Keep `limit` small and name the `fields` you need, since each record carries its related portal rows. When you don't know which table or field holds a word, use `search_records` first. See [find syntax](references/find-syntax.md).

**Change a record.** `get_record` or `find_records`, then `update_record` with `modId` from what you read, so it fails if someone else changed the record meanwhile. Error 301 means a person is editing it: wait or tell the user. `create_record` takes `fieldData` (dates as ISO `2026-10-15` or in the file's format).

**Import a spreadsheet.** `plan_import` (matches columns, shows what each row becomes and which repeat existing records), show the plan, then `import_records`, and keep `undo_import` in mind.

**Run a script.** `get_script` to read it, `check_script` for a draft, then `run_script` with `trace: true` and `maxSeconds` (for example 20). It runs on the server as FileMaker Server would: no dialogs, no screen, no network. If it fails, `explain_script_failure`; to step through it, `debug_script`.

**Understand a solution.** `explain_solution`, `solution_map`, `where_used` (before renaming or deleting anything) and `document_solution`. The prompts `explain_solution`, `what_would_break` and `draft_script` do these in order.

**Build or change a layout.** Needs a Full Access account (or the server administrator); a scoped token cannot. `get_theme` and `get_layout_design` to see the file's own look, `draft_layout` (with `like` for a layout to copy, `view: list` or `form`, `preview` first), then `lint_layout` and `fix_layout`. For small changes to one layout, `edit_layout_objects`. Do not invent a look: take it from the file's layouts.

**Change tables, fields, value lists, scripts.** `change_design` with `preview: true` first and show the lines it returns; apply with `preview: false`; keep the returned `undo`. `design_history` shows what changed before.

**Clean up data.** `find_data_problems`, show them, then `fix_data_problems`. One undoable step.

**Change many records the same way.** `update_records` with a `query`, `dryRun: true` first and the preview shown, then again with `expectCount` set to the number the preview matched. All or none, and `undo_data_fix` takes the batch back. For different values per record use `update_record` or a script.

**Check security.** `review_privileges`, `get_security`, `who_can_access`. `change_security` only with an explicit request.

## When a tool refuses

- "AI is turned off for X": the file's owner turned it off (or a file it uses). It also applies to the server administrator. Don't look for a way round it; tell the user where to turn it on (admin console).
- No `fmmcp` / AI access: the account's privilege set needs the AI access extended privilege. Tell the user.
- A field comes back as a stand-in (last four characters, or fixed text): it is masked for this account. Don't try to read it another way. Values like `<PERSON_1>` are stand-ins from personal data isolation; leave them as they are.
- `sql_query`, `evaluate_calculation` and design tools need broad privileges. A limited account or token won't get them; use `find_records` instead.
- A tool result with `isError` has the reason as its text. Quote it to the user before trying anything else.

## Habits

- Never put a token in a file, a commit or a message. It is in the plugin's settings.
- Say what you did in plain words: which file, which layout, how many records, what changed.
- Report what you did not check. If a find returned 50 of 1,200 records, say so.
- If the user wants something the tools can't do, say that, and don't improvise with scripts that do something else.
