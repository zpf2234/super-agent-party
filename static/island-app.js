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

function createIslandApp() {
  return Vue.createApp({
    data() {
      return {
        mode: 'still',           // still | quick | large
        activePanel: 0,          // 0=weather, 1=music
        isHovered: false,
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
      panelsTransform() {
        const base = -(this.activePanel * 50);
        const offset = this.isDragging ? (this.dragOffset / (this._panelWidth || 420) * 100) : 0;
        return `translateX(${base + offset}%)`;
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
        this.currentDate = `${n.getMonth() + 1}月${n.getDate()}日 周${WEEKDAYS[n.getDay()]}`;
      },

      // ===== Mouse Events =====
      onIslandEnter() {
        this.isHovered = true;
        this.setMouseIgnore(false);
        if (this.mode === 'large') return;
        this.mode = 'quick';
      },

      onIslandLeave() {
        this.isHovered = false;
        if (this.mode === 'large') return;
        this.mode = 'still';
        this.setMouseIgnore(true);
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
        this.dragOffset = 0;
        this.isDragging = true;
        this.suppressClick = false;
        this._panelWidth = this.$refs.panelsTrack ? this.$refs.panelsTrack.offsetWidth / 2 : 420;
        // Remove transition during drag for instant response
        if (this.$refs.panelsTrack) {
          this.$refs.panelsTrack.style.transition = 'none';
        }
      },

      onPointerMove(e) {
        if (this.mode !== 'large') return;
        if (!this.isDragging) return;
        const dx = e.clientX - this.swipeStartX;
        const dy = e.clientY - this.swipeStartY;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          this.swipeMoved = true;
        }
        if (this.swipeMoved) {
          this.dragOffset = dx;
          if (e.target.setPointerCapture) {
            e.target.setPointerCapture(e.pointerId);
          }
        }
      },

      onPointerUp(e) {
        if (this.mode !== 'large') return;
        this.isDragging = false;
        const dx = e.clientX - this.swipeStartX;
        // Restore transition for snap animation
        if (this.$refs.panelsTrack) {
          this.$refs.panelsTrack.style.transition = '';
        }
        if (this.swipeMoved && Math.abs(dx) > Math.abs(e.clientY - this.swipeStartY)) {
          if (Math.abs(dx) >= 40) {
            const dir = dx < 0 ? 1 : -1;
            const newPanel = this.activePanel + dir;
            if (newPanel >= 0 && newPanel <= 1) {
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
        if (next < 0 || next > 1) return;
        this.activePanel = next;
      },

      switchPanel(idx) {
        if (idx < 0 || idx > 1) return;
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
            const t = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')} 星期${WEEKDAYS[now.getDay()]}`;
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
