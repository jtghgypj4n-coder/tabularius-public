# R30-17: FileMaker Server migration and sync

## Prior work retained

The earlier [sync model audit](r22-05-sync-model.md) and existing sync tests
already cover interrupted write journals, retry adoption, lost acknowledgements,
transient GET timeouts, partial pages, and session expiry. This item builds on
those paths. No earlier r30-17 claim was present in the local notes or claims
search. There was no duplicate implementation of the sync journal.

## Changes and evidence

Migration requires complete live database and schedule lists (Claris lists
“List databases” and “List schedules” in its [Admin API calls](https://help.claris.com/en/admin-api-guide/content/admin-api-calls.html)),
stages a file and its external container folder separately, compares
source and staged SHA-256 before publication, and checks an existing copy on a
rerun. A synthetic three-file interruption test stops after each file boundary,
resumes, and checks that a second run leaves all copied checksums unchanged.
The data-at-rest `.openhbam.sqlite` name is recognized. Progress reports
completed file steps and elapsed-time ETA; sync reports processed planned
record steps with an estimate after two observations.

The Data API reader checks every page's count and length, rejects duplicate
record IDs or keyed UUIDs, and compares two complete reads of empty or
multi-page layouts before planning.
The synthetic source injects a truncated page, a same-count edit between pages,
an empty-to-populated change, request deadline failures, transient GET failures,
and session expiry. These are local test behaviors, not Claris guarantees.
Claris documents `_offset` as a “starting record” and `_limit` as a maximum
([Get a range of records](https://help.claris.com/en/data-api-guide/content/get-range-of-records.html)).

After live apply, a fresh read reports complete counts, up to 16 deterministic
keyed-record checksum comparisons, and local table versus remote layout
field-name hashes. It reports count, unkeyed, duplicate-key, sampled-record,
and field-list differences without record values. Claris documents layout
`fieldMetaData` ([Get layout metadata](https://help.claris.com/en/data-api-guide/content/get-layout-metadata.html))
and a read by record ID ([Get a single record](https://help.claris.com/en/data-api-guide/content/get-single-record.html)).
The password remains only in the live session closure and is cleared on close;
the persistent sync configuration and logs contain no password.

## KNOWN

| Boundary | Status |
| --- | --- |
| Atomic source snapshot across several Data API range requests | **Unverified**; two matching reads detect tested changes but cannot exclude every concurrent history. Quiesce the source for final verification. |
| Full FileMaker design equivalence | **Unverified**; the reported design hash covers field-name lists exposed on the layout, not scripts, privilege sets, relationships, or field definitions. |
| Whole-record equality beyond the deterministic sample | **Unverified**; counts are complete, but at most 16 keyed records per table are hashed. |
| FileMaker Server behavior for a partial range page, changed `foundCount`, or retry after a dropped write | **Unverified** by Claris pages cited here; local safeguards and synthetic faults define the tested behavior. |
| Synchronizing while source writes continue | **Unverified**; rerun after source activity stops. |

## Validation

- Focused migration and sync tests: 21 passed, 0 failed, 0 skipped, approximately 5.8 seconds for four files with `--test-concurrency=2`.
- Related container, review, and deletion sync tests: 16 passed, 0 failed, 0 skipped, approximately 5.0 seconds for three files with `--test-concurrency=2`.
- Earlier guarded sync-model runner: 3 passed, 0 failed, 0 skipped, approximately 17.9 seconds. Its child-command marker guard stayed clear. The wrapper's wall-clock guard is 120 seconds; the test file completed in about 18 seconds.
- Root TypeScript check: passed.

Tests use generated local data. No corpus or fixture file was opened.
No new dependency, protected-directory edit, commit, push, or deployment was made.
