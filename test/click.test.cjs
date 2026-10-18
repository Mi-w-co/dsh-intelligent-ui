/**
 * End-to-end check of the click path. CommonJS on purpose: the plugin bundle is
 * evaluated through `new Function`, and a pure-CJS harness keeps every
 * dependency on one module instance.
 *
 * The bug being guarded: a card Button carrying `@ToAssistant(...)` rendered
 * fine and did nothing, because the action event it emitted had no consumer.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

let loaded = null;
const fakeWindow = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loaded = { exports: factory((name) => require(name)) };
    },
  },
  open() {},
};
const fakeDocument = {
  createElement: () => ({ dataset: {}, textContent: "", remove() {} }),
  head: { append() {} },
};

new Function("window", "document", fs.readFileSync(path.join(root, "lib/client.js"), "utf8"))(
  fakeWindow,
  fakeDocument,
);

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log("  ok   " + name); }
  catch (error) { failed += 1; console.log("  FAIL " + name + "\n       " + error.message); }
}

if (loaded === null || typeof loaded.exports?.apply !== "function") {
  console.log("  FAIL the bundle did not register a usable module");
  process.exit(1);
}
const api = loaded.exports;

let registered = null;
api.apply({
  effect(fn) { fn(); },
  slots: { inject(k, fn) { fn(); }, register(r, c) { registered = c; } },
});

function makeComposer() {
  const calls = [];
  return {
    calls,
    actions: {
      setDraft: (text) => calls.push(["draft", text]),
      submit: () => calls.push(["submit"]),
    },
  };
}

function renderTail(program, composer) {
  const message = "看这个。\n\n```ui\n" + program + "\n```";
  const snapshot = {
    nodes: new Map([
      ["a1", { kind: "assistant-step", location: { turn: 1 }, data: { blocks: [{ kind: "text", text: message }] } }],
    ]),
  };
  return renderToStaticMarkup(
    React.createElement(registered, {
      sessionId: "s1",
      useChat: (selector) => selector(snapshot),
      inputActions: composer.actions,
      turn: 1,
    }),
  );
}

const program = [
  "root = Col([title, actions])",
  'title = Title("收工状态", "lg")',
  'actions = Row([Button("跑一次测试", @ToAssistant("跑一次 MiniMax-H3 测试")), Button("打开说明", @ToAssistant("打开安装说明"))], 2)',
].join("\n");

const composer = makeComposer();
const html = renderTail(program, composer);

check("two buttons render as real <button>", () => {
  const n = (html.match(/<button/g) ?? []).length;
  if (n !== 2) throw new Error("got " + n);
});

check("both labels survive", () => {
  if (!html.includes("跑一次测试")) throw new Error("first label missing");
  if (!html.includes("打开说明")) throw new Error("second label missing");
});

check("rendering sends nothing", () => {
  if (composer.calls.length !== 0) throw new Error("render sent " + JSON.stringify(composer.calls));
});

// The exact event the upstream renderer emits for ACTION_STEPS.ToAssistant:
// text lives in `humanFriendlyMessage`; `params` only carries `context`.
check("@ToAssistant click writes the draft and submits", () => {
  api.handleCardAction(
    { type: "continue_conversation", params: {}, humanFriendlyMessage: "跑一次 MiniMax-H3 测试", formState: {}, formName: undefined },
    composer.actions,
  );
  const got = JSON.stringify(composer.calls);
  if (got !== JSON.stringify([["draft", "跑一次 MiniMax-H3 测试"], ["submit"]])) {
    throw new Error("got " + got);
  }
});

check("a second click sends its own text", () => {
  composer.calls.length = 0;
  api.handleCardAction(
    { type: "continue_conversation", params: { context: "ctx" }, humanFriendlyMessage: "打开安装说明" },
    composer.actions,
  );
  const got = JSON.stringify(composer.calls);
  if (got !== JSON.stringify([["draft", "打开安装说明"], ["submit"]])) throw new Error("got " + got);
});

check("an empty message submits nothing", () => {
  composer.calls.length = 0;
  api.handleCardAction({ type: "continue_conversation", params: {}, humanFriendlyMessage: "" }, composer.actions);
  if (composer.calls.length !== 0) throw new Error("sent anyway");
});

check("an unknown event type is ignored without throwing", () => {
  composer.calls.length = 0;
  api.handleCardAction({ type: "something_else", params: {} });
  api.handleCardAction(null);
  if (composer.calls.length !== 0) throw new Error("sent anyway");
});

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);


