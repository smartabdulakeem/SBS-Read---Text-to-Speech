import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built index.html works under file:// (the packaged
  // Electron .exe uses loadFile), and equally under Capacitor and Vercel.
  base: './',
  plugins: [react(), tailwindcss()],
})
