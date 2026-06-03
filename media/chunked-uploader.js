import { fileServerUrl } from '../main.js'

const CHUNK_SIZE = 2 * 1024 * 1024 // 2MB
const MAX_CONCURRENT = 3 // 并发上传数

/**
 * 计算文件指纹
 * 优先使用 crypto.subtle（需要安全上下文），否则用简单哈希回退
 */
export async function computeFingerprint(file) {
    // 取前 1MB 数据
    const sampleSize = Math.min(file.size, 1024 * 1024)
    const sample = file.slice(0, sampleSize)
    const buffer = await sample.arrayBuffer()

    // 生成指纹字符串：前半部分用数据哈希，后半部分用文件名+大小
    let hashHex

    if (crypto.subtle) {
        // 安全上下文：使用 SHA-256
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
        hashHex = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
    } else {
        // 非安全上下文：使用简单哈希回退
        const bytes = new Uint8Array(buffer)
        // 采样取哈希：每隔 N 个字节取一个，最终生成 64 字符的十六进制串
        const step = Math.max(1, Math.floor(bytes.length / 32))
        const samples = []
        for (let i = 0; i < bytes.length; i += step) {
            samples.push(bytes[i])
            if (samples.length >= 32) break
        }
        // 用采样值做简单混合哈希
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57
        for (let i = 0; i < samples.length; i++) {
            const b = samples[i]
            h1 = Math.imul(h1 ^ b, 2654435761)
            h2 = Math.imul(h2 ^ b, 1597334677)
        }
        // 组合成 64 字符的十六进制串
        hashHex = (h1 >>> 0).toString(16).padStart(8, '0') +
                  (h2 >>> 0).toString(16).padStart(8, '0') +
                  file.size.toString(16).padStart(16, '0') +
                  file.name.split('').reduce((s, c) => s + c.charCodeAt(0).toString(16).padStart(2, '0'), '').slice(0, 32).padEnd(32, '0')
    }

    // 混入文件名和大小做二次哈希
    const extraData = new TextEncoder().encode(`${file.name}_${file.size}`)
    const combined = new Uint8Array(hashHex.length + extraData.length)
    combined.set(new TextEncoder().encode(hashHex), 0)
    combined.set(extraData, hashHex.length)

    if (crypto.subtle) {
        const finalHash = await crypto.subtle.digest('SHA-256', combined)
        return Array.from(new Uint8Array(finalHash)).map(b => b.toString(16).padStart(2, '0')).join('')
    } else {
        // 回退：直接返回十六进制串
        let result = ''
        const cb = new Uint8Array(combined)
        for (let i = 0; i < cb.length; i++) {
            result += cb[i].toString(16).padStart(2, '0')
            if (result.length >= 64) break
        }
        return result.padEnd(64, '0')
    }
}

/**
 * 分块上传器
 */
export class ChunkedUploader {
    constructor(file, options = {}) {
        this.file = file
        this.fingerprint = null
        this.totalChunks = 0
        this.uploadedChunks = new Set()
        this.pendingChunks = []
        this.onProgress = options.onProgress || (() => {})
        this.onComplete = options.onComplete || (() => {})
        this.onError = options.onError || (() => {})
        this.fileServerUrl = options.fileServerUrl || fileServerUrl || ''
        this.aborted = false
    }

    abort() {
        this.aborted = true
    }

    async init() {
        const fingerprint = await computeFingerprint(this.file)
        this.fingerprint = fingerprint

        const resp = await fetch(`${this.fileServerUrl}/api/upload/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: this.file.name, fileSize: this.file.size })
        })

        if (!resp.ok) throw new Error('初始化上传失败')

        const data = await resp.json()
        this.totalChunks = data.totalChunks

        if (data.alreadyUploaded) {
            this.onComplete({ url: this.fileServerUrl + data.url, fingerprint: data.fingerprint })
            return { alreadyUploaded: true, url: this.fileServerUrl + data.url, fingerprint: data.fingerprint }
        }

        this.uploadedChunks = new Set(data.uploadedChunks)
        this.pendingChunks = []
        for (let i = 0; i < this.totalChunks; i++) {
            if (!this.uploadedChunks.has(i)) {
                this.pendingChunks.push(i)
            }
        }

        return { alreadyUploaded: false, totalChunks: this.totalChunks, pendingCount: this.pendingChunks.length }
    }

    async upload() {
        if (this.pendingChunks.length === 0) {
            // 所有分块已上传，直接合并
            return this.complete()
        }

        let completedCount = this.uploadedChunks.size
        const total = this.totalChunks

        // 并发控制
        const queue = [...this.pendingChunks]

        const uploadOne = async () => {
            while (queue.length > 0 && !this.aborted) {
                const chunkIndex = queue.shift()
                await this.uploadChunk(chunkIndex)
                completedCount++
                this.onProgress({ completed: completedCount, total, chunk: chunkIndex })
            }
        }

        // 启动并发上传
        const workers = []
        const concurrency = Math.min(MAX_CONCURRENT, queue.length)
        for (let i = 0; i < concurrency; i++) {
            workers.push(uploadOne())
        }
        await Promise.all(workers)

        if (this.aborted) {
            throw new Error('上传已取消')
        }

        // 所有分块完成后合并
        return this.complete()
    }

    async uploadChunk(chunkIndex) {
        const start = chunkIndex * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, this.file.size)
        const blob = this.file.slice(start, end)

        const resp = await fetch(`${this.fileServerUrl}/api/upload/chunk`, {
            method: 'POST',
            headers: {
                'X-Fingerprint': this.fingerprint,
                'X-Chunk-Index': String(chunkIndex),
                'X-Total-Chunks': String(this.totalChunks),
                'X-Filename': encodeURIComponent(this.file.name),
            },
            body: blob
        })

        if (!resp.ok) throw new Error(`分块 ${chunkIndex} 上传失败`)
        const data = await resp.json()
        return data
    }

    async complete() {
        const resp = await fetch(`${this.fileServerUrl}/api/upload/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fingerprint: this.fingerprint,
                filename: this.file.name,
                totalChunks: this.totalChunks
            })
        })

        if (!resp.ok) throw new Error('文件合并失败')

        const data = await resp.json()
        const result = {
            url: this.fileServerUrl + data.url,
            fingerprint: data.fingerprint,
            filename: this.file.name
        }
        this.onComplete(result)
        return result
    }
}

/**
 * 便捷函数：上传文件并返回结果
 */
export async function uploadFile(file, options = {}) {
    const uploader = new ChunkedUploader(file, options)
    const initResult = await uploader.init()
    if (initResult.alreadyUploaded) {
        return {
            url: initResult.url,
            fingerprint: initResult.fingerprint,
            filename: file.name
        }
    }
    return uploader.upload()
}
