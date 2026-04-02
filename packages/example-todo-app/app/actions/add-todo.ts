import { createAction } from '@hyperspan/framework/actions';
import { html } from '@hyperspan/html';
import * as z from 'zod/v4';
import { addTodo } from '~/src/lib/db';

const schema = z.object({
  title: z.string().min(1, 'Task title is required'),
});

export default createAction({ name: 'add-todo', schema })
  .form((c, { data, error }) => {
    return html`
      <form class="flex gap-2">
        <input
          type="text"
          name="title"
          value="${data?.title || ''}"
          placeholder="What needs to be done?"
          class="flex-1 border border-slate-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          autofocus
        />
        ${error ? html`<p class="text-red-500 text-xs mt-1">${error.message}</p>` : ''}
        <button
          type="submit"
          class="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-lg text-sm font-semibold"
        >
          Add
        </button>
      </form>
    `;
  })
  .post(async (c, { data }) => {
    await addTodo(data.title);
    return c.res.redirect('/');
  });
