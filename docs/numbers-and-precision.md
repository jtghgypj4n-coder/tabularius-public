# Numbers and precision

## While a formula runs

Calculations use JavaScript numbers (binary doubles) for ordinary numeric values. The `+`, `-` and `*` operators also preserve whole-number arithmetic exactly while the result has at most 400 digits; beyond that limit they return `?`. Decimal arithmetic has special handling, so common decimal operations such as `0.1 + 0.2` produce `0.3`. `Round`, `Truncate` and `SetPrecision` use decimal-aware calculation paths. `SetPrecision` can format a repeating result to the requested number of decimal places. These are Tabularius observations; FileMaker's answer for each behaviour is unverified. <!-- known-difference: SQL and calculations ;; Calculation operators and functions do not share a single precision representation ;; Some operations preserve large whole numbers while others may round them ;; Run the same generated formulas in FileMaker and compare each result -->

Functions other than `+`, `-` and `*` may round values past 2^53 today. The current acceptance tests pin correct behaviours, and [whole-numbers.test.ts](../packages/calc/test/whole-numbers.test.ts) covers the existing large-integer cases without making every current loss permanent.

## What is stored

In a synthetic store, writing `9007199254740993` and reading it through `Store.get` returned `9007199254740992`; writing `12345678901234567890` returned `12345678901234567000`. This shows precision was lost by the store's number-field read path. FileMaker's own storage result is unverified. <!-- known-difference: SQL and calculations ;; Number-field storage reads lose digits beyond double precision ;; Reading back 9007199254740993 yielded 9007199254740992 and a 20-digit input yielded a rounded value ;; Repeat the generated-store write and read in FileMaker to determine whether its stored value differs -->

## What leaves the server

The Data API serializes record field data as JSON. Because the store read path already returned rounded JavaScript numbers, a JSON client receives rounded digits for these inputs; this is an inference from the store probe and serialization path, not an end-to-end HTTP probe. The web client's display path formats JavaScript numbers with `Intl.NumberFormat` and at most two fraction digits; this is an implementation observation, not a rendered-page probe. The SQL wire formats numeric values as text and has a binary numeric encoding, but the exact output for stored `1e21` and a 20-digit field value was not probed end to end. FileMaker's own answer for each route is unverified. <!-- known-difference: SQL and calculations ;; Large values may lose digits in JSON clients and web display, while SQL wire output is unverified ;; Store reads return rounded JavaScript numbers, JSON serializes those values, and web display uses Intl.NumberFormat ;; Probe 1e21 and a 20-digit value through raw Data API JSON, rendered web text and SQL wire, then compare with FileMaker -->
