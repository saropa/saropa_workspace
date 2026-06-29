# README screenshot

The README Screenshots section carried a "Screenshots are coming" placeholder
even though a screenshot asset existed in the repo. The section is now populated
with the actual screenshot so the Marketplace listing and GitHub README show the
product instead of a deferral note.

## Finish Report (2026-06-28)

### Scope

Docs only. Two authored files changed plus one new image asset:

- `README.md` — Screenshots section.
- `CHANGELOG.md` — Unreleased entry.
- `images/screenshot.png` — new asset (previously untracked).

### Change

The Screenshots section placeholder ("Screenshots are coming. In the meantime,
the Getting Started steps below walk through the full workflow.") was replaced
with an embedded image of the sidebar and launcher. The image is referenced by
an absolute raw GitHub URL
(`https://raw.githubusercontent.com/saropa/saropa_workspace/main/images/screenshot.png`)
rather than a repo-relative path, matching the existing banner convention so the
image renders on the VS Code Marketplace, which does not resolve relative image
links. The image is centered in a `<div align="center">` block and carries
descriptive alt text ("Saropa Workspace sidebar and launcher").

A comment above the markup records why the absolute URL is required, mirroring
the banner's comment so a future editor does not "fix" it to a relative path and
silently break Marketplace rendering.

### Notes

- The generated `extension/README.md` copy is rewritten from this root file by
  `scripts/publish.py` (`sync_extension_docs`) at package time, so the screenshot
  propagates to the packaged extension without a manual edit.
- The raw URL points at the `main` branch, so the image resolves only after the
  asset is committed and pushed to `main`. Until then the Marketplace/GitHub
  render is a broken-image link.
