# Future tab: deferred work, flagged by importance, with parallel research

Status: design only. Nothing in this document is built.

## 1. What the user gets

- A tab named "Future" on the Release Board.
- It lists every deferred item from every project root in one place.
- Items never count as problems. They never change a light.
- Each item shows a flag saying how important it is.
- Each item can also carry a research flag. A flagged item is picked up by an AI helper, which updates the document while the user does other work.

## 2. The importance flag

The user sets one flag per document. It is written at the top of the document, so it travels with the file and works in any project.

| Flag | Meaning | Where the document lives |
|---|---|---|
| Build next | Decided. First in the queue | `deferred/` |
| Marketable | Worth building because users would notice or it helps the store listing | `deferred/` |
| Nice to have | Good, no urgency | `deferred/` |
| Needs a decision | More information is needed before anyone can decide | `deferred/` |
| Not feasible | Blocked by a platform limit or a reason that will not change soon | `blocked/` |

- "Not feasible" documents are the blocked folder. The tab reads that folder too, shows those items last, and shows the blocker in one line.
- When the blocker clears, the user changes the flag and the document moves back to `deferred/`.
- Changing a flag in the tab moves the file only after the user confirms. The board never moves a file on its own.
- Order within a flag: the score in section 4.
- No flag set: the item shows as "Unflagged" at the top, so it is not forgotten. The board proposes a flag, marked "guessed".

## 3. The research flag

- A second, separate flag: "Research needed".
- The user can set it on any document, whatever its importance flag.
- States: needs research, being researched, research ready, reviewed.
- The tab shows a count of documents waiting for research, and a "Hand all to Claude" button. It opens the chat with one prompt per document.
- Each prompt carries the document, the question to answer, and the rules for the result.
- The AI helper may only do the following:
  - add a dated "Research" section to the document
  - cite its sources
  - say what it could not confirm
  - set the state to "research ready"
- It never changes the importance flag, never deletes text, never builds anything.
- The user reviews the added section, then sets "reviewed". Until then the tab shows "research ready, not reviewed".
- Research on several documents can run in parallel. One helper per document, up to a limit. Setting, default 3.
- Each research request names the question. Examples: "Is this still possible on current VS Code?", "What do competing extensions do?", "What would this cost to build?"
- This reuses the existing "Hand to chat" feature. It adds no new connection.

## 4. Other characteristics

Used to order items inside each importance flag. Read from a block at the top of each document. If the block is missing, the board proposes values marked "guessed".

| Characteristic | Values |
|---|---|
| Wow | 1 to 5: how much a user would notice and enjoy it |
| Reach | daily, weekly, rare |
| Effort | S, M, L, XL |
| Risk | low, medium, high: destructive actions, data loss, shared code |
| Free line | free, or a paid add-on that leaves the free base working |

Default order: Wow and Reach, divided by Effort; lower risk first on ties. The user can sort by Wow, Effort, Risk or Reach instead.

## 5. Document block

Each deferred document starts with a short block the board reads:

```
Importance: build-next | marketable | nice-to-have | needs-decision | not-feasible
Research: none | needed | in-progress | ready | reviewed
Research question: one line, up to 300 characters
Wow: 1-5
Reach: daily | weekly | rare
Effort: S | M | L | XL
Risk: low | medium | high
Blocker: one line, only for not-feasible
```

- The board shows an edit control for each field in the tab. It writes this block and nothing else in the document.
- A document without the block is still listed.

## 6. Where items come from

- `plans/deferred/` and `plans/blocked/`, and `docs/deferred/<area>/` and `docs/blocked/` in projects that use that layout.
- The Later and Exploratory sections of `ROADMAP.md`.
- Items in the master plan marked not started.
- The "Not built or not verified" section of any plan.
- Items found outside a deferred folder are listed with their source. Flagging one offers to move it into `deferred/`, after confirmation.

## 7. Current deferred items, with proposed flags (guessed, not owner-confirmed)

| Item | Proposed flag | Research |
|---|---|---|
| Recipes feeding the board | Build next | none |
| Status bar quick-run for the top shortcut | Marketable | none |
| Onboarding wizard for first install | Marketable | none |
| Shortcut usage shown in the sidebar | Nice to have | none |
| Quick-add from recent files | Nice to have | none |
| Notes tags, pin to top, sort, search across projects | Nice to have | none |
| Group shortcuts by folder in multi-root | Nice to have | none |
| Pin badge trend sparkline | Needs a decision | needed: is the hover delta enough |
| Linux terminal choice | Nice to have | none |
| Git conflict command center | Needs a decision | needed: risk review of the destructive macro |
| Run rollback, "Revert Last Run" | Needs a decision | needed: risk review |
| GitHub review-requested list | Needs a decision | needed: does the token scope cover it |
| Chat Explorer lookup | Build next, once that extension's release has the API | needed: confirm the release |
| Crash signals from Log Capture | Needs a decision | needed: that extension's API is not built |
| Haptic cues | Not feasible | blocker: no editor API for haptics |
| HUD Launcher desktop app | Needs a decision | needed: separate product, cost and market check |

## 8. Build order

1. Reader: finds deferred and blocked documents and the not-started items. Reads and writes the block.
2. The tab with importance flags, sort orders, and the guessed marking.
3. The blocked folder shown as "Not feasible", with the move-on-confirm action.
4. The research flag, its states, the count and the "Hand all to Claude" button, using Hand to chat.
5. The research result review step.

Each step: Opus reviews the design, Sonnet builds, Opus reviews the diff. Every setting has a default. The tab is visible with no clicks once any deferred document exists.

## Wave 2 status

- Built: the research states and question in the block, the count, "Research ready, not reviewed", Hand all to chat (one prompt per document, handed one after another because Hand to chat copies a single prompt at a time; a document becomes in-progress only after the paste is confirmed), Mark reviewed (after a confirmation).
- Setting: `releaseBoard.future.researchParallel` (default 3, 1 to 10).
