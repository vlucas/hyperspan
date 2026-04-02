import { html } from '@hyperspan/html';
import { createRoute } from '@hyperspan/framework';
import AppLayout from '~/app/layouts/app-layout';
import addTodoAction from '~/app/actions/add-todo';
import deleteTodoAction from '~/app/actions/delete-todo';
import toggleTodoAction from '~/app/actions/toggle-todo';
import { getTodos } from '~/src/lib/db';

export default createRoute().get(async (context) => {
  const todos = await getTodos();
  const remaining = todos.filter((t) => !t.completed).length;

  const content = html`
    <main class="w-full max-w-2xl mx-auto py-12 px-4">
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-slate-800 mb-1">Todo List</h1>
        <p class="text-sm text-slate-400">
          ${remaining === 0 && todos.length > 0
            ? 'All done!'
            : `${remaining} task${remaining !== 1 ? 's' : ''} remaining`}
        </p>
      </div>

      <div class="mb-6">${addTodoAction.render(context)}</div>

      <ul class="space-y-2">
        ${todos.length === 0
          ? html`
              <li class="text-center text-slate-400 text-sm py-16">
                No tasks yet — add one above!
              </li>
            `
          : todos.map(
              (todo) => html`
                <li
                  class="flex items-center gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-sm group"
                >
                  ${toggleTodoAction.render(context, {
                    data: { id: String(todo.id), completed: String(todo.completed) },
                  })}
                  <span
                    class="flex-1 text-sm ${todo.completed
                      ? 'line-through text-slate-400'
                      : 'text-slate-700'}"
                  >
                    ${todo.title}
                  </span>
                  ${deleteTodoAction.render(context, { data: { id: String(todo.id) } })}
                </li>
              `
            )}
      </ul>

      ${todos.length > 0
        ? html`
            <p class="text-xs text-slate-400 text-center mt-6">
              ${todos.length} task${todos.length !== 1 ? 's' : ''} total
            </p>
          `
        : ''}
    </main>
  `;

  return AppLayout(context, { title: 'Todo App', content });
});
