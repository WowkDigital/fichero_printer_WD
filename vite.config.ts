import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// Relative base so the build works under any GitHub Pages repository path.
export default defineConfig({
  base: './',
  plugins: [svelte(), tailwindcss()],
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
