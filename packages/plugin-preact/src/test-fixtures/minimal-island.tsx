import { h } from 'preact';

export default function MinimalIsland(props: { name?: string; count?: number }) {
  return h(
    'div',
    { className: 'minimal-island-fixture' },
    `Hello ${props.name ?? '?'} (${props.count ?? 0})`
  );
}
