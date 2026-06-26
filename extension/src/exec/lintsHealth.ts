import * as vscode from "vscode";
import { l10n } from "../i18n/l10n";

// Saropa Lints health-score read (recipe book #26, #36-40). The suite already offers
// shortcuts that RUN the linter and open its dashboards; this reads the Lints extension's
// PUBLIC API directly to surface the exact 0-100 Code Health score the Lints status
// bar shows — no shell, no report file to open — and reports it as a toast with the
// severity breakdown and a one-click path to the full dashboard.
//
// The API exposes the inputs (the violations data + the score parameters), not the
// computed score, so the formula is replicated here from the Lints source
// (extension/src/healthScore.ts) and kept in sync by this comment. Replicating is the
// only path the API offers; it degrades gracefully (a "score unavailable" message)
// if the shape ever drifts.

const LINTS_EXT = "saropa.saropa-lints";

// The slice of the Lints public API this consumer needs. Mirrors SaropaLintsApi in
// the Lints extension; only the members read here are typed.
interface SaropaLintsApi {
  getViolationsData(): ViolationsData | null;
  getHealthScoreParams(): HealthScoreParams | null;
  runAnalysis(): Promise<boolean>;
}

interface HealthScoreParams {
  impactWeights: Record<string, number>;
  decayRate: number;
}

interface ViolationsData {
  summary?: {
    filesAnalyzed?: number;
    filesExpected?: number;
    totalViolations?: number;
    byImpact?: { error?: number; warning?: number; info?: number };
    bySeverity?: { error?: number; warning?: number; info?: number };
  };
}

// Mirrors MIN_COVERAGE_FOR_SCORE in the Lints healthScore.ts: below this fraction of
// the project analyzed, the report is a partial sweep and a score from it would be a
// misleading false-low, so none is shown. Not exposed by getHealthScoreParams(), so
// it is duplicated here with this provenance note.
const MIN_COVERAGE_FOR_SCORE = 0.15;

interface HealthScore {
  score: number;
  errors: number;
  warnings: number;
  infos: number;
  filesAnalyzed: number;
}

// Resolve the Lints extension's exported API, activating it first (exports are only
// populated after activation). Returns undefined when the extension is not installed.
async function getLintsApi(): Promise<SaropaLintsApi | undefined> {
  const ext = vscode.extensions.getExtension<SaropaLintsApi>(LINTS_EXT);
  if (!ext) {
    return undefined;
  }
  const api = ext.isActive ? ext.exports : await ext.activate();
  return api ?? undefined;
}

// Compute the 0-100 health score from the violations data + parameters, replicating
// computeHealthScore from the Lints source: weighted severity density with
// exponential decay. Returns null when there is no summary, nothing was analyzed, or
// the report covers too small a slice of the project to trust (the partial-sweep
// guard) — the same conditions under which the Lints status bar shows no score.
function computeScore(
  data: ViolationsData,
  params: HealthScoreParams
): HealthScore | null {
  const summary = data.summary;
  if (!summary) {
    return null;
  }
  const filesAnalyzed = summary.filesAnalyzed ?? 0;
  if (filesAnalyzed === 0) {
    return null;
  }
  // Partial-sweep guard: an incremental IDE sweep over a handful of files inflates
  // density and craters the score to a false low. Only gate when the report carries
  // a coverage signal (filesExpected); older reports without it are trusted.
  const expected = summary.filesExpected ?? 0;
  if (expected > 0 && filesAnalyzed < expected * MIN_COVERAGE_FOR_SCORE) {
    return null;
  }

  // byImpact is the score input in the Lints source; fall back to bySeverity for a
  // report shape that only carries that.
  const counts = summary.byImpact ?? summary.bySeverity ?? {};
  const errors = safeNum(counts.error);
  const warnings = safeNum(counts.warning);
  const infos = safeNum(counts.info);

  const wError = params.impactWeights.error ?? 8;
  const wWarning = params.impactWeights.warning ?? 3;
  const wInfo = params.impactWeights.info ?? 0.25;
  const weighted = errors * wError + warnings * wWarning + infos * wInfo;
  const density = weighted / filesAnalyzed;
  const raw = Math.round(100 * Math.exp(-density * params.decayRate));
  const score = Number.isFinite(raw) ? raw : 0;
  return { score, errors, warnings, infos, filesAnalyzed };
}

function safeNum(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// The score band, matching the Lints scoreColorBand thresholds, used to label the
// toast ("good shape" / "needs work" / "serious problems").
function bandLabel(score: number): string {
  if (score >= 80) {
    return l10n("lints.band.good");
  }
  if (score >= 50) {
    return l10n("lints.band.fair");
  }
  return l10n("lints.band.poor");
}

// Read and report the Saropa Lints health score. Degrades through every failure mode
// with a useful next step: no extension -> say so; no data yet -> offer to run the
// analysis that produces it; partial sweep -> say the score is withheld and why.
export async function showLintsHealthScore(): Promise<void> {
  const api = await getLintsApi();
  if (!api) {
    vscode.window.showInformationMessage(l10n("lints.notInstalled"));
    return;
  }

  let data = api.getViolationsData();
  const params = api.getHealthScoreParams();
  if (!data || !params) {
    // No analysis has been written yet (or the API could not read it). Offer to run
    // the analysis that produces the data, then read again — the one useful action.
    const run = l10n("lints.runAnalysis");
    const choice = await vscode.window.showInformationMessage(
      l10n("lints.noData"),
      run
    );
    if (choice !== run) {
      return;
    }
    const ok = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: l10n("lints.analyzing") },
      () => api.runAnalysis()
    );
    if (!ok) {
      vscode.window.showWarningMessage(l10n("lints.analysisFailed"));
      return;
    }
    data = api.getViolationsData();
    if (!data) {
      vscode.window.showWarningMessage(l10n("lints.stillNoData"));
      return;
    }
  }

  const health = params ? computeScore(data, params) : null;
  if (!health) {
    // Data exists but no trustworthy score (no summary, nothing analyzed, or a
    // partial sweep) — name why rather than print a misleading number.
    vscode.window.showInformationMessage(l10n("lints.scoreUnavailable"));
    return;
  }

  const openDashboard = l10n("lints.openDashboard");
  const choice = await vscode.window.showInformationMessage(
    l10n("lints.score", {
      score: health.score,
      band: bandLabel(health.score),
      errors: health.errors,
      warnings: health.warnings,
      infos: health.infos,
      files: health.filesAnalyzed,
    }),
    openDashboard
  );
  if (choice === openDashboard) {
    // The Code Health (project vibrancy) dashboard is the full picture behind the
    // number; degrade quietly if the command is unavailable (older Lints build).
    try {
      await vscode.commands.executeCommand(
        "saropaLints.openProjectVibrancyReport"
      );
    } catch {
      // The command not existing is not worth a second error toast.
    }
  }
}
