// 粒子连线背景效果
export function createParticleBackground() {
    function getAttribute(el, attr, defaultValue) {
        return el.getAttribute(attr) || defaultValue;
    }

    function getElementsByTagName(tag) {
        return document.getElementsByTagName(tag);
    }

    let canvasWidth, canvasHeight;
    let particles;
    const canvas = document.createElement("canvas");
    const config = {
        zIndex: -1,
        opacity: 1,
        color: "255, 255, 255",
        count: 99
    };
    const canvasId = "particle_bg";
    const ctx = canvas.getContext("2d");
    const requestAnimFrame = window.requestAnimationFrame || 
                           window.webkitRequestAnimationFrame || 
                           window.mozRequestAnimationFrame || 
                           window.oRequestAnimationFrame || 
                           window.msRequestAnimationFrame || 
                           function(callback) {
                               window.setTimeout(callback, 1000 / 45);
                           };
    const random = Math.random;
    const mouse = { x: null, y: null, max: 20000 };

    canvas.id = canvasId;
    canvas.style.cssText = `position:fixed;top:0;left:0;z-index:${config.zIndex};opacity:${config.opacity};`;
    getElementsByTagName("body")[0].appendChild(canvas);

    function updateSize() {
        canvasWidth = canvas.width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
        canvasHeight = canvas.height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;
    }

    function draw() {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        
        let particle, otherParticle, dx, dy, distance;
        particles.forEach(function(p, index) {
            p.x += p.vx;
            p.y += p.vy;
            
            if (p.x > canvasWidth || p.x < 0) p.vx *= -1;
            if (p.y > canvasHeight || p.y < 0) p.vy *= -1;
            
            ctx.fillStyle = `rgba(${config.color}, 1)`;
            ctx.fillRect(p.x - 0.5, p.y - 0.5, 1, 1);
            
            for (let i = index + 1; i < particles.length; i++) {
                otherParticle = particles[i];
                if (otherParticle.x !== null && otherParticle.y !== null) {
                    dx = p.x - otherParticle.x;
                    dy = p.y - otherParticle.y;
                    distance = dx * dx + dy * dy;
                    
                    if (distance < otherParticle.max) {
                        if (otherParticle === mouse && distance >= otherParticle.max / 2) {
                            p.x -= 0.03 * dx;
                            p.y -= 0.03 * dy;
                        }
                        
                        const opacity = (otherParticle.max - distance) / otherParticle.max;
                        ctx.beginPath();
                        ctx.lineWidth = opacity / 2;
                        ctx.strokeStyle = `rgba(${config.color}, ${opacity + 0.2})`;
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(otherParticle.x, otherParticle.y);
                        ctx.stroke();
                    }
                }
            }
        });
        
        requestAnimFrame(draw);
    }

    updateSize();
    window.addEventListener('resize', updateSize, false);
    
    window.addEventListener('mousemove', function(e) {
        e = e || window.event;
        mouse.x = e.clientX;
        mouse.y = e.clientY;
    }, false);
    
    window.addEventListener('mouseout', function() {
        mouse.x = null;
        mouse.y = null;
    }, false);

    particles = [];
    for (let i = 0; i < config.count; i++) {
        let x = random() * canvasWidth;
        let y = random() * canvasHeight;
        let vx = 2 * random() - 1;
        let vy = 2 * random() - 1;
        particles.push({ x, y, vx, vy, max: 6000 });
    }
    
    particles.push(mouse);
    
    setTimeout(function() {
        draw();
    }, 100);
}

// 鼠标跟随阴影效果
export function mouseShadow() {
    const pointer = document.createElement("span");
    pointer.classList.add("pointer");
    document.body.appendChild(pointer);

    window.addEventListener("mousemove", function(e) {
        let x = e.clientX;
        let y = e.clientY;
        pointer.style.top = y + "px";
        pointer.style.left = x + "px";
    }, false);
}

// 生成随机颜色
export function generateRandomColor() {
    const colors = [
        '#FF6B6B', // 红色
        '#4ECDC4', // 青色
        '#45B7D1', // 蓝色
        '#96CEB4', // 绿色
        '#FFEAA7', // 黄色
        '#DDA0DD', // 紫色
        '#98D8C8', // 薄荷绿
        '#F7DC6F', // 金黄色
        '#BB8FCE', // 淡紫色
        '#85C1E9'  // 天蓝色
    ]
    return colors[Math.floor(Math.random() * colors.length)]
}

// 更新连接状态显示
let connectionStatusElement = null

export function setConnectionStatusElement(element) {
    connectionStatusElement = element
}

export function updateConnectionStatus(status) {
    if (!connectionStatusElement) {
        console.warn('Connection status element not set')
        return
    }
    
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
    
    const config = connectionStatusConfig[status] || connectionStatusConfig.disconnected
    connectionStatusElement.textContent = config.text
    connectionStatusElement.style.backgroundColor = config.bgColor
    connectionStatusElement.style.color = config.color
}

// 创建并添加用户信息面板
export function createUserInfoPanel(userName, userColor) {
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
        <span style="color: #999; font-size: 11px;">（你的专属颜色）</span>
    </div>`
    document.body.appendChild(userInfo)
}

// 创建并添加连接状态面板
export function createConnectionStatusPanel() {
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
    return connectionStatus
}

// 更新在线用户列表显示
export function updateOnlineUsersList(users) {
    const usersListElement = document.getElementById('online-users-list')
    if (!usersListElement) return

    usersListElement.innerHTML = ''
    
    if (!users || users.length === 0) {
        usersListElement.innerHTML = '<span style="color: #999;">暂无其他用户</span>'
        return
    }

    users.forEach(user => {
        const userBadge = document.createElement('div')
        userBadge.style.display = 'flex'
        userBadge.style.alignItems = 'center'
        userBadge.style.gap = '5px'
        userBadge.style.padding = '4px 8px'
        userBadge.style.backgroundColor = user.color + '20' // 添加透明度
        userBadge.style.borderRadius = '12px'
        userBadge.style.border = `1px solid ${user.color}`
        userBadge.style.fontSize = '12px'
        
        const colorDot = document.createElement('div')
        colorDot.style.width = '8px'
        colorDot.style.height = '8px'
        colorDot.style.borderRadius = '50%'
        colorDot.style.backgroundColor = user.color
        
        const userNameSpan = document.createElement('span')
        userNameSpan.textContent = user.name
        
        userBadge.appendChild(colorDot)
        userBadge.appendChild(userNameSpan)
        usersListElement.appendChild(userBadge)
    })
}