# Board and Gantt: move arrows, status via menu

Problem: dropping a dragged row on a row did nothing (Gantt) or hit an 8 px gap (Board). Dragging to the top status strip is hard on a laptop touchpad.

Owner decisions (2026-10-30):
- Reorder uses up/down arrow buttons on each row (Board and Gantt). They send the same `drop` message with zone `move` as Alt+Up/Alt+Down. Same rules as today: group listed by hand, one project, saved with Undo.
- Status changes use the row kebab menu (already offers every status). No new drag target for status.
- Dropping on a Board row counts as a drop in the nearest gap (done, uncommitted, boardHtmlDrag.ts zoneOf).

Queued after the arrows build (owner decision 2026-10-30):
- Left/right arrow buttons on each row, plus Alt+Left / Alt+Right.
  - Right: this row waits on the row above it (existing Waits on write, with Undo).
  - Left: the row above waits on this row.
  - Refused with a message on a cycle, a duplicate link or a document that cannot hold needs (existing planDrop "waits" rules).
