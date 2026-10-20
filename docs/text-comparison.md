# How text is compared

<!-- known-difference-file: Text comparison ;; Where two spellings of the same text (é as one character or with a combining accent, a ligature, full-width letters) count as equal differs from place to place, and none of it is checked against FileMaker except that a find ignores case, accents and width ;; A relationship or a SQL query can miss a record that a find returns ;; A FileMaker run of each row below with generated pairs (é against e and a combining accent, Å against the angstrom sign, ﬁ against fi, the ligatures ﬃ ﬄ ﬅ ﬆ, an emoji with joiners), or a Claris page that says what each place does -->

Text that looks the same can be stored in different ways: **é** as one character or as **e** followed by a combining
accent (what a Mac file name uses), **Å** as the letter with a ring, the angstrom sign or **A** and a ring, **ﬁ** as a
ligature, full-width letters and digits, half-width katakana, emoji joined with invisible characters. Two forms of one
letter are *canonically* equal (the same letters); the others are *compatibility* forms (a ligature and its letters).

| Where | Case | Accents | Canonical forms (é and e + accent) | Compatibility forms (ﬁ, full-width) |
| --- | --- | --- | --- | --- |
| Find: a plain word, `=word`, `==`, a wildcard (the word index holds the text as a find folds it) | ignored | ignored | equal | equal for the ligatures ﬀ ﬁ ﬂ and for width forms (full-width letters, digits and punctuation, half-width katakana), not for ﬃ ﬄ ﬅ ﬆ |
| Find, `<`, `>` and ranges | by the field's language ([Languages for sorting](sort-languages.md)) | follows the language | equal | not equal |
| Unique value | ignored | kept (`e` is not `é`) | equal | not equal |
| Value-list check ("member of value list") | ignored | kept | equal | not equal |
| Relationship `=` match | ASCII letters only | kept | not equal | not equal |
| Calculation `=` | ignored | ignored | equal | equal for ligatures, full-width and half-width forms; `ß` is not `ss` |
| `Exact` | kept | kept | not equal | not equal |
| `Position` | ignored | kept | not equal | not equal |
| SQL `=` and `<` | kept | kept | not equal | not equal |
| SQL `LIKE` | ASCII letters only | kept | not equal | not equal |
| Account names | ASCII letters only | kept | two accounts, but a new one that looks like another is refused | not equal |

- **Account names**: a sign-in and an account lookup match a name exactly apart from the case of ASCII letters,
  so the two forms of **José** are two accounts that each need their own password. Adding an account whose name is another
  account's written another way (also another capital that the database does not fold, **Émile** and **émile**) is refused,
  as importing accounts already refused it; so is a name that shares the other's lockout (below), such as **Straße** next
  to **Strasse**. The lockout counts a name in one form: case, compatibility forms (ß, ligatures, full-width letters),
  accents written either way, the characters a directory reads as nothing (soft hyphen, zero-width and direction marks,
  joiners) and stray spaces are all folded together (a lone surrogate counts as the U+FFFD that the database stores in its
  place), because a directory (LDAP) may take those spellings as one person and whoever is guessing chooses the spelling.
  That is a wider match than the account lookup, so it counts more failures together, never fewer. A directory with
  matching rules that go beyond this still lets a guess in another spelling start a bucket of its own; each address's total
  budget of failures bounds that. An account that arrives through single sign-on, a directory or provisioning is matched in
  lower case in every script, not only ASCII, and a provisioned name that looks like an existing account is refused too.
  Only accounts that exist count: deleting an account that came from the database file frees its name, though the file
  still lists it. Files that already hold two accounts that share a lockout keep them; there one account's correct sign-in
  clears the other's failed guesses from the same address.
- **Unique values and value lists** treat the two forms of one letter as one value (this changed: they used to differ).
- **Lone surrogates** (half of an emoji) cannot be stored: SQLite keeps U+FFFD in their place, so two values that differ
  only in such a character are equal once saved.
- **File names** (the files a server hosts, container file names) are kept as given. A name typed with the composed form
  of a letter does not find a file whose name the operating system stored in the decomposed form (macOS does), and the other
  way round.
- **Finds and width**: Claris says that "normally, finds are not case sensitive or width sensitive", with the example that a
  find with Japanese half-width characters matches the equivalent full-width ones
  ([Finding text and characters](https://help.claris.com/en/pro-help/content/finding-text.html)), so every kind of find here
  folds the width forms of a character to its normal-width character. The same page says a field whose Default language is
  Unicode is case- and width-sensitive; a find here ignores both for such a field too (not yet done). A dakuten or handakuten
  is dropped like an accent, so **ガ** and **カ** are equal in a find (not checked against FileMaker).
- **Relationships and OData**: Claris's page on [relationships that use comparative operators](https://help.claris.com/en/pro-help/content/relationships-comparative-operators.html)
  says only that "values in match fields are equal", and the OData guide's page on [`$filter`](https://help.claris.com/en/odata-guide/content/query-option-filter.html)
  leaves string comparison to the OData standard, so neither says how case, accents or width are compared. A relationship `=` match
  and an OData filter stay as the table says (not checked against FileMaker); a record a find returns can be missed by them.
- Where this page says a place does not fold a form, that is how Tabularius behaves today, kept until a FileMaker run or a
  Claris page says otherwise; it is not a claim about FileMaker.
