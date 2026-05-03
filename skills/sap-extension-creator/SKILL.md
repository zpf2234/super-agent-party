---
name: sap-extension-creator
description: Create Super Agent Party (SAP) extensions. This skill should be used when users want to create, build, or scaffold a new extension for Super Agent Party - including static HTML extensions (pure frontend) and Node.js backend extensions. Triggers on requests like "create a new SAP extension", "build an extension for Super Agent Party", "scaffold a plugin", "make a chat UI extension", or when working with sap extension projects.
---

# SAP Extension Creator

## Overview

Create Super Agent Party extensions—self-contained packages that extend the platform with custom chat UI and tools. Two modes are supported:

- **Static extension**: Pure HTML/CSS/JS frontend, no backend
- **Node.js extension**: Full-stack with Express backend, auto-managed by SAP

## Quick Decision Tree

```
User wants to create an extension?
├─ Only needs UI (chat, display, simple interactions)? → Static Extension
├─ Needs backend logic (API calls, DB, file processing)? → Node.js Extension
└─ Needs to register custom tools for AI agent? → Node.js Extension (with MCP)
```

## Core Files Every Extension Needs

| File | Required | Purpose |
|------|----------|---------|
| `package.json` | ✅ | Metadata, dependencies, tool declarations |
| `index.html` | ✅ | Main UI (full HTML page) |
| `index.js` | Node only | Node.js entry point |
| `node_modules/` | Node only | Auto-installed by SAP via `npm install` |

## Workflow

### Step 1: Gather Requirements

Ask the user:

1. **Extension name?** (hyphen-case, e.g., `my-weather-widget`)
2. **Description?** (one sentence)
3. **Static or Node.js?**
4. **For Node.js: what npm dependencies?**
5. **Should it register custom tools for the AI?** (e.g., close_extension, fetch_data, etc.)
6. **GitHub repository URL?** (optional, for updates)
7. **Transparent window?** (frameless, always-on-top — for mini widgets like music controllers)
8. **Default window size?** (width/height in pixels)

### Step 2: Scaffold the Extension

Use the templates in `assets/` as starting points:

- **Static**: Copy `assets/static-template/`
- **Node.js**: Copy `assets/node-template/`

Create the extension directory under the workspace (user will later install it into SAP's `extensions/` folder).

### Step 3: Write package.json

See `references/package-json-spec.md` for the complete field reference. Minimum:

```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "description": "What it does",
  "author": "your-name",
  "repository": "https://github.com/user/repo",
  "backupRepository": "https://gitee.com/user/repo",
  "category": "Tools"
}
```

For Node.js extensions, also include:
```json
{
  "main": "index.js",
  "nodePort": 0,
  "dependencies": { "express": "^5.1.0" }
}
```

For transparent/frameless widgets (e.g., mini music controllers, floating panels):
```json
{
  "transparent": true,
  "width": 280,
  "height": 80
}
```

When `transparent: true`, SAP creates a frameless, transparent, always-on-top window (see main.js `open-extension-window` handler). Use this for compact overlay widgets.

### Step 4: Write index.html

The HTML page is rendered inside the SAP window (directly or in an iframe). Key patterns:

- **Dark theme**: Use CSS variables matching SAP's dark theme (see template)
- **WebSocket connection**: Connect to `ws://host/ws` for messaging
- **Get extension ID**: Parse `window.location.pathname` for `/extensions/{ext_id}/`
- **Message rendering**: Listen for `messages_update` and `broadcast_messages` events
- **Send user input**: Send `set_user_input` then `trigger_send_message`

### Step 5: Write index.js (Node.js only)

See `references/node-entry-spec.md` for the full protocol. The entry point:

1. Receives a port number via `process.argv[2]`
2. Starts an Express server on that port at `127.0.0.1`
3. Serves static files from its own directory
4. Exposes a `/health` endpoint for readiness checks
5. SAP reverse-proxies requests to the extension

### Step 6: Implement Tool Registration (optional, Node.js only)

Extensions can register tools that the AI agent can call. Register via WebSocket:

```js
ws.send(JSON.stringify({
    type: 'register_node_extension_mcp',
    data: {
        ext_id: extId,
        tools: [{
            name: `${extId}_my_tool`,
            description: 'What this tool does',
            parameters: {
                type: 'object',
                properties: {
                    param1: { type: 'string', description: '...' }
                },
                required: ['param1']
            }
        }]
    }
}));
```

Handle incoming tool calls:
```js
if (d.type === 'call_mcp_tool') {
    // Execute tool, then:
    ws.send(JSON.stringify({
        type: 'mcp_tool_result',
        data: { call_id: d.data.call_id, result: 'output' }
    }));
}
```

## Responsive Design

Every extension should work well across different window sizes since SAP extensions can be resized or opened at different dimensions. Critical patterns:

### Viewport Meta (REQUIRED)

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
```

### CSS Media Queries

Use breakpoints to adapt layout at small sizes:

```css
/* Tablet / medium windows */
@media (max-width: 900px) {
  /* stack layouts vertically, reduce padding */
}

/* Phone / very small windows */
@media (max-width: 600px) {
  /* hide secondary elements, compact controls */
}
```

Key responsive practices:
- Use `vw` units for widths as fallback (e.g., `width: 65vw; max-width: 360px`)
- Use `flex` layouts that naturally wrap
- Hide non-essential elements on small screens (`display: none`)
- Reduce font sizes and padding at breakpoints

## Transparent Window / Compact Mode

When `transparent: true` is set in package.json, SAP creates a frameless transparent window. The extension must implement **compact mode** to work correctly.

### How SAP Creates Transparent Windows

From `main.js`, when `extension.transparent` is true:

```js
{
  frame: false,
  transparent: true,
  alwaysOnTop: true,
  skipTaskbar: false,
  hasShadow: false,
  backgroundColor: 'rgba(0, 0, 0, 0)',
}
```

### Compact Mode CSS (REQUIRED for transparent extensions)

The template includes compact mode that activates when the window height is small (< 200px). Key patterns:

```css
/* 1. Transparent backgrounds */
body.compact { background: transparent !important; }
html.compact { background: transparent !important; }

/* 2. Drag regions — make header/footer draggable for frameless windows */
body.compact header,
body.compact #inputBar {
  -webkit-app-region: drag;
}

/* 3. Interactive elements MUST opt-out of drag */
body.compact button,
body.compact input,
body.compact textarea,
body.compact .compact-close-btn {
  -webkit-app-region: no-drag;
}

/* 4. Compact close button (red circle, top-right) */
.compact-close-btn { display: none; }
body.compact .compact-close-btn {
  display: flex;
  position: absolute;
  top: 5px; right: 5px;
  width: 20px; height: 20px;
  background: rgb(255, 57, 57);
  border: none; border-radius: 50%;
  color: #fff;
  align-items: center; justify-content: center;
  font-size: 10px; cursor: pointer;
  transition: 0.2s;
  z-index: 100;
  -webkit-app-region: no-drag;
}
body.compact .compact-close-btn:hover { background: #ec4141; }

/* 5. Compact layout — hide/show elements */
body.compact header { padding: 0 12px; height: 44px; }
body.compact header span { display: none; }
```

### Compact Mode Detection (REQUIRED)

```js
function checkCompactMode() {
  if (window.innerHeight < 200) {
    document.documentElement.classList.add('compact');
    document.body.classList.add('compact');
  } else {
    document.documentElement.classList.remove('compact');
    document.body.classList.remove('compact');
  }
}

function closeWindow() { window.close(); }

checkCompactMode();
window.addEventListener('resize', checkCompactMode);
```

### Placing the Close Button

The close button HTML must be placed in the body (not inside other containers), typically right after `<body>`:

```html
<body>
  <button class="compact-close-btn" onclick="closeWindow()" title="关闭窗口">
    <i class="fa-solid fa-xmark"></i>
  </button>
  <!-- rest of content -->
</body>
```

## Using iframes for Custom Schemes

If your extension needs to invoke custom protocol URLs (e.g., `lxmusic://`, `myapp://`), use a hidden iframe technique:

```js
function invokeScheme(url) {
  let iframe = document.getElementById('scheme-invoker');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'scheme-invoker';
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
  }
  iframe.src = url;
}
```

This avoids `window.open()` popup blockers and works reliably inside Electron.

## WebSocket Protocol Reference

| Message Type | Direction | Purpose |
|---|---|---|
| `get_messages` | → SAP | Request current message history |
| `messages_update` | ← SAP | Message list updated |
| `broadcast_messages` | ← SAP | Broadcast message update |
| `set_user_input` | → SAP | Update user input text |
| `trigger_send_message` | → SAP | Send current input as user message |
| `trigger_clear_message` | → SAP | Clear all messages |
| `register_node_extension_mcp` | → SAP | Register MCP tools |
| `unregister_node_extension_mcp` | → SAP | Unregister on page close |
| `mcp_registered` | ← SAP | Confirmation of registration |
| `call_mcp_tool` | ← SAP | AI agent calls a registered tool |
| `mcp_tool_result` | → SAP | Return tool execution result |
| `trigger_close_extension` | → SAP | Request extension window close |

## Important Notes

- **Extension ID format**: `{owner}_{repo}` (e.g., `heshengtao_sap-example`)
- **nodePort: 0** means auto-assign a free port
- **Always register `beforeunload` handler** to send `unregister_node_extension_mcp`
- **Font Awesome** is available at `../../fontawesome/css/all.min.css` (relative from extension path)
- **SAP dark theme colors**: bg `#1e1f20`, assistant bubble `#25262a`, accent `#00c2a8`
- **Transparent windows**: Always implement compact mode. Without `-webkit-app-region: drag`, frameless windows cannot be moved. Without `-webkit-app-region: no-drag` on interactive elements, buttons become unclickable.
- **Close button**: For transparent/frameless windows, the extension MUST provide its own close button since there's no native title bar.

## Resources

### assets/
- `assets/static-template/` — Complete starter template for static extensions
- `assets/node-template/` — Complete starter template for Node.js extensions

### references/
- `references/package-json-spec.md` — Complete package.json field reference
- `references/node-entry-spec.md` — Node.js entry point and lifecycle specification