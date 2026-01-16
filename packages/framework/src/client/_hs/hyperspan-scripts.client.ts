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
export function lazyLoadScripts() {
  document
    .querySelectorAll('div[data-loading=lazy]')
    .forEach((el) => lazyLoadScriptObserver.observe(el));
}

window.addEventListener('load', () => {
  lazyLoadScripts();
});