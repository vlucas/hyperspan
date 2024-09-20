# Hyperspan. Simple. Full-Stack. Streaming.

> [!NOTE] > **Hyperspan is still in the early stages of development, your feedback is appreciated.**

Hyperspan is a full-stack framework built with [Bun](https://bun.sh) that is focused on simplicity and ease of use.

No JSX. No Virtual DOM. No hydration time. No nonsense. Just blazing fast HTML strings with reactive templates.

## Who Is Hyperspan For?

Hyperspan is best for websites, web applications, and APIs that need fast streaming and dynamic server responses. It is
great for performance critical applications and delivers no client-side JavaScript by default. This helps to ensure your
website stays fast and lightweight for end users as it grows over time, since all client JavaScript is explicitly
opt-in.

## Why Bun?

[Bun](https://bun.sh) is a Node-compatible runtime that offers better performance and built-in TypeScript support so
transpiling is not required for writing type-safe server-side code. Bun also offers some other extras like built-in
ultra fast testing utilities so extra dependencies are not required to write high-quality code.

## React vs. Hyperspan

Hyperspan is not a React replacement. React is a client-side library to build interactive JavaScript based UIs.
Hyperspan is a full-stack server-side framework built to deliver high-performance streaming and dynamic responses, and
does not deliver any JavaScript to the client by default.

Hyperspan can be best thought of as an _alternative_ to React-based frameworks like Next.js. It has all the same types
of things, like file-based page routes, API routes, middleware, components, etc. but Hyperspan has a very different
runtime and execution model. React-based frameworks ship all React components and code to the client by default,
resulting in surprisingly large JS bundle sizes that grow more over time as your site does. Hyperspan takes the opposite
approach, and does not ship ANY components to the client by default. Client components are available, but are explicitly
opt-in and should generally be used sparingly.

React is all JavaScript, all the time, delivered to the client. Hyperspan is mostly static content and markup delivered
to the client, with JavaScript sprinkles where needed.

## Philosophy

### P1: Server-Side First.

Current JavaScript frameworks ship everything to the browser by default and use non-intuitive ways to opt-out of this.
The first clue that this approach was backwards was when JavaScript bundle sizes started being measured in hundreds of
kilobytes to megabytes.

Keeping bundle sizes down in large projects over time can be challenging. A full stack framework should render as much
as possible on the server by default for better performance. Sending JavaScript code to the client and increasing bundle
sizes for all your users should be explicit and opt-in.

Modern frameworks make it too easy to _accidentally_ ship code to the client that you don't want. They often mix client
and server concerns in a way that is hard to understand and keep separate. They return cryptic and confusing errors when
you make mistakes around client and server boundaries.

We've lost the forrest from the trees. The complixity has become too much, and users are paying the price.

This is the way back for a full-stack framework:

- Server fetching and rendering by default.
- Minimal client-side JavaScript by default. Code that ships to the client should be explicit and opt-in.
- Most of the work and state should be maintained on the server. The framework should help make this easy.

### P2: Performance Oriented.

Server-side code is fast because it sends HTML strings to the client and lets the browser do its job - the job that is
was built specifically to do. There is no sense in typing up the JavaScript thread for rendering markup that can just be
sent directly.

You don't need a Virtual DOM or expensive reconciliation diff calculations to make interactive web sites or
applications. You just need a more intelligent template that knows the pieces that update.

HTML strings are the fastest and easiest way to update the parts of the DOM that change. We have known this since the
Web 1.0 days of AJAX and template partials. Modern JavaScript built-ins like Tagged Template Literals are an obvious
choice to do do the same thing today, and are built into the language.

### P3: Works the Same In Every Context.

All templates and components should be rendered asynchronously to allow you to do any other kind of asynchronous work in
them that you need to, in any context that you do it in. It's just JavaScript. Not special framework-flavored
JavaScript.

There should be no difference in how a template or component is rendered in one context vs. another. It should not
matter if a component runs on the client or the server, or fetches data or streams in. The core conceptual semantics
should be the same everywhere.
