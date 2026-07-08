# SAP 灵动岛增强设计 —— 移植 Ripple 功能

**日期**: 2026-07-08  
**状态**: 草案  

---

## 1. 背景

SAP 灵动岛已具备天气/时间展示与音乐播放控制两个面板，通过 still/quick/large 三态和横向拖拽切换面板。Ripple 项目（v3.3.0, MIT）是一个 Electron + React 的桌面灵动岛，实现了完整的 8 标签页系统、系统状态提示、AI 对话、剪贴板、任务管理等功能。

本设计将 Ripple 中适用于 SAP 的功能模块，按 SAP 现有的 Vue 3 + WebSocket + MCP 架构进行移植。设计产出一个可直接进入编写实施计划的 spec。

---

## 2. 技术约束

- **前端框架**: Vue 3 (Options API, CDN `vue.global.prod.js`) + Font Awesome 6 — 不从 React 迁移
- **动画**: CSS 过渡（`cubic-bezier`）+ Web Animations API（跑马灯）— 不引入 Framer Motion
- **通信**: WebSocket `/ws` 单通道 + `register_node_extension_mcp` 协议（不修改 server.py / py/dynamic_island.py / py/ws_manager.py）
- **系统 IPC**: Electron `ipcMain.handle` + `preload.js` contextBridge（只新增不修改已有）
- **持久化**: `localStorage`（聊天历史走后端）

---

## 3. 面板架构

### 3.1 当前架构

2 个面板 via `activePanel (0..1)` + `panelTransforms` computed + `panelsWrapper` 绝对定位滑动。

### 3.2 新架构

6 个面板（天气、音乐、搜索、AI 对话、剪贴板、任务），`activePanel` 范围为 `0..5`。

**`panelTransforms` 的泛化计算**:

```js
panelTransforms() {
  const panels = this.panels;  // 面板数量
  const dragPct = this.isDragging ? (this.dragOffset / (this._panelWidth || 420) * 100) : 0;
  const result = {};
  for (let i = 0; i < panels.length; i++) {
    result['p' + i] = `translateX(${(-this.activePanel + i) * 100 + dragPct}%)`;
  }
  return result;
}
```

HTML 模板从硬编码 2 个 `.panel` 改为 `v-for="(panel, i) in panels"` 循环渲染。

### 3.3 面板定义

```js
panels: [
  { id: 0, name: '天气', icon: 'fa-sun' },
  { id: 1, name: '音乐', icon: 'fa-music' },
  { id: 2, name: '搜索', icon: 'fa-search' },
  { id: 3, name: 'AI', icon: 'fa-robot' },
  { id: 4, name: '剪贴板', icon: 'fa-clipboard' },
  { id: 5, name: '任务', icon: 'fa-check-square' }
]
```

面板指示器圆点动态生成，点击 `switchPanel(i)`。

### 3.4 面板切换

保持现有 PointerEvent 拖拽（40px 阈值）+ 鼠标滚轮（60px 累积，800ms lockout）不变，新增支持：

- 键盘 `ArrowLeft`/`ArrowRight` 切换
- `Ctrl+1` ~ `Ctrl+6` 快捷键跳转（参照 Ripple `Island.jsx:1077-1096`）

---

## 4. 各面板详细设计

### 4.1 搜索面板

**UI**（Large 模式 420x200）：单行输入框居中的独立面板。

**交互**：输入 Enter → 智能判断：
- 若为 URL / 域名 / IP 地址 → 调用 `window.electronAPI.openExternal()` 直接打开
- 否则 → 用默认搜索引擎搜索
  - 可选引擎：Google `https://www.google.com/search?q=` / Bing `https://www.bing.com/search?q=`
  - 引擎选择存 `localStorage('island_search_engine')`

**MCP**:
```json
{
  "name": "island_search",
  "description": "在浏览器中打开搜索查询或网址",
  "parameters": {
    "type": "object",
    "properties": {
      "value": {"type": "string", "description": "搜索词或URL"},
      "engine": {"type": "string", "enum": ["google", "bing"], "description": "搜索引擎，默认google"}
    },
    "required": ["value"]
  }
}
```

### 4.2 AI 对话面板

**通信协议**：复用极简模式（`minimal.html:452-604`）的 WebSocket 消息：

1. 连接 `/ws` → 发送 `{ type: "get_messages" }`
2. 后端广播 `request_messages` → 主窗口响应 → 广播 `messages_update`
3. 用户输入 → `{ type: "set_user_input", data: { text: "..." } }` → 300ms 后 `{ type: "trigger_send_message", data: {} }`
4. AI 回复过程中持续收到 `messages_update`，实时渲染

**UI**：输入框 + 发送按钮 + 对话滚动区域。消息使用 Markdown 渲染（调用已有的 `markdown-it` 库）。代码块带复制按钮。

**注意**：每次打开面板时调用 `get_messages` 获取当前会话上下文，与主窗口聊天和极简模式共享同一对话。

快速按钮：清空对话 / 复制最后一条回复。

**MCP**:
```json
{
  "name": "island_ask",
  "description": "向AI提问并获取回复",
  "parameters": {
    "type": "object",
    "properties": {
      "text": {"type": "string", "description": "用户问题"}
    },
    "required": ["text"]
  }
}
```

### 4.3 剪贴板面板

**数据来源**：`navigator.clipboard.readText()` 每 2 秒轮询。变化时推入历史数组。上限 50 条，持久化到 `localStorage('island_clipboard')`。

**UI**：竖向列表，每条显示内容摘要（3 行截断）+「复制」按钮。空态提示「暂无剪贴板记录」。

**MCP**:
```json
{
  "name": "island_clipboard_get",
  "description": "获取最近N条剪贴板记录",
  "parameters": {
    "type": "object",
    "properties": {
      "count": {"type": "integer", "default": 5}
    },
    "required": []
  }
}
```

### 4.4 任务面板

**数据来源**：`localStorage('island_tasks')`。

**UI**（参照 Ripple `Island.jsx:1039-1048, 2112-2187`）：输入框 + 添加按钮 + 任务列表（checkbox + 文本 + 删除按钮）。勾选即删除（不保留已完成项目）。

**MCP**:
```json
[
  {"name": "island_tasks_add", "description": "添加任务", "parameters": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}},
  {"name": "island_tasks_list", "description": "列出所有任务", "parameters": {"type": "object", "properties": {}, "required": []}},
  {"name": "island_tasks_remove", "description": "删除任务", "parameters": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}}
]
```

### 4.5 音乐面板（保留现有，小幅增强）

保留现有 `sendMusicControl` 和 `handleMusicState` 逻辑。新增：
- Quick 模式下专辑封面加载失败时的降级显示（当前若 `artwork_url` 为空则默认用音乐图标）
- 跑马灯定时重启兜底（已有 `_buildMarquee`，不需要额外改动）

### 4.6 天气面板（保留现有）

保留现有 `fetchWeather` + `WCODE_MAP` + WEATHER_ICONS。不新增改动。

---

## 5. 系统状态提示

### 5.1 概览

Ripple 最亮眼的功能之一是系统事件自动弹出提示（低电量、充电、蓝牙连接、摄像头、麦克风）。本设计将其作为 Quick 模式的「告警劫持」机制。

### 5.2 状态类型

| 状态 | 触发条件 | 图标 | Quick 边框色 | 持续时间 |
|------|---------|------|-------------|---------|
| 低电量 | 电池 ≤20% | `fa-bolt` 红色 | `rgba(255,63,63,0.5)` | 3s |
| 充电 | 电池从 `!charging` → `charging` | `fa-bolt` 绿色 | `rgba(111,255,123,0.5)` | 1.5s |
| 蓝牙连接 | 设备从断开→连接 | `fa-headphones` 蓝色 | `rgba(0,150,255,0.34)` | 3s |
| 摄像头占用 | 摄像头从空闲→占用 | `fa-camera` 黄色 | `rgba(255,215,0,0.8)` | 3s |
| 麦克风占用 | 麦克风从空闲→占用 | `fa-microphone` 橙色 | `rgba(255,154,0,0.8)` | 3s |

### 5.3 告警队列

参照 Ripple `captureAlertQueue` 模式（`Island.jsx:950-1011`）：

```
data: alertQueue: [], alertTimer: null, shownAlerts: {}  // 防重复

当状态变化（如 cameraInUse false→true）:
  if (!shownAlerts.camera) {
    shownAlerts.camera = true
    alertQueue.push('camera')
    processQueue()
  }

processQueue():
  if (alertTimer || queue空) return
  item = queue.shift()
  mode = 'quick'
  showAlert(item)  // 设置 activeAlert，Quick 模板根据 activeAlert 切换内容
  borderColor = item对应颜色
  alertTimer = setTimeout(() => {
    activeAlert = null
    alertTimer = null
    restoreBorder()
    processQueue()
    if (queue空) mode = 'still'
  }, 3000 或 1500)
```

### 5.4 IPC Handler

在 `main.js` 中新增 3 个 handler（参照 Ripple `main.js:686-775`）：

**`get-bluetooth-status`**:
- Win: `Get-PnpDevice -Class Bluetooth | ? { $_.Status -eq 'OK' }`
- Mac: `system_profiler SPBluetoothDataType -json`
- Linux: `bluetoothctl devices Connected`

**`get-camera-status`**:
- Win: 注册表 `CapabilityAccessManager\ConsentStore\webcam`, `LastUsedTimeStop == 0`
- Mac: `ioreg -l | grep "CameraStreaming" | grep "= Yes"`
- Linux: `fuser /dev/video*`

**`get-mic-status`**:
- Win: 同上 `\microphone`
- Mac: `ioreg -l | grep "IOAudioStreamActive"`
- Linux: `pactl list source-outputs`

`preload.js` 暴露：
```js
getBluetoothStatus: () => ipcRenderer.invoke('get-bluetooth-status'),
getCameraStatus: () => ipcRenderer.invoke('get-camera-status'),
getMicStatus: () => ipcRenderer.invoke('get-mic-status'),
```

岛前端轮询：电池每 5 秒（`navigator.getBattery()` 已有 changed 事件监听，直接复用）、蓝牙每 5 秒、摄像头/麦克风每 3 秒。

### 5.5 电池数据处理

电池通过 `navigator.getBattery()` API 获取（当前 SAP 岛未实现，Ripple `Island.jsx:708-733` 已有参考）。监听 `chargingchange` 和 `levelchange` 事件即可，无需 IPC 轮询。

---

## 6. MCP 工具注册方案

### 6.1 当前状态

`island-app.js:registerMcpTools()` 注册 10 个工具（6 音乐 + 3 天气 + 1 时间）。

### 6.2 新增工具

在 `registerMcpTools()` 的 `tools[]` 数组中添加：

```js
{ name: 'island_search', description: '在浏览器中打开搜索查询或网址', parameters: { type: 'object', properties: { value: { type: 'string', description: '搜索词或URL' }, engine: { type: 'string', enum: ['google', 'bing'], description: '搜索引擎，默认google' } }, required: ['value'] } },
{ name: 'island_ask', description: '向AI提问并获取回复', parameters: { type: 'object', properties: { text: { type: 'string', description: '用户问题' } }, required: ['text'] } },
{ name: 'island_clipboard_get', description: '获取最近N条剪贴板记录', parameters: { type: 'object', properties: { count: { type: 'integer', default: 5 } }, required: [] } },
{ name: 'island_tasks_add', description: '添加一条任务', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
{ name: 'island_tasks_list', description: '列出所有待办任务', parameters: { type: 'object', properties: {}, required: [] } },
{ name: 'island_tasks_remove', description: '按文本内容删除一条任务', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
```

`handleMcpCall()` 的 `switch(tn)` 中追加对应 case。新工具仅在**前端注册**，无需修改 `server.py` 或 `py/dynamic_island.py`。

---

## 7. UI/UX 变更

### 7.1 Large 模式尺寸

统一 Large 模式高度为 300px，宽度保持 420px。内容超高的面板内部使用 `overflow-y: auto` 滚动。

### 7.2 Still 模式变更

Still 模式保持 170×40px 纯时间显示。若当前存在 `activeAlert` 且模式为 quick，则显示告警图标+文字而非常规 quick 内容。

### 7.3 Quick 模式状态切换

Quick 模式内容优先级（从高到低）：

1. `activeAlert` 非 null → 显示告警图标+文字+彩色边框
2. `isPlaying && hasMusic` → 显示音乐跑马灯（现有逻辑）
3. 常规 → 显示天气+时间+日期（现有逻辑）

### 7.4 键盘快捷键

在 `island-app.js` 的 `mounted()` 中添加 `document.addEventListener('keydown', ...)`：

- `ArrowLeft`: `moveTab(-1)`
- `ArrowRight`: `moveTab(1)`
- `Ctrl+1` 到 `Ctrl+6`: `switchPanel(n-1)`

仅 Large 模式下响应快捷键。

### 7.5 面板指示器

从固定 2 个 `.panel-dot` 改为 `v-for` 循环，点击圆点调用 `switchPanel(i)`。当前面板的圆点 `active` 类加宽。

---

## 8. 文件修改清单

| 文件 | 修改类型 | 内容 |
|------|---------|------|
| `static/css/island.css` | 修改 | 新增搜索、AI对话、剪贴板、任务面板样式；新增告警边框色 class；面板高度统一 300px |
| `static/island.html` | 重写 | 面板改为 `v-for` 循环；新增搜索/AI/剪贴板/任务面板模板；新增 Quick 告警内容模板 |
| `static/island-app.js` | 重写 | 多面板索引扩展；新增 4 个面板逻辑；alertQueue 机制；IPC 轮询；新 MCP 工具注册与处理 |
| `main.js` | 修改 | 新增 3 个 IPC handler（蓝牙/摄像头/麦克风状态检测） |
| `static/js/preload.js` | 修改 | 暴露 `getBluetoothStatus`, `getCameraStatus`, `getMicStatus` |

---

## 9. 无需修改的文件

| 文件 | 原因 |
|------|------|
| `server.py` | AI 对话复用已有 `get_messages`/`set_user_input`/`trigger_send_message` 协议；MCP 工具通过 `register_node_extension_mcp` 动态注册 |
| `py/dynamic_island.py` | 新 MCP 工具仅前端注册，不涉及后端 `ISLAND_TOOLS_SCHEMA` |
| `py/ws_manager.py` | 不变 |
| `static/js/vue_methods.js` / `vue_data.js` | 岛的通信通过 WebSocket 独立进行，不依赖主窗口 Vue 实例 |

---

## 10. 实施顺序

### 第一阶段：多面板底座 + AI 对话（P0）

1. 重构 `activePanel` 为 N 面板，修改 `panelTransforms` 和指示器
2. 实现搜索面板（最简单，无后端依赖）
3. 实现 AI 对话面板（WebSocket 复用极简模式协议）
4. 注册对应的 MCP 工具
5. 验证：Large 模式下滑动到搜索/AI 面板，搜索可用，AI 可收发消息

### 第二阶段：系统状态提示 + IPC（P0）

1. 在 `main.js` 添加 3 个 IPC handler
2. `preload.js` 暴露方法
3. `island-app.js` 实现电池监听 + alertQueue + IPC 轮询
4. 验证：插充电器 → 岛弹出绿色闪电 + 绿色边框 → 1.5s 恢复

### 第三阶段：剪贴板 + 任务面板（P1）

1. 剪贴板监听逻辑 + 面板 UI
2. 任务增删 + localStorage 面板 UI
3. 注册对应 MCP 工具

---

## 11. 测试要点

| 测试项 | 方法 |
|--------|------|
| 面板切换（6面板） | pointer 拖拽、wheel、键盘、Ctrl+数字，均正常工作 |
| 指示器 | 6 个圆点，当前高亮，点击切换 |
| 搜索 | 输入 URL 打开浏览器，输入关键词走搜索引擎 |
| AI 对话 | 输入→WS 消息→收到回复→Markdown 正确渲染 |
| 剪贴板 | 复制外部文本→面板出现条目→点击复制恢复 |
| 任务 | 添加→显示→勾选删除→刷新后任务仍在（localStorage）|
| 告警队列 | 同时触发充电+蓝牙→顺序提示，不重叠 |
| IPC 状态 | 打开摄像头→岛的黄色告警弹出 |
| 快捷键 | Ctrl+3 跳转到 AI 面板 |

---

## 12. 附录

### 参考文件（Ripple）

| 功能 | Ripple 文件:行号 |
|------|-----------------|
| 搜索面板 | `src/Island.jsx:848-859, 1510-1525` |
| AI 流式对话 | `src/Island.jsx:624-705, 1875-2063` |
| 剪贴板历史 | `src/Island.jsx:861-880, 2066-2109` |
| 任务管理 | `src/Island.jsx:1039-1048, 2112-2187` |
| 告警队列 | `src/Island.jsx:174-176, 950-1011` |
| 电池监听 | `src/Island.jsx:708-733` |
| 电池/充电告警 | `src/Island.jsx:736-768` |
| 蓝牙检测 | `src/Island.jsx:882-912` + `src/main.js:686-718` |
| 摄像头检测 | `src/Island.jsx:914-930` + `src/main.js:720-752` |
| 麦克风检测 | `src/Island.jsx:932-948` + `src/main.js:754-775` |
| 动态边框色 | `src/Island.jsx:1262-1266` |
| Ctrl+数字快捷键 | `src/Island.jsx:1077-1096` |

### 参考文件（SAP）

| 模块 | 路径 |
|------|------|
| 岛 HTML 入口 | `static/island.html` |
| 岛 Vue 应用 | `static/island-app.js` |
| 岛样式 | `static/css/island.css` |
| 岛窗口 IPC | `main.js:1658-1724` |
| preload 桥 | `static/js/preload.js:140-146` |
| 极简模式 WS 协议 | `static/minimal.html:452-604` |
