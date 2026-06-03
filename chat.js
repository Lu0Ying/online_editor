// 聊天室模块

// 全局变量引用（从 main.js 导入）
let ydoc = null
let provider = null
let userId = null
let userName = null
let chatMessagesArray = []

// 拖动相关变量
let isDragging = false
let dragStartX = 0
let dragStartY = 0
let panelStartX = 0
let panelStartY = 0

// 调整大小相关变量
let isResizing = false
let resizeStartX = 0
let resizeStartY = 0
let panelStartWidth = 0
let panelStartHeight = 0
let resizeEdge = '' // 调整的边缘：'left', 'right', 'top', 'bottom', 'corner'

// 吸附阈值（距离边缘多少像素时触发吸附）
const SNAP_THRESHOLD = 30
// 收起时的宽度
const COLLAPSED_WIDTH = 48
// 展开时的宽度
const EXPANDED_WIDTH = 320
// 展开时的高度
const EXPANDED_HEIGHT = 500

// 最小/最大尺寸
const MIN_WIDTH = 200
const MAX_WIDTH = 500
const MIN_HEIGHT = 300
const MAX_HEIGHT = 700

// 当前状态
let isSnapped = true // 是否吸附在边缘
let snapEdge = 'right' // 吸附的边缘：'left', 'right'
let isCollapsed = false // 是否收起

// 当前尺寸
let currentWidth = EXPANDED_WIDTH
let currentHeight = EXPANDED_HEIGHT

// 初始化聊天室模块
export function initChatModule(ydocRef, providerRef, userIdRef, userNameRef) {
    ydoc = ydocRef
    provider = providerRef
    userId = userIdRef
    userName = userNameRef
}

// 更新用户信息
export function updateUserInfo(newUserId, newUserName) {
    userId = newUserId
    userName = newUserName
}

// 设置聊天消息同步
export function setupChatSync() {
    if (!ydoc) {
        console.log('ydoc not ready, cannot setup chat sync')
        return
    }
    
    console.log('Setting up chat sync...')
    const chatArray = ydoc.getArray('chatMessages')
    
    // 监听聊天消息变化
    chatArray.observe((event) => {
        console.log('Chat array changed:', event)
        const changes = event.changes
        if (changes && changes.added) {
            changes.added.forEach((item) => {
                const content = item.content
                if (content && content.getContent) {
                    const messages = content.getContent()
                    messages.forEach((message) => {
                        if (message) {
                            addChatMessage(message)
                        }
                    })
                }
            })
        }
    })
    
    // 加载已有消息
    const existingMessages = chatArray.toArray()
    console.log('Existing messages:', existingMessages.length)
    existingMessages.forEach(addChatMessage)
}

// 设置聊天室 UI 事件监听
export function setupChat() {
    const chatPanel = document.getElementById('chat-panel')
    const chatHeader = chatPanel.querySelector('.chat-header')
    const chatToggle = document.getElementById('chat-toggle')
    
    // 初始化位置（右侧吸附）
    initPanelPosition(chatPanel)
    
    // 拖动功能 - 在 header 上拖动
    chatHeader.addEventListener('mousedown', startDrag)
    document.addEventListener('mousemove', drag)
    document.addEventListener('mouseup', endDrag)
    
    // 触摸支持
    chatHeader.addEventListener('touchstart', startDragTouch, { passive: false })
    document.addEventListener('touchmove', dragTouch, { passive: false })
    document.addEventListener('touchend', endDrag)
    
    // 调整大小功能 - 通过边框拖动
    chatPanel.addEventListener('mousedown', handlePanelMouseDown)
    chatPanel.addEventListener('mousemove', updateCursor)
    
    // 全局事件监听
    document.addEventListener('mousemove', resize)
    document.addEventListener('mouseup', endResize)
    
    // 点击 toggle 按钮
    chatToggle.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleCollapse(chatPanel)
    })
    
    // 点击面板：收起状态时展开
    chatPanel.addEventListener('click', () => {
        if (isCollapsed) {
            toggleCollapse(chatPanel)
        }
    })
    
    // 发送消息
    const sendBtn = document.getElementById('send-chat-btn')
    const chatInput = document.getElementById('chat-input')
    
    sendBtn.addEventListener('click', sendChatMessage)
    
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendChatMessage()
        }
    })
}

// 初始化面板位置
function initPanelPosition(panel) {
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight
    
    // 默认右侧中间吸附
    panel.style.right = '0px'
    panel.style.left = 'auto'
    panel.style.top = `${(windowHeight - EXPANDED_HEIGHT) / 2}px`
    panel.style.transform = 'none'
    
    isSnapped = true
    snapEdge = 'right'
    isCollapsed = false
    
    updatePanelState(panel)
}

// 开始拖动
function startDrag(e) {
    // 如果点击的是 toggle 按钮，不触发拖动
    if (e.target.id === 'chat-toggle' || e.target.closest('#chat-toggle')) {
        return
    }
    
    const chatPanel = document.getElementById('chat-panel')
    
    isDragging = true
    dragStartX = e.clientX
    dragStartY = e.clientY
    
    // 获取面板当前位置
    const rect = chatPanel.getBoundingClientRect()
    panelStartX = rect.left
    panelStartY = rect.top
    
    // 移除吸附状态
    chatPanel.classList.add('dragging')
    
    e.preventDefault()
}

// 触摸开始拖动
function startDragTouch(e) {
    if (e.target.id === 'chat-toggle' || e.target.closest('#chat-toggle')) {
        return
    }
    
    const touch = e.touches[0]
    const chatPanel = document.getElementById('chat-panel')
    
    isDragging = true
    dragStartX = touch.clientX
    dragStartY = touch.clientY
    
    const rect = chatPanel.getBoundingClientRect()
    panelStartX = rect.left
    panelStartY = rect.top
    
    chatPanel.classList.add('dragging')
    
    e.preventDefault()
}

// 拖动中
function drag(e) {
    if (!isDragging) return
    
    const chatPanel = document.getElementById('chat-panel')
    const deltaX = e.clientX - dragStartX
    const deltaY = e.clientY - dragStartY
    
    let newX = panelStartX + deltaX
    let newY = panelStartY + deltaY
    
    // 限制在窗口内
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight
    const panelWidth = isCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH
    
    newX = Math.max(0, Math.min(newX, windowWidth - panelWidth))
    newY = Math.max(0, Math.min(newY, windowHeight - EXPANDED_HEIGHT))
    
    // 设置位置（使用 left 而不是 right）
    chatPanel.style.left = `${newX}px`
    chatPanel.style.right = 'auto'
    chatPanel.style.top = `${newY}px`
    chatPanel.style.transform = 'none'
}

// 触摸拖动中
function dragTouch(e) {
    if (!isDragging) return
    
    const touch = e.touches[0]
    const chatPanel = document.getElementById('chat-panel')
    const deltaX = touch.clientX - dragStartX
    const deltaY = touch.clientY - dragStartY
    
    let newX = panelStartX + deltaX
    let newY = panelStartY + deltaY
    
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight
    const panelWidth = isCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH
    
    newX = Math.max(0, Math.min(newX, windowWidth - panelWidth))
    newY = Math.max(0, Math.min(newY, windowHeight - EXPANDED_HEIGHT))
    
    chatPanel.style.left = `${newX}px`
    chatPanel.style.right = 'auto'
    chatPanel.style.top = `${newY}px`
    chatPanel.style.transform = 'none'
    
    e.preventDefault()
}

// 结束拖动
function endDrag(e) {
    if (!isDragging) return
    
    isDragging = false
    const chatPanel = document.getElementById('chat-panel')
    
    // 检查是否需要吸附
    checkAndSnap(chatPanel)
    
    chatPanel.classList.remove('dragging')
}

// 检查并执行吸附
function checkAndSnap(panel) {
    const rect = panel.getBoundingClientRect()
    const windowWidth = window.innerWidth
    
    const panelWidth = isCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH
    
    // 检查是否靠近左边缘
    if (rect.left < SNAP_THRESHOLD) {
        snapToEdge(panel, 'left')
    }
    // 检查是否靠近右边缘
    else if (rect.left + panelWidth > windowWidth - SNAP_THRESHOLD) {
        snapToEdge(panel, 'right')
    }
    // 不靠近任何边缘
    else {
        isSnapped = false
        snapEdge = null
    }
    
    updatePanelState(panel)
}

// 吸附到边缘
function snapToEdge(panel, edge) {
    isSnapped = true
    snapEdge = edge
    
    if (edge === 'left') {
        panel.style.left = '0px'
        panel.style.right = 'auto'
    } else if (edge === 'right') {
        panel.style.left = 'auto'
        panel.style.right = '0px'
    }
}

// 切换收起/展开
function toggleCollapse(panel) {
    // 如果不吸附在边缘，不允许收起
    if (!isSnapped && !isCollapsed) {
        return
    }
    
    isCollapsed = !isCollapsed
    updatePanelState(panel)
}

// 更新面板状态
function updatePanelState(panel) {
    if (isCollapsed) {
        panel.classList.add('collapsed')
        panel.style.width = `${COLLAPSED_WIDTH}px`
        panel.style.height = `${currentHeight}px`
    } else {
        panel.classList.remove('collapsed')
        panel.style.width = `${currentWidth}px`
        panel.style.height = `${currentHeight}px`
    }
    
    if (isSnapped) {
        panel.classList.add('snapped')
        panel.classList.remove('floating')
    } else {
        panel.classList.remove('snapped')
        panel.classList.add('floating')
    }
    
    // 更新边缘方向
    panel.classList.remove('snap-left', 'snap-right')
    if (snapEdge === 'left') {
        panel.classList.add('snap-left')
    } else if (snapEdge === 'right') {
        panel.classList.add('snap-right')
    }
}

// 边框宽度（可拖动区域）
const RESIZE_BORDER = 8

// 处理面板鼠标按下事件
function handlePanelMouseDown(e) {
    if (isCollapsed) return
    
    const chatPanel = document.getElementById('chat-panel')
    const rect = chatPanel.getBoundingClientRect()
    
    // 计算鼠标相对于面板的位置
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    
    // 判断是否在可拖动区域
    const isLeft = x < RESIZE_BORDER
    const isRight = x > rect.width - RESIZE_BORDER
    const isTop = y < RESIZE_BORDER
    const isBottom = y > rect.height - RESIZE_BORDER
    
    // 确定调整方向
    if (isRight && isBottom) {
        resizeEdge = 'corner'
        startResize(e)
    } else if (isRight) {
        resizeEdge = 'right'
        startResize(e)
    } else if (isBottom) {
        resizeEdge = 'bottom'
        startResize(e)
    } else if (isLeft) {
        resizeEdge = 'left'
        startResize(e)
    } else if (isTop) {
        resizeEdge = 'top'
        startResize(e)
    }
}

// 开始调整大小
function startResize(e) {
    isResizing = true
    resizeStartX = e.clientX
    resizeStartY = e.clientY
    
    const chatPanel = document.getElementById('chat-panel')
    const rect = chatPanel.getBoundingClientRect()
    panelStartX = rect.left
    panelStartY = rect.top
    panelStartWidth = rect.width
    panelStartHeight = rect.height
    
    chatPanel.classList.add('resizing')
    
    // 设置光标样式
    if (resizeEdge === 'corner') {
        document.body.style.cursor = 'se-resize'
    } else if (resizeEdge === 'right') {
        document.body.style.cursor = 'e-resize'
    } else if (resizeEdge === 'bottom') {
        document.body.style.cursor = 's-resize'
    } else if (resizeEdge === 'left') {
        document.body.style.cursor = 'w-resize'
    } else if (resizeEdge === 'top') {
        document.body.style.cursor = 'n-resize'
    }
    
    e.preventDefault()
}

// 调整大小中
function resize(e) {
    if (!isResizing) return
    
    const chatPanel = document.getElementById('chat-panel')
    const deltaX = e.clientX - resizeStartX
    const deltaY = e.clientY - resizeStartY
    
    let newWidth = panelStartWidth
    let newHeight = panelStartHeight
    let newLeft = panelStartX
    let newTop = panelStartY
    
    // 根据调整方向进行调整
    if (resizeEdge === 'corner') {
        newWidth = Math.max(MIN_WIDTH, Math.min(panelStartWidth + deltaX, MAX_WIDTH))
        newHeight = Math.max(MIN_HEIGHT, Math.min(panelStartHeight + deltaY, MAX_HEIGHT))
    } else if (resizeEdge === 'right') {
        newWidth = Math.max(MIN_WIDTH, Math.min(panelStartWidth + deltaX, MAX_WIDTH))
    } else if (resizeEdge === 'bottom') {
        newHeight = Math.max(MIN_HEIGHT, Math.min(panelStartHeight + deltaY, MAX_HEIGHT))
    } else if (resizeEdge === 'left') {
        const widthChange = -deltaX
        newWidth = Math.max(MIN_WIDTH, Math.min(panelStartWidth + widthChange, MAX_WIDTH))
        newLeft = panelStartX + deltaX
    } else if (resizeEdge === 'top') {
        const heightChange = -deltaY
        newHeight = Math.max(MIN_HEIGHT, Math.min(panelStartHeight + heightChange, MAX_HEIGHT))
        newTop = panelStartY + deltaY
    }
    
    // 更新当前尺寸
    currentWidth = newWidth
    currentHeight = newHeight
    
    chatPanel.style.width = `${newWidth}px`
    chatPanel.style.height = `${newHeight}px`
    
    if (resizeEdge === 'left') {
        chatPanel.style.left = `${newLeft}px`
    }
    if (resizeEdge === 'top') {
        chatPanel.style.top = `${newTop}px`
    }
}

// 结束调整大小
function endResize(e) {
    if (!isResizing) return
    
    isResizing = false
    const chatPanel = document.getElementById('chat-panel')
    chatPanel.classList.remove('resizing')
    document.body.style.cursor = 'default'
    resizeEdge = ''
}

// 更新光标样式（鼠标在面板上移动时）
function updateCursor(e) {
    if (isResizing || isDragging || isCollapsed) return
    
    const chatPanel = document.getElementById('chat-panel')
    const rect = chatPanel.getBoundingClientRect()
    
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    
    const isLeft = x < RESIZE_BORDER
    const isRight = x > rect.width - RESIZE_BORDER
    const isTop = y < RESIZE_BORDER
    const isBottom = y > rect.height - RESIZE_BORDER
    
    if (isRight && isBottom) {
        chatPanel.style.cursor = 'se-resize'
    } else if (isRight) {
        chatPanel.style.cursor = 'e-resize'
    } else if (isBottom) {
        chatPanel.style.cursor = 's-resize'
    } else if (isLeft) {
        chatPanel.style.cursor = 'w-resize'
    } else if (isTop) {
        chatPanel.style.cursor = 'n-resize'
    } else {
        chatPanel.style.cursor = 'default'
    }
}

// 发送聊天消息
export function sendChatMessage() {
    const chatInput = document.getElementById('chat-input')
    const message = chatInput.value.trim()
    
    if (!message || !provider || !ydoc) return
    
    const chatMessage = {
        id: Date.now().toString(),
        sender: userName,
        senderId: userId,
        content: message,
        timestamp: new Date().toISOString()
    }
    
    // 使用 Yjs 同步聊天消息
    const chatArray = ydoc.getArray('chatMessages')
    chatArray.push([chatMessage])
    
    chatInput.value = ''
}

// 添加聊天消息到显示
export function addChatMessage(message) {
    const chatMessagesContainer = document.getElementById('chat-messages')
    if (!chatMessagesContainer) return
    
    // 避免重复添加
    if (chatMessagesArray.includes(message.id)) return
    chatMessagesArray.push(message.id)
    
    const messageElement = document.createElement('div')
    messageElement.className = `chat-message ${message.senderId === userId ? 'own' : 'other'}`
    
    const timestamp = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
    })
    
    messageElement.innerHTML = `
        ${message.senderId !== userId ? `<div class="sender">${message.sender}</div>` : ''}
        <div class="message-content">${escapeHtml(message.content)}</div>
        <div style="font-size: 10px; opacity: 0.5; margin-top: 4px;">${timestamp}</div>
    `
    
    chatMessagesContainer.appendChild(messageElement)
    
    // 滚动到底部
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight
}

// HTML 转义
function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
}

// 重置聊天消息（切换文档时调用）
export function resetChatMessages() {
    chatMessagesArray = []
    const chatMessagesContainer = document.getElementById('chat-messages')
    if (chatMessagesContainer) {
        chatMessagesContainer.innerHTML = ''
    }
}
