import { Idiomorph } from './idiomorph';
import { lazyLoadScripts } from './hyperspan-scripts.client';
import type { Hyperspan as HS } from '../../types';

const HS_ACTION_BEFORE_FETCH: HS.ActionEventName = 'hs:action:before-fetch';
const HS_ACTION_AFTER_FETCH: HS.ActionEventName = 'hs:action:after-fetch';
const HS_ACTION_BEFORE_SWAP: HS.ActionEventName = 'hs:action:before-swap';
const HS_ACTION_AFTER_SWAP: HS.ActionEventName = 'hs:action:after-swap';
const HS_ACTION_BEFORE_NAVIGATE: HS.ActionEventName = 'hs:action:before-navigate';

function dispatchActionEvent<T>(
  target: EventTarget,
  name: HS.ActionEventName,
  detail: T,
  cancelable = false
): boolean {
  return target.dispatchEvent(
    new CustomEvent(name, {
      detail,
      bubbles: true,
      cancelable,
      composed: true,
    })
  );
}

/** No box by default (`display: contents`) — style `:has(hs-action-loading)` for loading UI. */
function ensureActionLoadingStyles() {
  if (document.getElementById('hs-action-loading-style')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'hs-action-loading-style';
  style.textContent = 'hs-action-loading{display:contents}';
  document.head.appendChild(style);
}

class HSActionLoading extends HTMLElement {
  connectedCallback() {
    ensureActionLoadingStyles();
  }
}

if (!customElements.get('hs-action-loading')) {
  customElements.define('hs-action-loading', HSActionLoading);
}

function setActionLoading(hsActionTag: HTMLElement | null, loading: boolean) {
  if (!hsActionTag) {
    return;
  }
  const existing = hsActionTag.querySelector('hs-action-loading');
  if (loading) {
    if (!existing) {
      hsActionTag.appendChild(document.createElement('hs-action-loading'));
    }
  } else if (existing) {
    existing.remove();
  }
}

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

  const hsActionTag = form.closest('hs-action') as HTMLElement | null;
  const eventTarget: EventTarget = hsActionTag || document;
  const fetchDetail: HS.ActionFetchDetail = {
    form,
    action: hsActionTag,
    url: formUrl,
    method,
    loadingElement: true,
  };

  if (!dispatchActionEvent(eventTarget, HS_ACTION_BEFORE_FETCH, fetchDetail, true)) {
    return;
  }

  if (fetchDetail.loadingElement) {
    setActionLoading(hsActionTag, true);
  }

  const submitBtn = form.querySelector('button[type=submit],input[type=submit]');
  if (submitBtn) {
    submitBtn.setAttribute('disabled', 'disabled');
  }

  function applyResponseHtml(html: string) {
    const isFullDocument = html.includes('<html');
    if (isFullDocument) {
      html = html.replace(/^[\s\uFEFF]*<!DOCTYPE[^>]*>/i, '');
    }

    const swapDetail: HS.ActionSwapDetail = {
      form,
      action: hsActionTag,
      html,
      fullDocument: isFullDocument,
    };

    if (!dispatchActionEvent(eventTarget, HS_ACTION_BEFORE_SWAP, swapDetail, true)) {
      return;
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

    dispatchActionEvent(eventTarget, HS_ACTION_AFTER_SWAP, swapDetail);

    opts.afterResponse && opts.afterResponse();
    lazyLoadScripts();
  }

  async function navigateTo(url: string, preferHard: boolean) {
    const navigateDetail: HS.ActionNavigateDetail = {
      form,
      action: hsActionTag,
      url,
      hardNavigate: preferHard,
    };

    if (!dispatchActionEvent(eventTarget, HS_ACTION_BEFORE_NAVIGATE, navigateDetail, true)) {
      return;
    }

    if (navigateDetail.hardNavigate) {
      window.location.assign(navigateDetail.url);
      return;
    }

    // Soft morph requires same-origin (CORS / Idiomorph are not safe across domains).
    const resolved = new URL(navigateDetail.url, window.location.href);
    if (resolved.origin !== window.location.origin) {
      window.location.assign(navigateDetail.url);
      return;
    }

    const pageRes = await fetch(navigateDetail.url, {
      headers: { Accept: 'text/html' },
    });
    await consumeStreamingHtmlResponse(pageRes, applyResponseHtml);
  }

  fetch(formUrl, { body: formData, method, headers })
    .then(async (res: Response) => {
      // Look for special header that indicates a redirect.
      // fetch() automatically follows 3xx redirects, so we need to handle this manually to redirect the user to the full page
      if (res.headers.has('X-Redirect-Location')) {
        const newUrl = res.headers.get('X-Redirect-Location');
        if (newUrl) {
          const resolved = new URL(newUrl, window.location.href);

          // Default: same-origin + same path → soft morph; anything else → hard navigation.
          // Listeners can flip detail.hardNavigate on hs:action:before-navigate to override.
          const preferHard =
            resolved.origin !== window.location.origin ||
            resolved.pathname !== window.location.pathname;

          await navigateTo(newUrl, preferHard);
        }
        return;
      }

      await consumeStreamingHtmlResponse(res, applyResponseHtml);
    })
    .catch((error) => {
      console.error('[Hyperspan] Error submitting form action:', error);
    })
    .finally(() => {
      setActionLoading(hsActionTag, false);
      dispatchActionEvent(eventTarget, HS_ACTION_AFTER_FETCH, fetchDetail);
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
