# Calendar feeds

Show a layout's dates in any calendar app, and bring events from a `.ics` file into a table. This works on a date field (all-day events) or a timestamp field (timed events), with the privileges of the account that asks.

## Subscribe to a layout

The feed is one address per layout:

```
https://your-server/tabularius/calendar/v1/databases/{file}/layouts/{layout}/calendar.ics?start=Due&end=DueEnd&title=Customer&description=Notes&location=Place
```

| Parameter | Meaning |
| --- | --- |
| `start` | Required. A date or timestamp field of the layout's table. |
| `end` | A field of the same kind as `start`. Leave it out for one-day or open-ended events. |
| `title`, `description`, `location` | Fields that fill the event. A blank title shows as "(untitled)". |
| `query` | A JSON list of finds, as the Data API's `_find`, to feed only some records. |
| `zone` | The zone the timestamp readings are in: `UTC` or an IANA name such as `Europe/London`. |
| `limit` | At most this many events, 1 to 5000 (or the server's Data API limit, if that is lower). |

### Signing in

Calendar apps cannot send a `Authorization` header, so a feed accepts `?token=` with an API token, but only one that is **read-only and scoped to that one layout**. A link that leaks then shows that layout and can change nothing. Make one in the console (Security, API tokens), choose read-only, and limit it to the layout. Revoke the token to end the link. A sign-in session token is never accepted in the address, and neither is a token that can write; they are refused without being used, so a feed that polls one cannot keep a session alive.

Command-line tools and scripts can use any token in the `Authorization: Bearer` header instead, which keeps it out of the address.

The server log hides `token` values. A reverse proxy in front of the server may log the whole address, so check its log settings before sharing a feed link.

### What is in the feed

- A record you may not view is not in the feed, and a field you may not see cannot be named as `start`, `title` or the rest. A masked field shows its mask.
- Each event has a stable `UID` made from the record and the file, so an app updates an event when the record changes rather than adding a second one. `SEQUENCE` counts the record's changes.
- Records with no readable start are left out. `X-Tabularius-Events` and `X-Tabularius-Skipped` in the response say how many were written and skipped.
- A found set over 5000 events (or your `limit`) is an error that names its size, and never a feed that quietly lacks events. Narrow it with `query`.
- Text is escaped, lines are folded at 75 octets, and a line break inside a field cannot start a new property or event.
- The feed asks apps to refresh hourly. Apps decide how often they really do.

### Dates and time zones

- A **date** field makes all-day events. An end date is the last day, shown inclusive: a record ending on the 18th is shown through the 18th. (iCalendar's own end is exclusive, so the feed writes the 19th.) This is Tabularius's choice.
- A **timestamp** field has no zone. Without `zone`, events are *floating*: 09:30 shows as 09:30 wherever the calendar is.
- With `zone=Europe/London`, readings are converted to UTC instants, so a calendar in New York shows 04:30 for a 09:30 London event. Daylight saving is applied for the date of each event.
- Clocks going forward skip an hour: a reading in the skipped hour (02:30 on 8 March 2026 in New York) is moved forward by the length of the skip (to 03:30). Clocks going back repeat an hour: a reading in it is taken as the first time. These two choices are Tabularius's own.

## Make and end feeds

You do not have to build the address by hand.

**In the web client**, an account with Full Access (the same as Manage Security needs) has File > Manage > Calendar Feeds…. Pick the layout, the field that says when each event starts, and optionally the end, title, description and location fields, a time zone, a name and an expiry in days, then Make link. The address appears once, with a Copy button: it carries the token, so it is not stored and not listed afterwards. The list shows each feed's name, layout, the account it shows records as (yours), when it was made and last opened, and a Revoke button. An account without Full Access is not offered the entry.

**What a link can read.** The link's token is limited to one layout and to reading, and it sees what the account it shows records as may see. It is not limited to the fields or the search you chose when making it: whoever has the link can also read every record and visible field of that layout through the Data API (send the token as a Bearer token), or drop the search from the address. Treat it like a password, give each person or app their own, and revoke it when it is not needed. To give a link less, make it with `tabularius calendar-feed create --account` for an account whose privilege set shows less of the layout. The web client makes feeds for local accounts only; a person signed in through an identity provider uses the command.

File > Import Calendar (.ics)… reads a `.ics` file into the layout you pick, with the same field choices. It is offered with Import Records; the server still refuses an account that may not create records there.

**On the command line**, on the machine that holds the files:

```
tabularius calendar-feed <folder> <database> create --account Ann --layout Invoices --start Due --title Customer [--end F] [--description F] [--location F] [--zone Europe/London] [--query '[{"Status":"open"}]'] [--limit N] [--label "Team"] [--expires-days N] [--public-url https://your-server] [--json]
tabularius calendar-feed <folder> <database> list [--json]
tabularius calendar-feed <folder> <database> revoke <id>
tabularius import-ics <folder> <database> events.ics --account Ann --layout Invoices --start Due --title Description [--end F] [--description F] [--location F] [--uid F] [--zone UTC] [--json]
```

`create` prints the address once (`--public-url` puts your server's address in front of it; without it you get the path). `import-ics` prints what it did and makes all of the records or none.

Behind both, a feed is a read-only API token for one layout, with a name that starts "Calendar feed". It is also in the file's token list (Manage Security), where it can be revoked too, and making or revoking one is in the security log. The feed shows only what the account it was made for may see; it needs that account's privilege set to include the `fmrest` extended privilege, and `create` refuses without it, since the link could never open.

The same actions are routes, for scripts: `GET`, `POST` and `DELETE` on `/tabularius/calendar/v1/databases/{file}/feeds` (see the [REST reference](reference/rest.md)). A read-only or layout-scoped token cannot use them.

## Import a `.ics` file

```
POST /tabularius/calendar/v1/databases/{file}/layouts/{layout}/calendar-import?start=Due&title=Description&location=Place&uid=Code
Content-Type: text/calendar
```

The body is the `.ics` file (up to 8 MB and 5,000 events). Sign in with a `Authorization: Bearer` header and an account that may create records; a read-only token is refused, and `?token=` is not accepted. The answer is counts and reasons, never the file's text:

```json
{ "imported": 12, "skipped": 1, "notes": ["an event with no readable start was skipped (1)"] }
```

- Import is all or nothing. If the account's privileges refuse one record, none is made.
- **Repeating events** become one record per occurrence, up to 366 for each event. The rules read are daily, weekly (optionally on named days such as `BYDAY=MO,WE`), monthly on the start's day of the month, and yearly, with `INTERVAL`, `COUNT`, `UNTIL` and `EXDATE`. Any other rule imports the first occurrence only, and the notes say so. A changed single occurrence of a repeating event comes in as its own event.
- An all-day end date is made inclusive, to match the feed.
- Times written in UTC are stored as their UTC clock reading unless you give `zone`, which stores the reading in that zone. A time written with `TZID` is moved to `zone` when both are known zones; with no `zone` it is stored as written.
- A reminder (alarm) inside an event is ignored.

## What is not covered

- No `VTIMEZONE` blocks: timed events are floating or UTC.
- No event attendees, categories, attachments or free/busy.
- The feed is read-only: a calendar app cannot change records through it.
- The reader does not expand rules with `BYMONTHDAY`, `BYSETPOS`, numbered weekdays (`2TU`), or repeats more often than daily; their first occurrence is imported.
- Checked against RFC 5545 (line folding, escaping, required properties) and a reference reader in the tests. It has not been checked against each calendar app, which differ in how they treat floating times and refresh intervals.
