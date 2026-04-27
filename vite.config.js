import { defineConfig } from 'vite'

export default defineConfig({
    server: {
        port: 5173,
        host: '0.0.0.0',
        proxy: {
            '/ws': {
                target: 'ws://localhost:1235',
                ws: true,
            }
        }
    },
})