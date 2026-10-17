/**
 * Host half of dsh-intelligent-ui.
 *
 * Its only job is to teach the model OpenUI Lang, so assistant messages contain
 * `ui` blocks the browser half renders. The renderer lives entirely in
 * `client.js`; nothing here touches the conversation UI.
 */
import {
  PROMPT_SECTION_NAME,
  PROMPT_SECTION_ORDER,
  buildPrompt,
} from './prompt.js';

/**
 * Register the OpenUI authoring prompt.
 * @param ctx - the plugin's Cordis context.
 */
function apply(ctx) {
  ctx.inject(['systemPrompt'], (child) => {
    const systemPrompt = child.get('systemPrompt');
    if (systemPrompt === undefined) return;
    child.effect(
      () =>
        systemPrompt.section({
          name: PROMPT_SECTION_NAME,
          order: PROMPT_SECTION_ORDER,
          text: buildPrompt(),
        }),
      'intelligent-ui: OpenUI Lang authoring instructions',
    );
  });
}

export { apply };
