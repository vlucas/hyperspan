const STORE_KEY = 'todos';

export interface Todo {
  id: number;
  title: string;
  completed: number;
  created_at: string;
}

type TodoStore = { todos: Todo[]; nextId: number };

let kv: KVNamespace | null = null;
let memoryStore: TodoStore | null = null;

export function initDb(binding: KVNamespace): void {
  kv = binding;
}

async function loadStore(): Promise<TodoStore> {
  if (kv) {
    const raw = await kv.get(STORE_KEY);
    if (!raw) {
      return { todos: [], nextId: 1 };
    }
    return JSON.parse(raw) as TodoStore;
  }

  if (!memoryStore) {
    memoryStore = { todos: [], nextId: 1 };
  }
  return memoryStore;
}

async function saveStore(store: TodoStore): Promise<void> {
  if (kv) {
    await kv.put(STORE_KEY, JSON.stringify(store));
    return;
  }
  memoryStore = store;
}

export async function getTodos(): Promise<Todo[]> {
  const store = await loadStore();
  return [...store.todos].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function addTodo(title: string): Promise<void> {
  const store = await loadStore();
  store.todos.push({
    id: store.nextId++,
    title,
    completed: 0,
    created_at: new Date().toISOString(),
  });
  await saveStore(store);
}

export async function deleteTodo(id: number): Promise<void> {
  const store = await loadStore();
  store.todos = store.todos.filter((t) => t.id !== id);
  await saveStore(store);
}

export async function toggleTodo(id: number): Promise<void> {
  const store = await loadStore();
  const todo = store.todos.find((t) => t.id === id);
  if (todo) {
    todo.completed = todo.completed === 0 ? 1 : 0;
    await saveStore(store);
  }
}
