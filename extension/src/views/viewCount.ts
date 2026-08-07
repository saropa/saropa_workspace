import * as vscode from "vscode";

/** Any tree-data provider that publishes an item count and fires when it changes. */
export interface CountProvider {
  readonly onDidChangeCount: vscode.Event<number>;
  readonly count: number;
}

// Narrow structural type so callers can pass any TreeView<T> regardless of T.
// TreeView<T> has contravariant methods (reveal), so TreeView<Specific> does not
// assign to TreeView<unknown> in strict mode — but we only touch `description`.
interface HasDescription {
  description?: string | undefined;
}

// Compile-time guard: if a future VS Code release changes the `description`
// property shape on TreeView, tsc will fail here rather than at each call site.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertTreeViewSatisfiesHasDescription = vscode.TreeView<never> extends HasDescription ? true : never;

/** Wires a tree view's description to a provider's item count. Sets the initial value, subscribes to changes, and returns the subscription disposable. */
export function syncViewCount(
  view: HasDescription,
  provider: CountProvider
): vscode.Disposable {
  const apply = (count: number): void => {
    view.description = count > 0 ? String(count) : undefined;
  };
  apply(provider.count);
  return provider.onDidChangeCount(apply);
}
