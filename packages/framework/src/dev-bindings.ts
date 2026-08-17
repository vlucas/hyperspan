/** Dev-only platform bindings (D1, KV, etc.) shared across Vite SSR modules. */
let devBindings: unknown;

export function setDevBindings(env: unknown): void {
  devBindings = env;
}

export function getDevBindings(): unknown {
  return devBindings;
}

export function clearDevBindingsForTests(): void {
  devBindings = undefined;
}
