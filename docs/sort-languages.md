# Languages for sorting and indexing

<!-- known-difference-file: Sorting and languages ;; Each ICU locale mapping is an approximation of Claris, unverified; contractions (such as Czech ch) are not applied ;; A person sorts or finds with `<`, `>` or a range on a field set to that language can see an order that differs from FileMaker's ;; A FileMaker run sorting generated words in each language, compared language by language -->

A text field has a **Default language** (Manage Database > Fields > Options > Storage). It decides how the field's
values are put in order: which letters FileMaker counts as the same letter, and where a letter of its own goes (å after
z in Swedish, ł after l in Polish, ñ after n in Spanish). Claris describes it in
[Choosing a language for indexing or sorting](https://help.claris.com/en/pro-help/content/language-indexing-sorting.html);
the languages it can be set to are the ones Claris lists for the locale argument of
[SortValues](https://help.claris.com/en/pro-help/content/sortvalues.html), which says "Sort order is determined by locale in
the same manner as for sorting records."

Tabularius reads the setting from a converted file, and you can change it for a field in design mode (Storage, Default
language) or with `indexLanguage` in a design change. Nothing is rebuilt: the order is worked out when a query runs.

## Where the language applies

A field's language puts text in order in each of these, so they agree with one another:

- **Sort Records** and the Sort dialog, the Data API's `_sort`, portals and their sorts, value lists sorted by their field.
- **A find** with `<`, `>`, `<=`, `>=` and a range (`a...m`): the words of the value that lie between the bounds in the
  field's order, as Claris describes a text range.
- **Sub-summary groups**: records whose values the language sorts as equal fall in one group (an accent the language
  ignores does not start a new group).
- **SortValues** with a named locale: its text sorts in that language. An omitted or blank locale currently uses English;
  Claris specifies the file's locale, so this needs a file-locale check before it can claim parity. <!-- known-difference: Sorting and languages ;; An omitted or blank SortValues locale uses English rather than the file locale Claris specifies ;; A file with a non-English locale can sort an omitted-locale list differently ;; Persist the file locale and compare a generated SortValues probe in FileMaker -->

SQL `ORDER BY` on a direct text field in a single table uses the field's Default language here, so it agrees with Sort Records. An expression, join, or derived table keeps SQL's ordinary order because it cannot be assigned one field language without guessing. This direct-field behavior is a deliberate difference from [Claris's documented Unicode binary SQL order](https://help.claris.com/en/sql-reference/content/order-by-clause.html). Matching for equality does not follow the language either: a find for `=cafe`, a wildcard find and a unique-value check treat <!-- known-difference: Sorting and languages ;; Direct-field SQL ORDER BY uses the field's language where Claris documents Unicode binary SQL order ;; ExecuteSQL and read-only SQL can order a text field differently from FileMaker Server ;; An owner decision on cross-surface consistency versus Claris SQL parity -->
case and accents as they did before, in every language.

## Languages

Each language Claris lists, with the ICU locale that stands in for it. `Catalog`, `Unicode_Raw` (Default) and
`Unicode_Standard` keep the English order Tabularius has always used for a field with no language set (case and accents
are ignored; spaces and punctuation come before digits, digits before letters); a name that is not in the list is
treated as English, and names are read without regard to case.

| Language (as FileMaker names it) | Stands in as (ICU locale) | Status |
| --- | --- | --- |
| English | en | approximation of Claris, unverified; the existing English index comparison is retained |
| Catalog | en | approximation of Claris, unverified; keeps the existing English order |
| Unicode_Raw | en | approximation of Claris, unverified; keeps the existing English order |
| Unicode_Standard | en | approximation of Claris, unverified; keeps the existing English order |
| Japanese | ja | approximation of Claris, unverified; a few stored keys were compared, but special rules are unknown |
| Arabic | ar | approximation of Claris, unverified |
| Bengali | bn | approximation of Claris, unverified |
| Bulgarian | bg | approximation of Claris, unverified |
| Catalan | ca | approximation of Claris, unverified |
| Chinese | zh | approximation of Claris, unverified |
| Chinese_Stroke | zh-u-co-stroke | approximation of Claris, unverified |
| Croatian | hr | approximation of Claris, unverified |
| Czech | cs | approximation of Claris, unverified |
| Danish | da | approximation of Claris, unverified |
| Dutch | nl | approximation of Claris, unverified |
| Estonian | et | approximation of Claris, unverified |
| Finnish | fi-u-co-trad | approximation of Claris, unverified |
| Finnish_Custom | fi | approximation of Claris, unverified |
| French | fr | approximation of Claris, unverified |
| German | de-u-co-phonebk | approximation of Claris, unverified |
| German_Dictionary | de | approximation of Claris, unverified |
| Greek | el | approximation of Claris, unverified |
| Greek_Mixed | el | approximation of Claris, unverified |
| Gujarati | gu | approximation of Claris, unverified |
| Hebrew | he | approximation of Claris, unverified |
| Hindi | hi | approximation of Claris, unverified |
| Hungarian | hu | approximation of Claris, unverified |
| Icelandic | is | approximation of Claris, unverified |
| Italian | it | approximation of Claris, unverified |
| Kannada | kn | approximation of Claris, unverified |
| Korean | ko | approximation of Claris, unverified |
| Latvian | lv | approximation of Claris, unverified |
| Lithuanian | lt | approximation of Claris, unverified |
| Malayalam | ml | approximation of Claris, unverified |
| Marathi | mr | approximation of Claris, unverified |
| Norwegian | nb | approximation of Claris, unverified |
| Panjabi | pa | approximation of Claris, unverified |
| Persian | fa | approximation of Claris, unverified |
| Polish | pl | approximation of Claris, unverified |
| Portuguese | pt | approximation of Claris, unverified |
| Romanian | ro | approximation of Claris, unverified |
| Russian | ru | approximation of Claris, unverified |
| Serbian | sr-Latn | approximation of Claris, unverified |
| Slovak | sk | approximation of Claris, unverified |
| Slovenian | sl | approximation of Claris, unverified |
| Spanish | es | approximation of Claris, unverified |
| Spanish_Traditional | es-u-co-trad | approximation of Claris, unverified |
| Swedish | sv-u-co-trad | approximation of Claris, unverified |
| Swedish_Custom | sv | approximation of Claris, unverified |
| Tamil | ta | approximation of Claris, unverified |
| Telugu | te | approximation of Claris, unverified |
| Thai | th | approximation of Claris, unverified |
| Turkish | tr | approximation of Claris, unverified |
| Ukrainian | uk | approximation of Claris, unverified |
| Vietnamese | vi | approximation of Claris, unverified |

Where Claris offers two versions of a language, the pair is mapped to ICU's two: German is the phone-book order (ä sorts as
ae, ö as oe, ü as ue) and German_Dictionary the dictionary order (ä as a), Swedish and Finnish put w with v and
Swedish_Custom and Finnish_Custom keep them apart, Spanish_Traditional uses the traditional Spanish order. Which of Claris's
two is which was read off the names in design mode's list ("German (ä=a)", "Swedish (v<>w)") and is not checked either.

## What is not applied

- **Contractions** (Czech and Slovak ch, Hungarian digraphs such as cs, traditional Spanish ch and ll, Danish aa) and any
  rule that depends on the neighbouring letters. Every character has one weight, which is what lets SQLite sort the keys;
  the languages above are applied letter by letter.
- **Japanese** special rules and **Furigana**: the Japanese locale is an unverified stand-in. Furigana stays "not yet"
  (see [Design mode](design-mode.md)).
- **Chinese** special rules: `zh` and `zh-u-co-stroke` are unverified stand-ins; whether their order matches Claris's
  Chinese and Chinese_Stroke fields has not been checked.
- **Language numbers** in a converted file: only English (21) and Japanese (31) are known by number. A field with any other
  number keeps the number and is sorted in English order until a language is chosen for it.
- **Characters outside the language's scripts** sort after the language's own letters, by code point (a Latin name in a
  Russian field comes after the Cyrillic ones, as ICU's Russian order puts it).

## Settling it

A converted file whose fields use a language other than English holds that language's index; comparing the keys it stores
with the order here settles the language, as the English index did (`packages/calc/src/collation.ts`). So would a
FileMaker run that sorts a list of words in a field set to each language. Neither is in the repository, which has no
FileMaker files.
