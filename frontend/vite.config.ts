import { readFileSync } from 'node:fs'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * HTTPS opcional para probar la cámara desde un celular en la red local
 * (docs/pruebas-movil.md). Solo se activa si se indican las rutas del certificado
 * y la clave, que se generan fuera del repositorio (por ejemplo, con mkcert).
 */
function devHttps() {
  const cert = process.env.VITE_DEV_HTTPS_CERT
  const key = process.env.VITE_DEV_HTTPS_KEY
  if (!cert || !key) return undefined
  return { cert: readFileSync(cert), key: readFileSync(key) }
}

// https://vite.dev/config/  ·  https://vitest.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    https: devHttps(),
    // Mismo origen que la API: la cookie de sesión y el CSRF funcionan sin CORS.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Solo se procesa la hoja de estilos global, para verificar los tokens de marca.
    css: { include: [/src\/styles\/index\.css/] },
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
      reporter: ['text', 'html'],
    },
  },
})
