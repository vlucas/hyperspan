import { html } from '@hyperspan/html';
import { createRoute } from '@hyperspan/framework';
import { renderIsland } from '@hyperspan/framework/clientjs';
import MarketingLayout from '~/app/layouts/marketing-layout';
import ClientCounter from '~/app/components/client-counter';

export default createRoute().get(() => {
  const content = html`
    <main class="w-full mt-10">
      <section class=" py-12 text-center bg-gray-200">
        <h1 class="my-6 text-5xl/14">Your Big Headline Here</h1>
        <h2 class="my-10 text-2xl">Sub-Headline Goes Here</h2>
        <div class="mt-10 my-6">
          <p>Some text here</p>
          <p>Some text here</p>
          <a
            class="inline-block mt-10 p-2 px-4 text-lg bg-blue-600 text-white border border-blue-400 rounded shadow-sm"
            href="https://www.hyperspan.dev"
            >Action Item</a
          >
        </div>
      </section>

      <section class="mt-10 p-8">
        <!-- Call ClientCounter with renderIsland() and pass props! -->
        ${renderIsland(ClientCounter, { count: 5 })}
      </section>
    </main>
  `;

  return MarketingLayout({
    title: 'Homepage',
    content,
  });
});
