// All internal runtime symbols used by compiled Svelte 5 components
export * from 'svelte/internal/client';
// Public API — explicit to avoid ambiguous re-export errors
export { hydrate, mount, unmount, flushSync, tick, untrack, getContext, setContext, hasContext, getAllContexts, createRawSnippet } from 'svelte';
// Store utilities — 'get' is excluded because svelte/internal/client also exports 'get'
// (the reactive signal getter), and the ambiguity would silently drop both.
export { writable, readable, derived, readonly, toStore, fromStore } from 'svelte/store';
