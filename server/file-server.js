import fs from 'fs/promises'
import { createReadStream, existsSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const UPLOADS_DIR = path.join(__dirname, 'uploads')
const CHUNKS_DIR = path.join(__dirname, 'uploads', '.chunks')
const FILE_PORT = 1237

// 分块大小 2MB
const CHUNK_SIZE = 2 * 1024 * 1024

function ensureDir(dir) {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
    }
}

// 计算文件指纹: SHA-256(前 1MB + 文件名 + 文件大小)
function computeFingerprint(filename, fileSize) {
    const hash = crypto.createHash('sha256')
    hash.update(filename)
    hash.update(String(fileSize))
    return hash.digest('hex')
}

// 获取已上传的分块索引列表
async function getUploadedChunks(fingerprint) {
    const chunkDir = path.join(CHUNKS_DIR, fingerprint)
    try {
        const files = await fs.readdir(chunkDir)
        return files
            .filter(f => f.endsWith('.chunk'))
            .map(f => parseInt(f.replace('.chunk', ''), 10))
            .sort((a, b) => a - b)
    } catch {
        return []
    }
}

// 合并分块为完整文件
async function mergeChunks(fingerprint, filename, totalChunks) {
    const chunkDir = path.join(CHUNKS_DIR, fingerprint)
    const finalPath = path.join(UPLOADS_DIR, fingerprint)
    
    // 确保所有分块都存在
    for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(chunkDir, `${i}.chunk`)
        try {
            await fs.access(chunkPath)
        } catch {
            throw new Error(`分块 ${i} 缺失，合并失败`)
        }
    }
    
    // 追加写入最终文件
    const writeFd = await fs.open(finalPath, 'w')
    try {
        for (let i = 0; i < totalChunks; i++) {
            const chunkPath = path.join(chunkDir, `${i}.chunk`)
            const chunkData = await fs.readFile(chunkPath)
            await writeFd.write(chunkData)
        }
    } finally {
        await writeFd.close()
    }
    
    // 清理分块目录
    await fs.rm(chunkDir, { recursive: true, force: true })
    
    // 保存文件元信息
    const metaPath = path.join(UPLOADS_DIR, `${fingerprint}.meta.json`)
    await fs.writeFile(metaPath, JSON.stringify({
        originalName: filename,
        fingerprint,
        storedAt: new Date().toISOString()
    }))
    
    return finalPath
}

// 获取文件的 MIME 类型
function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase()
    const mimeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.ogv': 'video/ogg',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
    }
    return mimeMap[ext] || 'application/octet-stream'
}

// 解析请求 body 为 Buffer（用于二进制上传）
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = []
        req.on('data', chunk => chunks.push(chunk))
        req.on('end', () => resolve(Buffer.concat(chunks)))
        req.on('error', reject)
    })
}

function startFileServer() {
    ensureDir(UPLOADS_DIR)
    ensureDir(CHUNKS_DIR)
    
    const server = createServer(async (req, res) => {
        // CORS
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, HEAD')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Fingerprint, X-Chunk-Index, X-Total-Chunks, X-Filename, X-File-Size, Range')
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length')
        
        if (req.method === 'OPTIONS') {
            res.writeHead(200)
            res.end()
            return
        }
        
        const url = new URL(req.url, `http://${req.headers.host}`)
        const pathname = url.pathname
        
        console.log(`[FileServer] ${req.method} ${pathname}`)
        
        // ========== 上传分块 ==========
        if (req.method === 'POST' && pathname === '/api/upload/chunk') {
            try {
                const fingerprint = req.headers['x-fingerprint']
                const chunkIndex = parseInt(req.headers['x-chunk-index'], 10)
                const totalChunks = parseInt(req.headers['x-total-chunks'], 10)
                const filename = req.headers['x-filename']
                
                if (!fingerprint || isNaN(chunkIndex) || !filename) {
                    res.writeHead(400, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ error: '缺少必要参数' }))
                    return
                }
                
                const chunkDir = path.join(CHUNKS_DIR, fingerprint)
                ensureDir(chunkDir)
                
                const body = await readRequestBody(req)
                const chunkPath = path.join(chunkDir, `${chunkIndex}.chunk`)
                await fs.writeFile(chunkPath, body)
                
                console.log(`[FileServer] 收到分块 ${chunkIndex + 1}/${totalChunks}: ${filename}`)
                
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true, chunk: chunkIndex }))
            } catch (err) {
                console.error('[FileServer] 分块上传错误:', err)
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: err.message }))
            }
            return
        }
        
        // ========== 查询已上传分块（断点续传） ==========
        if (req.method === 'GET' && pathname === '/api/upload/chunks') {
            const fingerprint = url.searchParams.get('fingerprint')
            if (!fingerprint) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: '缺少 fingerprint 参数' }))
                return
            }
            
            const uploaded = await getUploadedChunks(fingerprint)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ uploaded }))
            return
        }
        
        // ========== 合并分块 ==========
        if (req.method === 'POST' && pathname === '/api/upload/complete') {
            try {
                const body = await readRequestBody(req)
                const { fingerprint, filename, totalChunks } = JSON.parse(body.toString())
                
                if (!fingerprint || !filename) {
                    res.writeHead(400, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ error: '缺少必要参数' }))
                    return
                }
                
                await mergeChunks(fingerprint, filename, totalChunks)
                
                console.log(`[FileServer] 文件合并完成: ${filename} -> ${fingerprint}`)
                
                // 生成访问 URL
                const fileUrl = `/api/files/${fingerprint}`
                
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true, url: fileUrl, fingerprint }))
            } catch (err) {
                console.error('[FileServer] 合并错误:', err)
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: err.message }))
            }
            return
        }
        
        // ========== 初始化上传（返回指纹） ==========
        if (req.method === 'POST' && pathname === '/api/upload/init') {
            try {
                const body = await readRequestBody(req)
                const { filename, fileSize } = JSON.parse(body.toString())
                
                if (!filename || !fileSize) {
                    res.writeHead(400, { 'Content-Type': 'application/json' })
                    res.end(JSON.stringify({ error: '缺少必要参数' }))
                    return
                }
                
                const fingerprint = computeFingerprint(filename, fileSize)
                const totalChunks = Math.ceil(fileSize / CHUNK_SIZE)
                
                // 检查是否已存在完整文件
                const finalPath = path.join(UPLOADS_DIR, fingerprint)
                let alreadyUploaded = false
                try {
                    await fs.access(finalPath)
                    alreadyUploaded = true
                } catch {}
                
                // 获取已上传的分块
                const uploadedChunks = alreadyUploaded ? [] : await getUploadedChunks(fingerprint)
                
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({
                    fingerprint,
                    totalChunks,
                    chunkSize: CHUNK_SIZE,
                    alreadyUploaded,
                    uploadedChunks,
                    url: alreadyUploaded ? `/api/files/${fingerprint}` : null
                }))
            } catch (err) {
                console.error('[FileServer] 初始化错误:', err)
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: err.message }))
            }
            return
        }
        
        // ========== 下载/访问文件（支持 Range 请求用于视频拖动） ==========
        if (req.method === 'GET' && pathname.startsWith('/api/files/')) {
            const fingerprint = pathname.replace('/api/files/', '')
            
            if (!fingerprint) {
                res.writeHead(400)
                res.end('缺少文件标识')
                return
            }
            
            const filePath = path.join(UPLOADS_DIR, fingerprint)
            let meta = {}
            
            try {
                await fs.access(filePath)
            } catch {
                // 文件不存在
                res.writeHead(404, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: '文件不存在' }))
                return
            }
            
            // 读取元信息获取原始文件名
            const metaPath = path.join(UPLOADS_DIR, `${fingerprint}.meta.json`)
            try {
                meta = JSON.parse(await fs.readFile(metaPath, 'utf8'))
            } catch {}
            
            const stat = await fs.stat(filePath)
            const fileSize = stat.size
            const mimeType = getMimeType(meta.originalName || fingerprint)
            
            // 处理 Range 请求
            const range = req.headers.range
            
            if (range) {
                const parts = range.replace(/bytes=/, '').split('-')
                const start = parseInt(parts[0], 10)
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1
                const chunkSize = end - start + 1
                
                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunkSize,
                    'Content-Type': mimeType,
                    'Cache-Control': 'public, max-age=86400'
                })
                
                const stream = createReadStream(filePath, { start, end })
                stream.pipe(res)
                stream.on('error', (err) => {
                    console.error('[FileServer] 流错误:', err)
                    if (!res.headersSent) {
                        res.writeHead(500)
                        res.end('Internal Error')
                    }
                })
            } else {
                res.writeHead(200, {
                    'Content-Type': mimeType,
                    'Content-Length': fileSize,
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'public, max-age=86400'
                })
                
                const stream = createReadStream(filePath)
                stream.pipe(res)
                stream.on('error', (err) => {
                    console.error('[FileServer] 流错误:', err)
                    if (!res.headersSent) {
                        res.writeHead(500)
                        res.end('Internal Error')
                    }
                })
            }
            return
        }
        
        // ========== 删除文件 ==========
        if (req.method === 'DELETE' && pathname.startsWith('/api/files/')) {
            const fingerprint = pathname.replace('/api/files/', '')
            
            if (!fingerprint) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: '缺少文件标识' }))
                return
            }
            
            try {
                const filePath = path.join(UPLOADS_DIR, fingerprint)
                const metaPath = path.join(UPLOADS_DIR, `${fingerprint}.meta.json`)
                
                await fs.unlink(filePath)
                try { await fs.unlink(metaPath) } catch {}
                
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: true }))
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ error: err.message }))
            }
            return
        }
        
        // 404
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not Found' }))
    })
    
    server.listen(FILE_PORT, '0.0.0.0', () => {
        console.log(`✅ File server running on http://0.0.0.0:${FILE_PORT}`)
        console.log(`   Local: http://localhost:${FILE_PORT}`)
        console.log(`   Uploads: ${UPLOADS_DIR}`)
    })
    
    return server
}

startFileServer()
