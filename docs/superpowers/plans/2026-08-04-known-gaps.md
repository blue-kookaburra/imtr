# Known gaps — parser and map

**Written:** 2026-08-04, at the end of the `svg-network-map` branch (SVG map redesign +
City Loop modelling).

These were found by executing real disruption text through the real parser into the
status layer. All were measured as **present on `main` before this branch** — none is a
regression. They are recorded here because they were expensive to find and would otherwise be
rediscovered from scratch.

**Update 2026-08-04, branch `parser-scope-detection`.** Gaps 1-3 are now addressed:
whole-line scope is decided by the weak claim's own sentence rather than by whether a loop
closure was detected elsewhere in the row, and the keyword gates accept `replacement buses`.
Gaps 1 and 2 are closed for their exemplars but **not for their whole class** — see the
residuals recorded under each. Gaps 4 and 5 are untouched.

**Update 2026-08-07.** Gap 2's residual, gap 5 and gap 6 are now fixed — see the notes under
each. **Gap 1's residual and gap 4 are the two still open**, and gap 1's is the one that can
still produce a wrong answer in either direction; the rest of this file's open items are
under-reads, not false claims.

The project invariant they bear on is **fail-visible** (`AGENTS.md`): anything the parser
can't confidently map renders as a line-level ⚠ warning — never a possibly-wrong blackout,
never a false "all clear". Both halves matter, and these sit on both sides of it.

---

## 1. A weakly-worded whole-line claim is swallowed by a co-occurring loop closure

`"Belgrave Line: No trains on the Belgrave line. The City Loop is closed."`

→ `wholeLine: false`, only the 4 ring edges bussed, Ringwood `normal`, calendar `normal`,
no warning. The text says no trains run on the line; the app tells a Ringwood passenger they
are fine. **False all-clear on the trunk.**

Cause: `WHOLE_LINE_REPLACED_WEAK` (`lib/scrape/parse.ts`) is deliberately suppressed when
`skipsStations` is set, because its alternatives (`no trains`, `trains do not run`,
`bus replacement`) otherwise match loop-only sentences and black out whole lines. The
suppression is right for loop-only text and wrong for genuinely-whole-line text that happens
to be phrased weakly.

**Addressed** — the claim's own sentence now decides, so the loop sentence beside it no
longer swallows it.

**Residual (both directions).** The rule is *negative*: a weak claim counts as whole-line
when its sentence does not mention the loop. That manufactures blackouts as well as
all-clears, and the doc should not record only the flattering half.

*Blackout direction.* A scope the section parser can't read is promoted to a full-line
claim once a loop sentence sits beside it: `"Trains do not run east of Ringwood. The City
Loop is closed."` → 31 of 31 edges, where `main` gave 4. `main`'s answer was also wrong (a
false all-clear east of Ringwood), so this trades one wrong answer for another rather than
regressing cleanly — but it lands on the half `AGENTS.md` names first. Same shape when the
qualifier is simply in a different sentence: `"Bus replacement is in place. This is while
the City Loop is closed."` → 31 of 31. Sentence scoping cannot see across a full stop, and
an unscoped weak claim beside a loop closure is genuinely ambiguous — the principled answer
for that case is a ⚠ warning rather than either confident state, which is a larger change
than this branch made.

*All-clear direction.* A sentence that names a ring station incidentally still reads as
loop-scoped, and with a loop closure alongside that is still a false all-clear:
`"No trains on the Belgrave line due to works near Parliament. The City Loop is closed."`
→ 4 of 31 edges, Ringwood `normal`. Bus-stop locations are named this way routinely in
article bodies. Closing the class needs *positive* whole-line detection — "entire line",
"all trains", "on the \<name\> line" — instead of inferring it from the absence of a loop
mention.

## 2. `"no trains through the City Loop"` blacks out the whole line

`"There are no trains through the City Loop."`

→ `skipsStations` unset, so the weak whole-line alternative has no closure to suppress it →
`wholeLine: true`, all 31 Belgrave edges bussed, Ringwood `cut`. **Possibly-wrong blackout**
from loop-only text.

Cause: `LOOP_CLOSED` matches `not run through the city loop` but not `no trains through the
city loop`. The weak-alternative guard is only ever as good as `LOOP_CLOSED`'s phrasing
coverage, so every phrasing it misses is a potential blackout rather than a quiet miss.

**Addressed** — the weak claim is now suppressed by its own sentence mentioning the loop,
which does not depend on `LOOP_CLOSED` recognising the phrasing.

**Residual closed 2026-08-07.** `LOOP_CLOSED` now carries a `no trains ... via|through the
City Loop` branch, so the row reaches the ring closure it describes instead of stopping at a
line-level ⚠ warning. The `no trains` prefix is its own subject guard — the branch cannot be
reached by "buses replace trains" — and `[^.]{0,60}` still cannot cross a full stop, so
`"No trains on the Belgrave line. The City Loop is closed."` sets the ring only from its
second sentence.

## 3. `"Replacement buses ..."` parses to no disruption at all

`"Replacement buses for trains run direct to Flinders Street."`

→ zero disruptions. `DISRUPTION_KEYWORDS` and `SERVICE_GAP` (`lib/scrape/parse.ts`) match
`bus replacement` but not `replacement buses`. The row is dropped before any loop or section
logic runs. **Silent all-clear.**

**Addressed** — `replacement (buses|coaches)` was added to both gates and to the weak
whole-line alternatives, so the row survives and reaches the same verdict as the
`bus replacement` word order.

## 4. Map has no screen-reader accessibility

`components/map/MapLabels.tsx` sets `aria-hidden` on the only textual content in the map, and
`MapStations.tsx`'s tap-target circles carry no accessible name or keyboard affordance. A
screen-reader user gets nothing from the Map tab.

Tracked since the SVG redesign's Task 9 review; deliberately out of scope for both plans.

## 5. Stacked edge tap targets ignore line focus

`components/map/MapLines.tsx` renders a hit path per edge with no focus filter, so where
several lines share one polyline the last-drawn edge always wins the tap. 66 polylines are
shared; the deepest is `parliament-richmond` with 5 lines, where Frankston always wins. With
Belgrave focused, tapping the Belgrave-coloured ring lane opens a Frankston sheet.

Pre-existing — trunk edges were already stacked 4 deep before the City Loop added a fifth.

**Fixed 2026-08-07.** `hitOrder` (`lib/map/hit.ts`) draws the focused line's hit paths last,
so focusing a line decides the tap on every polyline it shares. Measured before the fix: 66
shared polylines, 87 (stack, focused line) pairs where the tap opened the wrong line.
`tests/map-hit.test.ts` asserts zero across the real geometry. With no line focused the order
is left alone — there is no signal to pick a winner from, so any choice would be equally
arbitrary.

## 6. A trailing time phrase can lose an otherwise valid section

`"Buses replace trains between Ringwood and Belgrave from 9.30pm."`

→ `parsed: false`, so the whole line gets a ⚠ warning instead of the Ringwood–Belgrave
section it names. `sectionStations`' `(?:between|from)` alternation lets the second `from`
compete with the first, and the trailing clock time defeats the station-name character
class.

Measured identical on `main` and on `parser-scope-detection` — pre-existing, found while
verifying that branch. Fail-visible-safe (a warning, not a wrong claim), but it discards
information the text clearly carries, and "between X and Y from 9.30pm" is ordinary wording.

**Fixed 2026-08-07.** `from` joins the terminator words that close the station list. The
first `from` is always consumed by the `(?:between|from)` prefix, so a second one is a new
clause every time. The existing `\s+\d` terminator could not cover this — the clock time is
held off by the word, not by the digit.
