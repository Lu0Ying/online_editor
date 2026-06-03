import * as Y from 'yjs'

const API_BASE_URL = 'http://localhost:1236'

class VersionManager {
    constructor() {
        this.snapshots = new Map()
        this.isLoading = false
        this.initialized = false
    }

    async init() {
        if (this.initialized) return
        this.initialized = true
        await this.loadSnapshotsFromServer()
    }

    async loadSnapshotsFromServer() {
        try {
            this.isLoading = true
            const response = await fetch(`${API_BASE_URL}/api/snapshots`)
            const data = await response.json()
            
            this.snapshots.clear()
            if (data.snapshots && Array.isArray(data.snapshots)) {
                data.snapshots.forEach(snapshot => {
                    this.snapshots.set(snapshot.id, snapshot)
                })
            }
            console.log('✅ 从服务器加载了', this.snapshots.size, '个快照')
        } catch (error) {
            console.error('❌ 从服务器加载快照失败:', error)
        } finally {
            this.isLoading = false
        }
    }

    async saveSnapshot(doc, documentName, description = '') {
        try {
            // 获取完整文档状态
            const update = Y.encodeStateAsUpdate(doc)
            const binaryString = Array.from(update, byte => String.fromCharCode(byte)).join('')
            const base64State = btoa(binaryString)
            
            const requestBody = {
                documentName,
                content: base64State,
                description: description || this._generateDescription()
            }
            
            const response = await fetch(`${API_BASE_URL}/api/snapshots/save`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            })
            
            const data = await response.json()
            
            if (data.success && data.snapshot) {
                this.snapshots.set(data.snapshot.id, data.snapshot)
                console.log('✅ 快照已保存到服务器:', data.snapshot.id)
                return data.snapshot
            } else {
                throw new Error(data.error || '保存失败')
            }
        } catch (error) {
            console.error('❌ 保存快照失败:', error)
            throw error
        }
    }

    getSnapshot(snapshotId) {
        return this.snapshots.get(snapshotId)
    }

    getAllSnapshots(documentName = null) {
        let snapshots = Array.from(this.snapshots.values())
        
        if (documentName) {
            snapshots = snapshots.filter(s => s.documentName === documentName)
        }
        
        return snapshots.sort((a, b) => b.timestamp - a.timestamp)
    }

    async deleteSnapshot(snapshotId) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/snapshots/delete?id=${encodeURIComponent(snapshotId)}`, {
                method: 'DELETE'
            })
            
            const data = await response.json()
            
            if (data.success) {
                this.snapshots.delete(snapshotId)
                console.log('✅ 快照已从服务器删除:', snapshotId)
                return true
            } else {
                throw new Error(data.error || '删除失败')
            }
        } catch (error) {
            console.error('❌ 删除快照失败:', error)
            throw error
        }
    }

    async restoreSnapshot(doc, snapshotId) {
        const snapshot = this.snapshots.get(snapshotId)
        if (!snapshot) {
            throw new Error('快照不存在')
        }
        
        try {
            // 解码base64内容
            const binaryString = atob(snapshot.content)
            const update = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
                update[i] = binaryString.charCodeAt(i)
            }
            
            // 创建临时文档
            const tempDoc = new Y.Doc()
            Y.applyUpdate(tempDoc, update)
            
            // 获取快照的文本内容
            const snapshotContent = tempDoc.get('content', Y.XmlFragment)
            const textContent = this._extractText(snapshotContent)
            
            tempDoc.destroy()
            
            // 获取当前文档的内容
            const currentContent = doc.get('content', Y.XmlFragment)
            
            // 清空当前内容
            doc.transact(() => {
                if (currentContent.length > 0) {
                    currentContent.delete(0, currentContent.length)
                }
            })
            
            // 直接插入整个文本作为单个段落
            doc.transact(() => {
                const paragraph = new Y.XmlElement('paragraph')
                const textNode = new Y.XmlText()
                // 将换行符替换为特殊的格式保留在文本中
                textNode.insert(0, textContent)
                paragraph.insert(0, [textNode])
                currentContent.insert(0, [paragraph])
            })
            
            console.log('✅ 快照已恢复:', snapshotId, '文本长度:', textContent.length)
            return snapshot
        } catch (error) {
            console.error('❌ 恢复快照失败:', error)
            throw new Error('恢复快照失败: ' + error.message)
        }
    }

    async compareSnapshots(snapshotId1, snapshotId2) {
        try {
            const snap1 = this.snapshots.get(snapshotId1)
            const snap2 = this.snapshots.get(snapshotId2)
            
            if (!snap1 || !snap2) {
                throw new Error('快照不存在')
            }
            
            return this._generateDiff(snap1, snap2)
        } catch (error) {
            console.error('❌ 对比快照失败:', error)
            throw error
        }
    }

    _generateDiff(snap1, snap2) {
        // 解码内容进行详细对比
        try {
            const content1 = this._getTextContent(snap1?.content)
            const content2 = this._getTextContent(snap2?.content)
            
            const diff = {
                snapshot1: {
                    id: snap1?.id || 'unknown',
                    timestamp: snap1?.timestamp || 0,
                    description: snap1?.description || ''
                },
                snapshot2: {
                    id: snap2?.id || 'unknown',
                    timestamp: snap2?.timestamp || 0,
                    description: snap2?.description || ''
                },
                added: [],
                removed: [],
                modified: [],
                totalChanges: 0
            }
            
            const lines1 = content1.split('\n')
            const lines2 = content2.split('\n')
            const maxLen = Math.max(lines1.length, lines2.length)
            
            for (let i = 0; i < maxLen; i++) {
                const line1 = lines1[i] || ''
                const line2 = lines2[i] || ''
                
                if (!line1 && !line2) continue
                
                if (!line1 && line2) {
                    diff.added.push({ line: i + 1, content: line2 })
                    diff.totalChanges++
                } else if (line1 && !line2) {
                    diff.removed.push({ line: i + 1, content: line1 })
                    diff.totalChanges++
                } else if (line1 !== line2) {
                    diff.modified.push({ line: i + 1, oldContent: line1, newContent: line2 })
                    diff.totalChanges++
                }
            }
            
            console.log('✅ 对比完成:', { totalChanges: diff.totalChanges, added: diff.added.length, removed: diff.removed.length, modified: diff.modified.length })
            return diff
        } catch (error) {
            console.error('生成差异时出错:', error)
            return {
                snapshot1: {
                    id: snap1?.id || 'unknown',
                    timestamp: snap1?.timestamp || 0,
                    description: snap1?.description || ''
                },
                snapshot2: {
                    id: snap2?.id || 'unknown',
                    timestamp: snap2?.timestamp || 0,
                    description: snap2?.description || ''
                },
                added: [],
                removed: [],
                modified: [],
                totalChanges: 0,
                error: '无法生成详细差异: ' + error.message
            }
        }
    }

    _getTextContent(base64Content) {
        if (!base64Content) return ''
        
        try {
            const binaryString = atob(base64Content)
            const update = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
                update[i] = binaryString.charCodeAt(i)
            }
            
            const tempDoc = new Y.Doc()
            Y.applyUpdate(tempDoc, update)
            
            const content = tempDoc.get('content', Y.XmlFragment)
            const text = this._extractText(content)
            tempDoc.destroy()
            
            return text
        } catch (error) {
            console.error('解码内容失败:', error)
            return ''
        }
    }

    _extractText(element, preserveStructure = true) {
        let text = ''
        if (!element) return text
        
        try {
            if (typeof element.forEach === 'function') {
                let elementCount = 0
                element.forEach((child, index) => {
                    if (child instanceof Y.XmlText) {
                        const delta = child.toDelta()
                        delta.forEach(op => {
                            if (typeof op.insert === 'string') {
                                text += op.insert
                            }
                        })
                    } else if (child instanceof Y.XmlElement) {
                        const tagName = (child.tagName || '').toLowerCase()
                        // 扩展块级标签列表
                        const blockTags = ['paragraph', 'p', 'heading', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'listitem', 'li', 'codeblock', 'pre', 'div', 'section', 'br']
                        const isBlock = blockTags.includes(tagName)
                        
                        // 在块级元素之间添加换行
                        if (preserveStructure && isBlock && elementCount > 0 && !text.endsWith('\n')) {
                            text += '\n'
                        }
                        
                        text += this._extractText(child, preserveStructure)
                        
                        // 处理 <br> 标签
                        if (tagName === 'br') {
                            text += '\n'
                        }
                        
                        // 在块级元素后添加换行
                        if (preserveStructure && isBlock && !text.endsWith('\n')) {
                            text += '\n'
                        }
                        
                        elementCount++
                    }
                })
            }
        } catch (error) {
            console.error('提取文本失败:', error)
        }
        
        // 清理开头多余的换行
        text = text.replace(/^\n+/, '')
        // 保留结尾最多一个换行
        text = text.replace(/\n+$/, '') + '\n'
        // 清理连续超过2个的换行
        text = text.replace(/\n{3,}/g, '\n\n')
        
        console.log('📝 _extractText 提取的文本:', JSON.stringify(text).substring(0, 200))
        return text
    }

    _generateDescription() {
        const now = new Date()
        return `快照 - ${now.toLocaleString('zh-CN')}`
    }

    async clearAllSnapshots() {
        try {
            const snapshots = Array.from(this.snapshots.keys())
            for (const snapshotId of snapshots) {
                await fetch(`${API_BASE_URL}/api/snapshots/delete?id=${encodeURIComponent(snapshotId)}`, {
                    method: 'DELETE'
                })
            }
            this.snapshots.clear()
            console.log('✅ 所有快照已从服务器删除')
        } catch (error) {
            console.error('❌ 清空快照失败:', error)
            throw error
        }
    }

    getSnapshotCount(documentName = null) {
        if (documentName) {
            return Array.from(this.snapshots.values()).filter(s => s.documentName === documentName).length
        }
        return this.snapshots.size
    }
}

const versionManager = new VersionManager()
let showingAllSnapshots = false

export { versionManager, VersionManager }

export function formatTimestamp(timestamp) {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    })
}

export function generateDiffHtml(diff) {
    if (diff.error) {
        return `<div class="diff-container">
            <div class="diff-header">
                <div class="diff-title">差异对比结果</div>
                <div class="diff-error">${diff.error}</div>
            </div>
        </div>`
    }
    
    let html = `<div class="diff-container">`
    
    html += `<div class="diff-header">
        <div class="diff-title">差异对比结果</div>
        <div class="diff-meta">
            <span>快照1: ${formatTimestamp(diff.snapshot1.timestamp)}</span>
            <span>→</span>
            <span>快照2: ${formatTimestamp(diff.snapshot2.timestamp)}</span>
        </div>
        <div class="diff-stats">
            <span class="stat-added">新增: ${diff.added.length}</span>
            <span class="stat-removed">删除: ${diff.removed.length}</span>
            <span class="stat-modified">修改: ${diff.modified.length}</span>
            <span class="stat-total">总计: ${diff.totalChanges}</span>
        </div>
    </div>`
    
    if (diff.totalChanges === 0) {
        html += `<div class="diff-empty">两个版本内容完全相同</div>`
    } else {
        html += `<div class="diff-content">`
        
        if (diff.removed.length > 0) {
            html += `<div class="diff-section">
                <h3>删除的行</h3>
                <div class="diff-lines">`
            diff.removed.forEach(item => {
                html += `<div class="diff-line diff-removed">
                    <span class="line-number">-${item.line}</span>
                    <span class="line-content">${escapeHtml(item.content)}</span>
                </div>`
            })
            html += `</div></div>`
        }
        
        if (diff.added.length > 0) {
            html += `<div class="diff-section">
                <h3>新增的行</h3>
                <div class="diff-lines">`
            diff.added.forEach(item => {
                html += `<div class="diff-line diff-added">
                    <span class="line-number">+${item.line}</span>
                    <span class="line-content">${escapeHtml(item.content)}</span>
                </div>`
            })
            html += `</div></div>`
        }
        
        if (diff.modified.length > 0) {
            html += `<div class="diff-section">
                <h3>修改的行</h3>
                <div class="diff-lines">`
            diff.modified.forEach(item => {
                html += `<div class="diff-line diff-modified-old">
                    <span class="line-number">-${item.line}</span>
                    <span class="line-content">${escapeHtml(item.oldContent)}</span>
                </div>
                <div class="diff-line diff-modified-new">
                    <span class="line-number">+${item.line}</span>
                    <span class="line-content">${escapeHtml(item.newContent)}</span>
                </div>`
            })
            html += `</div></div>`
        }
        
        html += `</div>`
    }
    
    html += `</div>`
    
    return html
}

function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
}

export async function initVersionManagerUI() {
    // 初始化时从服务器加载快照
    await versionManager.init()
    
    const versionPanel = document.createElement('div')
    versionPanel.id = 'version-panel'
    versionPanel.className = 'version-panel'
    versionPanel.style.display = 'none'
    versionPanel.innerHTML = `
        <div class="version-panel-header">
            <h2>版本管理</h2>
            <button id="close-version-panel" class="close-btn">&times;</button>
        </div>
        <div class="version-panel-body">
            <div class="current-doc-info" style="padding: 12px 24px; background: rgba(14, 165, 233, 0.1); border-radius: 8px; margin: 16px 24px; display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 600; color: var(--primary-700);">当前文档:</span>
                <span id="version-current-doc-name" style="color: var(--primary-600);">未打开</span>
            </div>
            <div style="padding: 10px 24px; background: rgba(34, 197, 94, 0.1); border-radius: 8px; margin: 0 24px 16px; font-size: 12px; color: #166534; line-height: 1.5;">
                💾 快照保存在服务器 snapshots 文件夹中，持久化存储
            </div>
            <div class="version-actions">
                <button id="save-snapshot-btn" class="btn btn-primary">保存快照</button>
                <button id="compare-snapshots-btn" class="btn btn-secondary">对比版本</button>
                <button id="show-all-snapshots-btn" class="btn btn-secondary">显示所有快照</button>
                <button id="refresh-snapshots-btn" class="btn btn-secondary">刷新列表</button>
                <button id="clear-all-snapshots-btn" class="btn btn-danger">清空所有</button>
            </div>
            <div class="version-list">
                <h3>历史快照 <span id="snapshot-filter-label" style="font-weight: normal; font-size: 12px; color: #64748b;"></span></h3>
                <div id="snapshot-list" class="snapshot-list"></div>
            </div>
            <div id="diff-result" class="diff-result"></div>
        </div>
    `
    
    document.body.appendChild(versionPanel)
    
    setupVersionPanelListeners()
}

function setupVersionPanelListeners() {
    const closeBtn = document.getElementById('close-version-panel')
    const saveBtn = document.getElementById('save-snapshot-btn')
    const compareBtn = document.getElementById('compare-snapshots-btn')
    const showAllBtn = document.getElementById('show-all-snapshots-btn')
    const refreshBtn = document.getElementById('refresh-snapshots-btn')
    const clearBtn = document.getElementById('clear-all-snapshots-btn')
    const versionPanel = document.getElementById('version-panel')
    
    closeBtn.addEventListener('click', () => {
        versionPanel.style.display = 'none'
    })
    
    saveBtn.addEventListener('click', async () => {
        const ydoc = window.ydoc
        if (!ydoc) {
            alert('请先打开一个文档')
            return
        }
        
        const docName = window.currentDocumentName || 'unnamed'
        const description = prompt(`为文档 "${docName}" 保存快照\n\n请输入快照描述（可选，直接确定则使用默认描述）：`)
        
        if (description === null) {
            return
        }
        
        try {
            saveBtn.disabled = true
            saveBtn.textContent = '保存中...'
            
            const snapshot = await versionManager.saveSnapshot(ydoc, docName, description)
            alert(`✅ 快照已保存到服务器！\n\n文档: ${docName}\nID: ${snapshot.id}\n时间: ${formatTimestamp(snapshot.timestamp)}`)
            renderSnapshotList(showingAllSnapshots ? 'all' : 'current')
        } catch (error) {
            alert('❌ 保存失败: ' + error.message)
        } finally {
            saveBtn.disabled = false
            saveBtn.textContent = '保存快照'
        }
    })
    
    refreshBtn.addEventListener('click', async () => {
        try {
            refreshBtn.disabled = true
            refreshBtn.textContent = '刷新中...'
            await versionManager.loadSnapshotsFromServer()
            renderSnapshotList(showingAllSnapshots ? 'all' : 'current')
        } catch (error) {
            alert('❌ 刷新失败: ' + error.message)
        } finally {
            refreshBtn.disabled = false
            refreshBtn.textContent = '刷新列表'
        }
    })
    
    compareBtn.addEventListener('click', async () => {
        const snapshots = versionManager.getAllSnapshots(window.currentDocumentName)
        if (snapshots.length < 2) {
            alert('至少需要两个快照才能进行对比\n\n提示：当前' + (window.currentDocumentName ? `"${window.currentDocumentName}"` : '当前文档') + '只有 ' + snapshots.length + ' 个快照')
            return
        }
        
        let options = ''
        snapshots.forEach(snap => {
            options += `<option value="${snap.id}">${formatTimestamp(snap.timestamp)} - ${snap.description}</option>`
        })
        
        const compareModal = document.createElement('div')
        compareModal.className = 'compare-modal'
        compareModal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10001;
        `
        compareModal.innerHTML = `
            <div style="background: white; padding: 20px; border-radius: 8px; width: 80%; max-width: 600px;">
                <h3>选择要对比的两个版本</h3>
                <div style="margin: 10px 0;">
                    <label>快照1（旧版本）:</label>
                    <select id="compare-snap1" style="width: 100%; padding: 8px;">${options}</select>
                </div>
                <div style="margin: 10px 0;">
                    <label>快照2（新版本）:</label>
                    <select id="compare-snap2" style="width: 100%; padding: 8px;">${options}</select>
                </div>
                <div style="display: flex; gap: 10px; margin-top: 20px;">
                    <button id="do-compare-btn" class="btn btn-primary" style="flex: 1;">开始对比</button>
                    <button id="cancel-compare-btn" class="btn btn-secondary" style="flex: 1;">取消</button>
                </div>
            </div>
        `
        
        document.body.appendChild(compareModal)
        
        document.getElementById('do-compare-btn').addEventListener('click', async () => {
            const snap1Id = document.getElementById('compare-snap1').value
            const snap2Id = document.getElementById('compare-snap2').value
            
            if (snap1Id === snap2Id) {
                alert('请选择不同的快照进行对比')
                return
            }
            
            try {
                document.getElementById('do-compare-btn').disabled = true
                document.getElementById('do-compare-btn').textContent = '对比中...'
                
                const diff = await versionManager.compareSnapshots(snap1Id, snap2Id)
                const diffHtml = generateDiffHtml(diff)
                const diffResult = document.getElementById('diff-result')
                diffResult.innerHTML = diffHtml
                diffResult.style.display = 'block'
                
                setTimeout(() => {
                    diffResult.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }, 100)
                
            } catch (error) {
                console.error('对比失败:', error)
                alert('对比失败: ' + error.message)
            } finally {
                document.getElementById('do-compare-btn').disabled = false
                document.getElementById('do-compare-btn').textContent = '开始对比'
            }
            
            document.body.removeChild(compareModal)
        })
        
        document.getElementById('cancel-compare-btn').addEventListener('click', () => {
            document.body.removeChild(compareModal)
        })
    })
    
    showAllBtn.addEventListener('click', () => {
        showingAllSnapshots = !showingAllSnapshots
        if (showingAllSnapshots) {
            showAllBtn.textContent = '显示当前文档'
            showAllBtn.classList.remove('btn-secondary')
            showAllBtn.classList.add('btn-primary')
        } else {
            showAllBtn.textContent = '显示所有快照'
            showAllBtn.classList.remove('btn-primary')
            showAllBtn.classList.add('btn-secondary')
        }
        renderSnapshotList(showingAllSnapshots ? 'all' : 'current')
    })
    
    clearBtn.addEventListener('click', async () => {
        if (confirm('确定要清空所有快照吗？此操作不可恢复！')) {
            try {
                clearBtn.disabled = true
                clearBtn.textContent = '清空中...'
                await versionManager.clearAllSnapshots()
                renderSnapshotList(showingAllSnapshots ? 'all' : 'current')
                alert('✅ 已清空所有快照')
            } catch (error) {
                alert('❌ 清空失败: ' + error.message)
            } finally {
                clearBtn.disabled = false
                clearBtn.textContent = '清空所有'
            }
        }
    })
    
    versionPanel.addEventListener('click', (e) => {
        if (e.target === versionPanel) {
            versionPanel.style.display = 'none'
        }
    })
}

export function renderSnapshotList(filter = 'current') {
    const listContainer = document.getElementById('snapshot-list')
    const filterLabel = document.getElementById('snapshot-filter-label')
    
    let snapshots
    if (filter === 'all') {
        snapshots = versionManager.getAllSnapshots()
        if (filterLabel) filterLabel.textContent = '(显示所有快照，共 ' + snapshots.length + ' 个)'
    } else {
        snapshots = versionManager.getAllSnapshots(window.currentDocumentName)
        if (filterLabel) filterLabel.textContent = `(当前文档: ${window.currentDocumentName || '未打开'}，共 ${snapshots.length} 个)`
    }
    
    if (!listContainer) return
    
    console.log('📋 渲染快照列表，过滤模式:', filter, '数量:', snapshots.length)
    
    if (snapshots.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: #999;">暂无快照<br><small>点击「保存快照」创建第一个版本</small></p>'
        return
    }
    
    listContainer.innerHTML = snapshots.map(snap => `
        <div class="snapshot-item">
            <div class="snapshot-info">
                <div class="snapshot-timestamp">${formatTimestamp(snap.timestamp)}</div>
                <div class="snapshot-description">${snap.description}</div>
                <div class="snapshot-meta">
                    <span>文档: ${snap.documentName}</span>
                    <span>ID: ${snap.id.substring(0, 20)}...</span>
                </div>
            </div>
            <div class="snapshot-actions">
                <button class="snapshot-action-btn restore-btn" data-id="${snap.id}">恢复</button>
                <button class="snapshot-action-btn delete-btn" data-id="${snap.id}">删除</button>
            </div>
        </div>
    `).join('')
    
    document.querySelectorAll('.restore-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const snapshotId = e.target.getAttribute('data-id')
            const snapshot = versionManager.getSnapshot(snapshotId)
            
            if (!snapshot) {
                alert('快照不存在或已被删除')
                await versionManager.loadSnapshotsFromServer()
                renderSnapshotList(filter)
                return
            }
            
            if (confirm(`确定要恢复到该版本吗？\n\n快照文档: ${snapshot.documentName}\n时间: ${formatTimestamp(snapshot.timestamp)}\n描述: ${snapshot.description}\n\n⚠️ 当前文档内容将被完全替换！`)) {
                const ydoc = window.ydoc
                const editor = window.editor
                
                if (!ydoc) {
                    alert('❌ 请先打开一个文档')
                    return
                }
                
                if (!editor) {
                    alert('❌ 编辑器未初始化，请刷新页面重试')
                    return
                }
                
                try {
                    btn.disabled = true
                    btn.textContent = '恢复中...'
                    
                    await versionManager.restoreSnapshot(ydoc, snapshotId)
                    
                    setTimeout(() => {
                        alert(`✅ 恢复成功！\n\n文档已恢复到 ${formatTimestamp(snapshot.timestamp)} 的版本`)
                    }, 500)
                    
                } catch (error) {
                    console.error('恢复失败:', error)
                    alert('❌ 恢复失败: ' + error.message)
                } finally {
                    btn.disabled = false
                    btn.textContent = '恢复'
                }
            }
        })
    })
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const snapshotId = e.target.getAttribute('data-id')
            if (confirm('确定要删除此快照吗？')) {
                try {
                    btn.disabled = true
                    btn.textContent = '删除中...'
                    await versionManager.deleteSnapshot(snapshotId)
                    renderSnapshotList(filter)
                } catch (error) {
                    alert('❌ 删除失败: ' + error.message)
                } finally {
                    btn.disabled = false
                    btn.textContent = '删除'
                }
            }
        })
    })
}

export function showVersionPanel() {
    const panel = document.getElementById('version-panel')
    if (panel) {
        const docNameElement = document.getElementById('version-current-doc-name')
        if (docNameElement) {
            docNameElement.textContent = window.currentDocumentName || '未打开'
        }
        renderSnapshotList(showingAllSnapshots ? 'all' : 'current')
        document.getElementById('diff-result').style.display = 'none'
        panel.style.display = 'flex'
    }
}
