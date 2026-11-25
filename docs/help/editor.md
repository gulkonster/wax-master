# The editor: errors, completion, and what only the build finds

The editor checks your C++ while you type, with the compiler's own front end and the headers of the project's toolchain. It marks most mistakes at once. A few mistakes it cannot see; only the build (Ctrl+B) finds them. This page says which, and what the build then says.

## How errors are marked

- A red wavy line is an error, a yellow one a warning. The line is under the mistake itself: a missing `;` is marked at the end of the statement that lacks it, not at the next word.
- An unused `#include` is shown faded, with no line. Quick Fix removes it.
- Hover a mark to read the message. The messages are the compiler's, cleaned: a name such as `operator""_n<char, 's', 't', 'a', 't'>()` is shown as `"stat"_n`, and the comment marks of the headers are shown as plain text.
- Antelope's own rules are checked while you type, in plain words: a `"..."_n` name, an action name (the function name, or the text of `[[eosio::action("...")]]`), the text of `[[eosio::table("...")]]` and of `[[eosio::on_notify("contract::action")]]`. The message names the character or the length at fault and repeats the rule: a-z, 1-5 and `.`, at most 12 characters (a 13th may be 1-5 or a-j), and no dot at the end.
- A misspelled attribute such as `[[eosio::acton]]` gets a yellow line: the compiler ignores an attribute it does not know, so the action would silently be missing from the ABI. The message offers the nearest known name. This check is made for the toolchain 4.1.1wax01.
- Put the cursor on a name and its other uses in the file are highlighted.

## The Problems list

The Problems tab (View > Problems, Ctrl+Shift+M) is one list: the errors and warnings of the files the editor has open, and those of the last build. A mistake that both know is listed once. When you change a file, the build's rows for that file go away, because they no longer describe the text; build again to get them back. Problems that have no place in a file (the linker, the ABI generator, the ABI check) stay until the next build. A row of the editor looks like a row of the build; click it to jump to the place.

The build's red marks in the editor cover the word at the error's column and stay only while their row stands in the list. When there is nothing to show, the tab says `No problems in the open files or the last build.`

[Problems](app:show-problems)

## Quick Fix

When the compiler has a fix for a mistake, a light bulb appears at the line, and Ctrl+. (Quick Fix) lists the fixes: insert the missing `;`, remove an unused `#include`, and similar. Choose one and the text changes like any other edit; save the file as usual.

## Completion and snippets

- Completion opens while you type; Ctrl+Space opens it by hand. The names a contract developer needs come first. The library's internals (names in `detail::`, `bluegrass::`, `internal_use_do_not_use::`, names that start with two underscores, and the macros the app's own build flags define) are left out.
- Inside the lambda of `emplace` or `modify` written with `auto&`, as in `table.emplace(get_self(), [&](auto& row) { row. })`, the compiler cannot tell what `row` is. The editor then looks up the row type of the table and offers its fields and functions after `row.` (the detail says `field of ...` or `function of ...`).
- Snippets are offered with the other items when the line holds only spaces and at most one word before the cursor. Type the word and choose the snippet. The default texts are marked; overtype them, and Tab moves to the next.

| Word | What it writes |
|---|---|
| `action` | An action declaration with `[[eosio::action]]` |
| `table` | A table row struct with `primary_key` and its `multi_index` type |
| `notify` | A handler with `[[eosio::on_notify("eosio.token::transfer")]]` and the four transfer parameters |
| `find` | `find` and a `check` that the row exists |
| `emplace` | Adds a row to a table |
| `modify` | Changes a row of a table |
| `erase` | Removes a row from a table |
| `require_auth` | `require_auth(get_self());` |
| `check` | `check(true, "message");` |
| `inline` | Sends an inline action with `permission_level{get_self(), "active"_n}` |
| `singleton` | A struct and its `singleton` type; the editor adds `#include <eosio/singleton.hpp>` when the file does not have it |

The defaults fit the Token template (the table `statstable`, the row `st`, the arguments `quantity` and `memo`); change them to your names.

## Headers

- A change in a header counts at once, without a save. About half a second after you stop typing in an open header, the other open files are checked again against the new text, so an error you make in `include/hello.hpp` shows in `src/hello.cpp`, and an error you fix there goes away.
- The compiler reports only one error per `#include` line. When the header named there has errors of its own, the include line shows one error that gives the number of errors and the first one, in the form `include/hello.hpp has 2 errors; first: line 12: ...`. The editor opens such a header in the background (at most 12 per project) so that its errors reach the Problems list.
- A header that is only a piece of another file is not judged alone. Some projects have a header that uses `name`, `asset` or `std::` and relies on what the source file includes before it, or a header that is included inside a class. Read alone, it looks wrong; built as part of its file, it is right. When the project's main file has no error and another file includes the header, the header's own errors are not shown, and its first line gets an information mark: `This header is not complete on its own: it uses what <main file> includes before it. It is checked as part of that file, which has no errors.` As soon as the main file has an error, the header's errors are shown as they are.

## Format Document

Edit > Format Document (Shift+Alt+F) lays the file out by the `.clang-format` file of the project. Every new project, template and example carries one with these seven lines, and the shipped files are already laid out by it, so Format Document changes nothing in a new project:

```
BasedOnStyle: LLVM
ColumnLimit: 140
AllowShortFunctionsOnASingleLine: All
AllowShortLambdasOnASingleLine: All
AllowShortIfStatementsOnASingleLine: WithoutElse
AccessModifierOffset: -2
PointerAlignment: Left
```

An older or imported project may have no such file. Then the layout follows the LLVM style at 80 columns, which reflows lines you did not touch. To avoid that, make a file named `.clang-format` in the project's top folder (File > New File) and copy the seven lines into it. The file steers the layout only; it changes no build result.

## What only the build finds

The editor does not see these six. The build reports each: press Ctrl+B and read the first red line of Output, or the Problems row, which jumps to the place.

| What you wrote | What the build says |
|---|---|
| A wrong field name or type inside the lambda of `emplace` or `modify` written with `auto&`, such as `s.isuer = issuer;` | `no member named 'isuer' in 'mytoken::currency_stats'` at that line. Writing the row type instead of `auto`, as in `[&](currency_stats& s)`, gives the check while you type; both forms compile the same |
| A key of the wrong type given to `find`, `get` or `require_find`, such as `find("WAX")` | The first error is inside the toolchain's `multi_index.hpp`, for example `comparison between pointer and integer`. The Problems row points at your line when the build names it, and ends with the header's name and line in brackets, such as `[multi_index.hpp:1820]` |
| A row field of a type that cannot be stored, such as `const char*` | `static_assert failed ... "Pointers should not be serialized"`, inside the toolchain's `datastream.hpp`; the notes after it name your row struct |
| A function that was meant to be an action, without `[[eosio::action]]` | No error: the build succeeds. The action is missing from the ABI, so the Contract page does not list it. See [Common compiler errors](doc:compiler-errors) |
| A function declared in the header and never defined | `undefined symbol`, from the linker, with no place in a file. Write the body in the `.cpp` file with the same parameters |
| Ricardian text and the ABI | Output lines that start with `ABI check:` stop Deploy until fixed; an action without Ricardian text gives a warning. See [ABI check messages](doc:abi-check) and [Ricardian contracts](doc:ricardian) |

[Build](app:build)

## If the editor shows nothing

The status bar shows the editor engine next to the toolchain: `C++: ready`, `starting`, `indexing`, `off` or `error`. Hover it to read what the engine says.

- `C++: starting` or `indexing`: wait; marks and completion come when it is done.
- `C++: off`: the engine is not running; the hover text says why. If the toolchain is not set up, open Help > Setup and finish it.
- `C++: error`: the engine stopped. Click the item to start it again.
- `C++: ready` and still no marks: build with Ctrl+B. The build checks everything and is the last word.

[Setup](app:setup)

## Example

Open a new Token project. Delete the `;` after `require_auth(get_self())` in `create`: the red line stands at the end of that statement, the Problems tab counts one error, and Ctrl+. offers to insert the `;`. Undo it. Now change `s.issuer` to `s.isuer` inside `statstable.emplace(get_self(), [&](auto& s) {`: the editor stays silent. Ctrl+B names `isuer` in `currency_stats`, and its Problems row jumps to that line.

## What is needed

The toolchain (Help > Setup) and an open project. The editor writes nothing into the project.

See also [Common compiler errors](doc:compiler-errors) and [Build, Output and Problems](doc:build-output-problems).
