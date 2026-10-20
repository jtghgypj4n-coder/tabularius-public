# Time tracking

Hours logged against projects, with a summary report. Two tables, calculations that follow the
relationship, and two scripts. It is a design folder, the text `tabularius design-text` writes.

| File | What it makes |
| --- | --- |
| `tables/Projects.txt` | Projects with an hourly rate, and `Hours` and `Billable` worked out from their entries |
| `tables/Entries.txt` | Hour entries: the project, the day (today unless you say), the person, the hours, a note and the `Amount` at the project's rate |
| `relationships.txt` | Projects to Entries (new entries can be made, and deleted, from the project) |
| `scripts/Log time.txt` | Adds an entry from a parameter like `1\|Ana\|2.5` (project, person, hours) |
| `scripts/Hours by person.txt` | The summary report: a line per person, `Ana: 7.5`, for one project or for all |

```sh
tabularius new ~/tabularius Time
tabularius design-apply ~/tabularius Time examples/time-tracking          # lists the changes, makes none
tabularius design-apply ~/tabularius Time examples/time-tracking --apply
tabularius passwd ~/tabularius Time Admin
```

Make a project with a rate, then run `Log time` with `1|Ana|2.5` a few times. The project's
`Hours` and `Billable` follow, and `Hours by person` gives the report. The report is one
`ExecuteSQL` call: change its `GROUP BY` to `Day` to see hours a day instead.
