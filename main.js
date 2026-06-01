import { Editor, Mark } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { clickEffect, createParticleBackground, generateRandomColor, updateConnectionStatus, createUserInfoPanel, createConnectionStatusPanel, setConnectionStatusElement, updateOnlineUsersList } from './beautify.js'

const userId = `user-${Math.floor(Math.random() * 100000)}`
const userColor = generateRandomColor()
const userName = userId

const UserHighlight = Mark.create({
    name: 'userHighlight',
    inclusive: true,
    addAttributes() {
        return {
            userId: {
                default: null,
            },
            userName: {
                default: null,
            },
            color: {
                default: null,
            }
        }
    },
    parseHTML() {
        return [
            {
                tag: 'span[data-user-highlight]'
            }
        ]
    },
    renderHTML({ HTMLAttributes }) {
        const { userId, userName, color, ...rest } = HTMLAttributes
        const styles = []

        if (color) {
            styles.push(`background-color: ${color}`)
            styles.push('color: inherit')
        }

        return ['span', {
            ...rest,
            'data-user-highlight': userId || '',
            'data-user-id': userId || '',
            'data-user-name': userName || '',
            class: 'user-highlight',
            style: styles.join('; ')
        }, 0]
    },
    addCommands() {
        return {
            setUserHighlight: attrs => ({ commands }) => commands.setMark(this.name, attrs),
            unsetUserHighlight: () => ({ commands }) => commands.unsetMark(this.name)
        }
    }
})

// 系统消息通知函数
function showSystemNotification(title, message, type = 'info', duration = 3000) {
    const container = document.getElementById('system-notifications')
    if (!container) return
    
    // 创建消息元素
    const notification = document.createElement('div')
    notification.className = `system-notification ${type}`
    
    // 根据类型设置图标
    const icons = {
        'user-join': '👋',
        'user-leave': '👋',
        'document-save': '💾',
        'info': 'ℹ️',
        'warning': '⚠️'
    }
    
    const icon = icons[type] || icons['info']
    
    notification.innerHTML = `
        <div class="system-notification-title">
            <span>${icon}</span>
            <span>${title}</span>
        </div>
        <div class="system-notification-content">${message}</div>
    `
    
    container.appendChild(notification)
    
    // 设置自动消失
    setTimeout(() => {
        notification.classList.add('hiding')
        // 动画结束后移除元素
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification)
            }
        }, 300)
    }, duration)
}

// 始终使用当前访问的主机名，这样其他电脑访问时会自动连接到你的服务器
const serverHost = window.location.hostname
const wsUrl = `ws://${serverHost}:1235`
const apiUrl = `http://${serverHost}:1236`

let editor = null
let provider = null
let ydoc = null
let currentDocumentName = 'test_document'  // 默认文档名称
let saveTimeout = null  // 用于前端防抖保存提示
let isEditorCreated = false  // 防止重复创建编辑器
let isComposing = false  // 标记是否正在输入法组合输入（如拼音）
let previousUsers = new Set()  // 跟踪之前的用户列表，用于检测加入/退出
let autoSaveNotificationTimeout = null  // 用于防抖自动保存通知
let hasShownConnectedMessage = false  // 标记是否已显示连接成功消息

async function initEditor(documentName) {
    console.log('=== Initializing editor for document:', documentName, '===')
    
    // 重置编辑器创建标志
    isEditorCreated = false
    // 重置连接消息标志，允许在新文档中显示连接成功消息
    hasShownConnectedMessage = false
    
    if (editor) {
        console.log('Destroying existing editor...')
        editor.destroy()
        editor = null
    }
    
    if (provider) {
        console.log('Destroying existing provider...')
        provider.destroy()
        provider = null
    }
    
    if (ydoc) {
        console.log('Destroying existing ydoc...')
        ydoc.destroy()
        ydoc = null
    }
    
    currentDocumentName = documentName
    
    updateConnectionStatus('connecting')
    
    ydoc = new Y.Doc()
    
    // 监听 Yjs 文档变化，显示保存状态提示
    ydoc.on('update', (update, origin) => {
        console.log('Yjs document updated')
        // 清除之前的超时，设置新的超时来显示保存状态
        if (saveTimeout) {
            clearTimeout(saveTimeout)
        }
            
        // 更新状态为“正在保存...”
        updateConnectionStatus('saving')
            
        // 防抖显示自动保存通知（3秒内只显示一次）
        if (autoSaveNotificationTimeout) {
            clearTimeout(autoSaveNotificationTimeout)
        }
            
        autoSaveNotificationTimeout = setTimeout(() => {
            showSystemNotification(
                '自动保存',
                '文档已自动保存到服务器',
                'document-save',
                2000
            )
        }, 3000)
            
        // 1.5秒后恢复为已连接状态（假设服务器已保存）
        saveTimeout = setTimeout(() => {
            updateConnectionStatus('connected')
        }, 1500)
    })
    
    console.log('Creating Hocuspocus provider, URL:', wsUrl)
    
    provider = new HocuspocusProvider({
        url: wsUrl,
        name: documentName,
        document: ydoc,
        onStatus: ({ status }) => {
            console.log('>>> Connection status:', status)
            if (status === 'connected') {
                console.log('>>> Connected!')
                updateConnectionStatus('connected')
                // 只在首次连接时显示连接成功的系统消息
                if (!hasShownConnectedMessage) {
                    showSystemNotification(
                        '连接成功',
                        `已连接到文档 "${documentName}"`,
                        'info',
                        2000
                    )
                    hasShownConnectedMessage = true
                }
                // 等待 awareness 完全初始化后再创建编辑器
                setTimeout(() => {
                    if (!isEditorCreated) {
                        console.log('>>> Creating editor for the first time...')
                        isEditorCreated = true
                        createEditor()
                    }
                }, 100)
            } else if (status === 'disconnected') {
                console.log('>>> Disconnected')
                updateConnectionStatus('disconnected')
                // 断开连接时重置标志，下次重连时可以再次显示
                hasShownConnectedMessage = false
            } else if (status === 'connecting') {
                console.log('>>> Connecting...')
            }
        },
        onError: ({ error }) => {
            console.error('>>> Connection error:', error)
            updateConnectionStatus('error')
        },
        onSynced: () => {
            console.log('>>> Document synced with server')
            updateConnectionStatus('connected')
        },
        onConnect: () => {
            console.log('>>> WebSocket connected')
        },
        onDisconnect: () => {
            console.log('>>> WebSocket disconnected')
        },
        onAwarenessUpdate: ({ states }) => {
            // 过滤掉没有用户信息的状态（例如只包含光标位置但没有用户名的状态）
            const users = Array.from(states.values())
                .map(state => state.user)
                .filter(user => user && user.name)
            
            console.log('>>> Online users updated:', users)
            updateOnlineUsersList(users)
            
            // 检测用户加入和退出
            const currentUsers = new Set(users.map(u => u.name))
            
            // 检测新加入的用户
            currentUsers.forEach(userName => {
                if (!previousUsers.has(userName)) {
                    // 新用户加入
                    if (userName !== userId) {  // 不显示自己的加入消息
                        showSystemNotification(
                            '用户加入',
                            `${userName} 加入了文档`,
                            'user-join',
                            3000
                        )
                    }
                }
            })
            
            // 检测离开的用户
            previousUsers.forEach(userName => {
                if (!currentUsers.has(userName)) {
                    // 用户离开
                    if (userName !== userId) {  // 不显示自己的离开消息
                        showSystemNotification(
                            '用户离开',
                            `${userName} 离开了文档`,
                            'user-leave',
                            3000
                        )
                    }
                }
            })
            
            // 更新之前的用户列表
            previousUsers = currentUsers
        }
    })
    
    updateRecentDocuments(documentName)
    
    const docNameElement = document.getElementById('current-doc-name')
    if (docNameElement) {
        docNameElement.textContent = '当前文档: ' + documentName
    }
    
    // 更新分享链接
    const currentDocUrlElement = document.getElementById('current-doc-url')
    if (currentDocUrlElement) {
        const shareUrl = `${window.location.origin}${window.location.pathname}?doc=${documentName}`
        currentDocUrlElement.textContent = shareUrl
    }
}

function createEditor() {
    console.log('Creating Tiptap editor...')
    
    // 确保 provider、awareness 和 document 都已初始化
    if (!provider || !provider.awareness || !provider.document) {
        console.warn('Provider, awareness or document not ready yet, waiting...')
        setTimeout(createEditor, 100)
        return
    }
    
    console.log('Provider awareness ready:', !!provider.awareness)
    console.log('YDoc available:', !!ydoc)
    console.log('Provider document:', !!provider.document)
    console.log('Are they the same?', provider.document === ydoc)
    
    // 检查 awareness 是否有当前用户的信息
    if (provider.awareness) {
        console.log('Setting local state for awareness')
        provider.awareness.setLocalStateField('user', {
            id: userId,
            name: userName,
            color: userColor
        })
    }
    
    try {
        editor = new Editor({
            element: document.querySelector('#editor'),
            extensions: [
                StarterKit.configure({
                    // Collaboration 扩展自带历史支持，所以禁用 StarterKit 的历史
                    history: false
                }),
                UserHighlight,
                Collaboration.configure({
                    document: provider.document,
                    field: 'content'
                })
                // CollaborationCursor 与当前版本不兼容，已禁用以避免文字消失的问题
            ],
            onCreate: () => {
                console.log('Editor created successfully')
                console.log('User color:', userColor)
            },
            onUpdate: ({ editor }) => {
                const content = editor.getHTML()
                console.log('✏️ Editor updated, content length:', content.length)
                console.log('Content preview:', content.substring(0, 100))
            },
            onTransaction: ({ transaction }) => {
                if (transaction.docChanged) {
                    console.log('📝 Document changed in transaction')
                }
            },
            editorProps: {
                handleDOMEvents: {
                        beforeinput: (view, event) => {
                        if (!editor || editor.isDestroyed) {
                            return false
                        }

                        const insertTypes = [
                            'insertText',
                            'insertParagraph',
                            'insertLineBreak',
                            'insertCompositionText',
                            'insertFromPaste',
                            'insertFromDrop'
                        ]

                        if (event.inputType && insertTypes.includes(event.inputType)) {
                            editor.commands.setUserHighlight({
                                userId,
                                userName,
                                color: userColor
                            })
                        }

                        return false
                    },
                    compositionstart: () => {
                        // 开始组合输入（如拼音输入）
                        isComposing = true
                        console.log('Composition started')
                        return false
                    },
                    compositionend: () => {
                        // 结束组合输入，确保完整文本被插入
                        isComposing = false
                        console.log('Composition ended')
                        return false
                    }
                },
                attributes: {
                    class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl focus:outline-none'
                }
            }
        })
        
        setTimeout(() => {
            if (editor) {
                editor.commands.focus()
                console.log('Editor focused')
            }
        }, 100)
    } catch (error) {
        console.error('Error creating editor:', error)
        // 如果创建失败，等待后重试
        setTimeout(createEditor, 200)
    }
}



// 创建UI面板元素
const connectionStatus = createConnectionStatusPanel()
setConnectionStatusElement(connectionStatus)
createUserInfoPanel(userName, userColor)

// 调用粒子背景效果和点击特效
createParticleBackground()
clickEffect()



function updateRecentDocuments(documentName) {
    let recentDocs = JSON.parse(localStorage.getItem('recentDocuments') || '[]')
    recentDocs = recentDocs.filter(doc => doc !== documentName)
    recentDocs.unshift(documentName)
    recentDocs = recentDocs.slice(0, 5)
    localStorage.setItem('recentDocuments', JSON.stringify(recentDocs))
}

async function loadDocumentList() {
    try {
        const response = await fetch(apiUrl + '/api/documents')
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
        }
        const data = await response.json()
        return data.documents || []
    } catch (error) {
        console.error('Error loading document list:', error)
        return []
    }
}

async function checkDocumentExists(documentName) {
    try {
        const docs = await loadDocumentList()
        return docs.includes(documentName)
    } catch (error) {
        console.error('Error checking document existence:', error)
        return false
    }
}

async function deleteDocument(documentName) {
    try {
        const response = await fetch(`${apiUrl}/api/documents?name=${encodeURIComponent(documentName)}`, {
            method: 'DELETE'
        })
        
        if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to delete document')
        }
        
        console.log('Document deleted successfully:', documentName)
        
        // 如果删除的是当前打开的文档，重置编辑器
        if (currentDocumentName === documentName && editor) {
            editor.destroy()
            editor = null
            if (provider) {
                provider.destroy()
                provider = null
            }
            if (ydoc) {
                ydoc.destroy()
                ydoc = null
            }
            currentDocumentName = 'test_document'
            const docNameElement = document.getElementById('current-doc-name')
            if (docNameElement) {
                docNameElement.textContent = '当前文档: test_document'
            }
        }
        
        // 刷新文档列表
        const serverDocs = await loadDocumentList()
        renderRecentDocuments(serverDocs)
        
        alert(`文档 "${documentName}" 已删除`)
    } catch (error) {
        console.error('Error deleting document:', error)
        alert(`删除失败: ${error.message}`)
    }
}

async function renderRecentDocuments(docs) {
    const list = document.getElementById('recent-docs')
    list.innerHTML = ''
    
    if (!docs || docs.length === 0) {
        const li = document.createElement('li')
        li.textContent = '暂无文档'
        li.style.color = '#999'
        list.appendChild(li)
        return
    }
    
    docs.forEach(doc => {
        const li = document.createElement('li')
        li.innerHTML = `<span style="flex: 1;">${doc}</span>`
        li.style.display = 'flex'
        li.style.justifyContent = 'space-between'
        li.style.alignItems = 'center'
        
        const buttonGroup = document.createElement('div')
        buttonGroup.style.display = 'flex'
        buttonGroup.style.gap = '8px'
        
        const openBtn = document.createElement('button')
        openBtn.textContent = '打开'
        openBtn.className = 'btn-sm btn-sm-primary'
        openBtn.style.cursor = 'pointer'
        openBtn.addEventListener('click', async (e) => {
            e.stopPropagation()
            await initEditor(doc)
        })
        
        const deleteBtn = document.createElement('button')
        deleteBtn.textContent = '删除'
        deleteBtn.className = 'btn-sm btn-sm-danger'
        deleteBtn.style.cursor = 'pointer'
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation()
            if (confirm(`确定要删除文档 "${doc}" 吗？此操作不可恢复！`)) {
                await deleteDocument(doc)
            }
        })
        
        buttonGroup.appendChild(openBtn)
        buttonGroup.appendChild(deleteBtn)
        li.appendChild(buttonGroup)
        
        li.addEventListener('click', async () => {
            await initEditor(doc)
        })
        list.appendChild(li)
    })
}

function setupEventListeners() {
    document.getElementById('create-doc').addEventListener('click', async () => {
        const docName = document.getElementById('document-name').value.trim()
        if (docName) {
            await initEditor(docName)
            document.getElementById('document-name').value = ''
        } else {
            alert('请输入文档名称')
        }
    })
    
    document.getElementById('open-doc').addEventListener('click', async () => {
        const docName = document.getElementById('document-name').value.trim()
        if (docName) {
            // 检查文档是否存在
            const exists = await checkDocumentExists(docName)
            if (!exists) {
                alert(`文档 "${docName}" 不存在`)
                return
            }
            await initEditor(docName)
            document.getElementById('document-name').value = ''
        } else {
            alert('请输入文档名称')
        }
    })
    
    // 加入文档功能
    document.getElementById('join-doc').addEventListener('click', async () => {
        const docId = document.getElementById('document-id').value.trim()
        if (docId) {
            // 检查是否是URL链接
            let documentName = docId
            
            // 如果是完整的URL，提取文档名称
            if (docId.includes('?doc=')) {
                const urlParams = new URLSearchParams(docId.split('?')[1])
                documentName = urlParams.get('doc')
            } else if (docId.includes('/')) {
                // 尝试从路径中提取文档名称
                const parts = docId.split('/')
                documentName = parts[parts.length - 1].split('.')[0] // 移除可能的扩展名
            }
            
            if (documentName) {
                // 检查文档是否存在
                const exists = await checkDocumentExists(documentName)
                if (!exists) {
                    alert(`文档 "${documentName}" 不存在`)
                    return
                }
                await initEditor(documentName)
                document.getElementById('document-id').value = ''
            } else {
                alert('无法从链接中提取文档名称')
            }
        } else {
            alert('请输入文档编号或链接')
        }
    })
    
    // 复制链接功能
    document.getElementById('copy-link').addEventListener('click', () => {
        const currentDocUrlElement = document.getElementById('current-doc-url')
        const currentDocUrl = currentDocUrlElement ? currentDocUrlElement.textContent : ''
        
        if (currentDocUrl && currentDocUrl !== '无') {
            // 使用同步方式复制，确保在用户手势的同步上下文中执行
            if (navigator.clipboard && navigator.clipboard.writeText) {
                // 尝试使用现代 Clipboard API
                navigator.clipboard.writeText(currentDocUrl).then(() => {
                    alert('链接已复制到剪贴板！')
                }).catch(err => {
                    console.error('Clipboard API 复制失败: ', err)
                    fallbackCopyText(currentDocUrl, currentDocUrlElement)
                })
            } else {
                // 浏览器不支持 Clipboard API，直接使用降级方案
                fallbackCopyText(currentDocUrl, currentDocUrlElement)
            }
        } else {
            alert('当前没有打开的文档')
        }
    })
    
    // 降级复制方案
    function fallbackCopyText(text, element) {
        const textArea = document.createElement('textarea')
        textArea.value = text
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        
        try {
            const successful = document.execCommand('copy')
            if (successful) {
                alert('链接已复制到剪贴板！')
            } else {
                // execCommand 失败，选中文本让用户手动复制
                if (element) {
                    const range = document.createRange()
                    const selection = window.getSelection()
                    range.selectNodeContents(element)
                    selection.removeAllRanges()
                    selection.addRange(range)
                }
                alert('请手动复制选中的链接（Ctrl+C）')
            }
        } catch (err) {
            console.error('execCommand 复制失败: ', err)
            // 出错时选中文本让用户手动复制
            if (element) {
                const range = document.createRange()
                const selection = window.getSelection()
                range.selectNodeContents(element)
                selection.removeAllRanges()
                selection.addRange(range)
            }
            alert('请手动复制选中的链接（Ctrl+C）')
        } finally {
            document.body.removeChild(textArea)
        }
    }
    
    document.getElementById('save-btn').addEventListener('click', () => {
        if (provider && ydoc) {
            console.log('Manually triggering save via Hocuspocus...')
            
            // 通过 Hocuspocus provider 触发立即保存
            if (provider.forceSync) {
                provider.forceSync()
                console.log('Force sync triggered')
            }
            
            // 显示保存状态提示
            updateConnectionStatus('saving')
            
            // 显示保存中的系统消息
            showSystemNotification(
                '保存中',
                '正在将文档保存到服务器...',
                'document-save',
                2000
            )
            
            // 2秒后恢复状态并显示成功提示
            setTimeout(() => {
                updateConnectionStatus('connected')
                showSystemNotification(
                    '保存成功',
                    `文档 "${currentDocumentName}" 已保存到服务器`,
                    'document-save',
                    3000
                )
            }, 2000)
        } else {
            showSystemNotification(
                '错误',
                '请先打开一个文档',
                'warning',
                3000
            )
        }
    })
    
    
    document.getElementById('document-name').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const docName = e.target.value.trim()
            if (docName) {
                initEditor(docName)
                e.target.value = ''
            }
        }
    })
    
    // 导出文档功能
    document.getElementById('export-btn').addEventListener('click', () => {
        if (!editor) {
            alert('请先打开一个文档')
            return
        }
        
        const exportFormat = document.getElementById('export-format').value
        let content, filename, mimeType
        
        if (exportFormat === 'html') {
            content = editor.getHTML()
            filename = `${currentDocumentName}.html`
            mimeType = 'text/html'
        } else if (exportFormat === 'text') {
            content = editor.getText()
            filename = `${currentDocumentName}.txt`
            mimeType = 'text/plain'
        } else if (exportFormat === 'json') {
            // 导出 Yjs 文档状态
            const state = Y.encodeStateAsUpdate(ydoc)
            // 使用浏览器兼容的方式转换为 base64
            const binaryString = Array.from(state, byte => String.fromCharCode(byte)).join('')
            const base64State = btoa(binaryString)
            content = JSON.stringify({
                type: 'yjs',
                data: base64State,
                exportedAt: new Date().toISOString(),
                documentName: currentDocumentName
            }, null, 2)
            filename = `${currentDocumentName}.json`
            mimeType = 'application/json'
        }
        
        // 创建 Blob 并下载
        const blob = new Blob([content], { type: mimeType })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        
        console.log(`✅ Document exported as ${filename}`)
    })
}

async function init() {
    setupEventListeners()
    
    updateConnectionStatus('connecting')
    
    // 检查URL中是否有文档参数
    const urlParams = new URLSearchParams(window.location.search)
    const docParam = urlParams.get('doc')
    
    if (docParam) {
        // 如果URL中有文档参数，先检查文档是否存在
        const exists = await checkDocumentExists(docParam)
        if (!exists) {
            alert(`文档 "${docParam}" 不存在`)
            // 清除URL中的参数
            window.history.replaceState({}, document.title, window.location.pathname)
        } else {
            // 文档存在，自动加入
            await initEditor(docParam)
            // 清除URL中的参数，避免刷新时重复加入
            window.history.replaceState({}, document.title, window.location.pathname)
        }
    } else {
        // 否则使用默认文档
        await initEditor(currentDocumentName)
    }
    
    // 定期刷新文档列表（每 10 秒）
    setInterval(async () => {
        const serverDocs = await loadDocumentList()
        renderRecentDocuments(serverDocs)
    }, 10000)
    
    // 首次加载文档列表
    const serverDocs = await loadDocumentList()
    renderRecentDocuments(serverDocs)
}

init()
