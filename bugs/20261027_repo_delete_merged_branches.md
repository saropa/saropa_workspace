# Delete merged branches on GitHub

Status: needs the owner. The session cannot delete remote branches.

All pull requests for these branches are merged. Nothing is open. Each branch can be deleted.

Branches:
- claude/release-board-build-approach
- claude/release-board-groups
- claude/release-board-plan
- claude/release-board-plan-fixes
- rb-step0-stub
- rb-step1-engine
- rb-step1-fixes
- rb-step2-screen
- rb-step3-facts
- rb-step4-links
- rb-step5-severity
- rb-step6-health
- rb-step7-marks
- rb-step8-speed

Command:

```
git push origin --delete claude/release-board-build-approach claude/release-board-groups claude/release-board-plan claude/release-board-plan-fixes rb-step0-stub rb-step1-engine rb-step1-fixes rb-step2-screen rb-step3-facts rb-step4-links rb-step5-severity rb-step6-health rb-step7-marks rb-step8-speed
```
