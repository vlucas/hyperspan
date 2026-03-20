<template>
  <div>
    <p class="py-2 text-sm text-slate-600">A Vue 3 island with reactive state.</p>
    <p class="font-bold text-2xl my-3">Count: {{ current }}</p>
    <div class="flex gap-2 mt-3">
      <button
        class="bg-green-100 hover:bg-green-200 text-green-900 border border-green-300 px-3 py-1.5 rounded text-sm font-medium transition-colors"
        @click="current--"
      >
        - Decrement
      </button>
      <button
        class="bg-green-100 hover:bg-green-200 text-green-900 border border-green-300 px-3 py-1.5 rounded text-sm font-medium transition-colors"
        @click="current++"
      >
        + Increment
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const props = defineProps({ count: { type: Number, default: 0 } });
const current = ref(props.count);
</script>
