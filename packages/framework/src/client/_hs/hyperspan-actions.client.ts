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
  const confirmMessage = form.getAttribute('data-confirm') || '';
  const headers = {
    Accept: 'text/html',
    'X-Request-Type': 'partial',
  };

  if (confirmMessage) {
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) {
      return;
    }
  }

  const hsActionTag = form.closest('hs-action');
  const submitBtn = form.querySelector('button[type=submit],input[type=submit]');
  if (submitBtn) {
    submitBtn.setAttribute('disabled', 'disabled');
  }

  function applyResponseHtml(html: string) {
    const isFullDocument = html.includes('<html');
    if (isFullDocument) {
      html = html.replace(/^[\s\uFEFF]*<!DOCTYPE[^>]*>/i, '');
    }
    const target = isFullDocument ? window.document : hsActionTag || form;
    const options = isFullDocument ? undefined : { morphStyle: 'innerHTML' };

    Idiomorph.morph(target, html, options);

    if (!isFullDocument) {
      const outerElement = target.querySelector('hs-action');
      if (outerElement) {
        outerElement.replaceWith(...outerElement.childNodes);
      }
    }

    opts.afterResponse && opts.afterResponse();
    lazyLoadScripts();
  }

  fetch(formUrl, { body: formData, method, headers })
    .then(async (res: Response) => {
      // Look for special header that indicates a redirect.
      // fetch() automatically follows 3xx redirects, so we need to handle this manually to redirect the user to the full page
      if (res.headers.has('X-Redirect-Location')) {
        const newUrl = res.headers.get('X-Redirect-Location');
        if (newUrl) {
          const resolved = new URL(newUrl, window.location.href);

          // If the new URL is the same as the current URL, we can just fetch the new HTML and apply it
          if (resolved.pathname === window.location.pathname) {
            const pageRes = await fetch(resolved.href, {
              headers: { Accept: 'text/html' },
            });
            await consumeStreamingHtmlResponse(pageRes, applyResponseHtml);
            return;
          }

          // If the new URL is different, we need to redirect the user to the new URL
          window.location.assign(newUrl);
        }
        return;
      }

      const content = await res.text();
      // No content = DO NOTHING (redirect or something else happened)
      if (!content) {
        return;
      }

      applyResponseHtml(content);
    })
    .catch((error) => {
      console.error('[Hyperspan] Error submitting form action:', error);
    });
}

/** Streaming async chunks use template ids ending in `_content`. */
const STREAM_CHUNK_MARKER = /<template id="[^"]+_content">/;

function splitInitialStreamHtml(html: string): { initial: string; streamTail: string | null } {
  const match = STREAM_CHUNK_MARKER.exec(html);
  if (!match || match.index === 0) {
    return { initial: html, streamTail: null };
  }
  return {
    initial: html.slice(0, match.index),
    streamTail: html.slice(match.index),
  };
}

/** Append streamed HTML to body and run any inline scripts (e.g. window._hsc.push). */
function appendHtmlToBody(html: string) {
  if (!html) {
    return;
  }

  const template = document.createElement('template');
  template.innerHTML = html;
  const scripts: HTMLScriptElement[] = [];
  template.content.querySelectorAll('script').forEach((script) => {
    scripts.push(script);
    script.remove();
  });
  document.body.appendChild(template.content);
  for (const script of scripts) {
    const executable = document.createElement('script');
    if (script.src) {
      executable.src = script.src;
    } else {
      executable.textContent = script.textContent;
    }
    document.body.appendChild(executable);
  }
}

/**
 * Read a (possibly streaming) HTML response: Idiomorph the initial page HTML, then append
 * later stream chunks to document.body so streaming scripts run and placeholders resolve.
 */
async function consumeStreamingHtmlResponse(
  res: Response,
  applyInitialHtml: (html: string) => void
) {
  const body = res.body;
  if (!body) {
    const text = await res.text();
    if (text) {
      applyInitialHtml(text);
    }
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let isFirstChunk = true;

  function processChunk(html: string) {
    if (!html) {
      return;
    }

    if (isFirstChunk) {
      isFirstChunk = false;
      const { initial, streamTail } = splitInitialStreamHtml(html);
      if (initial) {
        applyInitialHtml(initial);
      }
      if (streamTail) {
        appendHtmlToBody(streamTail);
      }
      return;
    }

    appendHtmlToBody(html);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      processChunk(decoder.decode());
      break;
    }
    processChunk(decoder.decode(value, { stream: true }));
  }
}