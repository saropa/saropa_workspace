# Changelog backlinks to saropa.com

The changelog and the extension manifest carried no link to the Saropa developer pages, so every mirrored copy of the release history competed with the saropa.com original instead of pointing at it. The defect is recorded in [docs_changelog_no_backlink_to_saropa_com.md](docs_changelog_no_backlink_to_saropa_com.md).

## Finish Report (2026-11-27)

### What changed

- The extension manifest gained `"homepage": "https://saropa.com/developers/"`; `repository` is unchanged.
- `CHANGELOG.md` gained a "Full release history" header line, a saropa.com link after each release's `[log]` link, matching maintenance notes and an entry under 2.13.0. `CHANGELOG_HISTORY.md` gained the same per-release links.
- The link logic lives in `scripts/modules/_changelog_links.py`. The saropa.com address depends only on the major version: the current major uses the main changelog page and an older major N uses its `N.x/` page, whichever file holds the entry.
- The publish script's version step rewrites links after the version is settled: both links of the released entry (covering the `[Unreleased]` rename and the tag-clash bump) and the saropa.com link of every other entry in both changelog files (covering a new major). It then validates the result and stops the publish if the released overview or any saropa.com link is wrong. A consequence is that an `[Unreleased]` section without a summary line and both links now stops the publish.
- The pre-publish audit requires the top release's saropa.com link and warns about stale links in older entries. The warning does not block because the audit runs before the version step that repairs them.
- `CHANGELOG_HISTORY.md` carried two `1.5.18` headings. The second is 1.5.17, as its `[log]` link and the changelog at tag `v1.5.17` show, and its heading and anchor were corrected. The changelog at tag `v1.5.18` lists the same notes under 1.5.18.
- The 1.5.15 `[log]` link pointed at `main` and now points at tag `v1.5.15`.

### Tests

New tests are in `scripts/tests/test_changelog_links.py`. Results on 2026-11-27:

- `test_changelog_links`: 9 passed.
- `test_publish_pipeline`: 17 passed.
- `test_workflow`: 4 passed.
- `test_git_ops`: 9 passed.

A read-only run of the full-mode audit reported no blocking failures, with the existing warning that the 2.13.0 overview may be stale. No extension (TypeScript) tests were run, and no publish was run.

### Outstanding

- The changelog pages at `https://saropa.com/developers/saropa-workspace/changelog/` returned 404 when the links shipped, so the links do not resolve until those pages are published.
- The manifest homepage becomes visible on the Marketplace only after the next publish.
- The optional decision to keep archived releases only on saropa.com has not been taken.
- The bug is marked fixed and archived beside this report; the items above remain outstanding.
