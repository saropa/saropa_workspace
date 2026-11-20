# Remote branch cleanup

Status: checked 2026-10-27 19:30 against GitHub. The cloud session cannot delete remote branches, so the owner runs the commands below in a terminal.

Rule used: a branch is listed for deletion only when its pull request is merged, or it has no commits that main lacks. Branches with an open pull request or unmerged work are in the keep table.

## Delete (merged, safe)

| Repo | Branch | Why |
|---|---|---|
| saropa_workspace | `hand-to-chat-agent` | pull request 52 merged |
| saropa_workspace | `quality-tests-hosts` | pull request 53 merged |
| saropa_workspace | `release-board-polish` | pull request 54 merged |
| saropa_workspace | `quality-tests-webscripts` | pull request 55 merged |
| claude-chat-explorer | `public-api-chats-for-file` | pull request 4 merged |
| web.app | `claude/project-thread-qlfv9x` | pull request 112 merged |
| web.app | `claude/practical-goldberg-t8e10k` | pull requests 110 and 111 merged |
| web.app | `claude/seo-aso-improvements` | pull request 107 merged |
| contacts | `claude/exciting-hamilton-0mtlz0` | no commits that main lacks |

## Keep (do not delete without a decision)

| Repo | Branch | Why |
|---|---|---|
| contacts | `claude/nifty-goldberg-4f1zgq` | 8 commits main lacks (production schema export script and privacy plan fixes); no pull request found |
| web.app | `claude/optimistic-heisenberg-qa3zcc` | no pull request found |
| web.app | `pro/country-ties`, `pro/language-rule`, `pro/timezone-picker-free` | pull requests 98 to 100 were closed without merging |
| saropa-log-capture, saropa_drift_advisor, claude-chat-explorer | `dependabot/...` | each has an open dependency pull request |
| all repos | `main` | default branch |

saropa-supabase and saropa_lints have only `main`.

## Commands

Run each block in a terminal. Dry run first: it prints what would be deleted and changes nothing.

```
git push origin --delete --dry-run hand-to-chat-agent quality-tests-hosts release-board-polish quality-tests-webscripts
```

Run inside a clone of `saropa/saropa_workspace`. Then the same line without `--dry-run`:

```
git push origin --delete hand-to-chat-agent quality-tests-hosts release-board-polish quality-tests-webscripts
```

In a clone of `saropa/claude-chat-explorer`:

```
git push origin --delete public-api-chats-for-file
```

In a clone of `saropa/web.app`:

```
git push origin --delete claude/project-thread-qlfv9x claude/practical-goldberg-t8e10k claude/seo-aso-improvements
```

In a clone of `saropa/contacts`:

```
git push origin --delete claude/exciting-hamilton-0mtlz0
```

If the GitHub command line tool is installed, this deletes without a clone:

```
gh api -X DELETE repos/saropa/saropa_workspace/git/refs/heads/hand-to-chat-agent
gh api -X DELETE repos/saropa/saropa_workspace/git/refs/heads/quality-tests-hosts
gh api -X DELETE repos/saropa/saropa_workspace/git/refs/heads/release-board-polish
gh api -X DELETE repos/saropa/saropa_workspace/git/refs/heads/quality-tests-webscripts
```

## Stop it happening again

Turn on "Automatically delete head branches" in each repo: GitHub repo Settings, General, Pull Requests. Merged branches then delete themselves.

## Still to add after they merge

The severity work in progress uses `release-board-severity-edit` and `release-board-keyword-editor` in `saropa_workspace`. Add both to the delete list once their pull requests are merged.
