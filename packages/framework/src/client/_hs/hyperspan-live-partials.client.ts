import { Idiomorph } from "./idiomorph";

// Enable live partial updates when URL params change with <hs-live-partial> web component
class HSLivePartial extends HTMLElement {
  constructor() {
    super();
  }

  // Update the live partial by fetching the new HTML from the server and applying the diff
  update() {
    const path = this.getAttribute('path');
    if (!path) {
      return;
    }
    // Do an HTTP request to the live partial route
    fetch(path)
      .then(response => response.text())
      .then(html => {
        const el = this.shadowRoot?.querySelector('div') || this;
        Idiomorph.morph(el, html, { morphStyle: 'innerHTML' });

        // Check for nested hs-live-partial elements and remove them if present
        const outerElement = el.querySelector('hs-live-partial');
        if (outerElement) {
          outerElement.replaceWith(...outerElement.childNodes);
        }
      });
  }

  connectedCallback() {
    this.addEventListener('click', () => {
      this.update();
    });
  }
}

customElements.define('hs-live-partial', HSLivePartial);

const pagePathname = window.location.pathname;

// Update partials when URL query or hash changes while still on the same page
window.addEventListener('popstate', () => {
  if (window.location.pathname !== pagePathname) {
    return;
  }
  document.querySelectorAll('hs-live-partial').forEach((el) => {
    if (el instanceof HSLivePartial) {
      el.update?.();
    }
  });
});