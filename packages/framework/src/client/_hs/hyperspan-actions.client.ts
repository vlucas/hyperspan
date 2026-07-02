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

/** Marks the end of a streaming chunk boundary. */
const CHUNK_END = '<!--/hs:chunk-->';

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
 * Read a (possibly streaming) HTML response. The stream is shaped as:
 *   [full initial page HTML, including <slot> placeholders]
 *   <template id="X_content">…<!--end--></template><script>…_hsc.push({id:'X'})…</script>
 *   …one <template>/<script> pair per async chunk…
 *
 * Network reads do NOT align with these logical boundaries, so we buffer instead of assuming
 * the whole initial page (or a whole chunk) arrives in a single read:
 *   1. Accumulate until the first stream-chunk <template> marker appears (or the stream ends),
 *      then Idiomorph the everything-before-it as the initial page HTML - exactly once.
 *   2. After that, append only COMPLETE chunks (each terminated by the server's <!--/hs:chunk-->
 *      delimiter) to document.body so their scripts run and placeholders resolve. Any partial
 *      trailing chunk stays buffered until the rest of it arrives.
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
  let buffer = '';
  let initialApplied = false;

  function pump(isFinal: boolean) {
    // Phase 1: split off and morph the initial page HTML (everything before the first chunk).
    if (!initialApplied) {
      const match = STREAM_CHUNK_MARKER.exec(buffer);
      if (match) {
        const initial = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index);
        initialApplied = true;
        if (initial) {
          applyInitialHtml(initial);
        }
      } else if (isFinal) {
        // No stream chunks at all - the whole response is the page HTML.
        initialApplied = true;
        if (buffer) {
          applyInitialHtml(buffer);
        }
        buffer = '';
        return;
      } else {
        // Marker not here yet; keep buffering the (possibly large) initial HTML.
        return;
      }
    }

    // Phase 2: flush complete chunks; hold back any partial trailing chunk.
    if (isFinal) {
      if (buffer) {
        appendHtmlToBody(buffer);
        buffer = '';
      }
      return;
    }
    const lastEnd = buffer.lastIndexOf(CHUNK_END);
    if (lastEnd === -1) {
      return;
    }
    const flushEnd = lastEnd + CHUNK_END.length;
    appendHtmlToBody(buffer.slice(0, flushEnd));
    buffer = buffer.slice(flushEnd);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      pump(true);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    pump(false);
  }
}
