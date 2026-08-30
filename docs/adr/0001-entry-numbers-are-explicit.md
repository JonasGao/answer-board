# Entry numbers are explicit, not derived

Entries used to be numbered positionally (Q = start number + index), which kept
numbering always continuous and made a round like Q2, Q4, Q5 — an earlier
question re-asked alongside new ones — impossible to express. Now each entry
stores its own number; the board stays sorted by number, numbers may have gaps,
and deleting an entry leaves the others untouched. The start-number session
state is gone: "next number" is max on board + 1 (1 when empty).

## Considered options

- Positional derivation with per-entry number overrides — the overlay is just
  stored numbers with extra indirection.
- Two-segment model (re-answer segment + continuation segment) — breaks down as
  soon as the re-answered numbers are themselves non-contiguous, collapsing
  into stored numbers anyway.

## Consequences

- Deleting a middle entry leaves a gap instead of shifting later numbers; the
  README previously promised the opposite.
- Add assigns max + 1 (Q1 on an empty board); Relabel lets a single entry take
  an old number mid-round and re-sort into place.
- Renumber takes a whole list of numbers, of which a single number is the
  degenerate case (the old behavior).
