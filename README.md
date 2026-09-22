# 实时协作文档编辑器 (Online Editor)

一个基于 Web 的多人实时协作文档编辑器，支持富文本 / Markdown 编辑、协同光标、聊天室、媒体插入与版本管理。

## 功能特性

- **多人实时协作**：基于 Yjs CRDT 实现，多人同时编辑文档自动合并，无需手动冲突处理
- **协同光标与在线用户**：实时显示其他协作者的光标位置与在线用户列表
- **两种文档类型**：
  - Markdown 文档：源码编辑 + 预览渲染（支持表格、代码块高亮、标题等）
  - 普通文档：所见即所得编辑
- **文档管理**：创建 / 打开 / 通过编号或链接加入文档，支持复制分享链接与最近文档列表
- **聊天室**：同文档内的协作者可实时聊天
- **媒体插入**：插入图片、视频，支持拖拽文件与 `Ctrl+V` 粘贴，大文件分片上传（按内容指纹去重）
- **导出**：HTML / 纯文本 / JSON (Yjs) / ZIP（含媒体资源）
- **版本管理**：快照保存、加载、版本对比（含图片对比）
- **自动保存**：文档内容自动持久化到服务端

## 技术栈

| 分类 | 技术 |
| --- | --- |
| 编辑器 | TipTap 3（基于 ProseMirror） |
| 实时协作 | Yjs + Hocuspocus（WebSocket） |
| Markdown 渲染 | markdown-it |
| 代码高亮 | lowlight (highlight.js) |
| 文件上传 / 打包 | 分片上传 + JSZip |
| 前端构建 | Vite |
| 后端 | Node.js 原生 HTTP / WebSocket |

## 项目结构

```
online_editor/
├── index.html              # 前端主页面
├── main.js                 # 前端主逻辑（编辑器初始化、协作连接、Markdown 处理）
├── chat.js                 # 聊天室模块
├── beautify.js             # UI 美化（粒子背景、在线用户列表、连接状态等）
├── version-manager.js      # 版本管理（快照保存 / 加载 / 对比）
├── server.js               # 主服务：Hocuspocus 协同服务 + HTTP API
├── server/
│   ├── file-server.js      # 文件服务器：媒体分片上传 / 下载 / 删除
│   └── snapshot-manager.js # 快照存储管理
├── media/
│   ├── media-extension.js  # TipTap 协作图片 / 视频扩展
│   ├── chunked-uploader.js # 大文件分片上传器
│   └── export-utils.js     # 文档导出（含媒体打包）
├── css/index.css           # 页面样式
├── vite.config.js          # Vite 配置（端口与 API 代理）
├── onlinetext/             # 文档持久化存储（Yjs 状态 JSON）
├── snapshots/              # 版本快照存储
└── server/uploads/         # 上传媒体文件存储
```

## 服务端口

| 端口 | 服务 | 说明 |
| --- | --- | --- |
| 5173 | Vite 前端开发服务器 | 浏览器访问入口 |
| 1235 | Hocuspocus WebSocket | 文档实时协同同步 |
| 1236 | 主服务 HTTP API | 文档列表 / 加载、快照管理、高亮清理 |
| 1237 | 文件服务器 | 媒体文件分片上传 / 下载 / 删除 |

### 主要 HTTP API

- `GET  /api/documents` — 获取文档列表
- `GET  /api/load-document?name=` — 加载指定文档
- `GET  /api/snapshots?doc=` — 获取快照列表
- `POST /api/snapshots/save` — 保存快照
- `GET  /api/snapshots/load` — 加载快照
- `DELETE /api/snapshots/delete` — 删除快照
- `GET  /api/snapshots/compare` — 快照对比
- `POST /api/upload/init|chunk|complete` — 媒体分片上传
- `GET  /api/files/{fingerprint}` — 按指纹下载媒体文件

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 一键启动全部服务（协同服务 + 文件服务器 + 前端）
npm run dev

# 3. 浏览器访问
#    http://localhost:5173
```

也可以分别启动各服务：

```bash
npm run dev:server       # 协同服务 + HTTP API (1235 / 1236)
npm run dev:fileserver   # 文件服务器 (1237)
npm run dev:frontend     # Vite 前端 (5173)
```

生产构建：

```bash
npm run build
npm run preview
```

## 使用说明

1. 启动后在浏览器打开 `http://localhost:5173`
2. 首次进入可修改昵称，随后在「文档管理」面板创建 Markdown 或普通文档
3. 将文档链接分享给同一局域网内的其他用户，即可多人同时编辑
4. 通过顶部工具栏可进行保存、预览、导出与版本管理；右下角聊天室可与协作者交流
