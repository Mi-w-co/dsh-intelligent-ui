/**
 * Guards the composer binding against cross-turn leakage.
 *
 * A card button sends through the composer of ITS OWN turn. The first version
 * kept that binding in a module-level variable, so when two turns were mounted
 * the last one rendered captured every click — a button in turn A sent into
 * turn B's composer. The fix publishes the binding through a React context that
 * each tail provides, and this test fails if it ever goes back to a shared slot.
 *
 * CommonJS on purpose: the bundle is evaluated through `new Function`, and a
 * pure-CJS harness keeps one module instance for every dependency.
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
      loaded = factory((name) => require(name));
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

if (loaded === null) {
  console.log("  FAIL the bundle did not load");
  process.exit(1);
}
const api = loaded;
if (typeof api.apply !== "function") {
  console.log("  FAIL the bundle has no apply()");
  process.exit(1);
}

let Tail = null;
api.apply({
  effect(fn) { fn(); },
  slots: { inject(k, fn) { fn(); }, register(r, c) { Tail = c; } },
});

/** Render one turn's tail, returning the markup. */
function renderTurn(turn, composer) {
  const program = 'root = Col([Button("动作", @ToAssistant("发给第" + ' + turn + ' + "轮"))])';
  const message = "x\n\n```ui\n" + program + "\n```";
  const snapshot = {
    nodes: new Map([
      ["n" + turn, { kind: "assistant-step", location: { turn }, data: { blocks: [{ kind: "text", text: message }] } }],
    ]),
  };
  return renderToStaticMarkup(
    React.createElement(Tail, {
      sessionId: "s" + turn,
      useChat: (selector) => selector(snapshot),
      inputActions: composer,
      turn,
    }),
  );
}

function composerFor(sink) {
  return {
    setDraft: (t) => sink.push(["draft", t]),
    submit: () => sink.push(["submit"]),
  };
}

// ---- the leak --------------------------------------------------------------
// Two turns mounted at once, as the transcript does for a multi-turn answer.
const sinkA = [];
const sinkB = [];
renderTurn(1, composerFor(sinkA));
renderTurn(2, composerFor(sinkB));

check("the most recent turn renders", () => {
  if (sinkA.length !== 0 || sinkB.length !== 0) throw new Error("rendering sent something");
});

// `handleCardAction` is the handler the renderer calls. With no explicit binding
// it must not fall back to "whatever rendered last" — an unbound card simply
// cannot send. The real path passes the card's own binding from context.
check("an unbound handler sends nothing (no fallback to the last turn)", () => {
  api.handleCardAction({ type: "continue_conversation", params: {}, humanFriendlyMessage: "发给第2轮" });
  if (sinkB.length !== 0) throw new Error("leaked into the last-rendered turn: " + JSON.stringify(sinkB));
  if (sinkA.length !== 0) throw new Error("leaked into turn 1");
});

// The wired path: each handler carries its own turn's composer.
check("turn 1's own binding receives turn 1's click", () => {
  sinkA.length = 0;
  sinkB.length = 0;
  api.handleCardAction(
    { type: "continue_conversation", params: {}, humanFriendlyMessage: "发给第1轮" },
    composerFor(sinkA),
  );
  if (JSON.stringify(sinkA) !== JSON.stringify([["draft", "发给第1轮"], ["submit"]])) {
    throw new Error("turn 1 got " + JSON.stringify(sinkA));
  }
  if (sinkB.length !== 0) throw new Error("turn 2 received turn 1's click");
});

check("turn 2's own binding receives turn 2's click", () => {
  sinkA.length = 0;
  sinkB.length = 0;
  api.handleCardAction(
    { type: "continue_conversation", params: {}, humanFriendlyMessage: "发给第2轮" },
    composerFor(sinkB),
  );
  if (JSON.stringify(sinkB) !== JSON.stringify([["draft", "发给第2轮"], ["submit"]])) {
    throw new Error("turn 2 got " + JSON.stringify(sinkB));
  }
  if (sinkA.length !== 0) throw new Error("turn 1 received turn 2's click");
});

check("a null binding is inert, not an exception", () => {
  api.handleCardAction({ type: "continue_conversation", params: {}, humanFriendlyMessage: "x" }, null);
});

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
