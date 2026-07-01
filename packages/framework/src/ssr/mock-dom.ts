/** Stamped on our mock `document` so reloads don't stack duplicates */
export const MOCK_DOM_MARK = '__hyperspan_mock_dom';

function markedMockDocument(d: unknown): boolean {
  return Boolean(
    d && typeof d === 'object' && (d as Record<string, unknown>)[MOCK_DOM_MARK] === true
  );
}

/** Minimal element-like node for the mock DOM; not a spec-compliant implementation */
export function stubElement(tag: string): any {
  const children: unknown[] = [];
  const node: Record<string, unknown> = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    nodeName: String(tag).toLowerCase(),
    id: '',
    className: '',
    textContent: '',
    innerHTML: '',
    childNodes: children,
    get children(): unknown[] {
      return children;
    },
    style: {},
    dataset: {},
    parentNode: null,
    parentElement: null,
    classList: {
      contains: () => false,
      add() {},
      remove() {},
      toggle() {
        return false;
      },
    },
    appendChild(child: any) {
      children.push(child);
      child.parentNode = node as unknown as ParentNode;
      child.parentElement = node as unknown as (ParentNode & Element) | null;
      return child;
    },
    insertBefore(child: unknown, ref: unknown | null) {
      const ch = node.childNodes as unknown[];
      const refIx = ref == null ? -1 : ch.indexOf(ref);
      if (refIx < 0) children.push(child);
      else children.splice(refIx, 0, child);
      (child as Record<string, unknown>).parentNode = node as unknown as ParentNode;
      (child as Record<string, unknown>).parentElement = node as unknown as
        | (ParentNode & Element)
        | null;
      return child as ChildNode as unknown as HTMLElement;
    },
    removeChild(child: unknown): unknown {
      const ix = children.indexOf(child);
      if (ix >= 0) children.splice(ix, 1);
      const c = child as Record<string, unknown>;
      c.parentElement = undefined;
      c.parentNode = undefined;
      return child as ChildNode;
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    setAttribute() {},
    removeAttribute() {},
    hasAttribute(): boolean {
      return false;
    },
    getAttribute(): null | string {
      return null;
    },
    cloneNode(): unknown {
      return stubElement(tag);
    },
    getBoundingClientRect: () =>
      ({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        toJSON() {
          return '{}';
        },
      }) as DOMRect,
    blur() {},
    focus() {},
    click() {},
  };
  return node;
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key(i: number) {
      const keys = [...m.keys()];
      return keys[i] ?? null;
    },
    clear() {
      m.clear();
    },
    getItem(key: string) {
      return m.get(String(key)) ?? null;
    },
    setItem(key: string, value: string) {
      m.set(String(key), String(value));
    },
    removeItem(key: string) {
      m.delete(String(key));
    },
  } as Storage;
}

/**
 * Installs minimal mock `window` / `document` globals for SSR on runtimes without a real DOM (e.g. Bun server).
 *
 * Skips installing when a real-ish `document` already exists unless it carries {@link MOCK_DOM_MARK}.
 *
 * Set `HYPERSPAN_DISABLE_MOCK_DOM=1` or `true` to opt out.
 */
export function installMockDom(): boolean {
  const env = typeof process !== 'undefined' ? process.env : {};
  const disabled =
    env.HYPERSPAN_DISABLE_MOCK_DOM === '1' || env.HYPERSPAN_DISABLE_MOCK_DOM === 'true';
  if (disabled) return false;

  const g = globalThis as unknown as Record<string, unknown>;

  if (markedMockDocument(g.document)) return false;

  if (typeof g.document !== 'undefined' && g.document !== null && !markedMockDocument(g.document)) {
    try {
      const d = g.document as Partial<Document>;
      if (d.body !== undefined && typeof d.createElement === 'function') {
        return false;
      }
    } catch {
      /* install mocks */
    }
  }

  const htmlEl = stubElement('html');
  const body = stubElement('body');
  const head = stubElement('head');
  (htmlEl as any).appendChild(head);
  (htmlEl as any).appendChild(body);

  const navigatorStub = {
    userAgent: 'HyperspanSSR/1.0',
    language: 'en-US',
    languages: ['en-US'],
    platform: 'server',
    onLine: true,
    maxTouchPoints: 0,
  };

  let rafId = 1;
  const scheduleRaf = (cb: FrameRequestCallback) => {
    queueMicrotask(() => cb(performance.now()));
    return rafId++;
  };

  const win: Record<string, unknown> = {
    name: '',
    innerWidth: 1024,
    innerHeight: 768,
    outerWidth: 1024,
    outerHeight: 768,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 0,
    scrollTo() {},
    navigator: navigatorStub,
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    history: {
      length: 1,
      state: null,
      scrollRestoration: 'auto' as ScrollRestoration,
      replaceState() {},
      pushState() {},
      forward() {},
      back() {},
      go() {},
    },
    location: new URL('http://localhost/ssr'),
    resizeTo() {},
    resizeBy() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    alert() {},
    matchMedia(query: string) {
      const media = String(query);
      return {
        media,
        matches: false,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
        onchange: null,
      };
    },
    getComputedStyle: () =>
      ({
        getPropertyValue: () => '',
        setProperty() {},
      }) as unknown as CSSStyleDeclaration,
    requestIdleCallback(cb: IdleRequestCallback) {
      queueMicrotask(() => cb({ didTimeout: false, timeRemaining: () => Number.MAX_SAFE_INTEGER }));
      return 1;
    },
    cancelIdleCallback() {},
    requestAnimationFrame: scheduleRaf,
    cancelAnimationFrame() {},
    MutationObserver:
      typeof globalThis.MutationObserver !== 'undefined'
        ? globalThis.MutationObserver
        : (class {
            constructor(_callback: MutationCallback) {}
            disconnect() {}
            observe() {}
            takeRecords(): MutationRecord[] {
              return [];
            }
          } as unknown as typeof MutationObserver),
    IntersectionObserver:
      typeof globalThis.IntersectionObserver !== 'undefined'
        ? globalThis.IntersectionObserver
        : (class {
            constructor(_cb: IntersectionObserverCallback, _opts?: unknown) {}
            unobserve() {}
            disconnect() {}
            observe() {}
            takeRecords() {
              return [];
            }
            root = null;
            rootMargin = '';
            thresholds = [];
          } as unknown as typeof IntersectionObserver),
    ResizeObserver:
      typeof globalThis.ResizeObserver !== 'undefined'
        ? globalThis.ResizeObserver
        : (class {
            constructor(_callback: ResizeObserverCallback) {}
            disconnect() {}
            observe() {}
            unobserve() {}
          } as unknown as typeof ResizeObserver),
  };

  win.self = win as unknown as Window & typeof globalThis;
  win.window = win as unknown as Window & typeof globalThis;

  const documentStub: Record<string, unknown> = {
    [MOCK_DOM_MARK]: true,
    nodeType: 9,
    defaultView: null as unknown as Window | null,
    compatibilityMode: 'CSS1Compat',
    documentElement: htmlEl as unknown as HTMLElement,
    body: body as unknown as HTMLElement,
    head: head as unknown as HTMLHeadElement,
    cookie: '',
    readyState: 'complete',
    URL: 'http://localhost/ssr/',
    referrer: '',
    hidden: false,
    visibilityState: 'visible' as DocumentVisibilityState,
    parentElement: null,
    appendChild(...args: unknown[]) {
      return (body.appendChild as (...a: unknown[]) => unknown)(...args);
    },
    querySelector(sel: unknown) {
      const s = String(sel).toLowerCase();
      if (s === 'body' || s === 'html body') return body as unknown as HTMLElement | null;
      if (s === 'html') return htmlEl as unknown as HTMLElement | null;
      return null;
    },
    querySelectorAll() {
      return {
        length: 0,
        item() {
          return null;
        },
        forEach() {},
        *[Symbol.iterator]() {},
      };
    },
    getElementById(id: unknown) {
      const sid = String(id);
      const e: Record<string, unknown> = stubElement('div');
      e.id = sid;
      e.getAttribute = (k: string) => (k === 'id' ? sid : null);
      e.hasAttribute = (k: string) => k === 'id';
      return e as unknown as HTMLElement;
    },
    getElementsByTagName() {
      return [];
    },
    getElementsByClassName() {
      return [];
    },
    createElement(tag: unknown) {
      return stubElement(String(tag ?? 'div')) as unknown as HTMLElement;
    },
    createTextNode(data: unknown) {
      const v = String(data ?? '');
      return { nodeType: 3, nodeValue: v, nodeName: '#text', textContent: v } as unknown as Text;
    },
    createDocumentFragment() {
      const frag: Record<string, unknown> = {
        nodeType: 11,
        childNodes: [] as unknown[],
        appendChild(child: unknown) {
          (frag.childNodes as unknown[]).push(child);
          return child;
        },
      };
      return frag as unknown as DocumentFragment;
    },
    elementFromPoint: () => null,
    caretRangeFromPoint: () => null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  };

  documentStub.defaultView = win as unknown as Window;
  win.document = documentStub;

  g.window = win as unknown as Window & typeof globalThis;
  g.document = documentStub as unknown as Document;

  try {
    (globalThis as any).navigator = navigatorStub as unknown as Navigator;
  } catch {
    /* empty */
  }

  if (typeof globalThis.requestAnimationFrame !== 'function')
    globalThis.requestAnimationFrame = scheduleRaf as typeof requestAnimationFrame;
  if (typeof globalThis.cancelAnimationFrame !== 'function')
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;

  return true;
}
