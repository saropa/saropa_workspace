// Minimal `vscode` stand-in for unit tests. esbuild aliases the bare "vscode"
// import to THIS file when bundling tests (see esbuild.test.js), so a module that
// touches a small slice of the API can run under `node --test` without the
// extension host. It models ONLY the surface the unit-tested code paths use;
// anything else is intentionally absent so an accidental new host dependency fails
// loudly at bundle/run time rather than silently passing against a fake.

// workspace.getConfiguration(section).get(key, default): the unit tests exercise
// the DEFAULT-config path, so every key returns its supplied default. Behavior
// under custom user settings is a host concern (4.2 integration), not a unit one.
export const workspace = {
  getConfiguration(_section?: string): {
    get<T>(key: string, defaultValue: T): T;
  } {
    return {
      get<T>(_key: string, defaultValue: T): T {
        return defaultValue;
      },
    };
  },
};

// A faithful-enough URI for the store path helpers: file() yields the "file"
// scheme and echoes the path as fsPath; parse() reads the scheme from a
// "scheme://..." string and round-trips toString(). This is enough to verify the
// helpers' BRANCHING (file vs non-file scheme, fsPath vs toString); real
// platform-specific fsPath normalization is a host concern (4.2), not a unit one.
export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly fsPath: string,
    private readonly raw: string
  ) {}

  static file(p: string): Uri {
    return new Uri("file", p, p);
  }

  static parse(value: string): Uri {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(value);
    const scheme = match ? match[1] : "file";
    return new Uri(scheme, value, value);
  }

  toString(): string {
    return this.raw;
  }
}
