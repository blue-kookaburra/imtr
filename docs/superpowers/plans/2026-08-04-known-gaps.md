# Known gaps — parser and map

**Written:** 2026-08-04, at the end of the `svg-network-map` branch (SVG map redesign +
City Loop modelling).

These were each found by executing real disruption text through the real parser into the
status layer. All five were measured as **present on `main` before this branch** — none is a
regression. They are recorded here because they were expensive to find and would otherwise be
rediscovered from scratch.

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

Fix direction: detect whole-line *scope* explicitly — "entire line", "all trains", "on the
\<name\> line" — rather than inferring it from the absence of a section. Severity is moderated
by VIC's CMS almost always writing "Buses replace trains", which is strong wording and
unaffected.

## 2. `"no trains through the City Loop"` blacks out the whole line

`"There are no trains through the City Loop."`

→ `skipsStations` unset, so the weak whole-line alternative has no closure to suppress it →
`wholeLine: true`, all 31 Belgrave edges bussed, Ringwood `cut`. **Possibly-wrong blackout**
from loop-only text.

Cause: `LOOP_CLOSED` matches `not run through the city loop` but not `no trains through the
city loop`. The weak-alternative guard is only ever as good as `LOOP_CLOSED`'s phrasing
coverage, so every phrasing it misses is a potential blackout rather than a quiet miss.

Fix direction: widen `LOOP_CLOSED`, or invert the relationship so loop-scoped text is
recognised as loop-scoped before the whole-line question is asked at all.

## 3. `"Replacement buses ..."` parses to no disruption at all

`"Replacement buses for trains run direct to Flinders Street."`

→ zero disruptions. `DISRUPTION_KEYWORDS` and `SERVICE_GAP` (`lib/scrape/parse.ts`) match
`bus replacement` but not `replacement buses`. The row is dropped before any loop or section
logic runs. **Silent all-clear.**

Fix direction: add the inverted word order to both gates. Cheap; the reason it wasn't done
during the City Loop work is that the gates predate it and the fix was scoped narrowly.

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
Cheap fix: prefer the focused line's edge in `NetworkMap`'s `handleEdge`.
