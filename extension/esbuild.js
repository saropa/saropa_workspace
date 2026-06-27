const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// The Customize webview renders codicon glyphs, which need the icon font shipped beside
// the bundle (VS Code does NOT expose its built-in codicon font to webviews). Copy the
// font + its stylesheet from the @vscode/codicons package into dist/ so the panel can
// load them via webview.asWebviewUri. Copied (not bundled) because a font/CSS is a binary
// asset esbuild does not process; dist/ is what the .vsix packages, so the runtime never
// reads node_modules.
function copyCodiconAssets() {
  const from = path.join(__dirname, "node_modules", "@vscode", "codicons", "dist");
  const to = path.join(__dirname, "dist");
  fs.mkdirSync(to, { recursive: true });
  for (const file of ["codicon.css", "codicon.ttf"]) {
    fs.copyFileSync(path.join(from, file), path.join(to, file));
  }
}

// Surface esbuild errors in the VS Code "watch" task panel with file:line:col so
// a failed bundle is clickable rather than buried in raw stderr.
const problemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => console.log("[watch] build started"));
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    // vscode is provided by the host at runtime; bundling it would break loading.
    external: ["vscode"],
    logLevel: "silent",
    plugins: [problemMatcherPlugin],
  });
  copyCodiconAssets();
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
