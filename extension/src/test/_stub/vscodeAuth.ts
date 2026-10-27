// vscode.authentication stand-in for the test stub: a settable sign-in session and a log
// of the requests made, so a test can check whether a prompt was asked for.

/** One recorded getSession call. */
export interface AuthRequest {
  readonly provider: string;
  readonly scopes: readonly string[];
  readonly createIfNone: boolean;
}

let session: { accessToken: string } | undefined;
let failure: Error | undefined;
const requests: AuthRequest[] = [];

/** Test hook: the session getSession returns (undefined means signed out). */
export function __setAuthSession(next: { accessToken: string } | undefined): void {
  session = next;
}

/** Test hook: makes getSession throw this error (undefined clears it). */
export function __setAuthFailure(next: Error | undefined): void {
  failure = next;
}

/** Test hook: the getSession calls made since the last reset, in order. */
export function __authRequests(): readonly AuthRequest[] {
  return requests;
}

/** Test hook: signs out, clears the failure and the request log. */
export function __resetAuth(): void {
  session = undefined;
  failure = undefined;
  requests.length = 0;
}

/** Stub of `vscode.authentication`: only getSession. */
export const authentication = {
  async getSession(
    provider: string,
    scopes: readonly string[],
    options?: { createIfNone?: boolean }
  ): Promise<{ accessToken: string } | undefined> {
    requests.push({ provider, scopes, createIfNone: options?.createIfNone === true });
    if (failure) {
      throw failure;
    }
    return session;
  },
};
