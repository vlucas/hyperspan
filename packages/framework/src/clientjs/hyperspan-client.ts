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

  connectedCallback() {
    setTimeout(() => {
      bindHSActionForm(this, this.querySelector('form') as HTMLFormElement);
      actionFormObserver.observe(this, { childList: true, subtree: true });
    }, 10);
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
  if (!form) {
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
