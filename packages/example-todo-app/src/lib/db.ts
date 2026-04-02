import { Database } from 'bun:sqlite';

const db = new Database('todos.sqlite', { create: true });

db.run(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

export interface Todo {
  id: number;
  title: string;
  completed: number;
  created_at: string;
}

export async function getTodos(): Promise<Todo[]> {
  return (await db.query('SELECT * FROM todos ORDER BY created_at DESC').all()) as Todo[];
}

export async function addTodo(title: string): Promise<void> {
  await db.run('INSERT INTO todos (title) VALUES (?)', [title]);
}

export async function deleteTodo(id: number): Promise<void> {
  await db.run('DELETE FROM todos WHERE id = ?', [id]);
}

export async function toggleTodo(id: number): Promise<void> {
  await db.run(
    'UPDATE todos SET completed = CASE WHEN completed = 0 THEN 1 ELSE 0 END WHERE id = ?',
    [id]
  );
}
