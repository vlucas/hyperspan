import { html } from '@hyperspan/html';
import { createRoute } from '@hyperspan/framework';
import { renderPreactIsland } from '@hyperspan/plugin-preact';
import { renderSvelteIsland } from '@hyperspan/plugin-svelte';
import { renderVueIsland } from '@hyperspan/plugin-vue';
import MarketingLayout from '~/app/layouts/marketing-layout';

// Client-side components
import ClientCounter from '~/app/components/client-counter';
import SvelteCounter from '~/app/components/svelte-counter.svelte';
import VueCounter from '~/app/components/vue-counter.vue';

// Styles
import '~/app/styles/index.css';

export default createRoute().get(async (context) => {
  const content = html`
    <main class="w-full">
      <!-- Hero -->
      <section class="bg-gradient-to-br from-slate-900 to-indigo-900 text-white py-24 px-6 text-center rounded-xl">
        <div class="max-w-3xl mx-auto">
          <div class="inline-block bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-sm font-mono px-3 py-1 rounded-full mb-6">
            HTML-first &bull; Server-rendered &bull; Islands Architecture
          </div>
          <h1 class="text-5xl font-bold mb-6 leading-tight text-white">
            Build fast web apps<br />with HTML-first architecture
          </h1>
          <p class="text-xl text-slate-300 mb-10 max-w-2xl mx-auto">
            Hyperspan renders everything on the server and ships only the JavaScript you need —
            sprinkle in interactive islands from any frontend framework.
          </p>
          <div class="flex gap-4 justify-center flex-wrap">
            <a
              href="https://www.hyperspan.dev"
              class="btn bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-semibold"
            >
              Get Started
            </a>
            <a
              href="https://github.com/vlucas/hyperspan"
              class="btn border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white px-6 py-3 rounded-lg font-semibold"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      <!-- Features -->
      <section class="py-20 px-6">
        <div class="max-w-4xl mx-auto">
          <h2 class="text-3xl font-bold text-center mb-12 text-slate-800">Why Hyperspan?</h2>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="p-6 rounded-xl border border-slate-200 bg-white shadow-sm">
              <div class="text-3xl mb-3">&#9889;</div>
              <h3 class="font-bold text-lg mb-2 text-slate-800">Server-First</h3>
              <p class="text-slate-600 text-sm">
                Pages are rendered on the server with zero client JS by default. Fast initial loads
                and great SEO out of the box.
              </p>
            </div>
            <div class="p-6 rounded-xl border border-slate-200 bg-white shadow-sm">
              <div class="text-3xl mb-3">&#127965;</div>
              <h3 class="font-bold text-lg mb-2 text-slate-800">Islands Architecture</h3>
              <p class="text-slate-600 text-sm">
                Only hydrate the parts of your page that need interactivity. Ship the minimal
                JavaScript possible.
              </p>
            </div>
            <div class="p-6 rounded-xl border border-slate-200 bg-white shadow-sm">
              <div class="text-3xl mb-3">&#128268;</div>
              <h3 class="font-bold text-lg mb-2 text-slate-800">Multi-Framework</h3>
              <p class="text-slate-600 text-sm">
                Use Preact, Svelte, and Vue — all on the same page. Pick the best tool for each job
                without compromise.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- Islands Demo -->
      <section class="py-20 px-6 bg-slate-50 rounded-xl">
        <div class="max-w-4xl mx-auto">
          <h2 class="text-3xl font-bold text-center mb-3 text-slate-800">
            Multi-Framework Islands
          </h2>
          <p class="text-center text-slate-500 mb-12">
            Each counter below is an independent interactive island powered by a different frontend
            framework — all on the same page, all server-rendered.
          </p>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <!-- Preact Island -->
            <div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div class="flex items-center gap-2 mb-4">
                <div class="w-2.5 h-2.5 rounded-full bg-purple-500"></div>
                <span class="text-xs font-mono text-slate-400 uppercase tracking-wider"
                  >Preact Island</span
                >
              </div>
              ${renderPreactIsland(ClientCounter, { count: 0 })}
            </div>

            <!-- Svelte Island -->
            <div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div class="flex items-center gap-2 mb-4">
                <div class="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
                <span class="text-xs font-mono text-slate-400 uppercase tracking-wider"
                  >Svelte Island</span
                >
              </div>
              ${await renderSvelteIsland(SvelteCounter, { count: 10 })}
            </div>

            <!-- Vue Island -->
            <div class="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div class="flex items-center gap-2 mb-4">
                <div class="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                <span class="text-xs font-mono text-slate-400 uppercase tracking-wider"
                  >Vue Island</span
                >
              </div>
              ${await renderVueIsland(VueCounter, { count: 100 })}
            </div>
          </div>
        </div>
      </section>
    </main>
  `;

  return MarketingLayout(context, {
    title: 'Hyperspan — HTML-first web framework',
    content,
  });
});
