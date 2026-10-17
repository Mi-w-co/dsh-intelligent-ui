/**
 * Regression suite for the shipped bundle, rendered CLIENT-SIDE.
 *
 * DSH renders the plugin in a real browser, so the suite uses jsdom +
 * react-dom/client rather than react-dom/server. That matters: `react-dom/server`
 * never hydrates the OpenUI state store, so every `$variable` reads as empty and
 * `@Each` over a `$variable` produces no rows — both of which work fine in a
 * browser. Asserting against the server renderer would have produced false
 * failures for behaviour that is correct where it runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const React = require('react');
const { JSDOM } = require('jsdom');
const { createRoot } = require('react-dom/client');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

// The bundle is ~2 MB of real code (React, d3, KaTeX, MapLibre's peers). Loading
// it once per check exhausts the heap, so it is loaded a single time and every
// check reuses that module instance — which is also how DSH loads it.
let __cached = null;
function loadPlugin() {
  if (__cached !== null) return __cached;
  __cached = loadPluginOnce();
  return __cached;
}

/** Load a fresh instance, bypassing the cache (for the dispose check). */
function loadPluginOnce() {
  const src = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8');
  const tags = [];
  const document = {
    createElement() {
      const node = {
        dataset: {},
        textContent: '',
        remove() {
          const i = tags.indexOf(node);
          if (i >= 0) tags.splice(i, 1);
        },
        // jsdom's real DOM nodes use appendChild; some library code prefers it.
        appendChild() {},
        setAttribute() {},
        append() {},
        style: {},
      };
      return node;
    },
    // The library (KaTeX, charts) may append to document.head/body directly.
    head: {
      append: (node) => tags.push(node),
      appendChild: (node) => tags.push(node),
    },
    body: { append() {}, appendChild() {} },
    querySelector: () => null,
  };
  const window = {
    __ModuleLoader__: {
      load({ factory }) {
        window.__module = factory((name) => {
          if (name === 'react') return React;
          if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
          if (name === 'react-dom') return require('react-dom');
          if (name === 'react-dom/client') return require('react-dom/client');
          throw new Error(`loader cannot resolve: ${name}`);
        });
      },
    },
  };
  new Function('window', 'document', src)(window, document);

  const captured = { tags, tail: null, slotKey: null, opts: null, disposer: null };
  window.__module.apply({
    effect(fn) {
      captured.disposer = fn();
      return captured.disposer ?? (() => {});
    },
    slots: {
      inject(key, cb) {
        captured.slotKey = key;
        cb();
        return () => {};
      },
      register(opts, comp) {
        captured.opts = opts;
        captured.tail = comp;
        return () => {};
      },
    },
  });
  __cached = { mod: window.__module, ...captured };
  return __cached;
}

/** Render one program through the plugin's component in a real DOM. */
async function render(tail, program) {
  const text = '```ui\n' + program + '\n```';
  const useChat = (selector) =>
    selector({
      nodes: new Map([['n', { kind: 'assistant-step', data: { blocks: [{ kind: 'text', text }] } }]]),
    });
  const host = dom.window.document.createElement('div');
  dom.window.document.body.append(host);
  const r = createRoot(host);
  await new Promise((resolve) => {
    r.render(React.createElement(tail, { sessionId: 's1', useChat }));
    setTimeout(resolve, 60);
  });
  const html = host.innerHTML;
  r.unmount();
  host.remove();
  return html;
}

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, message: error.message });
  }
};

// Synchronous checks first (no rendering needed).
check('the bundle registers with the loader and exports apply/inject', () => {
  const { mod } = loadPlugin();
  if (typeof mod.apply !== 'function') throw new Error('apply is not exported');
  if (!Array.isArray(mod.inject)) throw new Error('inject is not an array');
  if (!mod.inject.includes('slots')) throw new Error('inject must declare slots');
});

check('activation inserts the library stylesheets', () => {
  const { tags } = loadPlugin();
  if (tags.length === 0) throw new Error('no style tag inserted');
  const total = tags.reduce((n, t) => n + t.textContent.length, 0);
  if (total < 50000) throw new Error(`only ${total} chars of CSS inserted`);
});

check('dispose removes every inserted stylesheet', () => {
  // Uses its own load so the shared instance keeps its styles for later checks.
  const { tags, disposer } = loadPluginOnce();
  if (typeof disposer !== 'function') throw new Error('no disposer');
  disposer();
  if (tags.length !== 0) throw new Error(`${tags.length} style tags leaked`);
});

check('it registers into conversation.chat.turnTail', () => {
  const { slotKey, opts } = loadPlugin();
  if (slotKey !== 'conversation.chat.turnTail') throw new Error(`wrong slot ${slotKey}`);
  if (opts.id !== 'dsh-intelligent-ui') throw new Error(`wrong id ${opts.id}`);
});

// Rendering checks run together at the end because they are async.
const asyncChecks = [
  ['a referenced child renders', 'root = Col([c], 3)\nc = Title("A")', ['iui-title', '>A<']],
  ['several referenced children render', 'root = Col([c, d], 3)\nc = Title("A")\nd = Badge("B", "info")', ['iui-title', 'iui-badge']],
  ['a referenced root renders', 'root = head\nhead = Title("A")', ['iui-title']],
  ['an inline child still renders', 'root = Col([Title("A")], 3)', ['iui-title']],
  [
    'referenced chart and table render',
    'root = Col([head, chart, table], 3)\nhead = Title("T")\nchart = Chart("pie", [{ label: "A", value: 1 }])\ntable = Table(["K"], [["V"]])',
    ['iui-title', 'iui-chart', 'iui-table'],
  ],
  [
    '@Each over a $variable renders its rows',
    'root = Col([rows], 3)\n$n = 3\nrows = Col(@Each(@Range(0, $n), "i", Text("Step " + i)), 2)',
    ['Step 0', 'Step 1', 'Step 2'],
  ],
  [
    '@Each over a literal list renders its rows',
    'root = Col([rows], 3)\nrows = Col(@Each([{day: 1, title: "A"}, {day: 2, title: "B"}], "d", Text("Day " + d.day)), 2)',
    ['Day 1', 'Day 2'],
  ],
  [
    'a $variable renders in a Title',
    'root = Title($n + " days")\n$n = 3',
    ['3 days'],
  ],
];

let passed = 0;
let failed = 0;
const report = (r) => {
  if (r.ok) {
    passed += 1;
    console.log(`  ok   ${r.name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${r.name}`);
    console.log(`       ${r.message}`);
  }
};

for (const r of results) report(r);

for (const [name, program, markers] of asyncChecks) {
  const { tail } = loadPlugin();
  try {
    const html = await render(tail, program);
    const missing = markers.filter((mk) => !html.includes(mk));
    if (missing.length > 0) throw new Error(`missing ${missing.join(', ')} (html ${html.length})`);
    report({ name, ok: true });
  } catch (error) {
    report({ name, ok: false, message: error.message });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
