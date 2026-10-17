// Headless verification of the built bundle, with no DSH host and no browser.
//
// The bundle is evaluated the way `window.__ModuleLoader__` does it, `apply()`
// is pointed at a fake slot registry to capture the `turnTail` component, and
// that component is rendered with `react-dom/server`. Everything below only
// needs `react` / `react-dom`, which are dev dependencies, so
// `pnpm install && node test/verify.mjs` is the whole setup.
//
// Run after `node tools/build-client.mjs` and `node tools/build-prompt.mjs`.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(`${root}/test/x.cjs`);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Silence React's SSR-only notices; they are not plugin failures.
const origWarn = console.warn;
const origErr = console.error;
console.warn = () => {};
console.error = (msg, ...rest) => {
  const text = String(msg);
  if (text.includes('useLayoutEffect') || text.includes('quirks mode')) return;
  origErr(msg, ...rest);
};

const src = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8');
const tags = [];
const document = {
  createElement: () => ({
    dataset: {},
    textContent: '',
    style: {},
    remove() {
      const i = tags.indexOf(this);
      if (i >= 0) tags.splice(i, 1);
    },
    setAttribute() {},
    setAttributeNS() {},
    append() {},
    appendChild() {},
  }),
  head: { append: (n) => tags.push(n), appendChild: (n) => tags.push(n) },
  body: { append() {}, appendChild() {} },
  querySelector: () => null,
  querySelectorAll: () => [],
};

let mod = null;
new Function('window', 'document', src)(
  {
    __ModuleLoader__: {
      load({ factory }) {
        mod = factory((n) =>
          n === 'react'
            ? React
            : n === 'react/jsx-runtime'
              ? require('react/jsx-runtime')
              : n === 'react-dom'
                ? require('react-dom')
                : n === 'react-dom/client'
                  ? require('react-dom/client')
                  : (() => {
                      throw new Error('cannot resolve ' + n);
                    })(),
        );
      },
    },
  },
  document,
);

let tail = null;
let slotName = null;
mod.apply({
  effect: (fn) => fn(),
  slots: {
    inject: (k, cb) => cb(),
    register: (o, c) => {
      slotName = o.name;
      tail = c;
      return () => {};
    },
  },
});

const render = (program) => {
  const text = '```ui\n' + program + '\n```';
  const useChat = (sel) =>
    sel({ nodes: new Map([['n', { kind: 'assistant-step', data: { blocks: [{ kind: 'text', text }] } }]]) });
  return renderToStaticMarkup(React.createElement(tail, { sessionId: 's', useChat }));
};

const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push([name, true]);
  } catch (e) {
    results.push([name, false, e.message]);
  }
};

const has = (program, needles) => {
  const html = render(program);
  for (const n of needles) if (!html.includes(n)) throw new Error(`missing ${n} (html ${html.length})`);
};

check('the bundle registers into conversation.chat.turnTail', () => {
  if (slotName !== 'conversation.chat.turnTail') throw new Error(`registered into ${slotName}`);
  if (typeof tail !== 'function') throw new Error('no component captured');
});

check('the manifest and the bundle agree on inject', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const declared = manifest.dsh?.client?.inject ?? [];
  const exported = mod.inject ?? [];
  if (JSON.stringify(declared) !== JSON.stringify(exported)) {
    throw new Error(`package.json ${JSON.stringify(declared)} vs bundle ${JSON.stringify(exported)}`);
  }
});

check('heading + badges + chart + table all render', () =>
  has(
    [
      'root = Col([head, chips, chart, table], 3)',
      'head = Title("行程与预算")',
      'chips = Row([Badge("2 天", "info"), Badge("1 人", "muted")], 1)',
      'chart = Chart("pie", [{ label: "住宿", value: 480 }])',
      'table = Table(["项目", "金额"], [["住宿", "¥300"]])',
    ].join('\n'),
    ['iui-title', 'iui-badge', 'iui-chart', 'iui-table', '行程与预算', '¥300'],
  ));

check('grid + slider + input render', () =>
  has(
    [
      'root = Col([h, grid], 3)',
      'h = Title("分配器", "md")',
      '$days = 2',
      'grid = Grid([Slider($days, 1, 7, 1, "天数"), Input($note, "备注")], 2, 260, 3)',
      '$note = ""',
    ].join('\n'),
    ['iui-grid', 'iui-slider', 'iui-input'],
  ));

check('form + quote + math render', () =>
  has(
    [
      'root = Col([form, quote, math], 3)',
      '$name = ""',
      'form = Form([Input($name, "姓名"), Button("提交")])',
      'quote = Quote("地铁扫码即可通行。")',
      'math = Math("E = mc^2")',
    ].join('\n'),
    ['blockquote', 'katex'],
  ));

check('svg drawing renders', () =>
  has('root = Svg([Circle(50, 50, 40), Line(10, 10, 90, 90)], "0 0 100 100")', ['<svg']));

check('carousel renders', () => has('root = Carousel([Card([Text("a")]), Card([Text("b")])])', ['iui-']));

check('@functions compute inside the program', () =>
  has(
    [
      'root = Col([t, l], 2)',
      't = Title(@Format(@Sum([1, 2, 3]), "0"))',
      'l = List(@Each([1, 2, 3], "i", ListItem("item " + i)), "number")',
    ].join('\n'),
    ['6', 'item 1', 'item 3'],
  ));

check('non-ui fence renders nothing', () => {
  const text = '```js\nconst x = 1;\n```';
  const useChat = (sel) =>
    sel({ nodes: new Map([['n', { kind: 'assistant-step', data: { blocks: [{ kind: 'text', text }] } }]]) });
  const html = renderToStaticMarkup(React.createElement(tail, { sessionId: 's', useChat }));
  if (html !== '') throw new Error('produced output');
});

check('stylesheets insert and remove cleanly', () => {
  if (tags.length === 0) throw new Error('no style tags inserted');
  const total = tags.reduce((n, t) => n + t.textContent.length, 0);
  if (total < 60000) throw new Error(`only ${total} chars of CSS`);
});

check('the prompt advertises the fence and the output contract', async () => {
  const prompt = await import(new URL('../lib/prompt.js', import.meta.url).href);
  const text = prompt.buildPrompt();
  if (text.length < 20000) throw new Error(`prompt is only ${text.length} chars`);
  if (!text.includes('```ui')) throw new Error('the prompt never mentions the ui fence');
  if (!text.includes('MANDATORY OUTPUT CONTRACT')) throw new Error('the enforcement rules are missing');
});

console.warn = origWarn;
console.error = origErr;

let pass = 0;
for (const [name, ok, msg] of results) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) console.log(`       ${msg}`);
  if (ok) pass += 1;
}
console.log(`\n${pass}/${results.length} passed`);
if (pass !== results.length) process.exitCode = 1;
