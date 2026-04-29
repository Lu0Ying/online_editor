import { defineConfig } from 'vite'

export default defineConfig({
    server: {
        port: 5173,
        strictPort: true,  // 严格使用 5173 端口，如果被占用则报错
        host: '0.0.0.0',
        proxy: {
            '/ws': {
                target: 'ws://localhost:1235',
                ws: true,
            }
        }
    },
})