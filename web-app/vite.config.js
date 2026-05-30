import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built index.html works under file:// (the packaged
  // Electron .exe uses loadFile), and equally under Capacitor and Vercel.
  base: './',
  // Tailwind v3 is processed via PostCSS (postcss.config.js). Target an older
  // CSS engine so the output runs on older Android System WebViews too.
  build: {
    cssTarget: 'chrome61',
  },
  plugins: [react()],
})
