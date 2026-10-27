import { BoardStrings } from "../board/boardHtml";
import { l10n } from "../i18n/l10n";
import { readHandSettings } from "../commands/boardHandToChat";

// The localized strings the board page is drawn with.
// Headings, buttons and the light.
function coreStrings() {
  return {
    title: l10n("releaseBoard.panel.title"),
    intro: l10n("releaseBoard.panel.intro"),
    noGo: l10n("releaseBoard.panel.noGo"),
    unverified: l10n("releaseBoard.panel.unverified"),
    resolveNow: l10n("releaseBoard.panel.resolveNow"),
    workOn: l10n("releaseBoard.panel.workOn"),
    inProgress: l10n("releaseBoard.panel.inProgress"),
    nothingHere: l10n("releaseBoard.panel.nothingHere"),
    more: l10n("releaseBoard.panel.more", { count: "{count}" }),
    blocked: l10n("releaseBoard.panel.blocked", { count: "{count}" }),
    refresh: l10n("releaseBoard.panel.refresh"),
    accept: l10n("releaseBoard.accept"),
    safetyHold: l10n("releaseBoard.panel.safetyHold"),
    baseline: l10n("releaseBoard.panel.baseline"),
    reasonBaseline: l10n("releaseBoard.panel.reasonBaseline"),
    reasonGrey: l10n("releaseBoard.panel.reasonGrey", { count: "{count}" }),
    reasonHealth: l10n("releaseBoard.panel.reasonHealth"),
    reasonUnread: l10n("releaseBoard.panel.reasonUnread"),
    go: l10n("releaseBoard.panel.go"),
    healthLint: l10n("releaseBoard.panel.healthLint"),
    healthTests: l10n("releaseBoard.panel.healthTests"),
    healthBuild: l10n("releaseBoard.panel.healthBuild"),
    allClear: l10n("releaseBoard.panel.allClear"),
  };
}

// Profiles, suggestions, flags and loading text.
function sectionStrings() {
  return {
    dependsOn: l10n("releaseBoard.panel.dependsOn"),
    linkedHeading: l10n("releaseBoard.panel.linkedHeading"),
    linkedNote: l10n("releaseBoard.panel.linkedNote"),
    flagsHeading: l10n("releaseBoard.panel.flagsHeading"),
    flagsNote: l10n("releaseBoard.panel.flagsNote"),
    hub: l10n("releaseBoard.panel.hub"),
    profileLabel: l10n("releaseBoard.panel.profileLabel"),
    profileRush: l10n("releaseBoard.panel.profileRush"),
    profileDeliberate: l10n("releaseBoard.panel.profileDeliberate"),
    profileZero: l10n("releaseBoard.panel.profileZero"),
    severityNames: l10n("releaseBoard.panel.severityNames"),
    proOnly: l10n("releaseBoard.panel.proOnly"),
    pinned: l10n("releaseBoard.panel.pinned"),
    needsRuleHeading: l10n("releaseBoard.panel.needsRuleHeading"),
    suggestHeading: l10n("releaseBoard.panel.suggestHeading"),
    suggestNote: l10n("releaseBoard.panel.suggestNote"),
    suggestAccept: l10n("releaseBoard.panel.suggestAccept"),
    suggestReject: l10n("releaseBoard.panel.suggestReject"),
    needsRuleNote: l10n("releaseBoard.panel.needsRuleNote"),
    loading: l10n("releaseBoard.panel.loading"),
    refreshing: l10n("releaseBoard.panel.refreshing"),
    chatsTitle: l10n("releaseBoard.panel.chatsTitle", { count: "{count}" }),
  };
}

// Path to GO lines and buttons.
function pathStrings() {
  return {
    ptgNone: l10n("releaseBoard.panel.ptgNone"),
    ptgItemRed: l10n("releaseBoard.panel.ptgItemRed"),
    ptgItemPinned: l10n("releaseBoard.panel.ptgItemPinned"),
    ptgItemSeverity: l10n("releaseBoard.panel.ptgItemSeverity"),
    ptgUnblocks: l10n("releaseBoard.panel.ptgUnblocks"),
    ptgWaiter: l10n("releaseBoard.panel.ptgWaiter"),
    ptgItemFirst: l10n("releaseBoard.panel.ptgItemFirst"),
    ptgItemFirstAny: l10n("releaseBoard.panel.ptgItemFirstAny"),
    ptgBlocked: l10n("releaseBoard.panel.ptgBlocked"),
    ptgLintMissing: l10n("releaseBoard.panel.ptgLintMissing"),
    ptgLintFailing: l10n("releaseBoard.panel.ptgLintFailing"),
    ptgTestsMissing: l10n("releaseBoard.panel.ptgTestsMissing"),
    ptgTestsFailing: l10n("releaseBoard.panel.ptgTestsFailing"),
    ptgBuildFailing: l10n("releaseBoard.panel.ptgBuildFailing"),
    ptgFeedOff: l10n("releaseBoard.panel.ptgFeedOff", { what: "{what}" }),
    ptgFeedChecking: l10n("releaseBoard.panel.ptgFeedChecking", { what: "{what}" }),
    ptgFeedWaiting: l10n("releaseBoard.panel.ptgFeedWaiting", { what: "{what}" }),
    ptgFeedFailed: l10n("releaseBoard.panel.ptgFeedFailed", { what: "{what}", reason: "{reason}" }),
    feedWhatBuild: l10n("releaseBoard.panel.feedWhatBuild"),
    feedWhatLint: l10n("releaseBoard.panel.feedWhatLint"),
    feedWhatTests: l10n("releaseBoard.panel.feedWhatTests"),
    ptgEnable: l10n("releaseBoard.panel.ptgEnable"),
    ptgRules: l10n("releaseBoard.panel.ptgRules"),
    ptgRulesAny: l10n("releaseBoard.panel.ptgRulesAny"),
    ptgUnread: l10n("releaseBoard.panel.ptgUnread"),
    ptgAccept: l10n("releaseBoard.panel.ptgAccept"),
    ptgMore: l10n("releaseBoard.panel.ptgMore"),
    ptgOpen: l10n("releaseBoard.panel.ptgOpen"),
    ptgRunLint: l10n("releaseBoard.panel.ptgRunLint"),
    ptgRunTests: l10n("releaseBoard.panel.ptgRunTests"),
    ptgOpenRules: l10n("releaseBoard.panel.ptgOpenRules"),
    ptgAcceptBtn: l10n("releaseBoard.panel.ptgAcceptBtn"),
  };
}

// Sittings picker and its step times.
function sittingsStrings() {
  return {
    sittingsButton: l10n("releaseBoard.sittings.button"),
    sittingsHeading: l10n("releaseBoard.sittings.heading"),
    sittingsPick: l10n("releaseBoard.sittings.pick"),
    sittingsNone: l10n("releaseBoard.sittings.none"),
    sittingsMore: l10n("releaseBoard.sittings.more", { count: "{count}" }),
    sittingsNeedOther: l10n("releaseBoard.sittings.needOther", { count: "{count}" }),
    sittingsTooLong: l10n("releaseBoard.sittings.tooLong", { count: "{count}" }),
    sittingsUntagged: l10n("releaseBoard.sittings.untagged", { count: "{count}" }),
    sittingsUntaggedNote: l10n("releaseBoard.sittings.untaggedNote"),
    timeAny: l10n("releaseBoard.sittings.timeAny"),
    timeMinutes: l10n("releaseBoard.sittings.timeMinutes", { count: "{count}" }),
    stepMinutes: l10n("releaseBoard.sittings.stepMinutes", { count: "{count}" }),
  };
}

// Hand to chat, Tidy and train text.
function toolStrings() {
  return {
    handToChat: readHandSettings().enabled ? l10n("releaseBoard.handToChat.button") : "",
    handToChatTip: l10n("releaseBoard.handToChat.tip"),
    tidyHeading: l10n("releaseBoard.tidy.heading"),
    tidyNote: l10n("releaseBoard.tidy.note", { days: "{days}" }),
    tidyDetail: l10n("releaseBoard.tidy.detail", { count: "{count}", days: "{days}" }),
    tidyTitle: l10n("releaseBoard.tidy.title", { count: "{count}" }),
    tidyMove: l10n("releaseBoard.tidy.move"),
    trainTitle: l10n("releaseBoard.train.title", { name: "{name}" }),
    trainHeldBy: l10n("releaseBoard.train.heldBy", { names: "{names}" }),
    trainCycle: l10n("releaseBoard.train.cycle"),
    trainOrder: l10n("releaseBoard.train.order"),
    tidyMore: l10n("releaseBoard.tidy.more", { count: "{count}" }),
  };
}

// Live evidence text.
function liveStrings() {
  return {
    liveHead: l10n("releaseBoard.live.head"),
    liveProblems: l10n("releaseBoard.live.problems", { errors: "{errors}", warnings: "{warnings}" }),
    liveLints: l10n("releaseBoard.live.lints", { errors: "{errors}", warnings: "{warnings}" }),
    liveLogs: l10n("releaseBoard.live.logs", { errors: "{errors}", crashes: "{crashes}" }),
    liveMore: l10n("releaseBoard.live.more", { count: "{count}" }),
    liveUnnamedHeading: l10n("releaseBoard.live.unnamedHeading"),
    liveUnnamedNote: l10n("releaseBoard.live.unnamedNote"),
    liveUnnamedStart: l10n("releaseBoard.live.start"),
  };
}

// All page strings, merged from the groups above.
export function strings(): BoardStrings {
  return {
    ...coreStrings(),
    ...sectionStrings(),
    ...pathStrings(),
    ...sittingsStrings(),
    ...toolStrings(),
    ...liveStrings(),
  };
}
