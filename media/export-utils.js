/**
 * 导出文档及媒体文件为压缩包
 * 遍历编辑器 HTML 内容，找到所有图片/视频引用，下载后放入 zip，
 * 并将 HTML 中的 src 替换为相对路径占位符
 */

/**
 * 从 editor HTML 中提取所有媒体指纹
 */
export function extractMediaReferences(html) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const mediaList = []

    // 提取图片
    doc.querySelectorAll('img[data-collaborative-image]').forEach((img) => {
        const fingerprint = img.getAttribute('data-collaborative-image')
        const src = img.getAttribute('src')
        if (fingerprint && src) {
            mediaList.push({ fingerprint, src, type: 'image', element: img })
        }
    })

    // 提取视频
    doc.querySelectorAll('div[data-collaborative-video]').forEach((div) => {
        const fingerprint = div.getAttribute('data-collaborative-video')
        const video = div.querySelector('video')
        const src = video ? video.getAttribute('src') : null
        if (fingerprint && src) {
            mediaList.push({ fingerprint, src, type: 'video', element: div, videoElement: video })
        }
    })

    return { mediaList, doc }
}

/**
 * 下载文件为 Blob
 */
async function downloadFile(url) {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`下载失败: ${url}`)
    return resp.blob()
}

/**
 * 获取文件扩展名
 */
function getExtension(url) {
    try {
        const pathname = new URL(url).pathname
        const ext = pathname.split('.').pop().toLowerCase()
        if (ext && ext.length <= 5) return ext
    } catch {}
    return 'bin'
}

/**
 * 生成相对于 HTML 文件的媒体路径
 */
function getMediaRelativePath(fingerprint, url, index) {
    const ext = getExtension(url)
    return `media/${fingerprint}.${ext}`
}

/**
 * 导出文档为包含媒体的压缩包
 * @param {string} htmlContent - 编辑器 HTML
 * @param {string} documentName - 文档名称
 * @param {string} fileServerUrl - 文件服务器地址
 * @returns {Promise<Blob>} zip 压缩包
 */
export async function exportDocumentWithMedia(htmlContent, documentName, fileServerUrl) {
    // 动态加载 jszip
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()

    const { mediaList, doc } = extractMediaReferences(htmlContent)

    // 下载所有媒体文件并加入 zip
    const mediaFolder = zip.folder('media')
    const downloadPromises = mediaList.map(async (item, index) => {
        try {
            const blob = await downloadFile(item.src)
            const ext = getExtension(item.src)
            const filename = `${item.fingerprint}.${ext}`
            mediaFolder.file(filename, blob)

            // 更新 DOM 中对应的 src 为相对路径
            const relativePath = `media/${filename}`
            if (item.type === 'image') {
                item.element.setAttribute('src', relativePath)
            } else if (item.type === 'video' && item.videoElement) {
                item.videoElement.setAttribute('src', relativePath)
            }

            return { success: true, fingerprint: item.fingerprint, filename }
        } catch (err) {
            console.warn(`媒体文件下载失败: ${item.src}`, err)
            return { success: false, fingerprint: item.fingerprint, error: err.message }
        }
    })

    const results = await Promise.all(downloadPromises)

    // 生成带有相对路径的最终 HTML
    const finalHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>${documentName}</title>
    <style>
        body { max-width: 900px; margin: 40px auto; padding: 0 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.8; color: #1e293b; }
        img, video { max-width: 100%; height: auto; border-radius: 8px; margin: 16px 0; }
        h1 { font-size: 2rem; margin: 28px 0 14px; }
        h2 { font-size: 1.5rem; margin: 22px 0 12px; }
        p { margin: 12px 0; }
    </style>
</head>
<body>
${doc.body.innerHTML}
</body>
</html>`

    zip.file(`${documentName}.html`, finalHtml)

    // 生成 zip
    const zipBlob = await zip.generateAsync({ type: 'blob' })

    return {
        blob: zipBlob,
        mediaCount: results.filter(r => r.success).length,
        failedCount: results.filter(r => !r.success).length,
        results,
    }
}
