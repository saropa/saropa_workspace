import { l10n } from "../i18n/l10n";

// Why: the list half of the Future tab text (tab, sort, flags, reach, risk) is its own function so each half stays under the 50-line limit.
function futureListStrings(): Record<string, string> {
  return {
    "tab": l10n("releaseBoard.future.tab", { count: "{count}" }),
    "tabBoard": l10n("releaseBoard.future.tabBoard"),
    "heading": l10n("releaseBoard.future.heading"),
    "note": l10n("releaseBoard.future.note"),
    "sort": l10n("releaseBoard.future.sort"),
    "sort.score": l10n("releaseBoard.future.sort.score"),
    "sort.wow": l10n("releaseBoard.future.sort.wow"),
    "sort.effort": l10n("releaseBoard.future.sort.effort"),
    "sort.risk": l10n("releaseBoard.future.sort.risk"),
    "sort.reach": l10n("releaseBoard.future.sort.reach"),
    "flag.unflagged": l10n("releaseBoard.future.flag.unflagged"),
    "flag.build-next": l10n("releaseBoard.future.flag.build-next"),
    "flag.marketable": l10n("releaseBoard.future.flag.marketable"),
    "flag.nice-to-have": l10n("releaseBoard.future.flag.nice-to-have"),
    "flag.needs-decision": l10n("releaseBoard.future.flag.needs-decision"),
    "flag.not-feasible": l10n("releaseBoard.future.flag.not-feasible"),
    "importance": l10n("releaseBoard.future.importance"),
    "wow": l10n("releaseBoard.future.wow"),
    "reach": l10n("releaseBoard.future.reach"),
    "effort": l10n("releaseBoard.future.effort"),
    "risk": l10n("releaseBoard.future.risk"),
    "blocker": l10n("releaseBoard.future.blocker"),
    "reach.daily": l10n("releaseBoard.future.reach.daily"),
    "reach.weekly": l10n("releaseBoard.future.reach.weekly"),
    "reach.rare": l10n("releaseBoard.future.reach.rare"),
    "risk.low": l10n("releaseBoard.future.risk.low"),
    "risk.medium": l10n("releaseBoard.future.risk.medium"),
    "risk.high": l10n("releaseBoard.future.risk.high"),
  };
}

// Why: the edit half of the Future tab text (tips, outside-the-plan, research, hand-off) is its own function so each half stays under the 50-line limit.
function futureEditStrings(): Record<string, string> {
  return {
    "guessedTip": l10n("releaseBoard.future.guessedTip"),
    "acceptTip": l10n("releaseBoard.future.acceptTip"),
    "proposed": l10n("releaseBoard.future.proposed", { flag: "{flag}" }),
    "scoreTip": l10n("releaseBoard.future.scoreTip", { score: "{score}" }),
    "editBlocker": l10n("releaseBoard.future.editBlocker"),
    "noBlocker": l10n("releaseBoard.future.noBlocker"),
    "outsideHeading": l10n("releaseBoard.future.outsideHeading", { count: "{count}" }),
    "outsideNote": l10n("releaseBoard.future.outsideNote"),
    "outsideSource": l10n("releaseBoard.future.outsideSource", { path: "{path}", line: "{line}", why: "{why}" }),
    "why.later": l10n("releaseBoard.future.why.later"),
    "why.exploratory": l10n("releaseBoard.future.why.exploratory"),
    "why.not-started": l10n("releaseBoard.future.why.not-started"),
    "research": l10n("releaseBoard.future.research"),
    "question": l10n("releaseBoard.future.question"),
    "questionHint": l10n("releaseBoard.future.questionHint"),
    "research.none": l10n("releaseBoard.future.research.state.none"),
    "research.needed": l10n("releaseBoard.future.research.state.needed"),
    "research.in-progress": l10n("releaseBoard.future.research.state.in-progress"),
    "research.ready": l10n("releaseBoard.future.research.state.ready"),
    "research.reviewed": l10n("releaseBoard.future.research.state.reviewed"),
    "readyNotReviewed": l10n("releaseBoard.future.readyNotReviewed"),
    "readyTip": l10n("releaseBoard.future.readyTip"),
    "markReviewed": l10n("releaseBoard.future.research.markReviewed"),
    "waiting": l10n("releaseBoard.future.waiting", { count: "{count}" }),
    "inProgressCount": l10n("releaseBoard.future.inProgressCount", { count: "{count}" }),
    "readyCount": l10n("releaseBoard.future.readyCount", { count: "{count}" }),
    "handAll": l10n("releaseBoard.future.handAll", { count: "{count}" }),
    "handBatch": l10n("releaseBoard.future.handBatch", { batch: "{batch}", queued: "{queued}" }),
    "handTip": l10n("releaseBoard.future.handTip"),
  };
}

// Why: the board string table merges this group with the others; it lives in its own module to keep the strings file short.
// Future tab text, keyed by the name the page looks up.
export function futureStrings() {
  return { futureLabels: { ...futureListStrings(), ...futureEditStrings() } as Record<string, string> };
}
