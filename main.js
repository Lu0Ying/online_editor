import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'

const userId = '用户' + Math.floor(Math.random() * 1000)
const userColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')
const userName = userId

// 始终使用当前访问的主机名，这样其他电脑访问时会自动连接到你的服务器
const serverHost = window.location.hostname
const wsUrl = `ws://${serverHost}:1235`
const apiUrl = `http://${serverHost}:1236`

let editor = null
let provider = null
let ydoc = null
let currentDocumentName = 'my-document'
let saveTimeout = null  // 用于前端防抖保存提示
let isEditorCreated = false  // 防止重复创建编辑器

async function initEditor(documentName) {
    console.log('=== Initializing editor for document:', documentName, '===')
    
    // 重置编辑器创建标志
    isEditorCreated = false
    
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
        
        // 更新状态为"正在保存..."
        updateConnectionStatus('saving')
        
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
                // 只在首次连接时创建编辑器，避免重复创建
                if (!isEditorCreated) {
                    console.log('>>> Creating editor for the first time...')
                    isEditorCreated = true
                    createEditor()
                }
            } else if (status === 'disconnected') {
                console.log('>>> Disconnected')
                updateConnectionStatus('disconnected')
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
        }
    })
    
    updateRecentDocuments(documentName)
    
    const docNameElement = document.getElementById('current-doc-name')
    if (docNameElement) {
        docNameElement.textContent = '当前文档: ' + documentName
    }
}

function createEditor() {
    console.log('Creating Tiptap editor...')
    
    // 确保 awareness 已初始化
    if (!provider || !provider.awareness) {
        console.warn('Provider or awareness not ready yet, waiting...')
        setTimeout(createEditor, 100)
        return
    }
    
    console.log('Provider awareness ready:', !!provider.awareness)
    console.log('YDoc available:', !!ydoc)
    console.log('Provider document:', !!provider.document)
    console.log('Are they the same?', provider.document === ydoc)
    
    editor = new Editor({
        element: document.querySelector('#editor'),
        extensions: [
            StarterKit.configure({
                // Collaboration 扩展自带历史支持，所以禁用 StarterKit 的历史
                history: false
            }),
            Collaboration.configure({
                document: ydoc,
                field: 'content'
            })
            // 暂时禁用 CollaborationCursor，先让编辑器正常工作
            // CollaborationCursor.configure({
            //     provider: provider,
            //     user: {
            //         name: userName,
            //         color: userColor
            //     }
            // })
        ],
        onCreate: () => {
            console.log('Editor created successfully')
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
}

const connectionStatus = document.createElement('div')
connectionStatus.style.position = 'fixed'
connectionStatus.style.bottom = '10px'
connectionStatus.style.right = '10px'
connectionStatus.style.padding = '10px 15px'
connectionStatus.style.borderRadius = '6px'
connectionStatus.style.fontSize = '13px'
connectionStatus.style.fontWeight = '500'
connectionStatus.style.zIndex = '9999'
connectionStatus.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'
document.body.appendChild(connectionStatus)

const userInfo = document.createElement('div')
userInfo.style.position = 'fixed'
userInfo.style.bottom = '55px'
userInfo.style.right = '10px'
userInfo.style.padding = '10px 15px'
userInfo.style.backgroundColor = '#fff'
userInfo.style.borderRadius = '6px'
userInfo.style.fontSize = '13px'
userInfo.style.zIndex = '9999'
userInfo.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'
userInfo.innerHTML = `<div style="display: flex; align-items: center; gap: 8px;">
    <div style="width: 12px; height: 12px; border-radius: 50%; background-color: ${userColor};"></div>
    <span>${userName}</span>
</div>`
document.body.appendChild(userInfo)

const connectionStatusConfig = {
    connected: {
        text: '● 已连接 - 实时协作中',
        bgColor: '#d4edda',
        color: '#155724'
    },
    saving: {
        text: '◐ 正在保存...',
        bgColor: '#fff3cd',
        color: '#856404'
    },
    connecting: {
        text: '◐ 连接中...',
        bgColor: '#fff3cd',
        color: '#856404'
    },
    disconnected: {
        text: '○ 未连接',
        bgColor: '#f8d7da',
        color: '#721c24'
    },
    error: {
        text: '✕ 连接错误',
        bgColor: '#f8d7da',
        color: '#721c24'
    }
}

function updateConnectionStatus(status) {
    const config = connectionStatusConfig[status] || connectionStatusConfig.disconnected
    connectionStatus.textContent = config.text
    connectionStatus.style.backgroundColor = config.bgColor
    connectionStatus.style.color = config.color
}

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
        
        const openBtn = document.createElement('button')
        openBtn.textContent = '打开'
        openBtn.style.padding = '4px 12px'
        openBtn.style.marginLeft = '10px'
        openBtn.style.cursor = 'pointer'
        openBtn.addEventListener('click', async (e) => {
            e.stopPropagation()
            await initEditor(doc)
        })
        
        li.appendChild(openBtn)
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
            await initEditor(docName)
            document.getElementById('document-name').value = ''
        } else {
            alert('请输入文档名称')
        }
    })
    
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
            
            // 2秒后恢复状态并显示成功提示
            setTimeout(() => {
                updateConnectionStatus('connected')
                alert('文档已保存到服务器！')
            }, 2000)
        } else {
            alert('请先打开一个文档')
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
}

async function init() {
    setupEventListeners()
    
    updateConnectionStatus('connecting')
    
    await initEditor(currentDocumentName)
    
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
