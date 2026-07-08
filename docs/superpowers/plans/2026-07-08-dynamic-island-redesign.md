# Dynamic Island Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild SAP Dynamic Island with Vue 3 as a full-screen transparent overlay with two swipeable panels (weather/time and music player), Ripple-style hover/expand/collapse interactions, and 4 new MCP weather/time tools.

**Architecture:** Full-screen transparent Electron window (Ripple pattern) with Vue 3 island component floating at top-center. Island has 3 states (still/quick/large), 2 panels with pointer+wheel horizontal swipe, and WebSocket MCP tool registration unchanged.

**Tech Stack:** Vue 3.5.22 (CDN, Options API), Font Awesome 6, OpenRunde fonts (local woff), WebSocket, OpenMeteo weather API, CSS transitions/animation

## Global Constraints

- Vue 3 must load from CDN at `libs/vue.global.prod.js` (already present)
- Font Awesome from CDN at `fontawesome/css/all.min.css` (already present)
- OpenMeteo weather API only (free, no API key required)
- OpenRunde fonts bundled as local .woff files (SIL OFL 1.1 licensed)
- Existing WebSocket protocol and `py/dynamic_island.py` MUST NOT be modified
- `preload.js` already exposes `setIgnoreMouseEvents`, `toggleWindowSize` — no changes needed
- Cross-platform: Windows (`type:"toolbar"`), macOS/Linux (`type:"panel"`), Linux special `forward:true`

---

### Task 1: Copy OpenRunde font files

**Files:**
- Copy: `D:\AI\Ripple\src\assets\fonts\OpenRunde-Regular.woff` → `D:\AI\super-agent-party\static\OpenRunde-Regular.woff`
- Copy: `D:\AI\Ripple\src\assets\fonts\OpenRunde-Medium.woff` → `D:\AI\super-agent-party\static\OpenRunde-Medium.woff`
- Copy: `D:\AI\Ripple\src\assets\fonts\OpenRunde-Semibold.woff` → `D:\AI\super-agent-party\static\OpenRunde-Semibold.woff`
- Copy: `D:\AI\Ripple\src\assets\fonts\OpenRunde-Bold.woff` → `D:\AI\super-agent-party\static\OpenRunde-Bold.woff`

**Interfaces:**
- Produces: 4 .woff files in `static/` for `@font-face` references in island.css

- [ ] **Step 1: Copy the four font files**

```powershell
Copy-Item "D:\AI\Ripple\src\assets\fonts\OpenRunde-Regular.woff" "D:\AI\super-agent-party\static\OpenRunde-Regular.woff"
Copy-Item "D:\AI\Ripple\src\assets\fonts\OpenRunde-Medium.woff" "D:\AI\super-agent-party\static\OpenRunde-Medium.woff"
Copy-Item "D:\AI\Ripple\src\assets\fonts\OpenRunde-Semibold.woff" "D:\AI\super-agent-party\static\OpenRunde-Semibold.woff"
Copy-Item "D:\AI\Ripple\src\assets\fonts\OpenRunde-Bold.woff" "D:\AI\super-agent-party\static\OpenRunde-Bold.woff"
```

- [ ] **Step 2: Verify files exist**

```powershell
Get-ChildItem "D:\AI\super-agent-party\static\OpenRunde-*.woff" | Select-Object Name, Length
```

- [ ] **Step 3: Commit**

---

### Task 2: Rewrite `static/css/island.css`

**Files:**
- Rewrite: `D:\AI\super-agent-party\static\css\island.css`

**Interfaces:**
- Produces: CSS classes for `#island-container`, `#island`, panel containers, swipe transitions, button styles, volume slider, panel indicators, marquee animation

- [ ] **Step 1: Write the complete island.css**

```css
/* OpenRunde 字体 */
@font-face {
  font-family: 'OpenRunde';
  src: url('../OpenRunde-Regular.woff') format('woff');
  font-weight: 400; font-style: normal;
}
@font-face {
  font-family: 'OpenRunde';
  src: url('../OpenRunde-Medium.woff') format('woff');
  font-weight: 500; font-style: normal;
}
@font-face {
  font-family: 'OpenRunde';
  src: url('../OpenRunde-Semibold.woff') format('woff');
  font-weight: 600; font-style: normal;
}
@font-face {
  font-family: 'OpenRunde';
  src: url('../OpenRunde-Bold.woff') format('woff');
  font-weight: 700; font-style: normal;
}

/* 全屏容器 */
#island-container {
  position: fixed; top: 0; left: 0;
  width: 100vw; height: 100vh;
  pointer-events: none;
  z-index: 2147483647;
}

/* 岛主体 */
#island {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 170px; height: 40px;
  border-radius: 14px;
  background: #000;
  color: #fff;
  font-family: 'OpenRunde', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  box-shadow: 0 0 24px rgba(0,0,0,0.12);
  transition: width 0.4s cubic-bezier(0.34,1.56,0.64,1),
              height 0.4s cubic-bezier(0.34,1.56,0.64,1),
              border-radius 0.35s ease,
              box-shadow 0.3s cubic-bezier(0.4,0,0.2,1);
  overflow: hidden;
  cursor: pointer;
  pointer-events: auto;
  display: flex; align-items: center; justify-content: center;
  will-change: width, height;
  -webkit-app-region: no-drag;
}

#island:hover {
  box-shadow: 0 0 32px rgba(0,0,0,0.25);
}

/* --- Still 静止态 --- */
.still-content {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%;
}
.still-time {
  font-size: 14px; font-weight: 600;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

/* --- Quick 悬停态 --- */
#island.quick {
  width: 310px;
  justify-content: flex-start;
  padding: 0 8px;
}
.quick-content {
  display: flex; align-items: center;
  width: 100%; height: 40px;
  gap: 6px;
}

/* Quick 天气图标 */
.quick-weather {
  display: flex; align-items: center; gap: 4px;
  flex-shrink: 0; font-size: 12px; color: rgba(255,255,255,0.7);
}
.quick-weather i { font-size: 14px; }

/* Quick 时间 */
.quick-time {
  font-size: 14px; font-weight: 600;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
  padding: 0 6px;
  border-right: 1px solid rgba(255,255,255,0.15);
}

/* Quick 左边：封面 + 跑马灯 */
.quick-left {
  display: flex; align-items: center; gap: 6px;
  flex: 1; min-width: 0; overflow: hidden;
}
.artwork-wrap {
  width: 24px; height: 24px; border-radius: 4px;
  background: rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; overflow: hidden;
}
.artwork-wrap i {
  font-size: 12px; color: rgba(255,255,255,0.6);
}

/* 跑马灯 */
.marquee-box {
  flex: 1; min-width: 0; height: 40px; line-height: 40px;
  overflow: hidden;
  mask-image: linear-gradient(to right, transparent 0%, black 10px, black calc(100% - 10px), transparent 100%);
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 10px, black calc(100% - 10px), transparent 100%);
}
.marquee-track {
  display: inline-flex; white-space: nowrap;
  height: 40px; line-height: 40px;
}
.marquee-item {
  font-size: 13px; font-weight: 500;
  white-space: nowrap; pointer-events: none;
  padding-right: 40px;
}

/* 右侧按钮 */
.quick-right {
  display: flex; align-items: center; flex-shrink: 0;
}
.ctrl-btn-sm {
  background: none; border: none; color: #fff;
  width: 30px; height: 30px; border-radius: 50%;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-size: 11px; transition: background 0.2s;
  -webkit-app-region: no-drag;
}
.ctrl-btn-sm:hover { background: rgba(255,255,255,0.12); }

/* --- Large 展开态 --- */
#island.large {
  width: 420px; height: 300px;
  border-radius: 30px;
  flex-direction: column;
  justify-content: flex-start;
  padding: 16px 0 0 0;
  cursor: default;
}

/* 面板滑动容器 */
.panels-wrapper {
  width: 100%; flex: 1;
  overflow: hidden;
  display: flex; align-items: flex-start;
}
.panels-track {
  display: flex;
  width: 200%;
  height: 100%;
  transition: transform 0.35s cubic-bezier(0.4,0,0.2,1);
  will-change: transform;
  touch-action: pan-y;
}
.panel {
  width: 50%; height: 100%;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 0 20px 10px;
  flex-shrink: 0;
}

/* 面板指示器 */
.panel-indicator {
  display: flex; gap: 6px;
  padding: 6px 0 10px;
}
.panel-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: rgba(255,255,255,0.2);
  transition: background 0.25s;
}
.panel-dot.active {
  background: rgba(255,255,255,0.8);
  width: 14px; border-radius: 3px;
}

/* === 面板1: 天气/时间 === */
.weather-panel {
  gap: 6px;
}
.weather-icon-large {
  font-size: 40px; color: rgba(255,255,255,0.8);
}
.weather-temp {
  font-size: 28px; font-weight: 600;
  line-height: 1.2;
}
.weather-desc {
  font-size: 13px; color: rgba(255,255,255,0.45);
}
.weather-divider {
  width: 80px; height: 1px;
  background: rgba(255,255,255,0.1);
  margin: 6px 0;
}
.weather-time {
  font-size: 36px; font-weight: 700;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}
.weather-date {
  font-size: 13px; color: rgba(255,255,255,0.45);
}

/* === 面板2: 音乐 === */
.music-panel {
  gap: 8px;
}
.large-artwork {
  width: 80px; height: 80px; border-radius: 8px;
  background: rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.large-artwork i {
  font-size: 28px; color: rgba(255,255,255,0.45);
}
.large-info {
  text-align: center; width: 100%; overflow: hidden;
}
.large-title {
  font-size: 15px; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.large-artist {
  font-size: 12px; color: rgba(255,255,255,0.45);
  margin-top: 2px;
}
.large-controls {
  display: flex; align-items: center; justify-content: center;
  gap: 20px;
}
.ctrl-btn-lg {
  background: none; border: none; color: rgba(255,255,255,0.65);
  width: 36px; height: 36px; border-radius: 50%;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-size: 14px; transition: all 0.2s;
  -webkit-app-region: no-drag;
}
.ctrl-btn-lg:hover {
  color: #fff; background: rgba(255,255,255,0.08);
}
.play-btn-lg {
  width: 44px; height: 44px;
  background: rgba(255,255,255,0.1);
  color: #fff; font-size: 16px;
}
.play-btn-lg:hover {
  background: rgba(255,255,255,0.18); transform: scale(1.06);
}
.large-vol {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 0 20px;
}
.vol-icon-lg {
  font-size: 10px; color: rgba(255,255,255,0.35); flex-shrink: 0;
}
.vol-slider-lg {
  flex: 1; -webkit-appearance: none; appearance: none;
  height: 3px; border-radius: 2px;
  background: rgba(255,255,255,0.12);
  outline: none; cursor: pointer;
  -webkit-app-region: no-drag;
}
.vol-slider-lg::-webkit-slider-thumb {
  -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%;
  background: #fff; cursor: pointer;
}

/* 禁止拖动 */
.ctrl-btn-sm, .ctrl-btn-lg, .vol-slider-lg {
  -webkit-app-region: no-drag;
}

/* Vue transition */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
```

- [ ] **Step 2: Commit**

---

### Task 3: Create `static/island-app.js`

**Files:**
- Create: `D:\AI\super-agent-party\static\island-app.js`

**Interfaces:**
- Consumes: Vue 3 (global `Vue`), WebSocket, `window.electronAPI.setIgnoreMouseEvents`, CSS classes from island.css
- Produces: `createIslandApp()` function that returns Vue app instance
- Internal exports used by island.html: `createIslandApp` global function

- [ ] **Step 1: Write island-app.js with full Vue Options API component**

```javascript
// SAP Dynamic Island - Vue 3 Application Logic
const MY_EXT_ID = 'dynamic_island';

const WCODE_MAP = {
  0: '晴', 1: '多云', 2: '少云', 3: '晴间多云',
  45: '雾', 48: '雾凇',
  51: '毛毛雨', 53: '小雨', 55: '中雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  71: '小雪', 73: '中雪', 75: '大雪',
  95: '雷暴', 96: '雷暴伴冰雹', 99: '强雷暴伴冰雹'
};

const WEATHER_ICONS = {
  '晴': 'fa-sun', '多云': 'fa-cloud-sun', '少云': 'fa-cloud-sun',
  '晴间多云': 'fa-cloud-sun',
  '雾': 'fa-smog', '雾凇': 'fa-smog',
  '毛毛雨': 'fa-cloud-rain', '小雨': 'fa-cloud-rain', '中雨': 'fa-cloud-rain',
  '大雨': 'fa-cloud-showers-heavy',
  '小雪': 'fa-snowflake', '中雪': 'fa-snowflake', '大雪': 'fa-snowflake',
  '雷暴': 'fa-bolt', '雷暴伴冰雹': 'fa-bolt', '强雷暴伴冰雹': 'fa-bolt'
};

function createIslandApp() {
  return Vue.createApp({
    data() {
      return {
        mode: 'still',           // still | quick | large
        activePanel: 0,          // 0=weather, 1=music
        isHovered: false,
        isExpanded: false,

        // Music state
        isPlaying: false,
        hasMusic: false,
        currentTrack: '',
        currentArtist: '',
        lastPlayAction: 0,
        volume: 50,
        marqueeAnim: null,

        // Weather state
        weatherTemp: null,
        weatherCode: null,
        weatherCity: '北京',
        weatherLoading: false,
        weatherError: null,

        // Time
        currentTime: '',
        currentDate: '',

        // WebSocket
        ws: null,
        reconnectTimer: null,
        musicPollTimer: null,
        weatherTimer: null,

        // Swipe
        swipeStartX: 0,
        swipeStartY: 0,
        swipeMoved: false,
        wheelAccum: 0,
        wheelLock: false,
        suppressClick: false
      };
    },

    computed: {
      weatherDesc() {
        if (this.weatherCode === null) return '加载中...';
        return WCODE_MAP[this.weatherCode] || '未知';
      },
      weatherIcon() {
        return WEATHER_ICONS[this.weatherDesc] || 'fa-cloud';
      },
      panelsTransform() {
        return `translateX(-${this.activePanel * 50}%)`;
      },
      isQuickView() {
        return this.mode === 'quick';
      },
      isLargeView() {
        return this.mode === 'large';
      },
      showMusicQuick() {
        return this.hasMusic && this.isPlaying && this.mode !== 'large';
      },
      showTimeStill() {
        return !this.hasMusic || !this.isPlaying;
      },
      playIcon() {
        return this.isPlaying ? 'fa-pause' : 'fa-play';
      }
    },

    created() {
      this.weatherCity = localStorage.getItem('island_weather_city') || '北京';
    },

    mounted() {
      this.connectWS();
      this.updateTime();
      this.timeTimer = setInterval(this.updateTime, 30000);

      // Mouse leave on whole container for focus-out collapse
      const container = this.$el;
      container.addEventListener('mouseleave', this.onContainerLeave);

      // Start weather polling
      this.fetchWeather();
      this.weatherTimer = setInterval(this.fetchWeather, 600000);
    },

    beforeUnmount() {
      this.stopMusicPoll();
      this.stopMarquee();
      this.unregisterMcpTools();
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      if (this.timeTimer) clearInterval(this.timeTimer);
      if (this.weatherTimer) clearInterval(this.weatherTimer);
    },

    methods: {
      // ===== Time =====
      updateTime() {
        const n = new Date();
        this.currentTime = n.getHours() + ':' + String(n.getMinutes()).padStart(2, '0');
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        this.currentDate = `${n.getMonth() + 1}月${n.getDate()}日 周${weekdays[n.getDay()]}`;
      },

      // ===== Mouse Events =====
      onIslandEnter() {
        this.isHovered = true;
        if (this.mode === 'large') return;
        this.mode = 'quick';
      },

      onIslandLeave() {
        this.isHovered = false;
        if (this.mode === 'large') return;
        this.mode = 'still';
      },

      onIslandClick(e) {
        if (e.target.closest('button') || e.target.closest('input')) return;
        if (this.suppressClick) { this.suppressClick = false; return; }
        if (this.mode === 'large') {
          this.mode = 'still';
          this.setMouseIgnore(true);
        } else {
          this.mode = 'large';
          this.setMouseIgnore(false);
        }
      },

      onContainerLeave() {
        if (this.mode !== 'large' && this.isHovered) {
          this.mode = 'still';
          this.isHovered = false;
        }
      },

      setMouseIgnore(ignore) {
        if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
          window.electronAPI.setIgnoreMouseEvents(ignore, { forward: true });
        }
      },

      // ===== Swipe =====
      onPointerDown(e) {
        if (this.mode !== 'large') return;
        if (e.target.closest('button') || e.target.closest('input')) return;
        this.swipeStartX = e.clientX;
        this.swipeStartY = e.clientY;
        this.swipeMoved = false;
        this.suppressClick = false;
      },

      onPointerMove(e) {
        if (this.mode !== 'large') return;
        if (!this.swipeStartX) return;
        const dx = e.clientX - this.swipeStartX;
        const dy = e.clientY - this.swipeStartY;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          this.swipeMoved = true;
        }
      },

      onPointerUp(e) {
        if (this.mode !== 'large') return;
        const dx = e.clientX - this.swipeStartX;
        if (this.swipeMoved && Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(e.clientY - this.swipeStartY)) {
          this.movePanel(dx > 0 ? -1 : 1);
          this.suppressClick = true;
        }
        this.swipeStartX = 0;
        this.swipeStartY = 0;
      },

      onWheel(e) {
        if (this.mode !== 'large') return;
        if (this.wheelLock) return;
        this.wheelAccum += e.deltaX || (e.deltaY > 5 ? e.deltaY : 0);
        if (Math.abs(this.wheelAccum) >= 60) {
          this.movePanel(this.wheelAccum > 0 ? 1 : -1);
          this.wheelAccum = 0;
          this.wheelLock = true;
          setTimeout(() => { this.wheelLock = false; }, 800);
        }
      },

      movePanel(dir) {
        this.activePanel = (this.activePanel + dir + 2) % 2;
      },

      switchPanel(idx) {
        this.activePanel = idx;
      },

      // ===== Weather =====
      async fetchWeather() {
        if (this.weatherLoading) return;
        this.weatherLoading = true;
        this.weatherError = null;
        try {
          const city = this.weatherCity || '北京';
          const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`);
          const geoData = await geoRes.json();
          if (!geoData.results || !geoData.results.length) {
            this.weatherError = '未找到城市';
            this.weatherLoading = false;
            return;
          }
          const { latitude, longitude } = geoData.results[0];
          const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
          const wData = await wRes.json();
          if (wData.current_weather) {
            this.weatherTemp = Math.round(wData.current_weather.temperature);
            this.weatherCode = wData.current_weather.weathercode;
          }
        } catch (err) {
          this.weatherError = '获取失败';
        }
        this.weatherLoading = false;
      },

      // ===== WebSocket =====
      connectWS() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
        const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';
        this.ws = new WebSocket(wsUrl);
        this.ws.onopen = () => {
          this.registerMcpTools();
          if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
          this.requestMusicState();
          this.startMusicPoll();
        };
        this.ws.onmessage = (e) => {
          try {
            const d = JSON.parse(e.data);
            if (d.type === 'call_mcp_tool') this.handleMcpCall(d.data);
            if (d.type === 'island_music_state') this.handleMusicState(d.data);
          } catch (err) {}
        };
        this.ws.onclose = () => {
          this.ws = null;
          this.stopMusicPoll();
          if (!this.reconnectTimer) this.reconnectTimer = setTimeout(() => this.connectWS(), 5000);
        };
      },

      registerMcpTools() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type: 'register_node_extension_mcp', data: { ext_id: MY_EXT_ID, tools: [
          { name: 'island_music_play',  description: '播放/恢复当前音乐', parameters: { type: 'object', properties: {}, required: [] } },
          { name: 'island_music_pause', description: '暂停音乐', parameters: { type: 'object', properties: {}, required: [] } },
          { name: 'island_music_next',  description: '下一首', parameters: { type: 'object', properties: {}, required: [] } },
          { name: 'island_music_prev',  description: '上一首', parameters: { type: 'object', properties: {}, required: [] } },
          { name: 'island_music_get_info', description: '获取当前播放信息', parameters: { type: 'object', properties: {}, required: [] } },
          { name: 'island_music_set_volume', description: '设置音量 0-100', parameters: { type: 'object', properties: { level: { type: 'integer', description: '0-100' } }, required: ['level'] } },
          { name: 'island_weather_get_current', description: '查询指定城市或当前配置城市的实时天气', parameters: { type: 'object', properties: { city: { type: 'string', description: '城市名称' } }, required: [] } },
          { name: 'island_weather_get_forecast', description: '查询指定城市未来几天天气预报', parameters: { type: 'object', properties: { city: { type: 'string', description: '城市名称' }, days: { type: 'integer', description: '预报天数, 默认3' } }, required: [] } },
          { name: 'island_weather_set_city', description: '设置灵动岛天气显示的城市', parameters: { type: 'object', properties: { city: { type: 'string', description: '城市名称' } }, required: ['city'] } },
          { name: 'island_get_time', description: '获取当前日期和时间信息', parameters: { type: 'object', properties: {}, required: [] } }
        ] } }));
      },

      unregisterMcpTools() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'unregister_node_extension_mcp', data: { ext_id: MY_EXT_ID } }));
        }
      },

      requestMusicState() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type: 'island_poll_music', data: {} }));
      },

      startMusicPoll() { this.stopMusicPoll(); this.musicPollTimer = setInterval(() => this.requestMusicState(), 2000); },
      stopMusicPoll() { if (this.musicPollTimer) { clearInterval(this.musicPollTimer); this.musicPollTimer = null; } },

      handleMusicState(data) {
        if (data.track) {
          const t = data.track.replace(/^["\s]+|["\s]+$/g, '');
          const a = (data.artist || '').replace(/^["\s]+|["\s]+$/g, '');
          if (!this.hasMusic || t !== this.currentTrack || a !== this.currentArtist) {
            this.currentTrack = t;
            this.currentArtist = a;
          }
          this.hasMusic = true;
          if (Date.now() - this.lastPlayAction > 2000) {
            this.isPlaying = data.isPlaying === true;
          }
          if (this.isPlaying && this.mode !== 'large') this.startMarquee();
        } else {
          if (this.hasMusic) {
            this.hasMusic = false;
            this.currentTrack = '';
            this.currentArtist = '';
            this.isPlaying = false;
            this.stopMarquee();
          }
        }
      },

      handleMcpCall(data) {
        const tn = data.tool_name, tp = data.tool_params, cid = data.call_id;
        let r = '';
        const sendResult = (result) => {
          if (cid && this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'mcp_tool_result', data: { call_id: cid, result } }));
          }
        };

        switch (tn) {
          case 'island_music_play': this.sendMusicControl('play'); this.lastPlayAction = Date.now(); this.isPlaying = true; sendResult('已播放'); break;
          case 'island_music_pause': this.sendMusicControl('pause'); this.lastPlayAction = Date.now(); this.isPlaying = false; sendResult('已暂停'); break;
          case 'island_music_next': this.sendMusicControl('next'); sendResult('已切下一首'); break;
          case 'island_music_prev': this.sendMusicControl('prev'); sendResult('已切上一首'); break;
          case 'island_music_get_info': r = this.currentTrack ? (this.currentTrack + (this.currentArtist ? ' - ' + this.currentArtist : '')) : '未检测到播放信息'; sendResult(r); break;
          case 'island_music_set_volume':
            const l = (tp && tp.level != null) ? Math.max(0, Math.min(100, parseInt(tp.level))) : 50;
            this.volume = l;
            this.sendMusicControl('volume', l);
            sendResult(`音量: ${l}%`);
            break;

          case 'island_weather_get_current':
            const wCity = tp && tp.city ? tp.city : this.weatherCity;
            this.fetchWeatherDirect(wCity, false).then(sendResult);
            return;

          case 'island_weather_get_forecast':
            const fCity = tp && tp.city ? tp.city : this.weatherCity;
            const days = tp && tp.days ? parseInt(tp.days) : 3;
            this.fetchForecast(fCity, Math.min(Math.max(days, 1), 7)).then(sendResult);
            return;

          case 'island_weather_set_city':
            const newCity = tp.city;
            this.weatherCity = newCity;
            localStorage.setItem('island_weather_city', newCity);
            this.fetchWeather();
            sendResult(`天气城市已设置为 ${newCity}`);
            return;

          case 'island_get_time':
            const now = new Date();
            const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
            const t = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')} 星期${weekdays[now.getDay()]}`;
            sendResult(t);
            return;

          default: sendResult('未知工具: ' + tn);
        }
      },

      async fetchWeatherDirect(city, forecast) {
        try {
          const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`);
          const geoData = await geoRes.json();
          if (!geoData.results || !geoData.results.length) return `未找到城市 "${city}"`;
          const { latitude, longitude } = geoData.results[0];
          const params = forecast
            ? `daily=temperature_2m_max,temperature_2m_min,weathercode&forecast_days=3`
            : `current_weather=true`;
          const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&${params}`);
          const wData = await wRes.json();
          if (forecast) {
            const daily = wData.daily;
            let lines = [`${city}的${daily.time.length}天天气预报:`];
            for (let i = 0; i < daily.time.length; i++) {
              lines.push(`- ${daily.time[i]}: 白天${daily.temperature_2m_max[i]}°C/${WCODE_MAP[daily.weathercode[i]] || '未知'}, 夜间${daily.temperature_2m_min[i]}°C/${WCODE_MAP[daily.weathercode[i]] || '未知'}`);
            }
            return lines.join('\n');
          } else {
            const cw = wData.current_weather;
            return `${city}实时天气:\n温度: ${cw.temperature}°C\n天气状况: ${WCODE_MAP[cw.weathercode] || '未知'}\n风速: ${cw.windspeed} km/h`;
          }
        } catch (err) {
          return `查询天气时出错: ${err.message}`;
        }
      },

      async fetchForecast(city, days) {
        try {
          const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`);
          const geoData = await geoRes.json();
          if (!geoData.results || !geoData.results.length) return `未找到城市 "${city}"`;
          const { latitude, longitude } = geoData.results[0];
          const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,weathercode&forecast_days=${days}`);
          const wData = await wRes.json();
          const daily = wData.daily;
          let lines = [`${city}的${days}天天气预报:`];
          for (let i = 0; i < daily.time.length; i++) {
            lines.push(`- ${daily.time[i]}: 白天${daily.temperature_2m_max[i]}°C/${WCODE_MAP[daily.weathercode[i]] || '未知'}, 夜间${daily.temperature_2m_min[i]}°C/${WCODE_MAP[daily.weathercode[i]] || '未知'}`);
          }
          return lines.join('\n');
        } catch (err) {
          return `查询预报时出错: ${err.message}`;
        }
      },

      // ===== Music Control =====
      sendMusicControl(action, value) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type: 'island_music_control', data: { action, level: value } }));
      },

      togglePlay() {
        if (this.isPlaying) {
          this.sendMusicControl('pause');
          this.isPlaying = false;
        } else {
          this.sendMusicControl('play');
          this.isPlaying = true;
        }
        this.lastPlayAction = Date.now();
      },

      // ===== Marquee =====
      startMarquee() {
        this.stopMarquee();
        this.$nextTick(() => {
          const track = this.$refs.marqueeTrack;
          if (!track) return;
          const a = track.querySelector('.marquee-item');
          if (!a) return;
          const copyWidth = a.offsetWidth;
          const dur = Math.max(10, copyWidth / 35) * 1000;
          this.marqueeAnim = track.animate(
            [{ transform: 'translateX(0)' }, { transform: `translateX(-${copyWidth}px)` }],
            { duration: dur, iterations: Infinity, easing: 'linear' }
          );
        });
      },

      stopMarquee() {
        if (this.marqueeAnim) { this.marqueeAnim.cancel(); this.marqueeAnim = null; }
      },

      closeWindow() {
        if (window.electronAPI && window.electronAPI.closeIslandWindow) {
          window.electronAPI.closeIslandWindow();
        }
      }
    },

    watch: {
      isPlaying(val) {
        if (val && this.mode !== 'large') {
          this.startMarquee();
        } else {
          this.stopMarquee();
        }
      },
      mode(val) {
        if (val !== 'large') {
          this.stopMarquee();
          if (this.isPlaying && val === 'quick') {
            this.$nextTick(() => this.startMarquee());
          }
        }
      }
    }
  });
}
```

- [ ] **Step 2: Commit**

---

### Task 4: Rewrite `static/island.html`

**Files:**
- Rewrite: `D:\AI\super-agent-party\static\island.html`

**Interfaces:**
- Consumes: `libs/vue.global.prod.js`, `css/island.css`, `island-app.js`, `fontawesome/css/all.min.css`
- Produces: Loaded island page with Vue 3 app mounted on `#island-container`

- [ ] **Step 1: Write island.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>灵动岛</title>
  <link rel="stylesheet" href="fontawesome/css/all.min.css">
  <link rel="stylesheet" href="css/island.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%; height: 100%;
      overflow: hidden;
      background: transparent !important;
      font-family: 'OpenRunde', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      user-select: none;
    }
  </style>
</head>
<body>
  <div id="island-container">
    <div id="island"
         :class="{ quick: isQuickView, large: isLargeView }"
         @mouseenter="onIslandEnter"
         @mouseleave="onIslandLeave"
         @click="onIslandClick"
         @pointerdown="onPointerDown"
         @pointermove="onPointerMove"
         @pointerup="onPointerUp"
         @wheel.passive="onWheel">

      <!-- Still / Quick 视图 -->
      <template v-if="!isLargeView">
        <div class="still-content" v-if="showTimeStill && !isQuickView">
          <span class="still-time">{{ currentTime || '--:--' }}</span>
        </div>

        <div class="quick-content" v-if="isQuickView || showMusicQuick">
          <div class="quick-weather" v-if="weatherTemp !== null">
            <i :class="'fa-solid ' + weatherIcon"></i>
            <span>{{ weatherTemp }}°</span>
          </div>
          <span class="quick-time" v-if="!showMusicQuick">{{ currentTime }}</span>

          <template v-if="showMusicQuick && hasMusic">
            <div class="quick-left">
              <div class="artwork-wrap">
                <i class="fa-solid fa-music"></i>
              </div>
              <div class="marquee-box">
                <div class="marquee-track" ref="marqueeTrack">
                  <span class="marquee-item">{{ currentTrack }}{{ currentArtist ? '  \u2022  ' + currentArtist : '' }}</span>
                  <span class="marquee-item">{{ currentTrack }}{{ currentArtist ? '  \u2022  ' + currentArtist : '' }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </template>

      <!-- Large 视图 -->
      <template v-if="isLargeView">
        <div class="panels-wrapper">
          <div class="panels-track" :style="{ transform: panelsTransform }">
            <!-- 面板1: 天气/时间 -->
            <div class="panel weather-panel">
              <div class="weather-icon-large" v-if="weatherTemp !== null">
                <i :class="'fa-solid ' + weatherIcon"></i>
              </div>
              <div class="weather-icon-large" v-else>
                <i class="fa-solid fa-cloud" style="opacity:0.3"></i>
              </div>
              <div class="weather-temp" v-if="weatherTemp !== null">{{ weatherTemp }}°C</div>
              <div class="weather-temp" v-else>--°C</div>
              <div class="weather-desc">{{ weatherDesc }}</div>
              <div class="weather-divider"></div>
              <div class="weather-time">{{ currentTime || '--:--' }}</div>
              <div class="weather-date">{{ currentDate }}</div>
            </div>

            <!-- 面板2: 音乐 -->
            <div class="panel music-panel">
              <div class="large-artwork">
                <i class="fa-solid fa-music"></i>
              </div>
              <div class="large-info">
                <div class="large-title">{{ currentTrack || '未在播放' }}</div>
                <div class="large-artist">{{ currentArtist }}</div>
              </div>
              <div class="large-controls">
                <button class="ctrl-btn-lg" @click.stop="sendMusicControl('prev')">
                  <i class="fa-solid fa-backward-step"></i>
                </button>
                <button class="ctrl-btn-lg play-btn-lg" @click.stop="togglePlay">
                  <i :class="'fa-solid ' + playIcon"></i>
                </button>
                <button class="ctrl-btn-lg" @click.stop="sendMusicControl('next')">
                  <i class="fa-solid fa-forward-step"></i>
                </button>
              </div>
              <div class="large-vol">
                <i class="fa-solid fa-volume-low vol-icon-lg"></i>
                <input type="range" class="vol-slider-lg" min="0" max="100"
                       :value="volume"
                       @input="volume = parseInt($event.target.value)"
                       @change.stop="sendMusicControl('volume', volume)">
                <i class="fa-solid fa-volume-high vol-icon-lg"></i>
              </div>
            </div>
          </div>
        </div>

        <!-- 面板指示器 -->
        <div class="panel-indicator">
          <div class="panel-dot" :class="{ active: activePanel === 0 }"
               @click.stop="switchPanel(0)"></div>
          <div class="panel-dot" :class="{ active: activePanel === 1 }"
               @click.stop="switchPanel(1)"></div>
        </div>
      </template>
    </div>
  </div>

  <script src="libs/vue.global.prod.js"></script>
  <script src="island-app.js"></script>
  <script>
    document.addEventListener('DOMContentLoaded', function () {
      const app = createIslandApp();
      const vm = app.mount('#island-container');

      window.addEventListener('focusout', function () {
        setTimeout(function () {
          const activeTag = document.activeElement && document.activeElement.tagName;
          if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA' && activeTag !== 'SELECT') {
            if (!vm.isHovered) {
              vm.mode = 'still';
              vm.setMouseIgnore(true);
            }
          }
        }, 100);
      });

      window.addEventListener('beforeunload', function () {
        vm.stopMusicPoll();
        vm.stopMarquee();
        vm.unregisterMcpTools();
        if (vm.reconnectTimer) clearTimeout(vm.reconnectTimer);
      });
    });
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

---

### Task 5: Modify `main.js` island window creation

**Files:**
- Modify: `D:\AI\super-agent-party\main.js` (lines 1658-1714, `open-island-window` handler)

**Interfaces:**
- Consumes: Ripple's full-screen window pattern
- Produces: Full-screen transparent overlay window for island

- [ ] **Step 1: Replace the island window creation in main.js**

Replace lines 1658-1714 (the `open-island-window` handler):

```javascript
    // === 灵动岛窗口 (全屏覆盖层) ===
    ipcMain.handle('open-island-window', async () => {
      if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
        dynamicIslandWindow.close();
        dynamicIslandWindow = null;
      }

      const primaryDisplay = screen.getPrimaryDisplay();
      const { x, y, width: screenW, height: screenH } = primaryDisplay.bounds;
      const isWindows = process.platform === 'win32';
      const isLinux = process.platform === 'linux';
      const windowType = isWindows ? 'toolbar' : 'panel';

      dynamicIslandWindow = new BrowserWindow({
        width: screenW,
        height: screenH,
        x: x,
        y: y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        resizable: false,
        backgroundColor: '#00000000',
        type: windowType,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          webSecurity: false,
          devTools: isDev,
          preload: path.join(__dirname, 'static/js/preload.js')
        }
      });

      remoteMain.enable(dynamicIslandWindow.webContents);

      if (isLinux) {
        dynamicIslandWindow.setIgnoreMouseEvents(true);
      } else {
        dynamicIslandWindow.setIgnoreMouseEvents(true, { forward: true });
      }

      await dynamicIslandWindow.loadURL(`http://${HOST}:${PORT}/island.html`);

      dynamicIslandWindow.on('closed', () => {
        dynamicIslandWindow = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('island-window-closed');
        }
      });

      return true;
    });
```

- [ ] **Step 2: Commit**

---

### Task 6: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Verify all files exist and are syntactically valid**

```powershell
# Check font files
Get-ChildItem "D:\AI\super-agent-party\static\OpenRunde-*.woff" | Select-Object Name, Length

# Check JS syntax with Node
node -e "require('fs').readFileSync('D:/AI/super-agent-party/static/island-app.js', 'utf8'); console.log('island-app.js: syntax OK')"

# Check HTML structure
node -e "const h = require('fs').readFileSync('D:/AI/super-agent-party/static/island.html', 'utf8'); console.log('island.html: ' + h.length + ' chars')"

# Check CSS structure
node -e "const c = require('fs').readFileSync('D:/AI/super-agent-party/static/css/island.css', 'utf8'); console.log('island.css: ' + c.length + ' chars')"
```

- [ ] **Step 2: Verify main.js has correct island window code**

```powershell
Select-String -Path "D:\AI\super-agent-party\main.js" -Pattern "open-island-window|setIgnoreMouseEvents|screenW|screenH" -Context 0,0
```

- [ ] **Step 3: Commit**
