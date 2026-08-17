# Hyperspan agent rules

Hyperspan is a **framework other people build on**. Prefer a general API over a one-off fix. If the framework needs a
capability, app authors likely need the same capability.

## Use the public API internally

Framework code should achieve things the same way consumers do: call the public API, pass options, register through the
same hooks.

- Do not add hard-coded names, allowlists, or special cases for built-in behavior (`streaming`, `actions`, a specific
        island, a specific adapter, …).
- Do not fork an internal path that apps cannot use. If built-in client JS must run as a classic script, that is `buildClientJS('~/app/client/file.ts', { type: 'iife' })` — the same call an app uses. Prefer a tsconfig alias or project-root path. Relative `./` / `../` paths must use `import.meta.resolve('./file.ts')` at the call site.
- When a new requirement shows up, extend the public API (options, registries, events). Then use that extension inside
the framework.
- Built-ins are just default registrations of those APIs, not privileged exceptions.

## Packages stay independent

`@hyperspan/framework`, each `@hyperspan/plugin-*`, and each `@hyperspan/adapter-*` are separate packages. They share
data through **public APIs or events**, not by importing each other.

**Allowed**

- Plugins and adapters depend on `@hyperspan/framework` (and `@hyperspan/html`) only.
- The app wires pieces together (`hyperspan.config.ts`, `vite.config.ts`).
- `@hyperspan/adapter-node` is the one exception: it is the default adapter, and Vite already requires Node.
`@hyperspan/framework` and `@hyperspan/vite-plugin` may import it. No other adapter gets this privilege.

**Not allowed**

- Framework importing a plugin or a non-Node adapter.
- A plugin importing another plugin, an adapter, or Vite-plugin internals that are not a documented public API.
- An adapter importing another adapter or a plugin.
- Switching on package names, filenames, or framework ids instead of using a registry/event the extension already opted
into.

New runtimes, islands, or client scripts should work by implementing the public contract and being registered by the app
— without editing core switch statements.
