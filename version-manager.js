import * as Y from 'yjs'

class VersionManager {
    constructor() {
        this.snapshots = new Map()
        this.snapshotIdCounter = 0
        this.maxSnapshots = 50
    }

    saveSnapshot(doc, documentName, description = '') {
        const snapshotId = `snapshot-${++this.snapshotIdCounter}`
        const update = Y.encodeStateAsUpdate(doc)
        const binaryString = Array.from(update, byte => String.fromCharCode(byte)).join('')
        const base64State = btoa(binaryString)
        
        const snapshot = {
            id: snapshotId,
            documentName,
            timestamp: Date.now(),
            description: description || this._generateDescription(),
            content: base64State,
            size: update.byteLength
        }
        
        this.snapshots.set(snapshotId, snapshot)
        
        if (this.snapshots.size > this.maxSnapshots) {
            const oldestId = Array.from(this.snapshots.keys()).sort()[0]
            this.snapshots.delete(oldestId)
        }
        
        this._saveToLocalStorage()
        
        return snapshot
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

    deleteSnapshot(snapshotId) {
        const deleted = this.snapshots.delete(snapshotId)
        if (deleted) {
            this._saveToLocalStorage()
        }
        return deleted
    }

    restoreSnapshot(doc, snapshotId) {
        const snapshot = this.snapshots.get(snapshotId)
        if (!snapshot) {
            throw new Error('快照不存在')
        }
        
        try {
            const binaryString = atob(snapshot.content)
            const update = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
                update[i] = binaryString.charCodeAt(i)
            }
            
            // 创建临时文档来读取快照内容
            const tempDoc = new Y.Doc()
            Y.applyUpdate(tempDoc, update)
            
            // 获取快照中的内容
            const snapshotContent = tempDoc.get('content', Y.XmlFragment)
            
            // 清空当前文档的内容
            const currentContent = doc.get('content', Y.XmlFragment)
            currentContent.delete(0, currentContent.length)
            
            // 从快照复制内容到当前文档
            snapshotContent.forEach((child) => {
                currentContent.push([child])
            })
            
            tempDoc.destroy()
            return snapshot
        } catch (error) {
            throw new Error('恢复快照失败: ' + error.message)
        }
    }

    compareSnapshots(snapshotId1, snapshotId2) {
        const snap1 = this.snapshots.get(snapshotId1)
        const snap2 = this.snapshots.get(snapshotId2)
        
        if (!snap1) {
            throw new Error('快照 ' + snapshotId1 + ' 不存在')
        }
        if (!snap2) {
            throw new Error('快照 ' + snapshotId2 + ' 不存在')
        }
        
        const content1 = this._decodeSnapshotContent(snap1)
        const content2 = this._decodeSnapshotContent(snap2)
        
        return this._generateDiff(content1, content2, snap1, snap2)
    }

    _decodeSnapshotContent(snapshot) {
        const binaryString = atob(snapshot.content)
        const update = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
            update[i] = binaryString.charCodeAt(i)
        }
        
        const tempDoc = new Y.Doc()
        Y.applyUpdate(tempDoc, update)
        
        const content = tempDoc.get('content', Y.XmlFragment)
        return content ? content.toString() : ''
    }

    _generateDiff(content1, content2, snap1, snap2) {
        const lines1 = content1.split('\n')
        const lines2 = content2.split('\n')
        
        const diff = {
            snapshot1: {
                id: snap1.id,
                timestamp: snap1.timestamp,
                description: snap1.description
            },
            snapshot2: {
                id: snap2.id,
                timestamp: snap2.timestamp,
                description: snap2.description
            },
            added: [],
            removed: [],
            modified: [],
            totalChanges: 0
        }
        
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
        
        return diff
    }

    _generateDescription() {
        const now = new Date()
        return `自动保存 - ${now.toLocaleString('zh-CN')}`
    }

    _saveToLocalStorage() {
        const data = {
            snapshots: Array.from(this.snapshots.values()),
            snapshotIdCounter: this.snapshotIdCounter
        }
        localStorage.setItem('versionManagerData', JSON.stringify(data))
    }

    loadFromLocalStorage() {
        const stored = localStorage.getItem('versionManagerData')
        if (stored) {
            try {
                const data = JSON.parse(stored)
                data.snapshots.forEach(snapshot => {
                    this.snapshots.set(snapshot.id, snapshot)
                })
                this.snapshotIdCounter = data.snapshotIdCounter || 0
            } catch (error) {
                console.error('加载版本数据失败:', error)
            }
        }
    }

    clearAllSnapshots() {
        this.snapshots.clear()
        this.snapshotIdCounter = 0
        localStorage.removeItem('versionManagerData')
    }

    getSnapshotCount(documentName = null) {
        if (documentName) {
            return Array.from(this.snapshots.values()).filter(s => s.documentName === documentName).length
        }
        return this.snapshots.size
    }
}

const versionManager = new VersionManager()
versionManager.loadFromLocalStorage()

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

export function initVersionManagerUI() {
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
            <div style="padding: 10px 24px; background: rgba(251, 191, 36, 0.1); border-radius: 8px; margin: 0 24px 16px; font-size: 12px; color: #92400e; line-height: 1.5;">
                💾 快照保存在浏览器本地存储 (LocalStorage)，清除浏览器数据会导致快照丢失
            </div>
            <div class="version-actions">
                <button id="save-snapshot-btn" class="btn btn-primary">保存快照</button>
                <button id="compare-snapshots-btn" class="btn btn-secondary">对比版本</button>
                <button id="clear-all-snapshots-btn" class="btn btn-danger">清空所有</button>
            </div>
            <div class="version-list">
                <h3>历史快照</h3>
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
        
        // 用户点击取消则不保存
        if (description === null) {
            return
        }
        
        const snapshot = versionManager.saveSnapshot(ydoc, docName, description)
        alert(`快照已保存！\n\n文档: ${docName}\nID: ${snapshot.id}\n时间: ${formatTimestamp(snapshot.timestamp)}`)
        renderSnapshotList()
    })
    
    compareBtn.addEventListener('click', () => {
        const snapshots = versionManager.getAllSnapshots(window.currentDocumentName)
        if (snapshots.length < 2) {
            alert('至少需要两个快照才能进行对比')
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
        
        document.getElementById('do-compare-btn').addEventListener('click', () => {
            const snap1Id = document.getElementById('compare-snap1').value
            const snap2Id = document.getElementById('compare-snap2').value
            
            if (snap1Id === snap2Id) {
                alert('请选择不同的快照进行对比')
                return
            }
            
            try {
                const diff = versionManager.compareSnapshots(snap1Id, snap2Id)
                const diffHtml = generateDiffHtml(diff)
                const diffResult = document.getElementById('diff-result')
                diffResult.innerHTML = diffHtml
                diffResult.style.display = 'block'
                
                // 滚动到对比结果区域
                setTimeout(() => {
                    diffResult.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }, 100)
                
            } catch (error) {
                console.error('对比失败:', error)
                alert('对比失败: ' + error.message)
            }
            
            document.body.removeChild(compareModal)
        })
        
        document.getElementById('cancel-compare-btn').addEventListener('click', () => {
            document.body.removeChild(compareModal)
        })
    })
    
    clearBtn.addEventListener('click', () => {
        if (confirm('确定要清空所有快照吗？此操作不可恢复！')) {
            versionManager.clearAllSnapshots()
            renderSnapshotList()
            alert('已清空所有快照')
        }
    })
    
    versionPanel.addEventListener('click', (e) => {
        if (e.target === versionPanel) {
            versionPanel.style.display = 'none'
        }
    })
}

export function renderSnapshotList() {
    const listContainer = document.getElementById('snapshot-list')
    const snapshots = versionManager.getAllSnapshots(window.currentDocumentName)
    
    if (!listContainer) return
    
    if (snapshots.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: #999;">暂无快照</p>'
        return
    }
    
    listContainer.innerHTML = snapshots.map(snap => `
        <div class="snapshot-item">
            <div class="snapshot-info">
                <div class="snapshot-timestamp">${formatTimestamp(snap.timestamp)}</div>
                <div class="snapshot-description">${snap.description}</div>
                <div class="snapshot-meta">
                    <span>文档: ${snap.documentName}</span>
                    <span>ID: ${snap.id}</span>
                    <span>大小: ${(snap.size / 1024).toFixed(2)} KB</span>
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
                renderSnapshotList()
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
                    // 恢复快照到 ydoc
                    versionManager.restoreSnapshot(ydoc, snapshotId)
                    
                    // 等待 Yjs 同步更新
                    setTimeout(() => {
                        // 刷新编辑器内容
                        if (editor && !editor.isDestroyed) {
                            editor.commands.clearContent()
                            const content = ydoc.get('content', Y.XmlFragment)
                            if (content) {
                                // 内容已通过 Yjs 自动同步
                            }
                        }
                        alert(`✅ 恢复成功！\n\n文档已恢复到 ${formatTimestamp(snapshot.timestamp)} 的版本`)
                    }, 500)
                    
                } catch (error) {
                    console.error('恢复失败:', error)
                    alert('❌ 恢复失败: ' + error.message)
                }
            }
        })
    })
    
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const snapshotId = e.target.getAttribute('data-id')
            if (confirm('确定要删除此快照吗？')) {
                versionManager.deleteSnapshot(snapshotId)
                renderSnapshotList()
            }
        })
    })
}

export function showVersionPanel() {
    const panel = document.getElementById('version-panel')
    if (panel) {
        // 更新当前文档名称显示
        const docNameElement = document.getElementById('version-current-doc-name')
        if (docNameElement) {
            docNameElement.textContent = window.currentDocumentName || '未打开'
        }
        renderSnapshotList()
        document.getElementById('diff-result').style.display = 'none'
        panel.style.display = 'flex'
    }
}
