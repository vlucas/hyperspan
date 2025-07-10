import { html } from '@hyperspan/html';
import { Idiomorph } from './idiomorph';

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
            if (!node) {
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

/**
 * Server action component to handle the client-side form submission and HTML replacement
 */
class HSAction extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    actionFormObserver.observe(this, { childList: true, subtree: true });
    bindHSActionForm(this, this.querySelector('form') as HTMLFormElement);
  }
}
window.customElements.define('hs-action', HSAction);
const actionFormObserver = new MutationObserver((list) => {
  list.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node instanceof HTMLFormElement) {
        bindHSActionForm(node.closest('hs-action') as HSAction, node);
      }
    });
  });
});

/**
 * Bind the form inside an hs-action element to the action URL and submit handler
 */
function bindHSActionForm(hsActionElement: HSAction, form: HTMLFormElement) {
  if (!hsActionElement || !form) {
    return;
  }

  form.setAttribute('action', hsActionElement.getAttribute('url') || '');
  const submitHandler = (e: Event) => {
    formSubmitToRoute(e, form as HTMLFormElement, {
      afterResponse: () => bindHSActionForm(hsActionElement, form),
    });
    form.removeEventListener('submit', submitHandler);
  };
  form.addEventListener('submit', submitHandler);
}

/**
 * Submit form data to route and replace contents with response
 */
type TFormSubmitOptons = { afterResponse: () => any };
function formSubmitToRoute(e: Event, form: HTMLFormElement, opts: TFormSubmitOptons) {
  e.preventDefault();

  const formUrl = form.getAttribute('action') || '';
  const formData = new FormData(form);
  const method = form.getAttribute('method')?.toUpperCase() || 'POST';
  const headers = {
    Accept: 'text/html',
    'X-Request-Type': 'partial',
  };

  const hsActionTag = form.closest('hs-action');
  const submitBtn = form.querySelector('button[type=submit],input[type=submit]');
  if (submitBtn) {
    submitBtn.setAttribute('disabled', 'disabled');
  }

  fetch(formUrl, { body: formData, method, headers })
    .then((res: Response) => {
      // Look for special header that indicates a redirect.
      // fetch() automatically follows 3xx redirects, so we need to handle this manually to redirect the user to the full page
      if (res.headers.has('X-Redirect-Location')) {
        const newUrl = res.headers.get('X-Redirect-Location');
        if (newUrl) {
          window.location.assign(newUrl);
        }
        return '';
      }

      return res.text();
    })
    .then((content: string) => {
      // No content = DO NOTHING (redirect or something else happened)
      if (!content) {
        return;
      }

      const target = content.includes('<html') ? window.document.body : hsActionTag || form;

      Idiomorph.morph(target, content);
      opts.afterResponse && opts.afterResponse();
      lazyLoadScripts();
    });
}

/**
 * Intersection observer for lazy loading <script> tags
 */
const lazyLoadScriptObserver = new IntersectionObserver(
  (entries, observer) => {
    entries
      .filter((entry) => entry.isIntersecting)
      .forEach((entry) => {
        observer.unobserve(entry.target);
        // @ts-ignore
        if (entry.target.children[0]?.content) {
          // @ts-ignore
          entry.target.replaceWith(entry.target.children[0].content);
        }
      });
  },
  { rootMargin: '0px 0px -200px 0px' }
);

/**
 * Lazy load <script> tags in the current document
 */
function lazyLoadScripts() {
  document
    .querySelectorAll('div[data-loading=lazy]')
    .forEach((el) => lazyLoadScriptObserver.observe(el));
}

window.addEventListener('load', () => {
  lazyLoadScripts();
});

// @ts-ignore
window.html = html;
