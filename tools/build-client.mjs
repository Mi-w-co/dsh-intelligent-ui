/**
 * Build `lib/client.js` for dsh-intelligent-ui.
 *
 * DSH loads a client half as a single self-contained script: a `factory(require)`
 * with no bundler and no npm resolution at load time. React, `react/jsx-runtime`
 * and `react-dom` are answered by DSH's frozen platform table, so they stay
 * external and are mapped onto the loader's `require`. Everything else — the
 * OpenUI packages, zod, the charts, KaTeX, MapLibre — is flattened in.
 *
 * The output writes the CSS the upstream components ship as text into the
 * document at activation, because a client bundle cannot emit a <link>.
 *
 * Run: node tools/build-client.mjs
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const id = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name;

/** Modules DSH's platform table answers; everything else must be bundled. */
const BASELINE = ["react", "react/jsx-runtime", "react-dom", "react-dom/client"];

// MapLibre needs a Web Worker, and a plugin is a single script with no sibling
// files. Compile the worker to a self-contained ES module and write it out as a
// string module the map component imports and turns into a blob URL.
//
// ES module, not IIFE: MapLibre only requests `{ type: "module" }` for a
// same-origin worker URL, and a blob built by this page counts as same-origin.
const workerOut = await esbuild.build({
  entryPoints: [path.join(root, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  write: false,
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: "var process = { env: { NODE_ENV: 'production' } };" },
  logLevel: "silent",
  absWorkingDir: root,
});
const workerSource = Buffer.from(workerOut.outputFiles[0].contents).toString("utf8");
// Only STATIC import/export would break a blob module. MapLibre's worker keeps
// two dynamic `import()` calls (an optional RTL-text plugin loader) and those are
// runtime-only, so they are fine.
if (/^\s*import\s[^(]/m.test(workerSource) || /^\s*export\s/m.test(workerSource)) {
  throw new Error(
    "the MapLibre worker bundle still has static import/export; a blob module cannot resolve them",
  );
}
fs.writeFileSync(
  path.join(root, "src/lib/components/map/worker-source.generated.ts"),
  "// GENERATED FILE — run `node tools/build-client.mjs`. Do not edit.\n" +
    "// The MapLibre worker as a self-contained ES module, carried as a string so\n" +
    "// the plugin can serve it from a blob URL (a plugin has no sibling files).\n" +
    `export const MAPLIBRE_WORKER_SOURCE = ${JSON.stringify(workerSource)};\n`,
);
console.log(`worker-source.generated.ts  ${(workerSource.length / 1024).toFixed(0)} KB`);

const result = await esbuild.build({
  entryPoints: [path.join(root, "src/client.tsx")],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: ["chrome120"],
  write: false,
  minify: true,
  jsx: "automatic",
  loader: {
    ".css": "text",
    ".png": "dataurl",
    ".svg": "dataurl",
  },
  external: BASELINE,
  // The bundle runs in a browser, which has no `process`. Upstream code (and
  // some dependencies) reads `process.env.NODE_ENV` and, in places, a bare
  // `process`; without a shim the factory throws `process is not defined` at
  // materialisation time and the plugin silently never activates. `define`
  // rewrites the literal reads; the banner covers everything else. "production"
  // is used because the shim is only `{ env }` — no `process.emitWarning` etc.
  define: { "process.env.NODE_ENV": '"production"' },
  banner: { js: "var process = { env: { NODE_ENV: 'production' } };" },
  logLevel: "warning",
  absWorkingDir: root,
});

const code = Buffer.from(result.outputFiles[0].contents).toString("utf8");

// The bundle must not reach for anything the loader cannot answer.
const specs = [...new Set([...code.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]))];
const stray = specs.filter((s) => !BASELINE.includes(s));
if (stray.length > 0) {
  throw new Error(
    `bundle requires modules DSH cannot resolve: ${stray.join(", ")}. ` +
      "Add them to dsh.client.external with a supplying package, or bundle them.",
  );
}

// The upstream component CSS is imported as text; collect it for runtime insert.
const cssModules = result.outputFiles.filter((f) => f.path.endsWith(".css"));

// The body is compiled through `new Function` with `module`/`exports` passed as
// PARAMETERS.
//
// Why not declare them in the factory scope: doing so makes every statement
// reference (`c = Title("A")` used as a child) resolve against a different
// library instance than the Renderer holds, so referenced children silently
// vanish while inline children still draw. Reproduced in real Chrome. An inner
// function taking the pair as parameters does NOT fix it — only `new Function`
// does, because its body is compiled in the global scope and therefore binds
// `module`/`exports`/`require` to exactly the parameters given.
//
// `process` is shimmed because the bundle runs in a browser: upstream reads
// `process.env.NODE_ENV`, and without the shim the factory throws
// `process is not defined` and the plugin never activates. The shim is emitted
// as a banner so it sits inside the same compiled body.
//
// The evaluation is wrapped so a failure degrades to an inert plugin instead of
// taking the page down with it: a thrown factory breaks the client module
// system, and the whole GUI then fails to boot. Reporting and returning an empty
// exports object keeps the app usable.
const out = `// GENERATED FILE — edit src/ and run \`node tools/build-client.mjs\`.
// Do not edit this file directly.
window.__ModuleLoader__.load({
\tid: ${JSON.stringify(id)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
\t\ttry {
\t\t\tvar __body = new Function("require", "module", "exports", "document", ${JSON.stringify(code)});
\t\t\t__body(require, module, exports, document);
\t\t} catch (error) {
\t\t\tconsole.error("${id}: the plugin bundle could not be evaluated, so the plugin is inert. " +
\t\t\t\t"A Content-Security-Policy without 'unsafe-eval' is the usual cause.", error);
\t\t}
\t\treturn module.exports;
\t}
});
`;

fs.writeFileSync(path.join(root, "lib/client.js"), out);
console.log(`wrote lib/client.js ${(out.length / 1024 / 1024).toFixed(2)} MB`);
console.log(`bare requires: ${JSON.stringify(specs)}`);
if (result.warnings.length > 0) {
  console.log(`warnings: ${result.warnings.length}`);
  for (const w of result.warnings.slice(0, 5)) console.log(`  ${w.text}`);
}

/** Indent a block by n tabs, leaving blank lines empty. */
function indent(text, n) {
  const pad = "\t".repeat(n);
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : pad + line))
    .join("\n");
}
