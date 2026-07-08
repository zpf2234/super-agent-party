# 灵动岛重构设计文档

**日期**: 2026-07-08
**版本**: 1.0
**状态**: 已确认

---

## 1. 背景

将 SAP 灵动岛从原生 JS 单文件重构为 Vue 3 架构，采用 Ripple 全屏覆盖层窗口方案，新增双面板横向滑动切换（时间/天气 + 音乐播放），收起态根据音乐播放状态自动切换显示内容。

---

## 2. 目标

1. **全屏覆盖层窗口**：替代当前 420 x 72px 小窗口，改为全屏透明窗口，岛浮动于顶部中央
2. **双面板滑动切换**：面板 1（时间/日期/天气），面板 2（音乐播放器），支持指针拖拽 + 滚轮横向滑动
3. **收起/展开交互（仿 Ripple）**：hover 悬停态 -> click 展开态 -> 失焦/鼠标离开 -> 收起
4. **收起态优先级**：音乐播放中显示歌名，无音乐显示时间
5. **天气 MCP 工具注册**：天气查询、天气预报、设置城市、获取时间 4 个工具

---

## 3. 架构

### 3.1 窗口层（main.js 改造）

参照 Ripple 的 createWindow 实现，将动态岛窗口改为全屏透明覆盖层：

```javascript
dynamicIslandWindow = new BrowserWindow({
  width: screenW,       // 全屏宽度
  height: screenH,      // 全屏高度
  x: 0, y: 0,
  transparent: true,
  alwaysOnTop: true,
  frame: false,
  resizable: false,
  backgroundColor: '#00000000',
  skipTaskbar: true,
  type: isWindows ? 'toolbar' : 'panel',
  webPreferences: { preload: ...existing }
});

// 初始全屏鼠标穿透
dynamicIslandWindow.setIgnoreMouseEvents(true, { forward: true });

// 新增 IPC：前端控制穿透开关
ipcMain.handle('set-island-ignore-mouse', (event, ignore) => {
  dynamicIslandWindow.setIgnoreMouseEvents(ignore, { forward: true });
});
```

### 3.2 文件结构

```
static/
├── island.html           # 重写：Vue 3 入口
├── island-app.js          # 新增：Vue 3 应用逻辑
├── css/
│   └── island.css          # 重写：岛样式 + 面板样式 + 动画
├── OpenRunde-Regular.woff  # 新增：从 Ripple 复制
├── OpenRunde-Medium.woff   # 新增
├── OpenRunde-Semibold.woff # 新增
├── OpenRunde-Bold.woff     # 新增
└── libs/
    └── vue.global.prod.js  # 已有：Vue 3.5.22
```

### 3.3 技术栈

| 层 | 技术 |
|----|------|
| UI 框架 | Vue 3.5.22 (Options API, CDN 全局引入) |
| 动画 | CSS transition + Vue `<Transition>` |
| 图标 | Font Awesome 6 (CDN, 已有) |
| 字体 | OpenRunde (SIL OFL 1.1, 本地 woff) |
| 通信 | WebSocket (协议不变) |
| 天气 API | OpenMeteo (免费免 key) |

---

## 4. 状态机

### 4.1 三种状态

```
still (静止态, 170x40px)
    │
    ├─ mouseenter → quick (悬停态, 310x40px)
    │                  │
    │                  ├─ click → large (展开态, 420x300px)
    │                  │            │
    │                  │            ├─ click 岛区域 → still
    │                  │            └─ window.focusout → still
    │                  │
    │                  └─ mouseleave → still
    │
    └─ 优先级判断：
        ├─ 有音乐播放 → 直接显示 quick (310x40px, 歌名跑马灯)
        └─ 无音乐播放 → still (170x40px, 时间)
```

### 4.2 交互规则

| 事件 | 动作 |
|------|------|
| mouseenter 岛区域 | still/standby -> quick (岛宽度变 310px) |
| click 岛区域 (非按钮/输入框) | quick -> large (展开 420x300px) |
| mouseleave 岛区域 | quick -> still (large 状态下不收起) |
| window.focusout (岛窗口失焦) | large -> still (延迟 100ms, 排除 input 聚焦) |
| click 岛区域 (large 态下) | large -> still (收起) |

---

## 5. 面板设计

### 5.1 面板 1：时间/日期/天气

布局：
- 天气图标 (根据 OpenMeteo weathercode 映射 Font Awesome 图标)
- 当前温度 (大号 OpenRunde-Semibold)
- 中文天气描述
- 分隔线
- 当前时间 (大号 OpenRunde-Bold, 24 小时制)
- 日期 + 星期

数据来源：
- 前端直接 fetch OpenMeteo API
- 城市默认从 localStorage 读取，降级为"北京"
- 每 10 分钟轮询

### 5.2 面板 2：音乐播放器

复用现有 large 态布局（封面占位符 + 歌名/歌手 + 控制按钮 + 音量滑块）。

### 5.3 面板滑动

- 容器：`display: flex; width: 200%`
- 每个面板占 50%
- 滑动：`transform: translateX(-{activePanel * 50}%)`, transition 0.35s
- 指针拖拽：swipeThreshold = 60px
- 滚轮：deltaX 累积 60px, 锁定期 800ms
- 底部指示器：`● ○`

---

## 6. 数据流

### 6.1 音乐状态（不变）

```
前端 (ws) --island_poll_music--> 后端 (dynamic_island.py)
          <--island_music_state-- { track, artist, isPlaying }
每 2 秒轮询
```

### 6.2 天气数据（新增）

```
前端 (fetch) --> geocoding-api.open-meteo.com/v1/search?name=城市
             <-- { results: [{ latitude, longitude, timezone }] }

前端 (fetch) --> api.open-meteo.com/v1/forecast?latitude=...&longitude=...&current_weather=true
             <-- { current_weather: { temperature, weathercode, windspeed } }
每 10 分钟轮询
```

天气代码映射 (WCODE_MAP)：同 py/utility_tools.py 的 _WCODE_MAP

### 6.3 城市存储

- localStorage key: `island_weather_city`
- 默认尝试 IP 定位，降级为 `"北京"`

---

## 7. MCP 工具

### 7.1 已有工具（不变）

island_music_play, island_music_pause, island_music_next, island_music_prev, island_music_get_info, island_music_set_volume

### 7.2 新增工具

| 工具名 | 说明 | 参数 | 数据来源 |
|--------|------|------|----------|
| island_weather_get_current | 获取当前天气 | city? | 前端 OpenMeteo |
| island_weather_get_forecast | 获取天气预报 | city?, days? | 前端 OpenMeteo |
| island_weather_set_city | 设置天气城市 | city | 前端 localStorage |
| island_get_time | 获取当前时间 | 无 | 前端 Date() |

---

## 8. CSS 动画

- 岛尺寸过渡：`cubic-bezier(0.34,1.56,0.64,1)` 0.4s (弹性效果)
- 面板滑动过渡：`cubic-bezier(0.4,0,0.2,1)` 0.35s
- 鼠标穿透控制：IPC set-island-ignore-mouse

---

## 9. 实现文件清单

| 文件 | 操作 | 内容 |
|------|------|------|
| main.js (1658-1714 行) | 改 | 窗口改为全屏, 新增 set-island-ignore-mouse IPC |
| static/island.html | 重写 | Vue 3 入口 + 模板 + MCP 逻辑 |
| static/island-app.js | 新增 | Vue 应用逻辑 |
| static/css/island.css | 重写 | 新岛样式 |
| static/OpenRunde-*.woff (4 个) | 新增 | 字体文件 |
| py/dynamic_island.py | 不改 | 现有逻辑保留 |
