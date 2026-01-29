import { Idiomorph } from './idiomorph';
import { lazyLoadScripts } from './hyperspan-scripts.client';

const actionFormObserver = new MutationObserver((list) => {
  list.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node && ('closest' in node || node instanceof HTMLFormElement)) {
        bindHSActionForm(
          (node as HTMLElement).closest('hs-action') as HSAction,
          node instanceof HTMLFormElement
            ? node
            : ((node as HTMLElement | HTMLFormElement).querySelector('form') as HTMLFormElement)
        );
      }
    });
  });
});

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

/**
 * Bind the form inside an hs-action element to the action URL and submit handler
 */
function bindHSActionForm(hsActionElement: HSAction, form: HTMLFormElement) {
  if (!hsActionElement || !form) {
    return;
  }

  form.setAttribute('action', hsActionElement.getAttribute('url') || '');
  const submitHandler = (e: Event) => {
    e.preventDefault();
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
  const formData = new FormData(form);
  const formUrl = form.getAttribute('action') || '';
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

      Idiomorph.morph(target, content, { morphStyle: 'innerHTML' });
      opts.afterResponse && opts.afterResponse();
      lazyLoadScripts();
    });
}