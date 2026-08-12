export function mountTodoStats() {
  const el = document.getElementById('todo-client-stats');
  if (!el) return;
  el.textContent = `Client JS active · ${new Date().toLocaleTimeString()}`;
  el.classList.add('text-emerald-600');
}
