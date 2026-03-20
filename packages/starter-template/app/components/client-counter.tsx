import { h } from 'preact';
import { useState } from 'preact/compat';

export default function ClientCounter({ count: initialCount = 0 }: { count?: number }) {
  const [count, setCount] = useState(initialCount);

  return (
    <div>
      <p className="font-bold text-2xl my-3">Count: {count}</p>
      <div className="flex gap-2 mt-3">
        <button
          className="bg-purple-100 hover:bg-purple-200 text-purple-900 border border-purple-300 px-3 py-1.5 rounded text-sm font-medium transition-colors"
          onClick={() => setCount(count - 1)}
        >
          - Decrement
        </button>
        <button
          className="bg-purple-100 hover:bg-purple-200 text-purple-900 border border-purple-300 px-3 py-1.5 rounded text-sm font-medium transition-colors"
          onClick={() => setCount(count + 1)}
        >
          + Increment
        </button>
      </div>
    </div>
  );
}
