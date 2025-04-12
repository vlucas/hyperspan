import { html } from '../html';
import { Idiomorph } from './idiomorph.esm';

/**
 * Used for streaming content from the server to the client.
 */
function htmlAsyncContentObserver() {
  if (typeof MutationObserver != 'undefined') {
    // Hyperspan - Async content loader
    // Puts streamed content in its place immediately after it is added to the DOM
    const asyncContentObserver = new MutationObserver((list) => {
      const asyncContent = list
        .map((mutation) =>
          Array.from(mutation.addedNodes).find((node: any) => {
            return node.id?.startsWith('async_') && node.id?.endsWith('_content');
          })
        )
        .filter((node: any) => node);

      asyncContent.forEach((el: any) => {
        try {
          // Also observe child nodes for nested async content
          asyncContentObserver.observe(el.content, { childList: true, subtree: true });

          const slotId = el.id.replace('_content', '');
          const slotEl = document.getElementById(slotId);

          if (slotEl) {
            // Wait until next paint for streaming content to finish writing to DOM
            // @TODO: Need a more guaranteed way to know HTML element is done streaming in...
            // Maybe some ".end" element that is hidden and then removed before insertion?
            requestAnimationFrame(() => {
              setTimeout(() => {
                Idiomorph.morph(slotEl, el.content.cloneNode(true));
                el.parentNode.removeChild(el);
              }, 100);
            });
          }
        } catch (e) {
          console.error(e);
        }
      });
    });
    asyncContentObserver.observe(document.body, { childList: true, subtree: true });
  }
}
htmlAsyncContentObserver();

// @ts-ignore
window.html = html;
