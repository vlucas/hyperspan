import { html } from '@hyperspan/html';
import { createRoute } from '@hyperspan/framework';
import MarketingLayout from '~/app/layouts/marketing-layout';
import '~/app/styles/test.css';

export default createRoute().get((context) => {
  const content = html`
    <main class="test">
      <h1>Test Route</h1>
    </main>
  `;

  return MarketingLayout(context, {
    title: 'Test Route',
    content,
  });
});
