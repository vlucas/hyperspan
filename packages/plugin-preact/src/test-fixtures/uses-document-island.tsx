import { h } from 'preact';

/** Top-level DOM access (fires as soon as this module is evaluated, before any render). */
void document.documentElement;

export default function UsesDocumentIsland(_props: Record<string, never>) {
  return h('div', { 'data-test': 'uses-document-island' }, 'fixture');
}
