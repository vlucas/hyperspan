import { html, renderToString } from '@hyperspan/html';
import { Idiomorph } from './idomorph.esm';

function setupAsyncContentObserver() {
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
            // Wait until next paint for streaming content to finish writing to DOM
            // @TODO: Need a more guaranteed way to know HTML element is done streaming in...
            // Maybe some ".end" element that is hidden and then removed before insertion?
            requestAnimationFrame(() => {
              setTimeout(() => {
                Idiomorph.morph(slotEl, el.content.cloneNode(true));
                el.parentNode.removeChild(el);
              }, 100);
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
setupAsyncContentObserver();

/**
 * Event binding for added/updated content
 */
function setupEventBindingObserver() {
  if (typeof MutationObserver != 'undefined') {
    const eventBindingObserver = new MutationObserver((list) => {
      bindHyperspanEvents(document.body);
    });
    eventBindingObserver.observe(document.body, { childList: true, subtree: true });
  }
}
setupEventBindingObserver();

/**
 * Global Window assignments...
 */

// @ts-ignore
const hyperspan: any = {
  _fn: new Map(),
  wc: new Map(),
  compIdOrLast(id?: string) {
    let comp = hyperspan.wc.get(id);

    // Get last component if id lookup failed
    if (!comp) {
      const lastComp = Array.from(hyperspan.wc).pop();
      // @ts-ignore - The value returned from a Map is a tuple. The second value (lastComp[1]) is the actual value
      comp = lastComp ? lastComp[1] : false;
    }

    return comp || false;
  },
  fn(id: string, ufn: any) {
    const comp = this.compIdOrLast(id);

    const fnd = {
      id,
      cid: comp ? comp.id : null,
      fn: comp ? ufn.bind(comp) : ufn,
      comp,
    };

    this._fn.set(id, fnd);
  },
  // Binds function execution to the component instance so 'this' keyword works as expected inside event handlers
  fnc(id: string, ...args: any[]) {
    const fnd = this._fn.get(id);

    if (!fnd) {
      console.log('[Hyperspan] Unable to find function with id ' + id);
      return;
    }

    if (fnd.comp) {
      fnd.fn.call(fnd.comp, ...args);
    } else {
      fnd.fn(...args);
    }
  },
};

/**
 * Web component (foundation of client components)
 */
class HyperspanComponent extends HTMLElement {
  constructor() {
    super();
  }

  static get observedAttributes() {
    return ['data-state'];
  }

  randomId() {
    return Math.random().toString(36).substring(2, 9);
  }

  async render() {
    let content = '<div>Loading...</div>';

    const comp = hyperspan.wc.get(this.id);

    if (comp) {
      content = await renderToString(comp.render());
    }

    Idiomorph.morph(this, content, { morphStyle: 'innerHTML' });
  }

  connectedCallback() {
    const comp = hyperspan.wc.get(this.id);

    if (comp) {
      comp.mount && comp.mount();
    }
  }

  attributeChangedCallback() {
    this.render();
  }
}

// Bind events
function bindHyperspanEvents(webComponentEl: HTMLElement) {
  const domEvents = [
    'click',
    'dblclick',
    'contextmenu',
    'hover',
    'focus',
    'blur',
    'mouseup',
    'mousedown',
    'touchstart',
    'touchend',
    'touchcancel',
    'touchmove',
    'submit',
    'change',
    'scroll',
    'keyup',
    'keydown',
  ];
  const eventEls = Array.from(
    webComponentEl.querySelectorAll('[on' + domEvents.join('], [on') + ']')
  );

  for (let i = 0; i < eventEls.length; i++) {
    const el = eventEls[i] as HTMLElement;
    const elEvents = el.getAttributeNames();

    elEvents
      .filter((ev) => ev.startsWith('on'))
      .map((event) => {
        const fnId = el.getAttribute(event)?.replace('hyperspan:', '');

        if (fnId && el.dataset[event] !== fnId) {
          const eventName = event.replace('on', '');
          el.addEventListener(eventName, globalEventDispatch);
          el.dataset[event] = fnId;
          el.removeAttribute(event);
        }
      });
  }
}

// Proxies all events to the function they go to by event type
function globalEventDispatch(e: Event) {
  let el = e.target as HTMLElement;

  if (el) {
    const dataName = 'on' + e.type;
    let fnId = el.dataset[dataName];

    if (!fnId) {
      el = el.closest('[data-' + dataName + ']') || el;
    }

    fnId = el.dataset[dataName];

    if (fnId) {
      hyperspan.fnc(fnId, e, el);
    }
  }
}

customElements.define('hs-wc', HyperspanComponent);

// @ts-ignore
window.hyperspan = hyperspan;
// @ts-ignore
window.html = html;
