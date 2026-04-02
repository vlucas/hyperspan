import { createAction } from '@hyperspan/framework/actions';
import { html } from '@hyperspan/html';
import * as z from 'zod/v4';
import { deleteTodo } from '~/src/lib/db';

const schema = z.object({
  id: z.string().min(1),
});

export default createAction({ name: 'delete-todo', schema })
  .form((c, { data }) => {
    return html`
      <form>
        <input type="hidden" name="id" value="${data?.id || ''}" />
        <button
          type="submit"
          title="Delete task"
          class="text-slate-300 hover:text-red-500 transition-colors p-1 rounded"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
          </svg>
        </button>
      </form>
    `;
  })
  .post(async (c, { data }) => {
    await deleteTodo(parseInt(data.id, 10));
    return c.res.redirect('/');
  });
