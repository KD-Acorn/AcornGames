import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['acorngames.net', 'api.acorngames.net', 'localhost']
  },
  preview: {
    allowedHosts: ['acorngames.net', 'api.acorngames.net', 'localhost'],
    port: 3003,
    host: true
  }
})
