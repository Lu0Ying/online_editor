// 点击特效
export function clickEffect() {
    let balls = [];
    let longPressed = false;
    let longPress;
    let multiplier = 0;
    let width, height;
    let origin;
    let normal;
    let ctx;
    const colours = ["#F73859", "#14FFEC", "#00E0FF", "#FF99FE", "#FAF15D"];
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    canvas.setAttribute("style", "width: 100%; height: 100%; top: 0; left: 0; z-index: 99999; position: fixed; pointer-events: none;");
    const pointer = document.createElement("span");
    pointer.classList.add("pointer");
    document.body.appendChild(pointer);

    if (canvas.getContext && window.addEventListener) {
        ctx = canvas.getContext("2d");
        updateSize();
        window.addEventListener('resize', updateSize, false);
        loop();
        window.addEventListener("mousedown", function(e) {
            pushBalls(randBetween(10, 20), e.clientX, e.clientY);
            document.body.classList.add("is-pressed");
            longPress = setTimeout(function(){
                document.body.classList.add("is-longpress");
                longPressed = true;
            }, 500);
        }, false);
        window.addEventListener("mouseup", function(e) {
            clearInterval(longPress);
            if (longPressed == true) {
                document.body.classList.remove("is-longpress");
                pushBalls(randBetween(50 + Math.ceil(multiplier), 100 + Math.ceil(multiplier)), e.clientX, e.clientY);
                longPressed = false;
            }
            document.body.classList.remove("is-pressed");
        }, false);
        window.addEventListener("mousemove", function(e) {
            let x = e.clientX;
            let y = e.clientY;
            pointer.style.top = y + "px";
            pointer.style.left = x + "px";
        }, false);
    } else {
        console.log("canvas or addEventListener is unsupported!");
    }


    function updateSize() {
        canvas.width = window.innerWidth * 2;
        canvas.height = window.innerHeight * 2;
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';
        ctx.scale(2, 2);
        width = (canvas.width = window.innerWidth);
        height = (canvas.height = window.innerHeight);
        origin = {
            x: width / 2,
            y: height / 2
        };
        normal = {
            x: width / 2,
            y: height / 2
        };
    }
    class Ball {
        constructor(x = origin.x, y = origin.y) {
            this.x = x;
            this.y = y;
            this.angle = Math.PI * 2 * Math.random();
            if (longPressed == true) {
                this.multiplier = randBetween(14 + multiplier, 15 + multiplier);
            } else {
                this.multiplier = randBetween(6, 12);
            }
            this.vx = (this.multiplier + Math.random() * 0.5) * Math.cos(this.angle);
            this.vy = (this.multiplier + Math.random() * 0.5) * Math.sin(this.angle);
            this.r = randBetween(8, 12) + 3 * Math.random();
            this.color = colours[Math.floor(Math.random() * colours.length)];
        }
        update() {
            this.x += this.vx - normal.x;
            this.y += this.vy - normal.y;
            normal.x = -2 / window.innerWidth * Math.sin(this.angle);
            normal.y = -2 / window.innerHeight * Math.cos(this.angle);
            this.r -= 0.3;
            this.vx *= 0.9;
            this.vy *= 0.9;
        }
    }

    function pushBalls(count = 1, x = origin.x, y = origin.y) {
        for (let i = 0; i < count; i++) {
            balls.push(new Ball(x, y));
        }
    }

    function randBetween(min, max) {
        return Math.floor(Math.random() * max) + min;
    }

    function loop() {
        ctx.fillStyle = "rgba(255, 255, 255, 0)";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < balls.length; i++) {
            let b = balls[i];
            if (b.r < 0) continue;
            ctx.fillStyle = b.color;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2, false);
            ctx.fill();
            b.update();
        }
        if (longPressed == true) {
            multiplier += 0.2;
        } else if (!longPressed && multiplier >= 0) {
            multiplier -= 0.4;
        }
        removeBall();
        requestAnimationFrame(loop);
    }

    function removeBall() {
        for (let i = 0; i < balls.length; i++) {
            let b = balls[i];
            if (b.x + b.r < 0 || b.x - b.r > width || b.y + b.r < 0 || b.y - b.r > height || b.r < 0) {
                balls.splice(i, 1);
            }
        }
    }
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