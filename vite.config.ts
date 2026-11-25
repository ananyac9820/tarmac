import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// base './' => relative asset paths, so the build works on GitHub Pages
// under any repo name and straight from the filesystem (offline demo).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  test: { include: ['tests/**/*.test.ts'] },
} as never);
