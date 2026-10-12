import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const DB_PATH = join(process.cwd(), 'todos.json');

export interface Todo {
  id: number;
  title: string;
  completed: number;
  created_at: string;
}

type TodoStore = { todos: Todo[]; nextId: number };

async function loadStore(): Promise<TodoStore> {
  if (!existsSync(DB_PATH)) {
    return { todos: [], nextId: 1 };
  }
  const raw = await readFile(DB_PATH, 'utf-8');
  return JSON.parse(raw) as TodoStore;
}

async function saveStore(store: TodoStore): Promise<void> {
  await mkdir(join(process.cwd()), { recursive: true });
  await writeFile(DB_PATH, JSON.stringify(store, null, 2));
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
