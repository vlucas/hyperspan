import { createAction } from '@hyperspan/framework/actions';
import { html } from '@hyperspan/html';
import * as z from 'zod/v4';
import { toggleTodo } from '~/src/lib/db';

const schema = z.object({
  id: z.string().min(1),
  completed: z.string().optional(),
});

export default createAction({ name: 'toggle-todo', schema })
  .form((c, { data }) => {
    const isDone = data?.completed === '1';
    return html`
      <form>
        <input type="hidden" name="id" value="${data?.id || ''}" />
        <input type="hidden" name="completed" value="${data?.completed || '0'}" />
        <button
          type="submit"
          title="${isDone ? 'Mark incomplete' : 'Mark complete'}"
          class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isDone
            ? 'bg-indigo-600 border-indigo-600 text-white'
            : 'border-slate-300 hover:border-indigo-400'}"
        >
          ${isDone ? html`<span class="text-xs">&#10003;</span>` : ''}
        </button>
      </form>
    `;
  })
  .post(async (c, { data }) => {
    await toggleTodo(parseInt(data.id, 10));
    return c.res.redirect('/');
  });
