# Find syntax for `find_records`

`query` is an array of requests. Records matching **any** request are found (OR). In one request, every field must match (AND).

```json
{ "query": [ { "Status": "Open", "Amount": ">1000" }, { "Customer": "Acme" } ] }
```

Open and over 1,000, **or** Acme.

| Write | Meaning |
| --- | --- |
| `abc` | a word in the field starts with abc (FileMaker's default) |
| `=abc` | a word matches abc exactly |
| `==abc` | the whole field is exactly abc |
| `=` | the field is empty |
| `*` | the field is not empty |
| `<5`, `<=5`, `>5`, `>=5` | comparisons (numbers, dates, times) |
| `1...10` | a range, ends included |
| `"two words"` | a phrase |
| `Sm*`, `Sm@th` | wildcards: `*` any characters, `@` one character |
| `7/3/2026`, `>=2026-07-03` | dates, in the file's format or ISO |

A request with `"omit": true` subtracts what it matches from the found set.

Related fields are written `Occurrence::Field`; a record matches when one of its related records matches every criterion given for that occurrence.

Sort with `"sort": [ { "fieldName": "Amount", "sortOrder": "descend" } ]`. `limit` defaults to 50 (at most 1,000); `offset` is 1-based. A masked field can't be searched or sorted by.
