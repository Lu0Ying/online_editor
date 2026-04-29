import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { Server } from '@hocuspocus/server'
import { createServer } from 'http'
import * as Y from 'yjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const onlinetextDir = path.join(__dirname, 'onlinetext')

const WS_PORT = 1235  // WebSocket 端口
const HTTP_PORT = 1236  // HTTP API 端口

console.log('Starting unified server...')
console.log('Current directory:', __dirname)
console.log('onlinetext directory:', onlinetextDir)

async function ensureDirectoryExists(dir) {
    try {
        await fs.access(dir)
        console.log('Directory exists:', dir)
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('Creating directory:', dir)
            await fs.mkdir(dir, { recursive: true })
            console.log('Directory created:', dir)
        } else {
            console.error('Error checking directory:', error)
        }
    }
}

async function storeYjsDocument(documentName, ydoc) {
    const filePath = path.join(onlinetextDir, `${documentName}.json`)
    
    try {
        const state = Y.encodeStateAsUpdate(ydoc)
        const base64State = Buffer.from(state).toString('base64')
        
        const documentData = {
            type: 'yjs',
            data: base64State,
            updatedAt: new Date().toISOString()
        }
        
        await fs.writeFile(filePath, JSON.stringify(documentData), 'utf8')
        console.log('✅ Document saved:', documentName)
    } catch (error) {
        console.error('Error storing Yjs document:', error)
    }
}

async function loadYjsDocument(documentName) {
    const filePath = path.join(onlinetextDir, `${documentName}.json`)
    
    try {
        const content = await fs.readFile(filePath, 'utf8')
        const documentData = JSON.parse(content)
        
        if (documentData.type === 'yjs' && documentData.data) {
            const state = Buffer.from(documentData.data, 'base64')
            const ydoc = new Y.Doc()
            Y.applyUpdate(ydoc, state)
            console.log('📄 Loaded existing document:', documentName)
            return ydoc
        } else {
            console.log('🔄 Converting legacy format:', documentName)
            const ydoc = new Y.Doc()
            if (documentData.content) {
                const ytext = ydoc.getText('content')
                ytext.insert(0, documentData.content)
            }
            await storeYjsDocument(documentName, ydoc)
            return ydoc
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('🆕 Creating new document:', documentName)
            return new Y.Doc()
        } else {
            console.error('Error loading Yjs document:', error)
            return new Y.Doc()
        }
    }
}

async function startServer() {
    try {
        await ensureDirectoryExists(onlinetextDir)
        console.log('Initializing servers...')
        
        // 创建独立的 HTTP 服务器处理 API 请求
        const httpServer = createServer(async (req, res) => {
            console.log(`HTTP API Request: ${req.method} ${req.url}`)
            
            // 设置 CORS 头
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
            
            // 处理 OPTIONS 预检请求
            if (req.method === 'OPTIONS') {
                res.writeHead(200)
                res.end()
                return
            }
            
            // 处理 /api/documents 请求 - 获取文档列表或删除文档
            if (req.url.startsWith('/api/documents')) {
                // GET - 获取文档列表
                if (req.method === 'GET') {
                    try {
                        const files = await fs.readdir(onlinetextDir)
                        const documents = files
                            .filter(file => file.endsWith('.json'))
                            .map(file => file.replace('.json', ''))
                        
                        console.log('Returning documents:', documents)
                        res.writeHead(200, { 'Content-Type': 'application/json' })
                        res.end(JSON.stringify({ documents }))
                    } catch (error) {
                        console.error('Error listing documents:', error)
                        res.writeHead(500, { 'Content-Type': 'application/json' })
                        res.end(JSON.stringify({ error: 'Failed to list documents' }))
                    }
                    return
                }
                
                // DELETE - 删除文档
                if (req.method === 'DELETE') {
                    const url = new URL(req.url, `http://${req.headers.host}`)
                    const documentName = url.searchParams.get('name')
                    
                    if (!documentName) {
                        res.writeHead(400, { 'Content-Type': 'application/json' })
                        res.end(JSON.stringify({ error: 'Document name is required' }))
                        return
                    }
                    
                    try {
                        const filePath = path.join(onlinetextDir, `${documentName}.json`)
                        await fs.unlink(filePath)
                        console.log('🗑️ Document deleted:', documentName)
                        res.writeHead(200, { 'Content-Type': 'application/json' })
                        res.end(JSON.stringify({ success: true, message: 'Document deleted successfully' }))
                    } catch (error) {
                        if (error.code === 'ENOENT') {
                            res.writeHead(404, { 'Content-Type': 'application/json' })
                            res.end(JSON.stringify({ error: 'Document not found' }))
                        } else {
                            console.error('Error deleting document:', error)
                            res.writeHead(500, { 'Content-Type': 'application/json' })
                            res.end(JSON.stringify({ error: 'Failed to delete document' }))
                        }
                    }
                    return
                }
            }
            
            // 其他请求返回 404
            res.writeHead(404, { 'Content-Type': 'text/plain' })
            res.end('Not Found')
        })
        
        // 启动 HTTP API 服务器 - 监听所有网络接口
        httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
            console.log(`✅ HTTP API server running on http://0.0.0.0:${HTTP_PORT}`)
            console.log(`   Local: http://localhost:${HTTP_PORT}`)
        })
        
        // 创建 Hocuspocus WebSocket 服务器
        const server = new Server({
            port: WS_PORT,
            address: '0.0.0.0',  // 监听所有网络接口，允许外部访问
            
            debounce: 1000,  // 增加到 1 秒，减少频繁保存
            maxDebounce: 5000,  // 最大延迟 5 秒后强制保存
            
            async onStoreDocument({ documentName, document }) {
                console.log('💾 Saving document:', documentName)
                try {
                    await storeYjsDocument(documentName, document)
                    console.log('✅ Document saved successfully:', documentName)
                } catch (error) {
                    console.error('❌ Failed to save document:', documentName, error)
                    throw error  // 抛出错误让 Hocuspocus 重试
                }
            },
            
            async onLoadDocument({ documentName }) {
                console.log('📂 Loading document:', documentName)
                return await loadYjsDocument(documentName)
            },
            
            onChange(data) {
                // 移除手动 debounce，使用 Hocuspocus 内置的 debounce 机制
                // onStoreDocument 会在 debounce 时间后自动调用
                console.log(`✏️ Document "${data.documentName}" changed`)
            },
            
            onDisconnect(data) {
                console.log(`🔌 Client disconnected from "${data.documentName}"`)
            }
        })
        
        await server.listen()
        
        console.log('✅ WebSocket server running on ws://0.0.0.0:' + WS_PORT)
        console.log(`   Local: ws://localhost:${WS_PORT}`)
        console.log('📁 Documents stored in:', onlinetextDir)
        console.log('\n💡 Tip: Use your computer\'s IP address to access from other devices')
        
    } catch (error) {
        console.error('Error starting server:', error)
    }
}

startServer()