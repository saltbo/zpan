import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import path from 'path'

export default defineConfig({
  plugins: [TanStackRouterVite({}), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      zod: path.resolve(__dirname, 'node_modules/zod'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8222',
    },
  },
})
