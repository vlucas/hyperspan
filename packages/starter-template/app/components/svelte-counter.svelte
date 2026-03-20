<script>
  let { count = 0 } = $props();
  let current = $state(count);
</script>

<div>
  <p class="py-2 text-sm text-slate-600">A Svelte 5 island.</p>
  <p class="font-bold text-2xl my-3">Count: {current}</p>
  <div class="flex gap-2 mt-3">
    <button
      class="bg-orange-100 hover:bg-orange-200 text-orange-900 border border-orange-300 px-3 py-1.5 rounded text-sm font-medium transition-colors"
      onclick={() => current--}
    >
      - Decrement
    </button>
    <button
      class="bg-orange-100 hover:bg-orange-200 text-orange-900 border border-orange-300 px-3 py-1.5 rounded text-sm font-medium transition-colors"
      onclick={() => current++}
    >
      + Increment
    </button>
  </div>
</div>
