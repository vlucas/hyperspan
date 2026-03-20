import { h } from 'preact';
import { useState } from 'preact/hooks';

export default function ClientCounter({ count = 0 }: { count?: number }) {
  const [current, setCurrent] = useState(count);

  return (
    <div>
      <p className="py-2 text-sm text-slate-600">A Preact island.</p>
      <p className="font-bold text-2xl my-3">Count: {current}</p>
      <div className="flex gap-2 mt-3">
        <button
          className="bg-purple-100 hover:bg-purple-200 text-purple-900 border border-purple-300 px-3 py-1.5 rounded text-sm font-medium transition-colors"
          onClick={() => setCurrent((c) => c - 1)}
        >
          - Decrement
        </button>
        <button
          className="bg-purple-100 hover:bg-purple-200 text-purple-900 border border-purple-300 px-3 py-1.5 rounded text-sm font-medium transition-colors"
          onClick={() => setCurrent((c) => c + 1)}
        >
          + Increment
        </button>
      </div>
    </div>
  );
}
