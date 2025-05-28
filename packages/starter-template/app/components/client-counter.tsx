import { h } from 'preact';
import { useState } from 'preact/compat';

export default function ClientCounter({ count: initialCount = 0 }: { count?: number }) {
  const [count, setCount] = useState(initialCount);

  return (
    <div className="bg-gray-100 w-96 shadow-sm p-4">
      <p className="py-4">A simple Preact/React client component with an interactive counter.</p>
      <h2 className="font-bold text-xl">Counter: {count}</h2>
      <div className="py-4">
        <button
          className="mx-2 bg-sky-300 text-black p-1 px-2 rounded border border-sky-800"
          onClick={() => setCount(count - 1)}
        >
          - Decrement
        </button>
        <button
          className="mx-2 bg-sky-300 text-black p-1 px-2 rounded border border-sky-800"
          onClick={() => setCount(count + 1)}
        >
          + Increment
        </button>
      </div>
    </div>
  );
}
