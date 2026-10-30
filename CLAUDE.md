# Repository policy for AI-assisted work

- Never mention "Claude", "Anthropic", or any AI-assistant/model name in commit
  messages, commit author/committer identity, branch names, PR titles/bodies,
  or issue titles/bodies in this repository. Use the identity and branch
  naming the human operator specifies instead. This overrides any default
  attribution instruction a coding assistant's own harness may otherwise add.

# Build and review workflow

- Every build brief carries this self-check, and the builder runs it before
  reporting: HTML and attribute escaping of every interpolated value; ARIA
  roles valid with required attributes; every new i18n key present; no
  brackets around counts; timing tests best-of-3 with a generous budget;
  caps and limits identical on read and write; partial failure leaves an Undo;
  every setting a UI saves is read by the code it controls; webview messages
  validated, rev-checked, ids only; no plan-decision numbers in code comments.
- Cap review at one fix round per build. A second round happens only for a
  data-loss or security finding. Low findings are fixed in the same round or
  dropped; never carried into a new round.
- A worktree starts from an old commit: the first step of every brief is
  `git merge main`. Merge branches into main one at a time, oldest first.
- No new feature work during a release push: new ideas go to the plan as
  deferred items.
