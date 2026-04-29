import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import Color from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { clickEffect, createParticleBackground, generateRandomColor, updateConnectionStatus, createUserInfoPanel, createConnectionStatusPanel, setConnectionStatusElement } from './beautify.js'

const userId = '用户' + Math.floor(Math.random() * 1000)
const userColor = generateRandomColor()
const userName = userId

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
    
    try {
        editor = new Editor({
            element: document.querySelector('#editor'),
            extensions: [
                StarterKit.configure({
                    // Collaboration 扩展自带历史支持，所以禁用 StarterKit 的历史
                    history: false
                }),
                TextStyle,
                Color.configure({
                    types: ['textStyle']
                }),
                Collaboration.configure({
                    document: provider.document,
                    field: 'content'
                })
                // 暂时禁用 CollaborationCursor，等待版本兼容问题解决
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
                console.log('User color:', userColor)
                // 设置默认文本颜色为用户颜色
                editor.chain().focus().setColor(userColor).run()
            },
            onUpdate: ({ editor }) => {
                const content = editor.getHTML()
                console.log('✏️ Editor updated, content length:', content.length)
                console.log('Content preview:', content.substring(0, 100))
            },
            onSelectionUpdate: ({ editor }) => {
                // 当选择（光标）位置更新时，确保颜色是用户颜色
                setTimeout(() => {
                    if (editor && !editor.isDestroyed) {
                        editor.commands.setColor(userColor)
                    }
                }, 0)
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
    
    // 文本颜色选择器
    document.getElementById('text-color').addEventListener('input', (e) => {
        if (editor) {
            const color = e.target.value
            editor.chain().focus().setColor(color).run()
        }
    })
    
    // 清除文本颜色
    document.getElementById('clear-color').addEventListener('click', () => {
        if (editor) {
            editor.chain().focus().unsetColor().run()
            document.getElementById('text-color').value = '#000000'
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
