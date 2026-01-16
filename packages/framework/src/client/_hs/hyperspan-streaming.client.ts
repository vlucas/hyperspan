import { lazyLoadScripts } from './hyperspan-scripts.client';

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

function renderStreamChunk(chunk: { id: string }) {
  const slotId = chunk.id;
  const slotEl = document.getElementById(slotId);
  const templateEl = document.getElementById(`${slotId}_content`) as HTMLTemplateElement;

  if (slotEl) {
    // Content AND slot are present - let's insert the content into the slot
    // Ensure the content is fully done streaming in before inserting it into the slot
    waitForContent(templateEl.content as unknown as HTMLElement, (el2) => {
      return Array.from(el2.childNodes).find(
        (node) => node.nodeType === Node.COMMENT_NODE && node.nodeValue === 'end'
      );
    })
      .then((endComment) => {
        templateEl.content.removeChild(endComment as Node);
        const content = templateEl.content.cloneNode(true);
        slotEl.replaceWith(content);
        templateEl.parentNode?.removeChild(templateEl);
        lazyLoadScripts();
      })
      .catch(console.error);
  } else {
    // Slot is NOT present - wait for it to be added to the DOM so we can insert the content into it
    waitForContent(document.body, () => {
      return document.getElementById(slotId);
    }).then((slotEl) => {
      (slotEl as HTMLElement)?.replaceWith(templateEl.content.cloneNode(true));
      lazyLoadScripts();
    });
  }
}

// @ts-ignore
window._hscc = renderStreamChunk;