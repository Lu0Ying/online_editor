// 聊天室模块

// 全局变量引用（从 main.js 导入）
let ydoc = null
let provider = null
let userId = null
let userName = null
let chatMessagesArray = []

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
    // 聊天室折叠/展开功能
    const chatPanel = document.getElementById('chat-panel')
    const chatToggle = document.getElementById('chat-toggle')
    
    // 点击 toggle 按钮始终切换状态
    chatToggle.addEventListener('click', (e) => {
        e.stopPropagation() // 阻止事件冒泡
        chatPanel.classList.toggle('collapsed')
    })
    
    // 点击面板：收起状态时展开，打开状态时不处理（避免误触）
    chatPanel.addEventListener('click', () => {
        if (chatPanel.classList.contains('collapsed')) {
            chatPanel.classList.remove('collapsed')
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
