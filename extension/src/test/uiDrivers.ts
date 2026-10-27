// Scripted answers for the menus and prompts of the configure commands, so a test can
// say "pick Save" or "type 09:30" and read back what each prompt offered.

import {
  __setInputHandler,
  __setPickHandler,
  __setQuickPickDriver,
  type FakeQuickPick,
} from "./_stub/vscode";

/** One row of a hub menu: the fields the tests read. */
export interface HubRow {
  readonly id?: string;
  readonly act?: string;
  readonly index?: number;
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly kind?: number;
}

/** What one showing of the hub offered. */
export interface HubShowing {
  readonly rows: readonly HubRow[];
  readonly title: string | undefined;
  readonly placeholder: string | undefined;
  /** The `id` or `act` of the row that started active, if any. */
  readonly active: string | undefined;
}

/** Answers a row of a hub: its id, or a matcher over the row. Undefined presses Esc. */
export type HubAnswer = string | ((row: HubRow) => boolean) | undefined;

const keyOf = (row: HubRow | undefined): string | undefined => row?.id ?? row?.act;

/**
 * Answers the hub menus in order. A string answer picks the row whose id or act equals
 * it; a function picks the first row it accepts; running out of answers presses Esc.
 * Returns the log of what each showing offered.
 */
export function driveHub(...answers: HubAnswer[]): HubShowing[] {
  const showings: HubShowing[] = [];
  let n = 0;
  __setQuickPickDriver((pick: FakeQuickPick) => {
    const rows = pick.items as HubRow[];
    showings.push({
      rows,
      title: pick.title,
      placeholder: pick.placeholder,
      active: keyOf(pick.activeItems[0] as HubRow | undefined),
    });
    const answer = answers[n++];
    if (answer === undefined) {
      pick.hide();
      return;
    }
    const match =
      typeof answer === "string"
        ? (r: HubRow): boolean => keyOf(r) === answer
        : answer;
    const row = rows.find((r) => r.kind !== -1 && match(r));
    if (!row) {
      throw new Error(`hub answer ${n} matched no row`);
    }
    pick.accept(row);
  });
  return showings;
}

/** A row offered by a pick prompt. */
export type PickRow = { readonly label: string } & Record<string, unknown>;

/** What one pick prompt offered, and the options it was opened with. */
export interface PickShowing {
  readonly rows: readonly PickRow[];
  readonly options: Record<string, unknown>;
}

/**
 * Answers the pick prompts in order. A string picks the row with that label; an array
 * picks several rows (multi-select); undefined cancels. Returns the log of the showings.
 */
export function drivePicks(...answers: Array<string | string[] | undefined>): PickShowing[] {
  const showings: PickShowing[] = [];
  let n = 0;
  __setPickHandler(async (items, options) => {
    const rows = items as PickRow[];
    showings.push({ rows, options: (options ?? {}) as Record<string, unknown> });
    const answer = answers[n++];
    if (answer === undefined) {
      return undefined;
    }
    const find = (label: string): PickRow => {
      const row = rows.find((r) => r.label === label);
      if (!row) {
        throw new Error(`pick ${n} has no row labeled ${label}`);
      }
      return row;
    };
    return Array.isArray(answer) ? answer.map(find) : find(answer);
  });
  return showings;
}

/** What one input prompt was opened with. */
export interface InputShowing {
  readonly prompt?: string;
  readonly value?: string;
  readonly title?: string;
  readonly placeHolder?: string;
  readonly validateInput?: (value: string) => string | undefined;
}

/** Answers the input prompts in order (undefined cancels). Returns the log of the showings. */
export function driveInputs(...values: Array<string | undefined>): InputShowing[] {
  const showings: InputShowing[] = [];
  let n = 0;
  __setInputHandler(async (opts) => {
    showings.push(opts as InputShowing);
    return values[n++];
  });
  return showings;
}
