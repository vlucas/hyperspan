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

    activateScriptsIn(isFullDocument ? document.body : (target as ParentNode));

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

          // Same-origin + same path: fetch updated HTML and morph in place. Cross-origin redirects
          // must use full navigation (CORS and Idiomorph are not safe across domains).
          if (
            resolved.origin === window.location.origin &&
            resolved.pathname === window.location.pathname
          ) {
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

      await consumeStreamingHtmlResponse(res, applyResponseHtml);
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

/** Clone a script node so the browser will execute it (preserves module type). */
function cloneScriptForExecution(script: HTMLScriptElement): HTMLScriptElement {
  const executable = document.createElement('script');
  if (script.src) {
    executable.src = script.src;
  } else if (script.textContent) {
    executable.textContent = script.textContent;
  }
  if (script.type) {
    executable.type = script.type;
  }
  for (const attr of script.getAttributeNames()) {
    if (attr === 'src' || attr === 'type') {
      continue;
    }
    executable.setAttribute(attr, script.getAttribute(attr) || '');
  }
  return executable;
}

/** Run scripts inserted by Idiomorph (innerHTML/morph does not execute them). */
function activateScriptsIn(root: ParentNode) {
  root.querySelectorAll('script').forEach((script) => {
    if (script.closest('template[id$="_content"]')) {
      return;
    }
    script.replaceWith(cloneScriptForExecution(script));
  });
}

/** Append streamed HTML to body and run top-level chunk scripts (e.g. window._hsc.push). */
function appendHtmlToBody(html: string) {
  if (!html) {
    return;
  }

  const container = document.createElement('template');
  container.innerHTML = html;
  const scripts: HTMLScriptElement[] = [];

  for (const node of Array.from(container.content.childNodes)) {
    if (node.nodeName === 'SCRIPT') {
      scripts.push(node as HTMLScriptElement);
    }
  }

  for (const script of scripts) {
    script.remove();
  }

  document.body.appendChild(container.content);

  for (const script of scripts) {
    document.body.appendChild(cloneScriptForExecution(script));
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
