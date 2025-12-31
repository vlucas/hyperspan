import { Idiomorph } from './idiomorph';
import { lazyLoadScripts } from './hyperspan-scripts.client';

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
            if (!node || !node?.id || typeof node.id !== 'string') {
              return false;
            }
            return node.id?.startsWith('async_loading_') && node.id?.endsWith('_content');
          })
        )
        .filter((node: any) => node);

      asyncContent.forEach((templateEl: any) => {
        try {
          // Also observe for content inside the template content (shadow DOM is separate)
          asyncContentObserver.observe(templateEl.content, { childList: true, subtree: true });

          const slotId = templateEl.id.replace('_content', '');
          const slotEl = document.getElementById(slotId);

          if (slotEl) {
            // Content AND slot are present - let's insert the content into the slot
            // Ensure the content is fully done streaming in before inserting it into the slot
            waitForContent(templateEl.content, (el2) => {
              return Array.from(el2.childNodes).find(
                (node) => node.nodeType === Node.COMMENT_NODE && node.nodeValue === 'end'
              );
            })
              .then((endComment) => {
                templateEl.content.removeChild(endComment);
                const content = templateEl.content.cloneNode(true);
                Idiomorph.morph(slotEl, content);
                templateEl.parentNode.removeChild(templateEl);
                lazyLoadScripts();
              })
              .catch(console.error);
          } else {
            // Slot is NOT present - wait for it to be added to the DOM so we can insert the content into it
            waitForContent(document.body, () => {
              return document.getElementById(slotId);
            }).then((slotEl) => {
              Idiomorph.morph(slotEl, templateEl.content.cloneNode(true));
              lazyLoadScripts();
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

/**
 * Wait until ALL of the content inside an element is present from streaming in.
 * Large chunks of content can sometimes take more than a single tick to write to DOM.
 */
async function waitForContent(
  el: HTMLElement,
  waitFn: (
    node: HTMLElement
  ) => HTMLElement | HTMLTemplateElement | Node | ChildNode | null | undefined,
  options: { timeoutMs?: number; intervalMs?: number } = { timeoutMs: 10000, intervalMs: 20 }
): Promise<HTMLElement | HTMLTemplateElement | Node | ChildNode | null | undefined> {
  return new Promise((resolve, reject) => {
    let timeout: NodeJS.Timeout;
    const interval = setInterval(() => {
      const content = waitFn(el);
      if (content) {
        if (timeout) {
          clearTimeout(timeout);
        }
        clearInterval(interval);
        resolve(content);
      }
    }, options.intervalMs || 20);
    timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`[Hyperspan] Timeout waiting for end of streaming content ${el.id}`));
    }, options.timeoutMs || 10000);
  });
}