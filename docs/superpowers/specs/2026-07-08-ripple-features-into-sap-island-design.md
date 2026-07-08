# SAP 灵动岛：Ripple 功能集成设计文档

**日期**: 2026-07-08  
**状态**: 草案  
**目标版本**: v0.5.0

---

## 1. 背景与目标

SAP 灵动岛（Dynamic Island）当前具备天气/时间展示与音乐播放控制两个面板。Ripple 项目（v3.3.0, MIT）是一个功能丰富的桌面灵动岛实现，它提供了大量可直接借鉴的功能模块。

**本设计的核心目标**：将 Ripple 中实用的功能面板和系统状态指示机制，移植到 SAP 灵动岛的 Vue 3 + WebSocket + MCP 架构中。

**非目标**：
- 不引入 React / Framer Motion（SAP 使用 Vue 3 + CSS 动画）
- 不修改 `server.py` 中已有的 `/ws` 消息路由
- 不修改 `py/dynamic_island.py` 的现有 `island_music_*` 和轮询函数
- 不修改 `py/ws_manager.py`

---

## 2. 功能面板规划

### 2.1 面板架构

当前灵动岛有 2 个面板（天气/时间、音乐），通过 `activePanel` 切换。本设计扩展为 **动态 N 面板架构**，其中 N 初始为 6，可通过设置面板（Settings）调整顺序与显示/隐藏。

**面板列表**（按预设顺序）：

| # | 面板名 | 数据源 | 现有? | MCP 工具 |
|---|--------|--------|-------|----------|
| 0 | 天气/时间 (Weather) | OpenMeteo API + `Date()` | ✅ 已有 | `island_weather_*`, `island_get_time` |
| 1 | 音乐 (Music) | WebSocket `island_music_*` | ✅ 已有 | `island_music_*` |
| 2 | AI 对话 (AI Chat) | WebSocket（极简模式协议） | ❌ 新增 | `island_ask` |
| 3 | 搜索 (Browser Search) | 前端 `openExternal` | ❌ 新增 | `island_search` |
| 4 | 剪贴板 (Clipboard) | `navigator.clipboard` | ❌ 新增 | `island_clipboard_*` |
| 5 | 任务 (Tasks) | `localStorage` | ❌ 新增 | `island_tasks_*` |

### 2.2 面板切换机制

- **activePanel** 从 `0..1` 扩展到 `0..N-1`
- 横向拖拽（PointerEvent, `≥40px` 阈值）切换，跟现有 `onPointerUp` 逻辑一致
- 鼠标滚轮（`deltaX` 累积 `≥60px`，800ms lockout）切换
- 键盘 `ArrowLeft` / `ArrowRight` 切换
- `Ctrl+1` ~ `Ctrl+6` 直接跳转（Ripple 模式）
- `panelTransforms` 计算由固定 2 面板改为 N 面板：`translateX(${-activePanel * 100 + dragOffsetPct}%)` 对所有面板通用
- 面板指示器动态生成 N 个圆点

### 2.3 新面板详细设计

#### 2.3.1 AI 对话面板

**交互方式**：直接复用极简模式（`static/minimal.html:452-604`）与 SAP 后端的 WebSocket 通信协议。

**通信流程**（不修改 server.py）：
1. 岛前端通过 `/ws` 发送 `{ type: "get_messages" }`
2. 后端广播 `{ type: "request_messages" }`，主窗口 `vue_methods.js` 响应并广播 `{ type: "broadcast_messages", data: { messages, conversationId } }`
3. 岛前端收到 `{ type: "messages_update", data: { messages, conversationId } }`
4. 用户输入 → 发送 `{ type: "set_user_input", data: { text: "..." } }` → 300ms 后发送 `{ type: "trigger_send_message", data: {} }`
5. AI 回复时后端陆续广播 `messages_update`，岛前端实时渲染

**UI 布局**（Large 模式 420×300 内）：
- 顶部：对话历史滚动区域，`max-height` 可调
- 底部：输入框（textarea）+ 发送按钮
- 回复支持 Markdown 渲染（借用 `vue_methods.js` 已有的 `markdown-it` 实例）
- 代码块带「复制」按钮

**MCP 工具**：
```json
{
  "name": "island_ask",
  "description": "向 AI 提出问题，返回 AI 的回复内容。对话上下文与主界面共享。",
  "parameters": {
    "type": "object",
    "properties": {
      "text": { "type": "string", "description": "用户的问题" }
    },
    "required": ["text"]
  }
}
```

**初始状态**：空对话，不显示历史（与极简模式一致，发送 `get_messages` 获取当前会话历史）。

#### 2.3.2 搜索面板

**数据来源**：纯前端，无后端依赖。

**交互**：
- 单行输入框，placeholder 提示「搜索或输入网址」
- 用户输入 Enter → 智能判断：若为 URL/direct domain → 调用 `window.electronAPI.openExternal()` 直接打开；否则 → 用搜索引擎搜索
- 引擎切换：输入框左侧按钮或下拉，可选 Google / Bing，存 `localStorage('island_search_engine')`

**MCP 工具**：
```json
{
  "name": "island_search",
  "description": "用浏览器打开指定查询或网址。传入 url 则直接打开，传入 query 则用默认搜索引擎搜索。",
  "parameters": {
    "type": "object",
    "properties": {
      "type": {
        "type": "string",
        "enum": ["url", "query"],
        "description": "url 直接打开，query 用搜索引擎搜索"
      },
      "value": { "type": "string", "description": "URL 或搜索词" }
    },
    "required": ["type", "value"]
  }
}
```

#### 2.3.3 剪贴板面板

**数据来源**：`navigator.clipboard.readText()` 轮询，每 2 秒检查一次，变化时推入历史数组。上限 50 条，存 `localStorage('island_clipboard')`。

**UI**：
- 竖向列表，每行显示文本摘要（3 行截断）+ 全文复制按钮
- 空列表时显示「暂无剪贴板记录」

**MCP 工具**：
```json
{
  "name": "island_clipboard_get",
  "description": "获取最近 N 条剪贴板记录",
  "parameters": {
    "type": "object",
    "properties": {
      "count": { "type": "integer", "description": "返回条数，默认 5", "default": 5 }
    },
    "required": []
  }
}
```

#### 2.3.4 任务面板

**数据来源**：`localStorage('island_tasks')`。

**UI**：
- 输入框 + 添加按钮
- 任务列表：checkbox + 任务文本 + 删除按钮
- 勾选后任务消除（直接删除，不保留已完成历史）
- 所有数据持久化到 `localStorage`

**MCP 工具**：
```json
{ "name": "island_tasks_add", "description": "添加一条任务", "parameters": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] } },
{ "name": "island_tasks_list", "description": "列出所有待办任务", "parameters": { "type": "object", "properties": {}, "required": [] } },
{ "name": "island_tasks_remove", "description": "按文本内容删除一条任务", "parameters": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] } }
```

### 2.4 Large 模式尺寸调整

| 面板 | Large 宽度 | Large 高度 |
|------|-----------|-----------|
| 天气/时间 | 420px | 300px |
| 音乐 | 330px | 300px |
| AI 对话 | 400px | 300px |
| 搜索 | 350px | 200px |
| 剪贴板 | 380px | 300px |
| 任务 | 420px | 300px |

面板高度统一为 300px 以保持切换一致性，各面板内部内容区域可滚动。

---

## 3. 系统状态提示机制

### 3.1 概述

系统状态提示是苹果灵动岛的核心体验之一——当系统事件发生时（低电量、蓝牙连接、麦克风占用等），岛自动弹出提示图标，停留 1.5~3 秒后自动回缩。

本设计将其作为 **Quick 模式的「告警劫持」** 机制，不干扰 Large 模式下的面板切换。

### 3.2 状态类型与样式

| 状态 | 图标 | Quick 模式边框颜色 | 持续时间 | 数据来源 |
|------|------|-------------------|----------|---------|
| 低电量 (≤20%) | `fa-bolt` 红色 | `rgba(255,63,63,0.5)` | 3s | `navigator.getBattery()` |
| 充电中 | `fa-bolt` 绿色 | `rgba(111,255,123,0.5)` | 1.5s | `navigator.getBattery()` |
| 蓝牙已连接 | `fa-headphones` 蓝色 | `rgba(0,150,255,0.34)` | 3s | IPC `get-bluetooth-status` |
| 摄像头占用 | `fa-camera` 黄色 | `rgba(255,215,0,0.8)` | 3s | IPC `get-camera-status` |
| 麦克风占用 | `fa-microphone` 橙色 | `rgba(255,154,0,0.8)` | 3s | IPC `get-mic-status` |
| 音乐播放 | （现有跑马灯，保持不变） | — | 持续 | WS `island_music_state` |

### 3.3 告警队列机制（参照 Ripple `captureAlertQueue` 模式）

```
数据层:
  alertQueue: []           // 告警 FIFO 队列
  alertTimer: null         // 当前告警显示定时器
  alertDisplayed: {}       // 记录已显示过的状态，防重复

流程:
  1. 某状态变化（例如摄像头从 未占用 → 占用）
  2. 若 alertDisplayed.camera === false，推入队列
  3. 若当前无告警显示，从队列取出并执行：
     - mode = 'quick'
     - 显示对应图标 + 文字
     - 边框变色
     - 设置定时器（3s 或 1.5s）
  4. 到期 → 清除，检查队列下一个
  5. 队列为空 → mode = 'still'
```

### 3.4 IPC Handler 设计（main.js 新增）

需要新增 3 个 IPC handler，参考 Ripple `main.js:686-775` 的跨平台实现：

**`get-bluetooth-status`**：
- Windows: `Get-PnpDevice -Class Bluetooth | Where-Object { $_.Status -eq 'OK' }`
- macOS: `system_profiler SPBluetoothDataType -json`
- Linux: `bluetoothctl devices Connected`

**`get-camera-status`**：
- Windows: 注册表 `HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam`
- macOS: `ioreg -l | grep "CameraStreaming"`
- Linux: `fuser /dev/video*`

**`get-mic-status`**：
- Windows: 注册表同路径 `\microphone`
- macOS: `ioreg -l | grep "IOAudioStreamActive"`
- Linux: `pactl list source-outputs`

在 `preload.js` 中暴露：
```javascript
getBluetoothStatus: () => ipcRenderer.invoke('get-bluetooth-status'),
getCameraStatus: () => ipcRenderer.invoke('get-camera-status'),
getMicStatus: () => ipcRenderer.invoke('get-mic-status'),
```

岛前端 `island-app.js` 新增定时轮询（每 3~5 秒），检查结果并推入 alertQueue。

---

## 4. MCP 工具注册方案

### 4.1 现有 MCP 工具

当前 `island-app.js:338-349` 注册了 10 个工具（6 音乐 + 3 天气 + 1 时间）。

### 4.2 新增 MCP 工具

在 `registerMcpTools()` 的 `tools[]` 数组中追加：

```javascript
// AI 对话
{ name: 'island_ask', description: '向 AI 提问并获取回复', parameters: { type: 'object', properties: { text: { type: 'string', description: '用户问题' } }, required: ['text'] } },
// 搜索
{ name: 'island_search', description: '在浏览器中搜索或打开 URL', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['url', 'query'] }, value: { type: 'string' } }, required: ['type', 'value'] } },
// 剪贴板
{ name: 'island_clipboard_get', description: '获取最近剪贴板记录', parameters: { type: 'object', properties: { count: { type: 'integer', default: 5 } }, required: [] } },
// 任务
{ name: 'island_tasks_add', description: '添加任务', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
{ name: 'island_tasks_list', description: '列出所有任务', parameters: { type: 'object', properties: {}, required: [] } },
{ name: 'island_tasks_remove', description: '删除任务', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
```

在 `handleMcpCall()` 的 `switch(tn)` 中追加对应 case。

**注意**：后端的 `py/dynamic_island.py:12-54` 中 `ISLAND_TOOLS_SCHEMA` 已有 6 个工具定义。新工具的 schema 仅在**前端**注册（通过 `register_node_extension_mcp` 广播），`server.py` 会自动收到 `node_ext_mcp_registered` 事件并将其加入 `node_ext_mcp_tools` 全局表，AI Agent 即可调用。**无需修改 `py/dynamic_island.py` 或 `server.py`**。

---

## 5. 文件修改清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `static/css/island.css` | 修改 | 新增面板样式（AI 对话、搜索、剪贴板、任务）；新增 alert 状态边框色类；增加面板数量适应 |
| `static/island.html` | 重写 | 新增 4 个面板的 DOM 模板；面板指示器改为动态 N 圆点 |
| `static/island-app.js` | 重写 | 扩展 activePanel 范围为 N；新增 AI/搜索/剪贴板/任务面板的逻辑与数据；新增 alertQueue 逻辑；新增 IPC 轮询；新增 MCP 工具注册与处理 |
| `main.js` | 修改 | 新增 `get-bluetooth-status`, `get-camera-status`, `get-mic-status` 3 个 IPC handler |
| `static/js/preload.js` | 修改 | 暴露新增的 3 个 IPC 方法 |

---

## 6. 不需要修改的文件

| 文件 | 原因 |
|------|------|
| `server.py` | AI 对话复用已有 `get_messages` / `set_user_input` / `trigger_send_message` 协议；MCP 工具通过 `register_node_extension_mcp` 动态注册 |
| `py/dynamic_island.py` | 新 MCP 工具仅前端注册，无需后端提前定义 |
| `py/ws_manager.py` | 消息路由不涉及 ws_manager 变更 |
| `vue_methods.js` / `vue_data.js` | 岛的通信通过 WebSocket 独立进行 |

---

## 7. UI 交互细节

### 7.1 面板切换动画（CSS）

现有 CSS transition 已覆盖：`island.css:185` 的 `transition: transform 0.35s cubic-bezier(0.4,0,0.2,1)`。

多面板适配：将 `island-app.js` 中 `panelTransforms` computed 改为对 N 个面板通用的映射：
```
panel i 的 transform = translateX(${(-activePanel + i) * 100 + dragPct}%)
```

### 7.2 键盘快捷键

在 `island-app.js` `mounted()` 中添加 `keydown` 监听：
- `ArrowLeft` / `ArrowRight` → 调用 `movePanel`
- `Ctrl+1` ~ `Ctrl+6` → `switchPanel(n-1)`

### 7.3 面板高度自适应

Large 模式 island 基础高度设为 `300px`。内容多的面板（AI 对话、设置）内部使用 `overflow-y: auto` 滚动。

### 7.4 Quick 模式告警劫持

当 alertQueue 非空且 mode 不为 large 时：
- Quick 模式的渲染内容由「时间+天气」或「音乐跑马灯」切换为告警图标 + 文字
- 告警图标 `font-size: 20px` 显示在左侧，文字在右侧
- 边框应用对应状态颜色
- 定时器结束后恢复常规 Quick 内容

---

## 8. 实施顺序

建议分 3 个阶段实施，每个阶段可独立测试：

### 阶段 1：多面板框架 + AI 对话（P0）
1. 扩展 `activePanel` 范围，修改 `panelTransforms` 和指示器
2. 新增 AI 对话面板（HTML + CSS + JS 逻辑）
3. 注册 `island_ask` MCP 工具
4. 验证：Large 模式下可横向滑动到 AI 面板，发送问题并收到回复

### 阶段 2：系统状态提示 + IPC（P0）
1. 在 `main.js` 添加 3 个 IPC handler
2. 在 `preload.js` 暴露对应方法
3. 在 `island-app.js` 实现 alertQueue 机制和轮询
4. 验证：插入充电器 → 岛弹出绿色闪电图标 + 绿色边框，1.5s 后恢复

### 阶段 3：搜索 + 剪贴板 + 任务面板（P1）
1. 添加 3 个面板的 HTML/CSS/JS 和 MCP 工具
2. 验证：各面板在大模式下滑动可用，MCP 工具可被 AI 调用

---

## 9. 测试要点

| 测试项 | 方法 |
|--------|------|
| 面板滑动 | 5+ 个面板，pointer 拖拽和 wheel 均应顺畅切换 |
| 面板指示器 | 动态生成正确数量圆点，当前面板高亮 |
| AI 对话收发 | 输入文字 → WS `set_user_input` + `trigger_send_message` → 收到 `messages_update` 渲染 |
| 搜索打开 URL | 输入 `github.com` → `openExternal` 打开浏览器 |
| 剪贴板捕获 | 复制文本 → 岛面板自动出现新条目 |
| 任务持久化 | 添加任务 → 刷新页面 → 任务仍在 |
| 告警队列 | 模拟多个状态同时触发，观察队列顺序和时序 |
| IPC 状态检测 | 打开摄像头 → 岛弹出黄色相机提示 + 黄色边框 |
| Ctrl+数字快捷键 | Ctrl+3 应跳转到第 3 个面板（AI 对话） |

---

## 10. 附录：关键参考文件

| 参考对象 | 路径 |
|---------|------|
| Ripple 完整 Island 组件 | `D:\AI\Ripple\src\Island.jsx` (2763 行) |
| Ripple 主进程 IPC | `D:\AI\Ripple\src\main.js:686-775` (蓝牙/摄像头/麦克风检测) |
| Ripple 告警队列 | `D:\AI\Ripple\src\Island.jsx:950-1011` |
| Ripple Tab 管理 | `D:\AI\Ripple\src\Island.jsx:99-141, 2225-2304` |
| SAP 极简模式 WebSocket | `D:\AI\super-agent-party\static\minimal.html:452-604` |
| SAP 现有岛实现 | `D:\AI\super-agent-party\static\island.html` / `island-app.js` / `css/island.css` |
| SAP 主进程 | `D:\AI\super-agent-party\main.js:1658-1724` (岛窗口创建) |
| SAP preload | `D:\AI\super-agent-party\static\js\preload.js:140-146` |
