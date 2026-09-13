import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative assets work at both username.github.io and username.github.io/repo/.
  base: './',
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/')) return 'vendor';
        },
      },
    },
  },
});
