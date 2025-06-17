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
            // Only insert the content if it is done streaming in
            waitForEndContent(el.content).then(() => {
              Idiomorph.morph(slotEl, el.content.cloneNode(true));
              el.parentNode.removeChild(el);
            });

            // Lazy load scripts (if any) after the content is inserted
            lazyLoadScripts();
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
async function waitForEndContent(el: HTMLElement) {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const endComment = Array.from(el.childNodes).find((node) => {
        return node.nodeType === Node.COMMENT_NODE && node.nodeValue === 'end';
      });
      if (endComment) {
        el.removeChild(endComment);
        clearInterval(interval);
        resolve(true);
      }
    }, 10);
  });
}

/**
 * Server action component to handle the client-side form submission and HTML replacement
 */
class HSAction extends HTMLElement {
  constructor() {
    super();
  }

  // Element is mounted in the DOM
  connectedCallback() {
    const form = this.querySelector('form');

    if (form) {
      form.addEventListener('submit', (e) => {
        formSubmitToRoute(e, form as HTMLFormElement);
      });
    }
  }
}
window.customElements.define('hs-action', HSAction);

/**
 * Submit form data to route and replace contents with response
 */
function formSubmitToRoute(e: Event, form: HTMLFormElement) {
  e.preventDefault();

  const formUrl = form.getAttribute('action') || '';
  const formData = new FormData(form);
  const method = form.getAttribute('method')?.toUpperCase() || 'POST';

  let response: Response;

  fetch(formUrl, { body: formData, method })
    .then((res: Response) => {
      // @TODO: Handle redirects with some custom server thing?
      // This... actually won't work, because fetch automatically follows all redirects (a 3xx response will never be returned to the client)
      const isRedirect = [301, 302].includes(res.status);

      // Is response a redirect? If so, let's follow it in the client!
      if (isRedirect) {
        const newUrl = res.headers.get('Location');
        if (newUrl) {
          window.location.assign(newUrl);
        }
        return '';
      }

      response = res;
      return res.text();
    })
    .then((content: string) => {
      // No content = DO NOTHING (redirect or something else happened)
      if (!content) {
        return;
      }

      Idiomorph.morph(form, content);
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
