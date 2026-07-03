# Saropa HUD Launcher — hardened security architecture

Security hardening for the base launcher in [WOW_X5.md](WOW_X5.md): the webview
Content Security Policy and the hardened release compiler/linker directives.

## Sandbox content security policy (`src-frontend/index.html`)

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'none'; 
               script-src 'self'; 
               style-src 'self' 'unsafe-inline'; 
               img-src 'self' data: https://raw.githubusercontent.com; 
               connect-src 'self' ws://localhost:* http://127.0.0.1:8484;">
```

## Hardened enterprise release compiler directives (`.cargo/config.toml`)

```toml
[target.x86_64-pc-windows-msvc]
rustflags = [
    "-C", "link-arg=/NXCOMPAT",      # Enforces hardware-enforced Data Execution Prevention (DEP) memory shield walls
    "-C", "link-arg=/DYNAMICBASE",  # Enforces complete randomized application location tracking layouts (ASLR)
    "-C", "link-arg=/HIGHENTROPYVA" # Allocates high-entropy 64-bit hardware memory mapping spaces
]

[profile.release]
opt-level = 3
lto = true             # Enables exhaustive whole-program Link-Time Optimization algorithms across files
codegen-units = 1      # Combines processing threads into a single optimization pass
panic = "abort"        # Drops verbose call stack-unwinding data tables to minify binary footprint
strip = true           # Purges debug symbols to protect the codebase from reverse-engineering attempts
```

## Success criteria

- The webview loads under the CSP with no console violations; only loopback/localhost
  `connect-src` targets are reachable.
- The release build links with DEP/ASLR/high-entropy flags on Windows and ships
  stripped, `panic = "abort"`, LTO on.
