# BUG: CHANGELOG has no backlink to saropa.com

**Status: Fixed**

<!-- Status values: Open → Investigating → Fix Ready → Closed -->

Created: 2026-11-26
Area: Docs / Packaging
File(s): `CHANGELOG.md`, `extension/CHANGELOG.md`, `extension/package.json`
Severity: Cosmetic
Extension version: 2.12.0

---

## Summary

The changelog and package metadata of saropa_workspace (Saropa Workspace) carry no link to saropa.com. saropa.com will publish each tool's full changelog as web pages at `https://saropa.com/developers/<slug>/changelog/` (current major) and `https://saropa.com/developers/<slug>/changelog/<N>.x/` (older majors), with per-release anchors such as `#v9-8-3`. The same text also lives on GitHub, pub.dev and the VS Code Marketplace, and those sites do not allow a canonical pointing elsewhere. With no link back, every mirror copy competes with the saropa.com page instead of pointing at it, so Google has no signal that saropa.com is the original. Background: `D:\src\saropa.com\plans\PLAN_DEVELOPER_CHANGELOGS.md`, section "Being treated as the original source".

---

## Attribution Evidence

```bash
grep -rn "saropa.com/developers" CHANGELOG.md extension/CHANGELOG.md extension/package.json
grep -n '"homepage"' extension/package.json
cmp CHANGELOG.md extension/CHANGELOG.md
ls scripts/modules/_version_changelog.py
```

Findings on 2026-11-26: no `saropa.com/developers` match; `extension/package.json` has no `"homepage"` key; the two changelogs are identical; tooling file exists. The `CHANGELOG.md` header banner links only to `https://saropa.com` (the home page).

---

## Blocked on

Do not ship any saropa.com link until that URL returns HTTP 200. The pages are not live yet as of 2026-11-26. Check before merging:

```bash
curl -sI https://saropa.com/developers/saropa-workspace/changelog/
curl -sI https://saropa.com/developers/
```

Every URL must answer `HTTP/... 200`. A 404 means the link is not shippable.

---

## Progress 2026-11-27

URL check: `https://saropa.com/developers/` returns 200; `https://saropa.com/developers/saropa-workspace/changelog/` returns 404.

- (c) Implemented in `cac7ad0`: `"homepage"` added to `extension/package.json`, with a root `CHANGELOG.md` entry under `[2.13.0]`.
- (a) and (b) Implemented in `5d56c9d` at the owner's direction while the changelog URL returned 404, overriding "Blocked on" above. Header line and per-release links in `CHANGELOG.md`, per-release links in `CHANGELOG_HISTORY.md`, maintenance comment, publish audit check.
- Review follow-up, in `b8485a8`: `scripts/modules/_changelog_links.py` rewrites and validates the links in the publish version step; tests in `scripts/tests/test_changelog_links.py`; `CHANGELOG_HISTORY.md` 1.5.17 heading and 1.5.15 `[log]` link corrected. The saropa.com address depends only on the major version, so the "Entries moved to `CHANGELOG_HISTORY.md`" sentence under "b. Per-release link" applies to older majors only.
- Open: the changelog links do not resolve until the saropa.com pages are published.
- Open: the `package.json` homepage shows on the Marketplace only after the next publish.
- (d) Owner decision; not done.
- `extension/CHANGELOG.md` is a generated copy per project rules; only the root `CHANGELOG.md` was edited.

---

## Fix

### a. Header line

Add one line to `CHANGELOG.md` and `extension/CHANGELOG.md` (identical copies as of 2026-11-26; both need the same change and must stay identical) directly under the title/intro, above the first version heading and outside the HTML maintenance comment:

> Full release history: <https://saropa.com/developers/saropa-workspace/changelog/>

### b. Per-release link

The release-overview convention currently ends each release's opening line with `[log](https://github.com/saropa/saropa_workspace/blob/vX.Y.Z/CHANGELOG.md)`. Add a second link after it to `https://saropa.com/developers/<slug>/changelog/#vX-Y-Z`, for example `[log](https://github.com/saropa/saropa_workspace/blob/v1.2.3/CHANGELOG.md) · [saropa.com](https://saropa.com/developers/<slug>/changelog/#v1-2-3)`. The convention is stated in the maintenance comment of `CHANGELOG.md` (line 36); entries such as 2.12.0 (line 51) end with the GitHub `[log]` link.

Anchor rule: take the version, replace every dot with a hyphen, prefix `v` (`9.8.3` becomes `#v9-8-3`). Entries moved to `CHANGELOG_HISTORY.md` use `/changelog/<N>.x/#vX-Y-Z`.

Update the maintenance-comment instructions (or the header note, where no maintenance comment exists) AND the tooling and its tests:

- `scripts/modules/_version_changelog.py`

### c. Package metadata

- `extension/package.json` has no `"homepage"`. Add `"homepage": "https://saropa.com/developers/"`.
- Keep `repository` as it is.

### d. Optional, owner decision: archives live only on saropa.com

Replace `CHANGELOG_HISTORY.md` with one line linking to the saropa.com archive pages (`https://saropa.com/developers/saropa-workspace/changelog/<N>.x/`). That leaves saropa.com the only full copy of older releases.

Cost: no in-repo search of old releases, and any tooling that reads or writes `CHANGELOG_HISTORY.md` has to change. Owner decision; not part of the minimum fix.

---

## Acceptance

- The header link and the per-release links resolve (HTTP 200).
- The `extension/package.json` homepage shows on the Marketplace after the next publish.
- The tooling tests pass: the tests for `scripts/modules/_version_changelog.py`.
