import { defineConfig } from 'vite'

export default defineConfig({
    server: {
        port: 5173,
        strictPort: true,
        host: '0.0.0.0',
        proxy: {
            '/ws': {
                target: 'ws://localhost:1235',
                ws: true,
            },
            // 代理文件上传和下载请求到文件服务器 (1237)
            '/api/files': {
                target: 'http://localhost:1237',
                changeOrigin: true,
            },
            '/api/upload': {
                target: 'http://localhost:1237',
                changeOrigin: true,
            },
        }
    },
})
