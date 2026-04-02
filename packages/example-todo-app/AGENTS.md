## Commands

```bash
bun run dev      # Start dev server
bun run start    # Start production server
bun run test     # Run tests with Bun's test runner
```

## Architecture

This is a [Hyperspan](https://www.hyperspan.dev/docs/install) application using an **Islands Architecture** — pages are server-rendered HTML by default, with interactive sections hydrated as isolated client-side islands.

**Key directories:**

- `app/routes/` — File-based routing. Each file exports a `createRoute()` handler and maps directly to a URL path.
- `app/components/` — Interactive island components (only use Preact `.tsx` for this application)
- `app/layouts/` — Reusable server-side HTML layout wrappers
- `app/styles/` — Global and per-page CSS (Tailwind v4). Import CSS files directly in TypeScript and Hyperspan will automatically bundle CSS for that route.
- `app/actions/` — Server actions. One per file. Each file exports a `createAction()` handler from `@hyperspan/framework/actions`. Renders a form with HTML and has built-in validation with Zod v4 schemas. `createAction().post((c: HS.Context) => { ... })` handler can return an HTML template, redirect, or return any other appropriate `Response` object. Errors thrown here are automatically caught and displayed to the user in the `createAction().form((c: HS.Context, { data, error }) => HSHTML)` via the `error` property.
- `src/lib/` — Shared utility code goes here

**Layouts** inject Tailwind output and island hydration scripts via `hyperspanStyleTags(context)` and `hyperspanScriptTags()`.

**Path alias:** `~/*` resolves to the repo root.

## Code Style

Prettier config: 100-char line width, 2-space indent, single quotes, semicolons, trailing commas (ES5). Always format code with prettier after writing to a file.
