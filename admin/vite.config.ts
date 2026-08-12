import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // The shared packages are TypeScript source rather than build artefacts.
      '@jaxongirman/slide-dom': path.resolve(__dirname, '../packages/slide-dom/src/index.tsx'),
      '@jaxongirman/jslayd': path.resolve(__dirname, '../packages/jslayd/src/index.ts'),
      '@jaxongirman/types': path.resolve(__dirname, '../packages/types/src/index.ts'),
    },
  },
})
