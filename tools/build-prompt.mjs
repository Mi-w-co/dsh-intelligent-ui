/**
 * Generate `lib/prompt-text.js` from the real library.
 *
 * The prompt is not hand-written: it comes from the official
 * `generateSystemPrompt` applied to the same component library the renderer
 * ships. That is what keeps the advertised component list, argument orders and
 * @functions identical to what can actually be drawn — a hand-written prompt
 * drifts the moment either side changes.
 *
 * Run: node tools/build-prompt.mjs
 */
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(import.meta.url);

// Bundle a Node-side entry that builds the prompt, then run it in-process.
// `library.toSpec()` is the prompt-ready spec (components with pre-built
// signatures, groups, functions, actions) that generateSystemPrompt expects.
// `toJSONSchema()` is for the parser and has a different shape.
const entry = path.join(root, "tools/.prompt-entry.mjs");
fs.writeFileSync(
  entry,
  `import { generateSystemPrompt } from "@openuidev/react-lang";
import { library, promptOptions } from "../src/library.ts";
// ONE object argument. The two-argument form is a deprecated overload that reads
// its options off the spec it is handed, so a second argument is silently
// dropped — which is how the hand-written rules and the worked examples went
// missing from the prompt while the component list still looked correct.
const text = generateSystemPrompt({ library: library.toSpec(), promptOptions });
process.stdout.write(text);
`,
);

const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  minify: false,
  jsx: "automatic",
  loader: { ".css": "text", ".png": "dataurl", ".svg": "dataurl" },
  external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
  logLevel: "warning",
  absWorkingDir: root,
});

fs.rmSync(entry, { force: true });

const code = Buffer.from(result.outputFiles[0].contents).toString("utf8");
const moduleObj = { exports: {} };
const React = require("react");
const req = (name) => {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return require("react/jsx-runtime");
  if (name === "react-dom") return require("react-dom");
  if (name === "react-dom/client") return require("react-dom/client");
  throw new Error("cannot resolve " + name);
};

// The bundle writes the prompt to stdout; capture it by running the module.
const captured = { out: "" };
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk) => {
  captured.out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  return true;
};
try {
  new Function("require", "module", "exports", code)(req, moduleObj, moduleObj.exports);
} finally {
  process.stdout.write = originalWrite;
}

const text = captured.out;
if (typeof text !== "string" || text.length < 200) {
  throw new Error(`generateSystemPrompt produced ${text.length} chars — expected the full prompt`);
}

// The official one-object form honours `preamble`, so the DSH framing travels
// in through `promptOptions` (src/lib/prompt-options.ts) and no post-processing
// is needed. Guard that instead of rewriting: if the shape ever changes, this
// build must fail rather than silently ship a prompt that tells the model its
// whole reply has to be openui-lang.
if (!text.startsWith("You are answering inside a chat application.")) {
  throw new Error(
    "the generated prompt does not open with this plugin's preamble — check that " +
      "`promptOptions.preamble` is still passed through generateSystemPrompt",
  );
}
const patched = text;

const out = `// GENERATED FILE — run \`node tools/build-prompt.mjs\`. Do not edit directly.
// Produced by @openuidev/react-lang's generateSystemPrompt over src/library.ts,
// so it always matches the components the renderer can draw: the component
// signatures, the hand-written rules and the worked examples all come from that
// one call. The opener is this plugin's own \`preamble\` (src/lib/prompt-options.ts),
// which upstream honours on the official one-object call.
export const PROMPT_TEXT = ${JSON.stringify(patched)};
`;

fs.writeFileSync(path.join(root, "lib/prompt-text.js"), out);
console.log(`wrote lib/prompt-text.js  ${patched.length} chars`);
console.log(`  components mentioned: ${new Set([...patched.matchAll(/^([A-Z][A-Za-z0-9]*)\(/gm)].map((m) => m[1])).size}`);
console.log(`  @functions mentioned: ${new Set([...patched.matchAll(/@([A-Z][A-Za-z0-9]+)\(/g)].map((m) => m[1])).size}`);
console.log(`  says "ENTIRE response must be openui-lang": ${/ENTIRE response must be openui-lang/.test(patched)}`);
console.log(`  mentions a \`\`\`ui fence: ${/```ui|fenced code block/i.test(patched)}`);
