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

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function fmtLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayLocalStr() {
  return fmtLocalDate(new Date());
}

function createIslandApp() {
  return Vue.createApp({
    data() {
      return {
        mode: 'still',           // still | quick | large
        activePanel: 0,          // 0=weather, 1=music, 2=tasks, 3=calendar
        isHovered: false,
        // Music state
        isPlaying: false,
        hasMusic: false,
        currentTrack: '',
        currentArtist: '',
        currentSourceApp: '',
        lastPlayAction: 0,
        musicMissCount: 0,
        volume: 50,
        marqueeAnim: null,

        // Album 3D tilt
        albumRotation: { x: 0, y: 0 },
        albumHovered: false,

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

        // Alert state (for task due / AI reply notifications)
        alertActive: false,
        alertText: '',
        alertIcon: 'fa-bell',
        alertDismissible: true,
        alertTimer: null,
        // Persistent task reminder state
        activeReminderTask: null,

        // Tasks state
        tasks: [],
        newTaskText: '',
        showCompleted: false,
        // Calendar state
        calendarSelectedDate: '',
        showMonthPicker: false,
        calendarMonthOffset: 0,
        calendarNewTaskText: '',
        calendarNewTaskHour: '09',
        calendarNewTaskMinute: '00',
        calendarNewTaskAllDay: false,
        swipeStartX: 0,
        swipeStartY: 0,
        swipeMoved: false,
        dragOffset: 0,
        isDragging: false,
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
      },
      pendingTaskCount() {
        return this.tasks.filter(t => !t.done).length;
      },
      completedCount() {
        return this.tasks.filter(t => t.done).length;
      },
      sortedTasks() {
        const active = this.tasks.filter(t => !t.done);
        const completed = this.tasks.filter(t => t.done);
        return this.showCompleted ? [...active, ...completed] : active;
      },
      // Reactive panel transforms — triggers Vue re-render on dragOffset change
      panelStyles() {
        const dragPct = this.isDragging ? (this.dragOffset / (this._panelWidth || 420) * 100) : 0;
        const maxBlur = 10;
        return {
          p0: (() => {
            const x = (0 - this.activePanel) * 100 + dragPct;
            const dist = Math.abs(x) / 100;
            return { transform: `translateX(${x}%)`, filter: `blur(${dist * maxBlur}px)`, opacity: 1 - dist * 0.5 };
          })(),
          p1: (() => {
            const x = (1 - this.activePanel) * 100 + dragPct;
            const dist = Math.abs(x) / 100;
            return { transform: `translateX(${x}%)`, filter: `blur(${dist * maxBlur}px)`, opacity: 1 - dist * 0.5 };
          })(),
          p2: (() => {
            const x = (2 - this.activePanel) * 100 + dragPct;
            const dist = Math.abs(x) / 100;
            return { transform: `translateX(${x}%)`, filter: `blur(${dist * maxBlur}px)`, opacity: 1 - dist * 0.5 };
          })(),
          p3: (() => {
            const x = (3 - this.activePanel) * 100 + dragPct;
            const dist = Math.abs(x) / 100;
            return { transform: `translateX(${x}%)`, filter: `blur(${dist * maxBlur}px)`, opacity: 1 - dist * 0.5 };
          })()
        };
      },
      albumStyle() {
        return {
          transform: `rotateX(${this.albumRotation.x}deg) rotateY(${this.albumRotation.y}deg) scale(${this.albumHovered ? 1.25 : 1})`,
          transformStyle: 'preserve-3d',
          transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.3s ease-out',
          filter: this.albumHovered ? 'brightness(1.1)' : 'none'
        };
      },
      // Calendar computed
      weekDayLabels() {
        return ['一', '二', '三', '四', '五', '六', '日'];
      },
      weekRange() {
        const d = new Date(this.calendarSelectedDate + 'T00:00:00');
        const day = d.getDay() || 7;
        const monday = new Date(d);
        monday.setDate(d.getDate() - day + 1);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return `${monday.getMonth()+1}月${monday.getDate()}日 - ${sunday.getMonth()+1}月${sunday.getDate()}日`;
      },
      weekDates() {
        const d = new Date(this.calendarSelectedDate + 'T00:00:00');
        const day = d.getDay() || 7;
        const monday = new Date(d);
        monday.setDate(d.getDate() - day + 1);
        const days = [];
        for (let i = 0; i < 7; i++) {
          const dt = new Date(monday);
          dt.setDate(monday.getDate() + i);
          const ds = fmtLocalDate(dt);
          const today = todayLocalStr();
          days.push({
            date: ds,
            day: dt.getDate(),
            isToday: ds === today,
            hasTask: this.tasks.some(t => !t.done && t.due_time && t.due_time.slice(0, 10) === ds)
          });
        }
        return days;
      },
      selectedDateLabel() {
        const d = new Date(this.calendarSelectedDate + 'T00:00:00');
        return `${d.getMonth()+1}月${d.getDate()}日 周${this.weekDayLabels[d.getDay() === 0 ? 6 : d.getDay() - 1]}`;
      },
      dayTasks() {
        return this.tasks
          .filter(t => t.due_time && t.due_time.slice(0, 10) === this.calendarSelectedDate)
          .sort((a, b) => {
            if (a.all_day && !b.all_day) return -1;
            if (!a.all_day && b.all_day) return 1;
            if (a.all_day && b.all_day) return 0;
            return (a.due_time || '').localeCompare(b.due_time || '');
          });
      },
      showReminderInQuick() {
        return this.activeReminderTask !== null && this.mode !== 'large';
      },
      monthPickerLabel() {
        const now = new Date();
        const m = new Date(now.getFullYear(), now.getMonth() + this.calendarMonthOffset, 1);
        return `${m.getFullYear()}年${m.getMonth()+1}月`;
      },
      monthCalendarDays() {
        const now = new Date();
        const m = new Date(now.getFullYear(), now.getMonth() + this.calendarMonthOffset, 1);
        const year = m.getFullYear();
        const month = m.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDow = firstDay.getDay() || 7;
        const today = todayLocalStr();
        const days = [];
        for (let i = 1; i < startDow; i++) {
          const pd = new Date(year, month, 1 - (startDow - i));
          const ds = fmtLocalDate(pd);
          days.push({ date: ds, day: pd.getDate(), otherMonth: true, isToday: ds === today, hasTask: false });
        }
        for (let d = 1; d <= lastDay.getDate(); d++) {
          const ds = fmtLocalDate(new Date(year, month, d));
          days.push({
            date: ds, day: d, otherMonth: false, isToday: ds === today,
            hasTask: this.tasks.some(t => !t.done && t.due_time && t.due_time.slice(0, 10) === ds)
          });
        }
        return days;
      },
    },

    created() {
      this.weatherCity = localStorage.getItem('island_weather_city') || '北京';
      this.loadTasks();
      const today = new Date();
      this.calendarSelectedDate = fmtLocalDate(today);
      this.activeReminderTask = null;
    },

    mounted() {
      this.connectWS();
      this.updateTime();
      this.timeTimer = setInterval(this.updateTime, 30000);

      // Mouse leave on whole container for focus-out collapse
      const container = this.$el;
      container.addEventListener('mouseleave', this.onContainerLeave);

      // Document-level: clicks outside the island collapse large mode
      document.addEventListener('mousedown', this.onDocMouseDown);

      // Start weather polling
      this.fetchWeather();
      this.weatherTimer = setInterval(this.fetchWeather, 600000);

      // Start task reminder checker
      this.taskReminderTimer = setInterval(this.checkTaskReminders, 30000);
      this.checkTaskReminders();
    },

    beforeUnmount() {
      document.removeEventListener('mousedown', this.onDocMouseDown);
      this.stopMusicPoll();
      this.stopMarquee();
      this.unregisterMcpTools();
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      if (this.timeTimer) clearInterval(this.timeTimer);
      if (this.weatherTimer) clearInterval(this.weatherTimer);
      if (this.taskReminderTimer) clearInterval(this.taskReminderTimer);
    },

    methods: {
      // ===== Time =====
      updateTime() {
        const n = new Date();
        this.currentTime = n.getHours() + ':' + String(n.getMinutes()).padStart(2, '0');
        this.currentDate = `${n.getMonth() + 1}月${n.getDate()}日 周${WEEKDAYS[n.getDay()]}`;
      },

      // ===== Mouse Events =====
      onIslandEnter() {
        this.isHovered = true;
        this.setMouseIgnore(false);
        if (this.mode === 'large') return;
        if (this.activeReminderTask) return;
        this.mode = 'quick';
      },

      onIslandLeave() {
        this.isHovered = false;
        if (this.mode === 'large') return;
        if (this.activeReminderTask) return;
        this.mode = 'still';
        this.setMouseIgnore(true);
      },

      onIslandClick(e) {
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
        if (this.suppressClick) { this.suppressClick = false; return; }
        if (this.mode !== 'large') {
          this.mode = 'large';
          if (this.activeReminderTask) {
            this.activePanel = 3;
          }
          this.setMouseIgnore(false);
        }
      },

      onDocMouseDown(e) {
        if (this.mode === 'large') {
          const island = this.$refs.island;
          if (island && !island.contains(e.target)) {
            this.mode = 'still';
            this.showMonthPicker = false;
            this.setMouseIgnore(true);
          }
        }
      },

      onContainerLeave() {
        if (this.mode !== 'large' && this.isHovered) {
          this.mode = 'still';
          this.isHovered = false;
        }
      },

      onContainerMouseDown(e) {
        if (this.mode === 'large' && e.target === e.currentTarget) {
          this.mode = 'still';
          this.showMonthPicker = false;
          this.setMouseIgnore(true);
        }
      },

      // ===== Album 3D Tilt =====
      onAlbumMouseMove(e) {
        const rect = e.currentTarget.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const deltaX = e.clientX - centerX;
        const deltaY = e.clientY - centerY;
        const maxDistance = Math.sqrt(rect.width * rect.width + rect.height * rect.height) / 2;
        this.albumRotation.x = (deltaY / maxDistance) * 35;
        this.albumRotation.y = (deltaX / maxDistance) * -35;
      },
      onAlbumMouseLeave() {
        this.albumRotation = { x: 0, y: 0 };
        this.albumHovered = false;
      },

      setMouseIgnore(ignore) {
        if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
          window.electronAPI.setIgnoreMouseEvents(ignore, { forward: true });
        }
      },

      // ===== Swipe =====
      onPointerDown(e) {
        if (this.mode !== 'large') return;
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.cal-day-cell') || e.target.closest('.cal-month-cell') || e.target.closest('.cal-add-all-day')) return;
        this.swipeStartX = e.clientX;
        this.swipeStartY = e.clientY;
        this.swipeMoved = false;
        this.dragOffset = 0;
        this.isDragging = true;
        this.suppressClick = false;
        this._panelWidth = this.$refs.island ? this.$refs.island.offsetWidth : 420;
        // Remove transition on all panels during drag for instant response
        const wrapper = this.$refs.panelsWrapper;
        if (wrapper) {
          wrapper.querySelectorAll('.panel').forEach(p => { p.style.transition = 'none'; });
        }
        const captureEl = this.$refs.island || e.target;
        if (captureEl.setPointerCapture) {
          captureEl.setPointerCapture(e.pointerId);
        }
      },

      onPointerMove(e) {
        if (this.mode !== 'large') return;
        if (!this.isDragging) return;
        const dx = e.clientX - this.swipeStartX;
        const dy = e.clientY - this.swipeStartY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          this.swipeMoved = true;
        }
        this.dragOffset = dx;
      },

      onPointerUp(e) {
        if (!this.isDragging) return;
        this.isDragging = false;
        if (e.target.releasePointerCapture && e.pointerId != null) {
          e.target.releasePointerCapture(e.pointerId);
        }
        const dx = e.clientX - this.swipeStartX;
        const wrapper = this.$refs.panelsWrapper;
        if (wrapper) {
          wrapper.querySelectorAll('.panel').forEach(p => { p.style.transition = ''; });
        }
        if (this.swipeMoved && Math.abs(dx) > Math.abs(e.clientY - this.swipeStartY)) {
          if (Math.abs(dx) >= 40) {
            const dir = dx < 0 ? 1 : -1;
            const newPanel = this.activePanel + dir;
            if (newPanel >= 0 && newPanel <= 3) {
              this.activePanel = newPanel;
            }
            this.suppressClick = true;
          }
        }
        this.dragOffset = 0;
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
        const next = this.activePanel + dir;
        if (next < 0 || next > 3) return;
        this.activePanel = next;
      },

      switchPanel(idx) {
        if (idx < 0 || idx > 3) return;
        this.activePanel = idx;
      },

      // ===== Calendar =====
      selectDate(dateStr) {
        this.calendarSelectedDate = dateStr;
      },
      prevWeek() {
        const d = new Date(this.calendarSelectedDate + 'T00:00:00');
        d.setDate(d.getDate() - 7);
        this.calendarSelectedDate = fmtLocalDate(d);
      },
      nextWeek() {
        const d = new Date(this.calendarSelectedDate + 'T00:00:00');
        d.setDate(d.getDate() + 7);
        this.calendarSelectedDate = fmtLocalDate(d);
      },
      toggleMonthPicker() {
        this.showMonthPicker = !this.showMonthPicker;
      },
      prevMonth() {
        this.calendarMonthOffset--;
      },
      nextMonth() {
        this.calendarMonthOffset++;
      },
      jumpToDateFromMonth(dateStr) {
        this.calendarSelectedDate = dateStr;
        this.showMonthPicker = false;
        this.calendarMonthOffset = 0;
      },
      addCalendarTask() {
        const text = this.calendarNewTaskText.trim();
        if (!text) return;
        let dueTime;
        if (this.calendarNewTaskAllDay) {
          dueTime = this.calendarSelectedDate + 'T00:00:00';
        } else {
          dueTime = this.calendarSelectedDate + 'T' + this.calendarNewTaskHour + ':' + this.calendarNewTaskMinute + ':00';
        }
        this.addTask(text, dueTime, null, this.calendarNewTaskAllDay, 'user');
        this.calendarNewTaskText = '';
        this.calendarNewTaskHour = '09';
        this.calendarNewTaskMinute = '00';
        this.calendarNewTaskAllDay = false;
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
            if (d.type === 'island_ai_reply_done') this.showAlert({ icon: 'fa-comment-dots', text: d.data?.text || 'AI 已回复', dismissible: true, duration: 5000 });
            if (d.type === 'island_notification') this.showAlert({ icon: d.data?.icon || 'fa-bell', text: d.data?.text || '', dismissible: true, duration: 5000 });
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
          { name: 'island_get_time', description: '获取当前日期和时间信息', parameters: { type: 'object', properties: {}, required: [] } },
          { name: 'island_task_create', description: '在灵动岛上创建一条待办事项，可关联到日历', parameters: { type: 'object', properties: { text: { type: 'string', description: '待办内容' }, due_time: { type: 'string', description: '开始时间 ISO 格式, 可选' }, end_time: { type: 'string', description: '结束/过期时间 ISO 格式, 可选, 默认 due_time+1h' }, all_day: { type: 'boolean', description: '是否全天事件, 可选' } }, required: ['text'] } },
          { name: 'island_task_list', description: '列出灵动岛上所有待办事项', parameters: { type: 'object', properties: {}, required: [] } },
          { name: 'island_task_complete', description: '按文本匹配并标记完成灵动岛上的一条待办事项', parameters: { type: 'object', properties: { text: { type: 'string', description: '待办内容关键词（模糊匹配）' } }, required: ['text'] } },
          { name: 'island_task_delete', description: '按文本匹配并删除灵动岛上的一条待办事项', parameters: { type: 'object', properties: { text: { type: 'string', description: '待办内容关键词（模糊匹配）' } }, required: ['text'] } },
          { name: 'island_calendar_list', description: '列出指定日期的所有待办事项', parameters: { type: 'object', properties: { date: { type: 'string', description: '日期, YYYY-MM-DD 格式, 默认今天' } }, required: [] } },
          { name: 'island_calendar_month', description: '列出指定月份每天的任务数量', parameters: { type: 'object', properties: { year: { type: 'integer', description: '年份, 如 2025' }, month: { type: 'integer', description: '月份 1-12' } }, required: ['year', 'month'] } }
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
          this.musicMissCount = 0;
          const t = data.track.replace(/^["\s]+|["\s]+$/g, '');
          const a = (data.artist || '').replace(/^["\s]+|["\s]+$/g, '');
          if (!this.hasMusic || t !== this.currentTrack || a !== this.currentArtist) {
            this.currentTrack = t;
            this.currentArtist = a;
          }
          this.currentSourceApp = data.sourceAppId || '';
          this.hasMusic = true;
          if (Date.now() - this.lastPlayAction > 2000) {
            this.isPlaying = data.isPlaying === true;
          }
          if (this.isPlaying && this.mode !== 'large') this.startMarquee();
        } else {
          this.musicMissCount++;
          if (this.musicMissCount >= 3) {
            if (this.hasMusic) {
              this.hasMusic = false;
              this.currentTrack = '';
              this.currentArtist = '';
              this.currentSourceApp = '';
              this.isPlaying = false;
              this.stopMarquee();
            }
            this.musicMissCount = 0;
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
          case 'island_music_next': this.sendMusicControl('next'); sendResult('已切下一首'); setTimeout(() => this.requestMusicState(), 400); setTimeout(() => this.requestMusicState(), 1200); break;
          case 'island_music_prev': this.sendMusicControl('prev'); sendResult('已切上一首'); setTimeout(() => this.requestMusicState(), 400); setTimeout(() => this.requestMusicState(), 1200); break;
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
            const t = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')} 星期${WEEKDAYS[now.getDay()]}`;
            sendResult(t);
            return;

          case 'island_task_create':
            this.addTask(tp.text, tp.due_time, tp.end_time, tp.all_day, 'ai');
            sendResult('已创建待办: ' + tp.text);
            return;
          case 'island_task_list':
            if (!this.tasks.length) { sendResult('暂无待办事项'); return; }
            r = this.tasks.map(t => (t.done ? '✅' : '⬜') + ' ' + t.text + (t.due_time ? ' (到期: ' + this.formatTaskTime(t.due_time) + ')' : '')).join('\n');
            sendResult(r);
            return;
          case 'island_task_complete':
            const ctask = this.tasks.find(t => t.text.includes(tp.text));
            if (!ctask) { sendResult('未找到匹配的待办: ' + tp.text); return; }
            ctask.done = !ctask.done;
            this.saveTasks();
            sendResult((ctask.done ? '已完成' : '已恢复') + ': ' + ctask.text);
            return;
          case 'island_task_delete':
            const didx = this.tasks.findIndex(t => t.text.includes(tp.text));
            if (didx === -1) { sendResult('未找到匹配的待办: ' + tp.text); return; }
            const dtxt = this.tasks[didx].text;
            this.tasks.splice(didx, 1);
            this.saveTasks();
            sendResult('已删除: ' + dtxt);
            return;
          case 'island_calendar_list':
            const listDate = (tp && tp.date) ? tp.date : todayLocalStr();
            const dayItems = this.tasks.filter(t => t.due_time && t.due_time.slice(0, 10) === listDate);
            if (!dayItems.length) { sendResult(`${listDate} 暂无待办事项`); return; }
            r = dayItems.map(t => (t.done ? '✅' : '⬜') + ' ' + t.text + (t.all_day ? ' (全天)' : '') + (!t.all_day && t.due_time ? ' ' + this.formatTaskTime(t.due_time) : '')).join('\n');
            sendResult(`${listDate} 的待办:\n` + r);
            return;
          case 'island_calendar_month':
            const y = tp.year, m = tp.month;
            const daysInMonth = new Date(y, m, 0).getDate();
            const counts = [];
            for (let d = 1; d <= daysInMonth; d++) {
              const ds = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
              const n = this.tasks.filter(t => t.due_time && t.due_time.slice(0, 10) === ds).length;
              if (n > 0) counts.push(`${ds}: ${n}个待办`);
            }
            sendResult(counts.length ? `${y}年${m}月: ` + counts.join('; ') : `${y}年${m}月暂无待办`);
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
          const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
          const wData = await wRes.json();
          const cw = wData.current_weather;
          return `${city}实时天气:\n温度: ${cw.temperature}°C\n天气状况: ${WCODE_MAP[cw.weathercode] || '未知'}\n风速: ${cw.windspeed} km/h`;
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

      skipTrack(dir) {
        this.sendMusicControl(dir > 0 ? 'next' : 'prev');
        setTimeout(() => this.requestMusicState(), 400);
        setTimeout(() => this.requestMusicState(), 1200);
      },

      // ===== Marquee =====
      // 用单段文字 + 复制的方式做无缝循环。关键点：
      //   1. 两个 item 之间的间距应该等于容器宽度 (boxWidth)，这样一次只看到一段歌词，
      //      第二段从右边出来时第一段已经从左边消失，避免视觉重叠。
      //   2. 动画位移 = itemWidth + spacing，end-start 完全等于循环周期，无缝衔接。
      //   3. 每秒检测一次动画是否还在跑 (playState === 'running')，跑马灯卡住就重启。
      startMarquee() {
        const text = this.currentTrack + (this.currentArtist ? '  \u2022  ' + this.currentArtist : '');
        const changed = this._marqueeText !== text;
        this._marqueeText = text;
        if (!changed && this.marqueeAnim && this.marqueeAnim.playState === 'running') return;
        this.stopMarquee();
        if (!text) return;
        // 等待 DOM 渲染完成 (v-if 切换 / 文本变化)
        this.$nextTick(() => this._buildMarquee());
      },

      _buildMarquee() {
        const track = this.$refs.marqueeTrack;
        if (!track) return;
        const items = track.querySelectorAll('.marquee-item');
        if (items.length < 2) return;
        const a = items[0];
        const b = items[1];
        const box = track.parentElement;
        if (!box) return;
        const itemWidth = a.offsetWidth;
        const boxWidth = box.offsetWidth;
        if (!itemWidth || !boxWidth) return;
        // 间距略小于容器宽度，保证一次只显示一段但留出微小余量
        const spacing = Math.max(boxWidth - 8, itemWidth);
        // 通过 margin 而非 CSS gap 控制间距，避免和 JS 计算冲突
        a.style.marginRight = spacing + 'px';
        b.style.marginRight = spacing + 'px';
        const itemStep = itemWidth + spacing;
        // 速度：每秒约 35 像素
        const dur = Math.max(8000, (itemStep / 35) * 1000);
        this.marqueeAnim = track.animate(
          [
            { transform: 'translateX(0)' },
            { transform: `translateX(-${itemStep}px)` }
          ],
          { duration: dur, iterations: Infinity, easing: 'linear' }
        );
        // 兜底：检测卡死 (浏览器在最小化/切换 tab 时会暂停动画，恢复后可能不自动 play)
        if (this.marqueeTimer) clearInterval(this.marqueeTimer);
        this.marqueeTimer = setInterval(() => {
          if (!this.isPlaying || this.mode === 'large') return;
          if (!this.marqueeAnim) {
            this._buildMarquee();
          } else if (this.marqueeAnim.playState !== 'running') {
            this.marqueeAnim.play();
          }
        }, 1000);
      },

      stopMarquee() {
        if (this.marqueeAnim) { this.marqueeAnim.cancel(); this.marqueeAnim = null; }
        if (this.marqueeTimer) { clearInterval(this.marqueeTimer); this.marqueeTimer = null; }
      },

      closeWindow() {
        if (window.electronAPI && window.electronAPI.closeIslandWindow) {
          window.electronAPI.closeIslandWindow();
        }
      },

      // ===== Alert =====
      showAlert({ icon = 'fa-bell', text = '', dismissible = true, duration = 5000 }) {
        this.alertIcon = icon;
        this.alertText = text;
        this.alertDismissible = dismissible;
        this.alertActive = true;
        if (this.alertTimer) clearTimeout(this.alertTimer);
        if (duration > 0) this.alertTimer = setTimeout(() => this.dismissAlert(), duration);
      },
      dismissAlert() {
        this.alertActive = false;
        if (this.alertTimer) { clearTimeout(this.alertTimer); this.alertTimer = null; }
      },
      completeReminderTask() {
        if (!this.activeReminderTask) return;
        const task = this.tasks.find(t => t.id === this.activeReminderTask.id);
        if (task) { task.done = true; this.saveTasks(); }
        this.activeReminderTask = null;
        this.setMouseIgnore(true);
      },
      dismissReminderNote() {
        this.activeReminderTask = null;
        this.setMouseIgnore(true);
      },

      // ===== Tasks =====
      loadTasks() {
        try { this.tasks = JSON.parse(localStorage.getItem('island_tasks') || '[]'); } catch (e) { this.tasks = []; }
      },
      saveTasks() {
        localStorage.setItem('island_tasks', JSON.stringify(this.tasks));
      },
      addTask(text, dueTime, endTime, allDay, source) {
        if (typeof text !== 'string') text = this.newTaskText;
        const t = (text || '').trim();
        if (!t) return;
        const dTime = dueTime || null;
        const eTime = endTime || null;
        const endVal = eTime || (dTime ? new Date(new Date(dTime).getTime() + 3600000).toISOString() : null);
        this.tasks.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          text: t,
          done: false,
          due_time: dTime,
          end_time: endVal,
          all_day: allDay || false,
          source: source || 'user',
          notified: false,
          created_at: Date.now()
        });
        this.newTaskText = '';
        this.saveTasks();
      },
      toggleTask(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
          task.done = !task.done;
          this.saveTasks();
          if (task.done && this.activeReminderTask && this.activeReminderTask.id === id) {
            this.dismissReminderNote();
          }
        }
      },
      deleteTask(id) {
        if (this.activeReminderTask && this.activeReminderTask.id === id) {
          this.dismissReminderNote();
        }
        this.tasks = this.tasks.filter(t => t.id !== id);
        this.saveTasks();
      },
      formatTaskTime(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) {
          const m = /(\d{1,2}):(\d{2})/.exec(isoStr);
          if (m) return m[1] + ':' + m[2];
          return isoStr;
        }
        return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      },
      checkTaskReminders() {
        const now = Date.now();
        let triggered = false;
        for (const task of this.tasks) {
          if (task.done || task.notified || !task.due_time) continue;
          const due = new Date(task.due_time).getTime();
          if (isNaN(due)) continue;
          const endTime = task.end_time ? new Date(task.end_time).getTime() : due + 3600000;
          if (now < due) continue;
          if (now >= endTime) {
            task.notified = true;
            if (this.activeReminderTask && this.activeReminderTask.id === task.id) {
              this.activeReminderTask = null;
            }
            continue;
          }
          task.notified = true;
          triggered = true;
          this.activeReminderTask = task;
          if (this.mode === 'still') {
            this.setMouseIgnore(false);
          }
        }
        if (triggered) this.saveTasks();
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
      mode(val, oldVal) {
        if (val === 'large') {
          this.stopMarquee();
        } else {
          if (oldVal === 'large') {
            // Only full restart when exiting large mode
            this.stopMarquee();
            if (this.isPlaying) {
              this.$nextTick(() => this.startMarquee());
            }
          } else if (!this.marqueeAnim && this.isPlaying) {
            // Marquee not running — start it (still↔quick doesn't restart)
            this.startMarquee();
          }
        }
      }
    }
  });
}
