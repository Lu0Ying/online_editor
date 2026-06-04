import { Editor, Mark } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Heading from '@tiptap/extension-heading'
import Blockquote from '@tiptap/extension-blockquote'
import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import ListItem from '@tiptap/extension-list-item'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import { common, createLowlight } from 'lowlight'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { mouseShadow, createParticleBackground, generateRandomColor, updateConnectionStatus, createUserInfoPanel, createConnectionStatusPanel, setConnectionStatusElement, updateOnlineUsersList } from './beautify.js'
import { initChatModule, setupChat, setupChatSync, resetChatMessages, updateUserInfo } from './chat.js'
import { CollaborativeImage, CollaborativeVideo } from './media/media-extension.js'
import { ChunkedUploader } from './media/chunked-uploader.js'
import { exportDocumentWithMedia } from './media/export-utils.js'
import MarkdownIt from 'markdown-it'
import { initVersionManagerUI, showVersionPanel, versionManager } from './version-manager.js'

const md = new MarkdownIt({
    html: true,
    breaks: true,
    linkify: true,
    typographer: true,
})

const lowlight = createLowlight(common)

// 创建无输入规则的扩展，编辑区保持原始 Markdown 语法（预览时才渲染）
const HeadingRaw = Heading.extend({ addInputRules() { return [] } })
const BlockquoteRaw = Blockquote.extend({ addInputRules() { return [] } })
const BulletListRaw = BulletList.extend({ addInputRules() { return [] } })
const OrderedListRaw = OrderedList.extend({ addInputRules() { return [] } })
const HorizontalRuleRaw = HorizontalRule.extend({ addInputRules() { return [] } })

// 从编辑器文档提取 Markdown 文本（处理所有节点类型）
function getEditorMarkdown(editor) {
    const doc = editor.state.doc
    const lines = []

    doc.content.forEach((node) => {
        const type = node.type.name

        if (type === 'paragraph') {
            lines.push(node.textContent)
        } else if (type === 'heading') {
            const level = node.attrs.level || 1
            lines.push('#'.repeat(level) + ' ' + node.textContent)
        } else if (type === 'bulletList') {
            node.content.forEach((item) => {
                lines.push('- ' + item.textContent)
            })
        } else if (type === 'orderedList') {
            node.content.forEach((item, i) => {
                lines.push((i + 1) + '. ' + item.textContent)
            })
        } else if (type === 'blockquote') {
            node.content.forEach((child) => {
                if (child.type.name === 'paragraph') {
                    lines.push('> ' + child.textContent)
                }
            })
        } else if (type === 'codeBlock') {
            const lang = node.attrs.language || ''
            lines.push('```' + lang)
            lines.push(node.textContent)
            lines.push('```')
        } else if (type === 'horizontalRule') {
            lines.push('---')
        } else if (type === 'table') {
            const rows = []
            node.content.forEach((row) => {
                const cells = []
                row.content.forEach((cell) => {
                    cells.push(cell.textContent.trim())
                })
                rows.push('| ' + cells.join(' | ') + ' |')
            })
            if (rows.length > 0) {
                lines.push(rows[0])
                const colCount = rows[0].split('|').length - 2
                const sep = '|' + Array(colCount).fill('------').join('|') + '|'
                lines.push(sep)
                for (let i = 1; i < rows.length; i++) {
                    lines.push(rows[i])
                }
            }
        } else if (type === 'collaborativeImage') {
            const src = node.attrs.src || ''
            const alt = node.attrs.alt || ''
            const fingerprint = node.attrs.fingerprint || ''
            lines.push(`<img src="${src}" alt="${alt}" data-collaborative-image="${fingerprint}" loading="lazy">`)
        } else if (type === 'collaborativeVideo') {
            const src = node.attrs.src || ''
            const fingerprint = node.attrs.fingerprint || ''
            lines.push(`<div data-collaborative-video="${fingerprint}"><video src="${src}" controls preload="metadata"></video></div>`)
        }
    })

    return lines.join('\n')
}

// 从 localStorage 获取保存的用户名，如果没有则生成随机用户名
const savedUserName = localStorage.getItem('onlineEditorUserName')
const userId = savedUserName || `user-${Math.floor(Math.random() * 100000)}`
const userColor = generateRandomColor()
let userName = userId  // 使用 let 以便后续可以修改

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
// 文件服务器通过 Vite 代理，使用相对路径即可跨设备访问
export const fileServerUrl = ''

let editor = null
let provider = null
let ydoc = null
let currentDocumentName = 'test_document'  // 默认文档名称
let currentDocType = 'markdown'  // 当前文档类型: 'markdown' | 'normal'
let saveTimeout = null  // 用于前端防抖保存提示
let isEditorCreated = false  // 防止重复创建编辑器
let isComposing = false  // 标记是否正在输入法组合输入（如拼音）
let compositionStartPos = null  // 记录组合输入开始时的光标位置，用于追溯高亮
let previousUsers = new Set()  // 跟踪之前的用户列表，用于检测加入/退出
let autoSaveNotificationTimeout = null  // 用于防抖自动保存通知
let hasShownConnectedMessage = false  // 标记是否已显示连接成功消息

async function initEditor(documentName, docType = 'markdown') {
    console.log('=== Initializing editor for document:', documentName, 'type:', docType, '===')
    
    // 保存文档类型
    currentDocType = docType
    
    // 更新预览按钮可见性
    const previewBtn = document.getElementById('markdown-preview-btn')
    if (previewBtn) {
        previewBtn.style.display = docType === 'markdown' ? '' : 'none'
    }
    
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
        window.ydoc = null  // 清除全局引用
    }
    
    // 重置聊天消息
    resetChatMessages()
    
    currentDocumentName = documentName
    window.currentDocumentName = documentName  // 暴露给版本管理模块
    
    updateConnectionStatus('connecting')
    
    ydoc = new Y.Doc()
    window.ydoc = ydoc  // 暴露给版本管理模块
    
    // 存储/读取文档类型到 Yjs 元数据（同步到其他用户）
    const metadata = ydoc.getMap('_metadata')
    // 仅在元数据中没有 docType 时设置（新文档），已有则从服务器同步中获取
    if (!metadata.has('docType')) {
        metadata.set('docType', docType)
    } else {
        // 从同步的元数据中读取文档类型
        const syncedType = metadata.get('docType')
        if (syncedType && syncedType !== docType) {
            docType = syncedType
            currentDocType = syncedType
            // 更新预览按钮可见性
            const previewBtn = document.getElementById('markdown-preview-btn')
            if (previewBtn) {
                previewBtn.style.display = docType === 'markdown' ? '' : 'none'
            }
        }
    }
    
    // 监听元数据变化（其他用户修改文档类型时同步）
    metadata.observe(() => {
        const syncedType = metadata.get('docType')
        if (syncedType && syncedType !== currentDocType) {
            currentDocType = syncedType
            const previewBtn = document.getElementById('markdown-preview-btn')
            if (previewBtn) {
                previewBtn.style.display = syncedType === 'markdown' ? '' : 'none'
            }
        }
    })
    
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
                // 兜底：如果 3 秒内 onSynced 未触发，直接创建编辑器
                setTimeout(() => {
                    if (!isEditorCreated) {
                        console.log('>>> Creating editor (fallback), docType:', docType)
                        isEditorCreated = true
                        createEditor(docType)
                    }
                }, 3000)
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
            
            // 同步完成后检查元数据中的文档类型
            const metadata = ydoc.getMap('_metadata')
            const syncedType = metadata.get('docType')
            if (syncedType && syncedType !== currentDocType) {
                currentDocType = syncedType
                docType = syncedType
                const previewBtn = document.getElementById('markdown-preview-btn')
                if (previewBtn) {
                    previewBtn.style.display = syncedType === 'markdown' ? '' : 'none'
                }
            }
            
            // 首次同步后创建编辑器（确保元数据已同步）
            if (!isEditorCreated) {
                console.log('>>> Creating editor (after sync), docType:', docType)
                isEditorCreated = true
                setTimeout(() => createEditor(docType), 100)
            }
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
    
    // 关闭文档管理面板
    const docManagerPanel = document.getElementById('doc-manager-panel')
    const docManagerBtn = document.getElementById('topbar-doc-manager-btn')
    if (docManagerPanel) {
        docManagerPanel.classList.remove('open')
    }
    if (docManagerBtn) {
        docManagerBtn.classList.remove('active')
    }
}

function createEditor(docType = 'markdown') {
    const isMarkdown = docType === 'markdown'
    console.log('Creating Tiptap editor... (docType:', docType, ')')
    
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
    
    // 初始化聊天模块
    initChatModule(ydoc, provider, userId, userName)
    
    // 初始化聊天消息同步
    setupChatSync()
    
    try {
        editor = new Editor({
            element: document.querySelector('#editor'),
            extensions: [
                StarterKit.configure({
                    history: false,
                    codeBlock: false,
                    // Markdown 文档禁用自动转换，普通文档启用
                    heading: isMarkdown ? false : {},
                    blockquote: isMarkdown ? false : {},
                    bulletList: isMarkdown ? false : {},
                    orderedList: isMarkdown ? false : {},
                    horizontalRule: isMarkdown ? false : {},
                }),
                // Markdown 文档用无输入规则版本（保留节点但不自动转换）
                ...(isMarkdown ? [HeadingRaw, BlockquoteRaw, BulletListRaw, OrderedListRaw, ListItem, HorizontalRuleRaw] : []),
                UserHighlight,
                CollaborativeImage,
                CollaborativeVideo,
                Table.configure({
                    resizable: true,
                }),
                TableRow,
                TableCell,
                TableHeader,
                CodeBlockLowlight.extend({
                    ...(isMarkdown ? { addInputRules() { return [] } } : {}),
                    renderHTML({ node, HTMLAttributes }) {
                        const lang = node.attrs.language || 'text'
                        return [
                            'pre',
                            { ...HTMLAttributes, 'data-language': lang },
                            ['code', {}, 0],
                        ]
                    },
                }).configure({
                    lowlight,
                }),
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
                            // 组合输入期间跳过 setUserHighlight，
                            // 避免操作编辑器状态干扰浏览器 IME 导致字符重复
                            if (!isComposing) {
                                editor.commands.setUserHighlight({
                                    userId,
                                    userName,
                                    color: userColor
                                })
                            }
                        }

                        return false
                    },
                    compositionstart: () => {
                        isComposing = true
                        compositionStartPos = editor ? editor.state.selection.from : null
                        return true
                    },
                    compositionend: () => {
                        isComposing = false

                        if (editor && !editor.isDestroyed && compositionStartPos !== null) {
                            const startPos = compositionStartPos
                            compositionStartPos = null
                            // 延迟执行：确保 IME 完全释放后再设置高亮，
                            // 避免在 composition 生命周期内操作编辑器状态
                            setTimeout(() => {
                                if (editor && !editor.isDestroyed) {
                                    const endPos = editor.state.selection.from
                                    if (endPos > startPos) {
                                        editor.chain()
                                            .setTextSelection({ from: startPos, to: endPos })
                                            .setUserHighlight({
                                                userId,
                                                userName,
                                                color: userColor
                                            })
                                            .setTextSelection(endPos)
                                            .run()
                                    }
                                }
                            }, 0)
                        }

                        return true
                    }
                },
                attributes: {
                    class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl focus:outline-none'
                }
            }
        })
        
        window.editor = editor  // 暴露给版本管理模块
        
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
updateUserInfoPanel(userName)

// 调用粒子背景效果和鼠标阴影
createParticleBackground()
mouseShadow()



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
                window.ydoc = null  // 清除全局引用
            }
            currentDocumentName = 'test_document'
            window.currentDocumentName = 'test_document'  // 更新全局引用
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

function setupVersionManager() {
    initVersionManagerUI()
    
    document.getElementById('version-btn').addEventListener('click', () => {
        showVersionPanel()
    })
}

function setupEventListeners() {
    // 顶部导航栏文档管理面板切换
    const docManagerBtn = document.getElementById('topbar-doc-manager-btn')
    const docManagerPanel = document.getElementById('doc-manager-panel')
    
    if (docManagerBtn && docManagerPanel) {
        docManagerBtn.addEventListener('click', () => {
            docManagerPanel.classList.toggle('open')
            docManagerBtn.classList.toggle('active')
        })
        
        // 点击面板外部关闭
        document.addEventListener('click', (e) => {
            if (docManagerPanel.classList.contains('open') && 
                !docManagerPanel.contains(e.target) && 
                !docManagerBtn.contains(e.target)) {
                docManagerPanel.classList.remove('open')
                docManagerBtn.classList.remove('active')
            }
        })
    }

    document.getElementById('create-doc').addEventListener('click', async () => {
        const docName = document.getElementById('document-name').value.trim()
        if (docName) {
            // 显示文档类型选择弹窗
            window._pendingDocName = docName
            document.getElementById('doctype-modal').style.display = 'flex'
        } else {
            alert('请输入文档名称')
        }
    })
    
    // 文档类型选择：Markdown
    document.getElementById('doctype-markdown')?.addEventListener('click', async () => {
        document.getElementById('doctype-modal').style.display = 'none'
        const docName = window._pendingDocName
        if (docName) {
            await initEditor(docName, 'markdown')
            document.getElementById('document-name').value = ''
            window._pendingDocName = null
        }
    })
    
    // 文档类型选择：普通
    document.getElementById('doctype-normal')?.addEventListener('click', async () => {
        document.getElementById('doctype-modal').style.display = 'none'
        const docName = window._pendingDocName
        if (docName) {
            await initEditor(docName, 'normal')
            document.getElementById('document-name').value = ''
            window._pendingDocName = null
        }
    })
    
    // 取消文档类型选择
    document.getElementById('cancel-doctype')?.addEventListener('click', () => {
        document.getElementById('doctype-modal').style.display = 'none'
        window._pendingDocName = null
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
    document.getElementById('export-btn').addEventListener('click', async () => {
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
        } else if (exportFormat === 'zip') {
            // 导出为包含媒体的压缩包
            try {
                showSystemNotification('导出中', '正在打包文档和媒体文件...', 'info', 3000)
                const result = await exportDocumentWithMedia(
                    editor.getHTML(),
                    currentDocumentName,
                    fileServerUrl
                )
                
                const url = URL.createObjectURL(result.blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `${currentDocumentName}.zip`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
                
                showSystemNotification(
                    '导出完成',
                    `已导出 ${result.mediaCount} 个媒体文件` + 
                    (result.failedCount > 0 ? `，${result.failedCount} 个失败` : ''),
                    'document-save',
                    3000
                )
                console.log(`✅ Document exported as ${currentDocumentName}.zip`)
                return
            } catch (err) {
                console.error('导出失败:', err)
                alert('导出压缩包失败: ' + err.message)
                return
            }
        }
        
        // 创建 Blob 并下载（非 zip 格式）
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
    
    // 聊天室功能
    setupChat()
    
    // 重命名功能
    setupRename()
}

function setupRename() {
    const renameBtn = document.getElementById('rename-btn')
    const renameModal = document.getElementById('rename-modal')
    const confirmBtn = document.getElementById('confirm-rename')
    const cancelBtn = document.getElementById('cancel-rename')
    const newUsernameInput = document.getElementById('new-username')
    
    renameBtn.addEventListener('click', () => {
        newUsernameInput.value = userName
        renameModal.style.display = 'flex'
    })
    
    cancelBtn.addEventListener('click', () => {
        renameModal.style.display = 'none'
    })
    
    confirmBtn.addEventListener('click', () => {
        const newName = newUsernameInput.value.trim()
        if (!newName) {
            alert('请输入昵称')
            return
        }
        
        // 更新本地用户名
        userName = newName
        
        // 保存到 localStorage
        localStorage.setItem('onlineEditorUserName', newName)
        
        // 更新 chat.js 模块中的用户名
        updateUserInfo(userId, userName)
        
        // 更新 awareness 中的用户信息
        if (provider && provider.awareness) {
            provider.awareness.setLocalStateField('user', {
                name: userName,
                color: userColor
            })
        }
        
        // 更新用户信息面板显示
        updateUserInfoPanel(userName)
        
        renameModal.style.display = 'none'
        
        showSystemNotification('昵称已更新', `你的昵称已改为: ${userName}`, 'info', 2500)
    })
    
    // 点击遮罩关闭弹窗
    renameModal.addEventListener('click', (e) => {
        if (e.target === renameModal) {
            renameModal.style.display = 'none'
        }
    })
}

function updateUserInfoPanel(newName) {
    // 更新当前用户名称显示
    const currentUserNameEl = document.getElementById('current-user-name')
    if (currentUserNameEl) {
        currentUserNameEl.textContent = newName
    }
}

// ========== 媒体上传功能 ==========

function showUploadProgress(filename, progress) {
    const percent = Math.round((progress.completed / progress.total) * 100)
    showSystemNotification(
        '文件上传中',
        `${filename}: ${percent}% (${progress.completed}/${progress.total} 分块)`,
        'info',
        2000
    )
}

async function handleMediaUpload(file, type) {
    if (!editor) {
        alert('请先打开一个文档')
        return
    }

    // 文件类型校验
    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp']
    const videoTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']

    if (type === 'image' && !imageTypes.includes(file.type)) {
        alert('请选择图片文件（支持 JPG、PNG、GIF、WebP、SVG、BMP）')
        return
    }
    if (type === 'video' && !videoTypes.includes(file.type)) {
        alert('请选择视频文件（支持 MP4、WebM、OGG、MOV）')
        return
    }

    // 视频大小限制 500MB
    if (type === 'video' && file.size > 500 * 1024 * 1024) {
        alert('视频文件不能超过 500MB')
        return
    }

    showSystemNotification('文件上传', `正在上传 ${file.name}...`, 'info', 2000)

    try {
        const uploader = new ChunkedUploader(file, {
            fileServerUrl,
            onProgress: (progress) => {
                showUploadProgress(file.name, progress)
            },
            onComplete: (result) => {
                // 上传完成，插入到编辑器
                if (type === 'image') {
                    editor.commands.insertCollaborativeImage({
                        src: result.url,
                        fingerprint: result.fingerprint,
                        alt: file.name,
                        title: file.name,
                    })
                } else if (type === 'video') {
                    editor.commands.insertCollaborativeVideo({
                        src: result.url,
                        fingerprint: result.fingerprint,
                        title: file.name,
                    })
                }

                showSystemNotification(
                    '上传完成',
                    `${file.name} 已插入文档，协作者可同步查看`,
                    'document-save',
                    3000
                )
            },
            onError: (err) => {
                console.error('上传失败:', err)
                showSystemNotification(
                    '上传失败',
                    `${file.name}: ${err.message}`,
                    'warning',
                    4000
                )
            }
        })

        await uploader.init()
        await uploader.upload()
    } catch (err) {
        console.error('上传异常:', err)
        showSystemNotification(
            '上传失败',
            `${file.name}: ${err.message}`,
            'warning',
            4000
        )
    }
}

function setupMediaUpload() {
    // 图片上传按钮
    const insertImageBtn = document.getElementById('insert-image-btn')
    const imageFileInput = document.getElementById('image-file-input')

    if (insertImageBtn && imageFileInput) {
        insertImageBtn.addEventListener('click', () => {
            imageFileInput.accept = 'image/*'
            imageFileInput.click()
        })

        imageFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0]
            if (file) {
                handleMediaUpload(file, 'image')
                imageFileInput.value = ''
            }
        })
    }

    // 视频上传按钮
    const insertVideoBtn = document.getElementById('insert-video-btn')
    const videoFileInput = document.getElementById('video-file-input')

    if (insertVideoBtn && videoFileInput) {
        insertVideoBtn.addEventListener('click', () => {
            videoFileInput.accept = 'video/*'
            videoFileInput.click()
        })

        videoFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0]
            if (file) {
                handleMediaUpload(file, 'video')
                videoFileInput.value = ''
            }
        })
    }

    // 拖拽上传支持
    const editorElement = document.querySelector('#editor')
    if (editorElement) {
        editorElement.addEventListener('dragover', (e) => {
            e.preventDefault()
            e.stopPropagation()
        })

        editorElement.addEventListener('drop', (e) => {
            e.preventDefault()
            e.stopPropagation()

            const files = e.dataTransfer.files
            if (files.length === 0) return

            for (const file of files) {
                if (file.type.startsWith('image/')) {
                    handleMediaUpload(file, 'image')
                } else if (file.type.startsWith('video/')) {
                    handleMediaUpload(file, 'video')
                }
            }
        })
    }

    // 粘贴图片支持
    document.addEventListener('paste', (e) => {
        if (!editor) return
        
        // 检查焦点是否在编辑器内
        const editorDom = document.querySelector('#editor .ProseMirror')
        if (!editorDom || !editorDom.contains(document.activeElement)) return

        const items = e.clipboardData?.items
        if (!items) return

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault()
                const file = item.getAsFile()
                if (file) {
                    handleMediaUpload(file, 'image')
                }
                break
            }
        }
    })
}

// ========== Markdown 工具栏 ==========

function setupMarkdownToolbar() {
    let previewMode = false

    // 根据文档类型显示/隐藏预览按钮
    const previewBtn = document.getElementById('markdown-preview-btn')
    if (previewBtn) {
        previewBtn.style.display = currentDocType === 'markdown' ? '' : 'none'
    }

    // 创建预览面板
    const previewPanel = document.createElement('div')
    previewPanel.id = 'markdown-preview-panel'
    previewPanel.className = 'markdown-preview-panel'
    previewPanel.style.display = 'none'
    const editorBox = document.getElementById('editor')
    editorBox?.parentNode?.insertBefore(previewPanel, editorBox.nextSibling)

    // 媒体工具栏
    const mediaToolbar = document.getElementById('media-toolbar')

    document.getElementById('markdown-preview-btn')?.addEventListener('click', () => {
        if (!editor) return
        previewMode = !previewMode
        const btn = document.getElementById('markdown-preview-btn')

        if (previewMode) {
            // 提取编辑器原始 Markdown 文本，用 markdown-it 渲染为 HTML
            const markdown = getEditorMarkdown(editor)
            previewPanel.innerHTML = md.render(markdown)
            editorBox.style.display = 'none'
            previewPanel.style.display = 'block'
            if (mediaToolbar) mediaToolbar.style.display = 'none'
            btn.textContent = '✏️ 编辑'
            btn.classList.add('active')
            btn.title = '编辑模式'
        } else {
            // 退出预览：将编辑器富文本转为 Markdown 源文本，显示源码
            const markdown = getEditorMarkdown(editor)
            const html = markdown
                .split('\n')
                .map(line => {
                    // 图片/视频的原始 HTML 不转义，TipTap parseHTML 会还原为协作节点
                    if (/^<(img|div)\s/.test(line) && (line.includes('data-collaborative-image') || line.includes('data-collaborative-video'))) {
                        return line
                    }
                    const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    return line ? `<p>${escaped}</p>` : '<p><br></p>'
                })
                .join('')
            editor.commands.setContent(html)
            previewPanel.style.display = 'none'
            editorBox.style.display = ''
            if (mediaToolbar) mediaToolbar.style.display = ''
            editor.setEditable(true)
            btn.textContent = '👁️ 预览'
            btn.classList.remove('active')
            btn.title = '预览模式'
        }
    })
}

async function init() {
    setupEventListeners()
    setupMediaUpload()
    setupMarkdownToolbar()
    setupVersionManager()
    
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
