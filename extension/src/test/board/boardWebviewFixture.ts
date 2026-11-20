// Shared setup for the board webview page tests. The board page is one very large script, so the
// tests do not boot the whole page: each page-side module (drag and drop, hand-off drawer, project
// controls, chat controls, the Tags and rules editor) is run alone in the fake DOM, against markup
// built by that module's own renderers. The fixture supplies the few globals the real page script
// declares before these modules run (`vscode`, `REV`, `wired`, ...), as small stand-ins.
//
// Modeled on launcherWebviewFixture.ts, plannerWebviewFixture.ts and dashboardWebviewFixture.ts.

import { strings } from "../../views/boardStrings";
import type { BoardStrings } from "../../board/boardHtmlUtil";
import { FakeDocument, FakeElement, FakeEvent, runPage, type Page, type PageOptions } from "../_stub/fakeDom";

/** The real English strings the host sends, so a label changed in the catalog changes the tests with it. */
export const t: BoardStrings = strings();

/** The revision the stand-in page script carries; every message a page posts must echo it. */
export const REV = 7;

/** A value that would break out of markup, an attribute or a script if it were ever interpolated raw. */
export const EVIL = "<img src=x onerror=\"alert(1)\">&\"'</script><!--";

// The fake DOM has no sibling pointers, no isConnected, no scrollIntoView, no select and no document
// fragment, all of which the board page modules call. They are added once, on the prototypes, and only
// when missing, so a later upgrade of the fake DOM wins and this file stops patching without a change.
function patchFakeDom(): void {
  const proto = FakeElement.prototype as unknown as Record<string, unknown>;
  const sibling = (offset: number) => function (this: FakeElement): FakeElement | null {
    const list = this.parentNode?.children ?? [];
    return list[list.indexOf(this) + offset] ?? null;
  };
  const getters: Record<string, () => unknown> = {
    previousElementSibling: () => sibling(-1),
    nextElementSibling: () => sibling(1),
  };
  for (const [name, make] of Object.entries(getters)) {
    if (!(name in proto)) {
      Object.defineProperty(proto, name, { configurable: true, get: make() as (this: FakeElement) => unknown });
    }
  }
  if (!("isConnected" in proto)) {
    // Connected means the parent chain ends at the document node, as in a browser.
    Object.defineProperty(proto, "isConnected", {
      configurable: true,
      get(this: FakeElement): boolean {
        for (let n: FakeElement | null = this; n; n = n.parentNode) {
          if (n instanceof FakeDocument) {
            return true;
          }
        }
        return false;
      },
    });
  }
  for (const noop of ["scrollIntoView", "select"]) {
    if (!(noop in proto)) {
      proto[noop] = (): void => undefined;
    }
  }
  const doc = FakeDocument.prototype as unknown as Record<string, unknown>;
  if (!("createDocumentFragment" in doc)) {
    // A plain wrapper stands in for a fragment: text and element content are what the tests read.
    doc.createDocumentFragment = function (this: FakeDocument): FakeElement {
      return this.createElement("div");
    };
  }
}
patchFakeDom();

// The globals the board page script declares before the page-side modules run. Each is the smallest
// stand-in that keeps the module's own logic real: `sitSend` and `showTab` only record their calls,
// `openGroupRows` resolves at once (the rows are already in the page).
const PRELUDE = `
const vscode=acquireVsCodeApi();
const REV=${REV};
const WAITQ=new Map();
const rkey=(g,by,from)=>g+'|'+by+'|'+from;
const openGroupRows=()=>Promise.resolve();
const wired=(sel,fn)=>document.querySelectorAll(sel).forEach(fn);
const SIT={all:['a','b']};
const SITCALLS=[];
const sitSend=o=>{SITCALLS.push(o);};
const SHOWTAB=[];
const showTab=n=>{SHOWTAB.push(n);};
`;

/**
 * Parses `body` into a page, mirrors every `hidden` attribute onto the `hidden` property (the page
 * scripts read and write the property, the fake DOM only parses the attribute), then runs the
 * prelude. Page scripts are run by the caller with `page.run`, so the script source never goes
 * through the HTML parser.
 */
export function openBoardPage(body: string, options: PageOptions = {}): Page {
  const page = runPage(`<!DOCTYPE html><html><body>${body}</body></html>`, options);
  mirrorBooleanAttributes(page);
  page.run(PRELUDE, "board-prelude.js");
  return page;
}

// The parser keeps `hidden` and `disabled` only as attributes, but the page scripts read and write the
// properties. Without this copy a control that starts disabled would read as enabled until a script first
// touched it, and a click handler would run for a control a user cannot press.
function mirrorBooleanAttributes(page: Page): void {
  for (const el of page.all("[hidden]")) {
    (el as unknown as { hidden: boolean }).hidden = true;
  }
  for (const el of page.all("[disabled]")) {
    el.disabled = true;
  }
}

/**
 * Opens a complete page that carries one inline script (the Tags and rules editor): the markup is parsed
 * without the script, the boolean attributes are mirrored, and only then does the script run, so its first
 * reads see the state the browser would. The page brings its own `vscode` handle, so no prelude is added.
 */
export function openInlineScriptPage(html: string, options: PageOptions = {}): Page {
  const found = /<script nonce="[^"]*">([\s\S]*)<\/script>/.exec(html);
  if (!found) {
    throw new Error("openInlineScriptPage: the page has no nonce script");
  }
  const page = runPage(html.replace(found[0], ""), options);
  mirrorBooleanAttributes(page);
  page.run(found[1], "inline-page.js");
  return page;
}

/** True when the element is hidden by the property a script set, else by its markup attribute. */
export function isHidden(el: FakeElement): boolean {
  const prop = (el as unknown as { hidden?: boolean }).hidden;
  return typeof prop === "boolean" ? prop : el.hasAttribute("hidden");
}

/** A keyboard event with modifier keys, which the typed event init does not list. */
export function keyWith(page: Page, el: FakeElement, key: string, mods: { alt?: boolean; ctrl?: boolean; shift?: boolean; meta?: boolean } = {}): FakeEvent {
  const init = { key, altKey: !!mods.alt, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, metaKey: !!mods.meta };
  return page.fire(el, "keydown", init as unknown as Partial<FakeEvent>);
}

/** The `checked` state a script reads on a checkbox (not part of the fake element's typed surface). */
export const setChecked = (el: FakeElement, on: boolean): void => {
  (el as unknown as { checked: boolean }).checked = on;
};

/** Reads the `checked` property the page scripts set. */
export const isChecked = (el: FakeElement): boolean => (el as unknown as { checked?: boolean }).checked === true;

/** Replaces {name} placeholders the way the catalog's own strings expect. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(String(v)), text);
}

/** Every id attribute in the page, to check that ARIA references point at something real. */
export const ids = (page: Page): string[] => page.all("[id]").map((e) => e.getAttribute("id") ?? "");

/**
 * Checks the ARIA wiring of a fragment: ids are unique, and every aria-labelledby, aria-controls and
 * aria-owns value names an element that exists. Returns the problems found, so a test can assert an
 * empty list and print what is wrong when it is not.
 */
export function ariaProblems(page: Page): string[] {
  const all = ids(page);
  const problems: string[] = [];
  for (const id of new Set(all)) {
    if (all.filter((x) => x === id).length > 1) {
      problems.push(`duplicate id ${id}`);
    }
  }
  for (const attr of ["aria-labelledby", "aria-controls", "aria-owns"]) {
    for (const el of page.all(`[${attr}]`)) {
      for (const ref of (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean)) {
        if (!all.includes(ref)) {
          problems.push(`${attr}="${ref}" on <${el.tag}> has no target`);
        }
      }
    }
  }
  return problems;
}
