import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA (ADR-0001): relative base for cPanel public_html deployment,
// no server runtime. Hashed assets + no source maps in production (§175).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
        },
      },
    },
  },
});
