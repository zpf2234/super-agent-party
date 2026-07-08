# SAP 灵动岛：Ripple 功能移植设计文档

**日期**: 2026-07-08
**版本**: 1.0
**状态**: 草案

---

## 1. 背景

SAP 灵动岛已具备基础架构（全屏透明覆盖层、still/quick/large 三态、天气/音乐双面板、10 个 MCP 工具）。Ripple 项目（v3.3.0, MIT）是一个功能完备的桌面灵动岛实现，提供 AI 对话、系统状态提示、剪贴板、任务等实用功能。

本设计将 Ripple 中与 SAP 定位一致的功能模块移植到灵动岛现有 Vue 3 架构中。

---

## 2. 技术约束

- **前端框架**: Vue 3 (Options API, CDN) + Font Awesome 6 — 不从 React 迁移
- **动画**: CSS `cubic-bezier` 过渡 + Web Animations API — 不引入 Framer Motion
- **通信**: WebSocket `/ws` 单通道 + `register_node_extension_mcp` 协议 — 不修改 server.py
- **系统 IPC**: 仅新增 `ipcMain.handle` + `preload.js` — 不修改现有 IPC
- **持久化**: `localStorage`（聊天历史走后端）

---

## 3. 面板架构

### 3.1 当前架构

2 个面板（天气/时间、音乐），`activePanel` 范围为 `0..1`。

### 3.2 新架构

6 个面板，`activePanel` 范围为 `0..5`。

```js
data() {
  return {
    panels: [
      { id: 0, name: '天气', icon: 'fa-sun' },
      { id: 1, name: '音乐', icon: 'fa-music' },
      { id: 2, name: '搜索', icon: 'fa-search' },
      { id: 3, name: 'AI 对话', icon: 'fa-robot' },
      { id: 4, name: '剪贴板', icon: 'fa-clipboard' },
      { id: 5, name: '任务', icon: 'fa-check-square' }
    ],
    // ...
  }
}
```

### 3.3 panelTransforms 泛化

```js
panelTransforms() {
  const dragPct = this.isDragging ? (this.dragOffset / (this._panelWidth || 420) * 100) : 0;
  const result = {};
  for (let i = 0; i < this.panels.length; i++) {
    result['p' + i] = `translateX(${(-this.activePanel + i) * 100 + dragPct}%)`;
  }
  return result;
}
```

### 3.4 模板

```html
<div class="panel" v-for="(panel, i) in panels" :key="panel.id"
     :style="{ transform: panelTransforms['p' + i] }">
  <!-- 面板内容 -->
</div>
```

### 3.5 面板指示器

从固定 2 个 `.panel-dot` 改为 `v-for` 循环，点击圆点调用 `switchPanel(i)`。

---

## 4. 各面板详细设计

### 4.1 搜索面板

**UI**：单行输入框居中，placeholder「搜索或输入网址」。输入 Enter 后智能路由（URL → `openExternal`，关键词 → 搜索引擎）。引擎切换存 `localStorage('island_search_engine')`，可选 Google / Bing。

**MCP**:
```json
{"name": "island_search", "description": "在浏览器中搜索或打开网址", "parameters": {"type": "object", "properties": {"value": {"type": "string", "description": "搜索词或URL"}, "engine": {"type": "string", "enum": ["google", "bing"], "description": "搜索引擎，默认google"}}, "required": ["value"]}}
```

### 4.2 AI 对话面板

**通信协议**：复用极简模式（`minimal.html:452-604`）的 WebSocket 消息类型：

1. 连接 `/ws` → 发送 `{ type: "get_messages" }`
2. 收到 `{ type: "messages_update", data: { messages } }` → 渲染对话历史
3. 用户输入 → `{ type: "set_user_input", data: { text: "..." } }` → 300ms 后 `{ type: "trigger_send_message" }`
4. AI 回复过程中持续收到 `messages_update` → 实时渲染

所有消息类型已在 `server.py` 中存在，无需后端改动。

**UI**：输入框 + 发送按钮 + 对话历史滚动区。消息用 `markdown-it` 渲染（库已存在 `static/libs/markdown-it.min.js`），代码块带复制按钮。「清空对话」快捷按钮。

**MCP**:
```json
{"name": "island_ask", "description": "向 AI 提问并获取回复", "parameters": {"type": "object", "properties": {"text": {"type": "string", "description": "用户问题"}}, "required": ["text"]}}
```

### 4.3 剪贴板面板

**数据来源**：`navigator.clipboard.readText()` 每 2 秒轮询。变化时推入历史数组（上限 50 条）。持久化到 `localStorage('island_clipboard')`。

**UI**：竖向列表，每条显示内容摘要 +「复制」按钮。空态提示「暂无剪贴板记录」。

**MCP**:
```json
{"name": "island_clipboard_get", "description": "获取最近 N 条剪贴板记录", "parameters": {"type": "object", "properties": {"count": {"type": "integer", "default": 5}}, "required": []}}
```

### 4.4 任务面板

**数据来源**：`localStorage('island_tasks')`。参照 Ripple `Island.jsx:1039-1048, 2112-2187`。

**UI**：输入框 + 添加按钮 + 任务列表（checkbox + 文本 + 删除按钮）。勾选即删除。

**MCP**:
```json
{"name": "island_tasks_add", "description": "添加一条任务", "parameters": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}}
{"name": "island_tasks_list", "description": "列出所有待办任务", "parameters": {"type": "object", "properties": {}, "required": []}}
{"name": "island_tasks_remove", "description": "按文本内容删除一条任务", "parameters": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}}
```

### 4.5 天气面板（保留现有）

保持 `fetchWeather` + `WCODE_MAP` + `WEATHER_ICONS` 不变。

### 4.6 音乐面板（保留现有）

保持 `sendMusicControl` + `handleMusicState` 不变。

---

## 5. 系统状态提示

### 5.1 概述

通用「告警劫持」机制：系统状态变化时，岛自动弹出指定图标+文字+边框色，保持 1.5~3s 后回缩。不干扰 Large 模式。

### 5.2 状态类型

| 状态 | 图标 | 边框色 | 时长 | 数据源 |
|------|------|--------|------|--------|
| 低电量 (≤20%) | `fa-bolt` 红 | `rgba(255,63,63,0.5)` | 3s | `navigator.getBattery()` |
| 充电中 | `fa-bolt` 绿 | `rgba(111,255,123,0.5)` | 1.5s | `navigator.getBattery()` |
| 蓝牙连接 | `fa-headphones` 蓝 | `rgba(0,150,255,0.34)` | 3s | IPC `get-bluetooth-status` |
| 摄像头占用 | `fa-camera` 黄 | `rgba(255,215,0,0.8)` | 3s | IPC `get-camera-status` |
| 麦克风占用 | `fa-microphone` 橙 | `rgba(255,154,0,0.8)` | 3s | IPC `get-mic-status` |

### 5.3 告警队列

参照 Ripple `captureAlertQueue`（`Island.jsx:950-1011`）：

```js
data() {
  return {
    alertQueue: [],
    alertTimer: null,
    shownAlerts: {}  // 防重复：每种状态只弹一次直到状态恢复
  }
}

processQueue() {
  if (this.alertTimer || this.alertQueue.length === 0) return;
  const item = this.alertQueue.shift();
  this.mode = 'quick';
  this.activeAlert = item;
  // Quick 模板检查 activeAlert，切换显示
  // 岛 border 同步变色
  const durations = { battery: 3000, charging: 1500, bluetooth: 3000, camera: 3000, mic: 3000 };
  this.alertTimer = setTimeout(() => {
    this.activeAlert = null;
    this.alertTimer = null;
    this.processQueue();
    if (this.alertQueue.length === 0) this.mode = 'still';
  }, durations[item]);
}
```

### 5.4 IPC Handler（main.js 新增）

3 个 handler，参照 Ripple `main.js:686-775`：

**`get-bluetooth-status`**:
- Win: `Get-PnpDevice -Class Bluetooth | ? Status -eq 'OK'`
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

### 5.5 preload.js 暴露

```js
getBluetoothStatus: () => ipcRenderer.invoke('get-bluetooth-status'),
getCameraStatus: () => ipcRenderer.invoke('get-camera-status'),
getMicStatus: () => ipcRenderer.invoke('get-mic-status'),
```

### 5.6 前端轮询

`island-app.js` 的 `mounted()` 中新增：
- 电池监听：`navigator.getBattery()` → `chargingchange` / `levelchange` 事件
- 蓝牙：`setInterval(() => this.pollBluetooth(), 5000)`
- 摄像头：`setInterval(() => this.pollCamera(), 3000)`
- 麦克风：`setInterval(() => this.pollMic(), 3000)`

---

## 6. MCP 工具注册

### 6.1 当前注册

`registerMcpTools()` 中 10 个工具（6 音乐 + 3 天气 + 1 时间）。

### 6.2 新增注册

在 `tools[]` 数组追加：

```js
{ name: 'island_search', description: '在浏览器中搜索或打开网址', parameters: { type: 'object', properties: { value: { type: 'string', description: '搜索词或URL' }, engine: { type: 'string', enum: ['google', 'bing'] } }, required: ['value'] } },
{ name: 'island_ask', description: '向 AI 提问并获取回复', parameters: { type: 'object', properties: { text: { type: 'string', description: '用户问题' } }, required: ['text'] } },
{ name: 'island_clipboard_get', description: '获取最近 N 条剪贴板记录', parameters: { type: 'object', properties: { count: { type: 'integer', default: 5 } }, required: [] } },
{ name: 'island_tasks_add', description: '添加一条任务', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
{ name: 'island_tasks_list', description: '列出所有待办任务', parameters: { type: 'object', properties: {}, required: [] } },
{ name: 'island_tasks_remove', description: '按文本内容删除一条任务', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
```

在 `handleMcpCall()` 的 `switch` 中添加对应 case。均仅前端处理（搜索调 `openExternal`、AI 走 WS 消息、剪贴板/任务读 localStorage），无需后端修改。

---

## 7. UI/UX 变更

### 7.1 Large 模式

高度统一 300px，宽度 420px。内容超高的面板内部 `overflow-y: auto`。

### 7.2 Quick 模式内容优先级

1. `activeAlert` 非 null → 告警图标+文字+彩色边框
2. `isPlaying && hasMusic` → 音乐跑马灯
3. 常规 → 天气+时间+日期

### 7.3 面板切换

新增键盘快捷键（仅 Large 模式响应）：
- `ArrowLeft` → `moveTab(-1)`
- `ArrowRight` → `moveTab(1)`
- `Ctrl+1`~`Ctrl+6` → `switchPanel(n-1)`

---

## 8. 文件修改清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `static/css/island.css` | 修改 | 新增搜索/AI/剪贴板/任务面板样式；告警边框色 class；面板高度统一 300px |
| `static/island.html` | 重写 | 面板改为 `v-for` 循环；新增 4 个面板模板；Quick 增加告警内容模板 |
| `static/island-app.js` | 重写 | `activePanel` 范围扩展；4 个新面板逻辑；alertQueue；IPC 轮询；新 MCP 工具 |
| `main.js` | 修改 | 新增 3 个 IPC handler（蓝牙/摄像头/麦克风） |
| `static/js/preload.js` | 修改 | 暴露 `getBluetoothStatus`、`getCameraStatus`、`getMicStatus` |

---

## 9. 无需修改的文件

| 文件 | 原因 |
|------|------|
| `server.py` | AI 对话复用已有 WS 消息类型；MCP 工具前端动态注册 |
| `py/dynamic_island.py` | 新工具仅前端注册处理 |
| `py/ws_manager.py` | 不变 |
| `static/js/vue_data.js` | 不受影响 |
| `static/js/vue_methods.js` | 不受影响 |

---

## 10. 实施顺序

### 阶段 1：多面板底座 + AI 对话（P0）

1. 扩展 `activePanel` 为 N，`panelTransforms` 泛化，指示器动态渲染
2. 实现搜索面板（逻辑最简单，无后端依赖）
3. 实现 AI 对话面板（WS 复用极简模式协议）
4. 注册 `island_search`、`island_ask` MCP 工具
5. 验证：Large 模式下滑动到搜索/AI 面板，搜索打开浏览器，AI 收发消息

### 阶段 2：系统状态提示 + IPC（P0）

1. `main.js` 添加 3 个 IPC handler + `preload.js` 暴露
2. `island-app.js` 实现电池监听 + alertQueue + IPC 轮询
3. 验证：插充电器 → 岛弹出绿色闪电 + 绿色边框 → 1.5s 恢复

### 阶段 3：剪贴板 + 任务面板（P1）

1. 剪贴板轮询 + 面板 UI
2. 任务增删 + localStorage + 面板 UI
3. 注册 `island_clipboard_*`、`island_tasks_*` MCP 工具

---

## 11. 测试要点

| 测试项 | 方法 |
|--------|------|
| 6 面板切换 | pointer 拖拽、wheel 滚轮、Arrow 键、Ctrl+数字均正常 |
| 面板指示器 | 6 个圆点正确渲染，当前高亮，点击切换 |
| 搜索 | 输入 URL 打开浏览器，输入关键词走搜索引擎 |
| AI 对话 | 输入→WS 消息→收到 `messages_update`→Markdown 正确渲染 |
| 剪贴板 | 复制外部文本→面板出现条目→点击恢复 |
| 任务 | 添加→显示→勾选清除→刷新后持续存在 |
| 告警队列 | 同时触发充电+蓝牙→顺序弹出，不重叠 |
| IPC 状态 | 打开摄像头→黄色告警弹出 |
| 快捷键 | Ctrl+3 跳转 AI 面板 |

---

## 12. 参考文件

### Ripple

| 功能 | 行号 |
|------|------|
| 搜索 | `Island.jsx:848-859, 1510-1525` |
| AI 流式对话 | `Island.jsx:624-705, 1875-2063` |
| 剪贴板历史 | `Island.jsx:861-880, 2066-2109` |
| 任务管理 | `Island.jsx:1039-1048, 2112-2187` |
| 告警队列 | `Island.jsx:950-1011` |
| 电池 | `Island.jsx:708-733, 736-768` |
| 蓝牙/摄像头/麦克风 IPC | `main.js:686-775` |
| 边框色 | `Island.jsx:1262-1266` |
| Ctrl+数字快捷键 | `Island.jsx:1077-1096` |

### SAP

| 模块 | 路径:行号 |
|------|----------|
| 岛 HTML | `static/island.html` |
| 岛 JS | `static/island-app.js` |
| 岛 CSS | `static/css/island.css` |
| 岛窗口 IPC | `main.js:1658-1724` |
| preload | `static/js/preload.js:140-146` |
| 极简模式 WS | `static/minimal.html:452-604` |
