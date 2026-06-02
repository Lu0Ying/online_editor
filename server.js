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
        const activeUserIds = gatherActiveUserIds(ydoc)
        console.log(`Active user IDs for "${documentName}":`, Array.from(activeUserIds))
        if (removeInactiveUserHighlights(ydoc, activeUserIds)) {
            console.log(`🔧 Cleaned up stale highlight wrappers before saving document: ${documentName}`)
        }
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

function gatherActiveUserIds(document) {
    const activeUserIds = new Set()
    try {
        const awarenessStates = document.awareness.getStates()
        for (const state of awarenessStates.values()) {
            if (state && state.user && state.user.id) {
                activeUserIds.add(state.user.id)
            }
        }
    } catch (error) {
        console.error('Error gathering active user ids:', error)
    }
    return activeUserIds
}

function removeInactiveUserHighlights(document, activeUserIds) {
    const xmlFragment = document.get('content', Y.XmlFragment)
    if (!xmlFragment) {
        console.log('⚠️ No xmlFragment found')
        return false
    }

    console.log('🔍 removeInactiveUserHighlights called, activeUserIds:', Array.from(activeUserIds))
    let removed = false

    function traverse(element, depth = 0) {
        const children = element.toArray()
        console.log(`  ${'  '.repeat(depth)}Traversing ${children.length} children`)
        
        // 反向遍历，避免删除元素时索引变化导致跳过的元素
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i]
            console.log(`  ${'  '.repeat(depth)}Child ${i}: type=${child.constructor.name}`)
            
            if (child instanceof Y.XmlElement) {
                traverse(child, depth + 1)
                const attrs = child.getAttributes()
                console.log(`  ${'  '.repeat(depth)}Attrs:`, attrs)
                
                if (attrs['data-user-highlight'] !== undefined) {
                    const highlightUserId = attrs['data-user-id']
                    console.log(`  ${'  '.repeat(depth)}Found highlight, userId=${highlightUserId}, active=${activeUserIds.has(highlightUserId)}`)
                    
                    if (highlightUserId && !activeUserIds.has(highlightUserId)) {
                        // 在删除前保存子元素
                        const nestedChildren = child.toArray()
                        console.log(`  ${'  '.repeat(depth)}Removing wrapper, ${nestedChildren.length} nested children`)
                        child.delete()
                        // 在同一位置插入子元素
                        if (nestedChildren.length > 0) {
                            element.insert(i, nestedChildren)
                        }
                        removed = true
                    }
                }
            } else if (child instanceof Y.XmlText) {
                // 检查 YXmlText 上的 formatting marks
                const delta = child.toDelta()
                console.log(`  ${'  '.repeat(depth)}YXmlText delta:`, JSON.stringify(delta, null, 2))
                
                let hasChanges = false
                const newDelta = delta.map(item => {
                    if (item.attributes && item.attributes['userHighlight']) {
                        const highlight = item.attributes['userHighlight']
                        const highlightUserId = highlight.userId
                        console.log(`  ${'  '.repeat(depth)}Found text highlight, userId=${highlightUserId}, active=${activeUserIds.has(highlightUserId)}`)
                        
                        if (highlightUserId && !activeUserIds.has(highlightUserId)) {
                            // 移除高亮属性，保留文本
                            const newAttrs = { ...item.attributes }
                            delete newAttrs['userHighlight']
                            hasChanges = true
                            removed = true
                            console.log(`  ${'  '.repeat(depth)}Removing highlight for userId=${highlightUserId}`)
                            return { ...item, attributes: Object.keys(newAttrs).length > 0 ? newAttrs : undefined }
                        }
                    }
                    return item
                })
                
                if (hasChanges) {
                    console.log(`  ${'  '.repeat(depth)}Updating YXmlText with new delta`)
                    // 重建 YXmlText 内容
                    child.delete(0, child.length)
                    let offset = 0
                    for (const item of newDelta) {
                        if (item.insert) {
                            child.insert(offset, item.insert, item.attributes || {})
                            offset += item.insert.length
                        }
                    }
                }
            }
        }
    }

    document.transact(() => {
        traverse(xmlFragment)
    })

    console.log(`🔍 removeInactiveUserHighlights done, removed=${removed}`)
    return removed
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

            // 处理 /api/cleanup-highlights 请求 - 清除离线用户的高亮包装器
            if (req.url.startsWith('/api/cleanup-highlights')) {
                const url = new URL(req.url, `http://${req.headers.host}`)
                const documentName = url.searchParams.get('name')

                if (!documentName) {
                    res.writeHead(400, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ error: 'Document name is required' }))
                    return
                }

                try {
                    const ydoc = await loadYjsDocument(documentName)
                    const activeUserIds = gatherActiveUserIds(ydoc)
                    const removed = removeInactiveUserHighlights(ydoc, activeUserIds)

                    if (removed) {
                        await storeYjsDocument(documentName, ydoc)
                        console.log(`🔧 Cleaned up stale highlight wrappers for document: ${documentName}`)
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({
                        success: true,
                        message: removed ? 'Offline user highlights cleaned up' : 'No inactive highlights found',
                        documentName
                    }))
                } catch (error) {
                    console.error('Error cleaning up highlights:', error)
                    res.writeHead(500, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ error: 'Failed to cleanup highlights' }))
                }
                return
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
                try {
                    const activeUserIds = gatherActiveUserIds(data.document)
                    console.log(`Active user IDs for "${data.documentName}":`, Array.from(activeUserIds))
                    if (removeInactiveUserHighlights(data.document, activeUserIds)) {
                        console.log(`🔧 Cleaned up stale highlight wrappers for document: ${data.documentName}`)
                        // 手动保存文档，因为断开连接时不会自动触发 onStoreDocument
                        storeYjsDocument(data.documentName, data.document).catch(err => {
                            console.error('Error saving document after cleanup:', err)
                        })
                    }
                } catch (error) {
                    console.error('Error cleaning up highlight wrappers on disconnect:', error)
                }
            },

            async onAwarenessUpdate({ documentName, awareness, states }) {
                // 当感知状态更新时，可以记录日志或进行其他处理
                const userCount = states.length
                console.log(`👥 Document "${documentName}" has ${userCount} online users`)
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