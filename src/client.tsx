/**
 * Browser half of dsh-intelligent-ui.
 *
 * Bundled by `tools/build-client.mjs` into a single `__ModuleLoader__` script, so
 * this file may use real imports and JSX; the build flattens them. Only `react`,
 * `react/jsx-runtime` and `react-dom` stay external, and DSH's loader answers all
 * three from its frozen platform table.
 *
 * The plugin registers one entry in the `conversation.chat.turnTail` list slot.
 * That slot is the additive extension point ui-chat owns, and its component
 * receives `sessionId` and `useChat`, so a turn's assistant text can be read and
 * rendered as extra cards without patching the shipped UI.
 */
import * as React from "react";
import { Renderer } from "@openuidev/react-lang";
import { componentCss, library, runLibraryAction } from "./library";

/** Stable identity of this plugin's slot entry. */
const PLUGIN_ID = "dsh-intelligent-ui";

/** Fenced-code-block info string that marks an OpenUI program. */
const FENCE = "ui";

/**
 * Attribute set on a rendered `ui` fence that a card has replaced.
 *
 * The transcript renders the assistant's Markdown verbatim, so the `ui` fence
 * the model wrote is drawn as an ordinary code block — a wall of OpenUI source
 * above every card. The card is the answer; the source is scaffolding. This
 * attribute is the hook the stylesheet uses to collapse the fence.
 *
 * A `data-*` attribute, not an inline style or a class: the code block belongs
 * to the shipped Markdown renderer, which re-renders its `className` and `style`
 * props but never touches attributes it did not create, so the mark is stable
 * across re-renders while it lasts (and unmounts with the message).
 */
const FENCE_ATTR = "data-diui-fence";

/**
 * Normalize a program for comparison.
 *
 * The extracted program has been `.trim()`-ed; the DOM copy is the fence body
 * exactly as Markdown parsed it. CRLF and trailing spaces of a line are the only
 * legitimate differences, so both sides go through this before matching.
 * @param source - a program or a rendered code block's text.
 * @returns the comparable form.
 */
function canonical(source) {
  return String(source ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}

/**
 * Collapse the `ui` fences that the cards below them already render.
 *
 * Callers render one card per fence, so hiding every fence whose text equals one
 * of this turn's programs is exact: an ordinary code block in the same answer is
 * left alone, and a program the renderer could not use keeps its source visible
 * (the boundary fallback renders it instead).
 *
 * The anchor is the card container, which sits in the turn's own row; walking up
 * to the ancestor that also holds the markdown rows scopes the search to this
 * turn, so a transcript full of earlier answers is not re-scanned on every turn.
 * @param anchor - the card container element.
 * @param programs - the programs extracted from this turn's assistant text.
 */
function hideRenderedFences(anchor, programs) {
  if (anchor === null || anchor === undefined || programs.length === 0) return;
  const wanted = new Set(programs.map(canonical).filter((text) => text !== ""));
  if (wanted.size === 0) return;

  let scope = anchor.parentElement;
  for (let depth = 0; scope !== null && depth < 12; depth += 1) {
    if (scope.querySelector("div.md-code-block") !== null) break;
    scope = scope.parentElement;
  }
  // `ownerDocument`, not the module's `document` binding: it resolves to the same
  // tree the card is painted into, and it keeps a non-DOM test double from being
  // the fallback container.
  const container = scope ?? anchor.ownerDocument;
  if (container === null || container === undefined) return;
  for (const block of container.querySelectorAll("div.md-code-block")) {
    if (block.hasAttribute(FENCE_ATTR)) continue;
    const text = block.querySelector("pre")?.textContent ?? "";
    if (wanted.has(canonical(text))) block.setAttribute(FENCE_ATTR, "1");
  }
}

/**
 * Extract OpenUI programs from an assistant message.
 * A message may contain prose plus one or more `ui` fences; each fence becomes
 * one card, so an answer can explain and then show two small tools.
 * @param text - the assistant text block.
 * @returns the program sources, in order.
 */
export function extractPrograms(text) {
  const out = [];
  const re = /^[ \t]*```[ \t]*ui[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  let match;
  while ((match = re.exec(String(text ?? ""))) !== null) {
    const body = match[1].trim();
    if (body !== "") out.push(body);
  }
  return out;
}

/**
 * Stylesheet for the block wrapper, inserted alongside the library's own CSS.
 *
 * Deliberately frameless: the reference implementation (and ChatGPT's own
 * Intelligent UI) lets the components read as the assistant's own message
 * content. An enclosing "Interactive UI" panel with a border and a heading adds
 * a box around every answer that the model did not ask for, and a program that
 * draws its own `Card` then ends up nested inside it.
 */
const FRAME_CSS = `
.diui-root{display:flex;flex-direction:column;gap:12px;margin-top:12px}
.diui-card{background:transparent}
.diui-card-body{padding:0}
.md-code-block[data-diui-fence]{display:none!important}
.diui-card-fallback{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.diui-card-fallback summary{cursor:pointer}
.diui-card-fallback pre{margin:8px 0 0;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-markdown-code-block,rgba(127,127,127,.12));font:var(--dsw-font-markdown-code-block-small,12px/1.5 ui-monospace,monospace);overflow:auto;max-height:320px}
`;

/**
 * Insert our stylesheets into the document.
 *
 * Two things are concatenated: the card frame, and the upstream component CSS
 * (theme, components, KaTeX) that the bundle carries as text — a client bundle
 * cannot emit a <link>, and the upstream sources' bare CSS imports are dropped
 * by the bundler.
 *
 * The `styles.insert()` helper belongs to the dynamic Cordis package format
 * (`dsh-cordis-client-runner` passes it as a closure parameter). A plugin loaded
 * through `dsh.client` as a `__ModuleLoader__` bundle gets no such global, so it
 * owns its own `<style>` tag and removes it on dispose.
 * @returns a disposer removing the tags.
 */
function insertStyles() {
  const tags = [FRAME_CSS, componentCss].filter((css) => typeof css === "string" && css !== "").map((css) => {
    const tag = document.createElement("style");
    tag.dataset.dshPlugin = PLUGIN_ID;
    tag.textContent = css;
    document.head.append(tag);
    return tag;
  });
  return () => {
    for (const tag of tags) tag.remove();
  };
}

/**
 * Keeps a bad program from reaching the chat view.
 *
 * The card renders model-authored input through a third-party renderer, so a
 * throw here would otherwise propagate out of this slot and unmount the shipped
 * conversation UI. Catching it locally means the worst case is a missing card.
 */
class CardBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("intelligent-ui: a card failed to render and was dropped", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    // The fence that fed this card is collapsed by the stylesheet, so a boundary
    // that rendered nothing would delete the model's content along with the
    // source. Showing the program behind a disclosure keeps it reachable.
    return (
      <details className="diui-card-fallback">
        <summary>This UI could not be rendered — show its source</summary>
        <pre>{this.props.program}</pre>
      </details>
    );
  }
}

/** One card: an OpenUI program rendered by the official renderer. */
function Card({ program }) {
  const onAction = React.useCallback((event) => {
    // Custom actions (e.g. CopyToClipboard) are ours; built-in steps are not.
    runLibraryAction(event);
  }, []);
  // Validation problems are logged, not printed on the card: the reader cannot act
  // on "field /kind expects one of [...]", and the card would look broken for what
  // is often a cosmetic slip. The console keeps them available for debugging.
  const onError = React.useCallback((next) => {
    const list = Array.isArray(next) ? next.filter((e) => e.severity !== "warning") : [];
    if (list.length > 0) console.warn("intelligent-ui: the program did not fully validate", list);
  }, []);

  return (
    <div className="diui-card">
      <div className="diui-card-body">
        {/* `Renderer` is the default renderer itself; `Renderer.Root` is only the
            context provider, which renders no content on its own. */}
        <Renderer
          response={program}
          library={library}
          onAction={onAction}
          onError={onError}
        />
      </div>
    </div>
  );
}

/** Every card contributed by one turn's assistant text. */
function IntelligentUiTail(props) {
  const { sessionId, useChat, turn } = props;
  if (typeof useChat !== "function") {
    console.error("intelligent-ui: the slot did not provide useChat; no cards can be read.");
    return null;
  }
  // Select the assistant text of THIS turn. Returning a joined string keeps the
  // subscription stable across unrelated node churn.
  //
  // `turn` is the slot's own owner prop, and every chat node carries
  // `location.turn`. Filtering on it keeps this seat from rendering another
  // turn's cards if the snapshot ever holds more than the current turn — which
  // would duplicate every earlier card at the end of the conversation. Nodes
  // whose turn is unknown are kept, so a shape change degrades to the previous
  // behaviour instead of silently rendering nothing.
  const text = useChat((snapshot) => {
    const parts = [];
    for (const node of snapshot.nodes.values()) {
      if (node.kind !== "assistant-step") continue;
      const nodeTurn = node.location?.turn;
      if (turn !== undefined && nodeTurn !== undefined && nodeTurn !== turn) continue;
      const blocks = node.data?.blocks;
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (block?.kind === "text" && typeof block.text === "string") parts.push(block.text);
      }
    }
    return parts.join("\n");
  });

  const programs = React.useMemo(() => extractPrograms(text), [text]);
  const rootRef = React.useRef(null);
  // After paint of this turn's cards, collapse the fences they replace. A layout
  // effect runs before the browser paints the frame, so the code block does not
  // flash next to its card; it is also the only hook that can assume the card row
  // and the message row are both mounted.
  React.useLayoutEffect(() => {
    hideRenderedFences(rootRef.current, programs);
  }, [programs]);
  if (programs.length === 0) return null;
  return (
    <div ref={rootRef} className="diui-root" data-session={sessionId}>
      {programs.map((program, i) => (
        <CardBoundary key={i} program={program}>
          <Card program={program} />
        </CardBoundary>
      ))}
    </div>
  );
}

/**
 * Hard dependencies the loader must resolve before `apply` runs.
 *
 * `slots` is required: `apply` registers into `ctx.slots`, and a plugin whose
 * `inject` omits it can be activated before the slot registry exists, which makes
 * `ctx.slots.inject(...)` throw and leaves the plugin silently inactive (present
 * in the boot graph, absent from every slot).
 */
export const inject = ["slots"];

/**
 * Plugin entry.
 * @param ctx - the client plugin context.
 */
export function apply(ctx) {
  ctx.effect(insertStyles, "intelligent-ui: styles");
  ctx.slots.inject("conversation.chat.turnTail", () =>
    ctx.slots.register(
      {
        name: "conversation.chat.turnTail",
        id: PLUGIN_ID,
        order: 50,
      },
      IntelligentUiTail,
    ),
  );
  console.log(`${PLUGIN_ID}: ready — assistant messages with a \`\`\`ui block render as cards.`);
}
