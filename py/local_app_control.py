import os
import json
import asyncio
import websockets
import requests
from typing import Dict, Optional, List, Optional

_外部连接: Dict[int, dict] = {}


def _ws_alive(ws) -> bool:
    """websockets 16+ 没有 .closed 属性，改用 close_code"""
    try:
        return ws.close_code is None
    except Exception:
        return False


def get_connected_ports() -> List[int]:
    return list(_外部连接.keys())


def get_connection_info(port: int) -> Optional[dict]:
    conn = _外部连接.get(port)
    if conn:
        return {
            "port": port,
            "appName": conn.get("app_name", ""),
            "appId": conn.get("app_id", ""),
            "targets": conn.get("targets", []),
            "activeWsUrl": conn.get("active_ws_url"),
            "activeTargetId": conn.get("active_target_id", ""),
        }
    return None


def get_all_connection_info() -> List[dict]:
    ports = list(_外部连接.keys())
    print(f"[LocalAppControl] get_all_connection_info: ports={ports}, total={len(ports)}")
    return [get_connection_info(p) for p in ports]


async def get_external_cdp_targets(port: int) -> List[dict]:
    try:
        resp = requests.get(f"http://127.0.0.1:{port}/json/list", timeout=3)
        return resp.json()
    except Exception as e:
        print(f"[LocalAppControl] 获取 CDP targets 失败 (port {port}): {e}")
        return []


def _pick_best_target(targets, preferred_id=None):
    if preferred_id:
        for t in targets:
            if t.get("id") == preferred_id:
                return t.get("webSocketDebuggerUrl")
    for t in targets:
        if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
            return t.get("webSocketDebuggerUrl")
    for t in targets:
        if t.get("type") == "webview" and t.get("webSocketDebuggerUrl"):
            return t.get("webSocketDebuggerUrl")
    for t in targets:
        if t.get("webSocketDebuggerUrl"):
            return t["webSocketDebuggerUrl"]
    return None


async def connect_to_external_app(port: int, app_id: str = "", app_name: str = "") -> dict:
    if port in _外部连接:
        conn = _外部连接[port]
        if conn.get("ws") and _ws_alive(conn["ws"]):
            print(f"[LocalAppControl] 端口 {port} 已有连接，复用")
            return {"success": True, "message": "已连接", "targets": conn.get("targets", [])}

    print(f"[LocalAppControl] 正在连接端口 {port} (app: {app_name})...")
    try:
        resp = requests.get(f"http://127.0.0.1:{port}/json/list", timeout=3)
        targets = resp.json()
    except Exception as e:
        print(f"[LocalAppControl] 连接 fail (port {port}): {e}")
        return {"success": False, "error": str(e), "targets": []}

    ws_url = _pick_best_target(targets)
    first_target = None
    for t in targets:
        if t.get("type") in ("page", "webview") and t.get("webSocketDebuggerUrl"):
            first_target = t
            break
    if not first_target:
        for t in targets:
            if t.get("webSocketDebuggerUrl"):
                first_target = t
                break

    _外部连接[port] = {
        "targets": targets,
        "ws": None,
        "active_ws_url": ws_url,
        "active_target_id": first_target.get("id", "") if first_target else "",
        "connected_at": asyncio.get_event_loop().time(),
        "app_name": app_name,
        "app_id": app_id,
    }

    if ws_url:
        try:
            ws = await websockets.connect(ws_url, max_size=10 * 1024 * 1024, ping_interval=20, close_timeout=1)
            _外部连接[port]["ws"] = ws
            print(f"[LocalAppControl] 端口 {port} WebSocket 连接成功")
        except Exception as e:
            print(f"[LocalAppControl] WebSocket 连接失败 (port {port}): {e}")

    page_count = len([t for t in targets if t.get("type") == "page"])
    webview_count = len([t for t in targets if t.get("type") == "webview"])
    usable_count = len([t for t in targets if t.get("webSocketDebuggerUrl") and t.get("type") not in ("worker","service_worker","shared_worker")])
    print(f"[LocalAppControl] 端口 {port}: {len(targets)} targets (page={page_count}, webview={webview_count}, usable={usable_count})")
    return {"success": True, "message": "连接成功", "targets": targets, "activeWsUrl": ws_url, "usableCount": usable_count}


async def disconnect_from_external_app(port: int) -> dict:
    print(f"[LocalAppControl] 断开端口 {port}")
    conn = _外部连接.pop(port, None)
    if conn:
        ws = conn.get("ws")
        if ws:
            try:
                if _ws_alive(ws):
                    await asyncio.wait_for(ws.close(), timeout=3)
            except (asyncio.TimeoutError, Exception) as e:
                print(f"[LocalAppControl] 端口 {port} WS 关闭异常: {e}")
    print(f"[LocalAppControl] 端口 {port} 已移除，剩余: {list(_外部连接.keys())}")
    return {"success": True}


async def switch_external_target(port: int, target_id: str = "") -> dict:
    conn = _外部连接.get(port)
    if not conn:
        return {"error": f"端口 {port} 未连接", "success": False}

    targets = conn.get("targets", [])
    if not targets:
        targets = await get_external_cdp_targets(port)
        _外部连接[port]["targets"] = targets

    target = None
    for t in targets:
        if target_id and t.get("id") == target_id:
            target = t
            break
    if not target:
        for t in targets:
            if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                target = t
                break
    if not target:
        for t in targets:
            if t.get("type") == "webview" and t.get("webSocketDebuggerUrl"):
                target = t
                break
    if not target:
        for t in targets:
            if t.get("webSocketDebuggerUrl"):
                target = t
                break

    if not target:
        return {"error": "找不到可用的 target", "success": False}

    ws_url = target.get("webSocketDebuggerUrl")
    if not ws_url:
        return {"error": "目标没有 webSocketDebuggerUrl", "success": False}

    old_ws = conn.get("ws")
    if old_ws and _ws_alive(old_ws):
        try:
            await old_ws.close()
        except Exception:
            pass

    try:
        ws = await websockets.connect(ws_url, max_size=10 * 1024 * 1024, ping_interval=20, close_timeout=1)
        _外部连接[port]["ws"] = ws
        _外部连接[port]["active_ws_url"] = ws_url
        _外部连接[port]["active_target_id"] = target.get("id", "")
        print(f"[LocalAppControl] 端口 {port} 切换到 target: {target.get('title','')} (type={target.get('type')}, id={target.get('id')})")
        return {"success": True, "target": {"title": target.get("title"), "type": target.get("type"), "url": target.get("url"), "id": target.get("id")}}
    except Exception as e:
        return {"error": str(e), "success": False}


async def refresh_external_targets(port: int) -> dict:
    try:
        targets = await get_external_cdp_targets(port)
        _外部连接[port]["targets"] = targets
        print(f"[LocalAppControl] 端口 {port} targets 已刷新: {len(targets)}")
        return {"success": True, "targets": targets}
    except Exception as e:
        return {"error": str(e), "success": False}


async def execute_external_cdp(port: int, method: str, params: Optional[dict] = None) -> dict:
    conn = _外部连接.get(port)
    if not conn:
        return {"error": "未连接", "success": False}

    ws = conn.get("ws")
    ws_url = conn.get("active_ws_url")

    if ws and _ws_alive(ws):
        return await _send_cdp(ws, method, params or {})

    if ws_url:
        try:
            ws = await websockets.connect(ws_url, max_size=10 * 1024 * 1024, ping_interval=20, close_timeout=1)
            _外部连接[port]["ws"] = ws
            return await _send_cdp(ws, method, params or {})
        except Exception as e:
            return {"error": str(e), "success": False}

    targets = await get_external_cdp_targets(port)
    _外部连接[port]["targets"] = targets
    ws_url = _pick_best_target(targets)
    if ws_url:
        try:
            ws = await websockets.connect(ws_url, max_size=10 * 1024 * 1024, ping_interval=20, close_timeout=1)
            _外部连接[port]["ws"] = ws
            _外部连接[port]["active_ws_url"] = ws_url
            return await _send_cdp(ws, method, params or {})
        except Exception as e:
            return {"error": str(e), "success": False}

    return {"error": "找不到可连接的 target", "success": False}


async def select_external_target(port: int, target_url: str) -> dict:
    try:
        ws = await websockets.connect(target_url, max_size=10 * 1024 * 1024, ping_interval=20, close_timeout=1)
        if port in _外部连接:
            old_ws = _外部连接[port].get("ws")
            if old_ws and _ws_alive(old_ws):
                try:
                    await old_ws.close()
                except Exception:
                    pass
        _外部连接[port]["ws"] = ws
        _外部连接[port]["active_ws_url"] = target_url
        return {"success": True}
    except Exception as e:
        return {"error": str(e), "success": False}


async def _send_cdp(ws, method: str, params: dict) -> dict:
    import websockets.exceptions
    cmd_id = 1
    message = {"id": cmd_id, "method": method, "params": params}
    try:
        await ws.send(json.dumps(message))
    except websockets.exceptions.ConnectionClosed as e:
        return {"error": f"WebSocket 连接已关闭: {e}", "success": False}
    while True:
        try:
            response = await asyncio.wait_for(ws.recv(), timeout=30)
        except asyncio.TimeoutError:
            return {"error": "CDP 响应超时 (30s)", "success": False}
        except websockets.exceptions.ConnectionClosed as e:
            return {"error": f"WebSocket 连接已关闭: {e}", "success": False}
        data = json.loads(response)
        if data.get("id") == cmd_id:
            # CDP 协议错误：透传完整错误信息
            if "error" in data:
                err = data["error"]
                code = err.get("code", "")
                msg = err.get("message", str(err))
                return {"error": f"CDP {method}: [{code}] {msg}", "success": False, "cdp_error": err}
            return data.get("result", {})


async def cleanup_all():
    for port in list(_外部连接.keys()):
        await disconnect_from_external_app(port)


_GENERIC_DIR_NAMES = {
    "64bit", "app", "current", "plugins", "overlay", "locales", "resources",
    "swiftshader", "bin", "bin64", "cores", "node_modules", "dist",
    "locale", "pak", "blink", "content", "compatible_web",
}


def _is_skip_directory(dir_path: str) -> bool:
    """检查目录或exe是否应被跳过"""
    name = os.path.basename(dir_path).lower()
    # 通用子目录名
    if name in _GENERIC_DIR_NAMES:
        return True
    # shadowbot 版本目录
    import re
    if re.match(r"^shadowbot-\d+\.\d+\.\d+$", name):
        return True
    # 游戏数据目录
    if name.endswith("_data"):
        return True
    # 安装器 / VC Redist
    if "Visual C++" in name or "vc_redist" in name:
        return True
    # Edge WebView2 是系统组件，不应作为独立应用扫描
    if "webview2" in name:
        return True
    return False


def _is_quality_ancestor(exe_path: str, ancestor_path: str, markers_dir: str) -> bool:
    """检查祖先目录是否像一个真正的应用安装目录（排除临时目录/插件子目录）"""
    if _is_skip_directory(ancestor_path):
        return False
    # 拒绝盘符根目录和系统目录
    drive, tail = os.path.splitdrive(ancestor_path)
    if tail in ("\\", "/", ""):
        return False
    if os.path.normcase(ancestor_path) == os.path.normcase(os.environ.get("SystemRoot", "")):
        return False
    ancestor_name = os.path.basename(ancestor_path).lower()
    # 排除随机 hash 名称 (UUID 之类)
    hex_chars = set("0123456789abcdef-")
    if len(ancestor_name) > 30 and all(c in hex_chars for c in ancestor_name):
        return False
    try:
        file_count = len([f for f in os.scandir(ancestor_path) if f.is_file()])
        if file_count < 3:
            return False
    except Exception:
        return False
    return True


def _classify_chromium_app(exe_path: str, markers_dir: str) -> str:
    """根据运行时标记分类 Chromium 应用类型"""
    import re
    files = set()
    try:
        files = set(os.listdir(markers_dir))
    except Exception:
        pass

    # 目录级标记优先
    if "libcef.dll" in files:
        return "cef"
    if "electron.exe" in files:
        return "electron"
    if "msedge.dll" in files:
        return "browser"
    if "chrome.dll" in files:
        return "browser"

    # 目录名匹配 Electron 版本目录（如 app-11.99.0）
    dir_basename = os.path.basename(markers_dir)
    if re.match(r"^app-?\d+\.", dir_basename):
        return "electron"

    # 二进制检查：读取末尾 50MB（Electron 字符串通常在尾部）
    try:
        size = os.path.getsize(exe_path)
        with open(exe_path, "rb") as f:
            if size > 50_000_000:
                f.seek(size - 50_000_000)
            data = f.read(50_000_000)
        if b"Electron/" in data:
            return "electron"
    except Exception:
        pass

    return "chromium"


def _is_chromium_dir(dir_files: set) -> bool:
    """判断目录是否为 Chromium 运行时目录"""
    if "icudtl.dat" not in dir_files:
        return False
    if "libEGL.dll" not in dir_files:
        return False
    paks = [f for f in dir_files if f.endswith(".pak")]
    return len(paks) >= 2


def _find_main_exe(directory: str) -> Optional[str]:
    """在目录中找主exe，排除安装器、更新器、服务等辅助程序"""
    from pathlib import Path
    d = Path(directory)
    dir_name = d.name.lower()
    skip_words = (
        "uninst", "update", "setup", "crashpad", "minidump",
        "elevated", "elevation", "tracing", "notification", "helper",
        "pwa_launcher", "os_update", "service", "handler",
        "卸载", "安装", "更新", "修复", "配置",
    )
    candidates = []
    for exe_file in sorted(d.glob("*.exe"), key=lambda x: x.stat().st_size, reverse=True):
        name_lower = exe_file.name.lower()
        if any(s in name_lower for s in skip_words):
            continue
        if exe_file.stat().st_size > 500000:
            candidates.append(exe_file)
    if not candidates:
        return None
    # 优先选择文件名与目录名匹配的（如 QQ/QQ.exe）
    for c in candidates:
        if c.stem.lower() == dir_name:
            return str(c.resolve())
    return str(candidates[0].resolve())


def _build_search_paths(default_paths: list) -> list:
    """构建完整搜索路径：默认路径 + 非C盘 Program Files"""
    import string
    all_paths = list(default_paths)
    for drive in string.ascii_uppercase:
        if drive == "C":
            continue
        root = f"{drive}:\\"
        if not os.path.exists(root):
            continue
        for sub in ("Program Files", "Program Files (x86)"):
            pf = f"{drive}:\\{sub}"
            if os.path.exists(pf):
                all_paths.append(pf)
    return list(dict.fromkeys(all_paths))


def _scan_start_menu(seen_paths: set) -> list:
    """通过 Windows 开始菜单快捷方式发现已安装应用"""
    import subprocess
    results = []
    start_dirs = [
        os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs"),
        "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
        os.path.join(os.environ.get("USERPROFILE", ""), "Desktop"),
        "C:\\Users\\Public\\Desktop",
    ]

    # 收集所有 .lnk 路径，一次性用 PowerShell 解析
    all_lnks = []
    for start_dir in start_dirs:
        if not os.path.exists(start_dir):
            continue
        for root, dirs, files in os.walk(start_dir):
            for f in files:
                if f.lower().endswith(".lnk"):
                    all_lnks.append(os.path.join(root, f).replace("\\", "\\\\"))

    if not all_lnks:
        return results

    # 批量 PowerShell 解析（最多 200 个一次分批，避免命令行过长）
    batch_size = 200
    for batch_start in range(0, len(all_lnks), batch_size):
        batch = all_lnks[batch_start:batch_start + batch_size]
        lnk_list = "@(" + ",".join(f"'{lnk}'" for lnk in batch) + ")"
        ps_cmd = (
            f"$WScript = New-Object -ComObject WScript.Shell; "
            f"foreach ($lnk in {lnk_list}) {{ "
            f"try {{ Write-Output ($WScript.CreateShortcut($lnk).TargetPath) }} catch {{ Write-Output '' }} "
            f"}}"
        )
        try:
            si = subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps_cmd],
                capture_output=True, text=True, timeout=60
            )
            for target in si.stdout.splitlines():
                target = target.strip()
                if not target or not os.path.exists(target):
                    continue
                target = os.path.normpath(target)
                base = os.path.basename(target).lower()
                # 跳过卸载器、安装器、更新器
                skip_keywords = ("uninst", "update", "setup", "crashpad", "repair",
                                 "卸载", "安装", "修复", "更新", "配置")
                is_skip = any(k in base for k in skip_keywords)
                if is_skip:
                    continue
                # 在同目录及常见子目录中找更大的 exe（启动器通常比真 exe 小）
                parent = os.path.dirname(target)
                best_path = target
                try:
                    best_size = os.path.getsize(target)
                except Exception:
                    continue
                for sub in ("app", "versions", "bin", "dist"):
                    sp = os.path.join(parent, sub)
                    if not os.path.isdir(sp):
                        continue
                    for f in os.listdir(sp):
                        fp = os.path.join(sp, f)
                        if not f.lower().endswith(".exe"):
                            continue
                        if any(k in f.lower() for k in skip_keywords):
                            continue
                        try:
                            sz = os.path.getsize(fp)
                            if sz > best_size:
                                best_size = sz
                                best_path = os.path.normpath(fp)
                        except Exception:
                            continue
                target = best_path
                norm = target.lower().replace("\\", "/")
                if norm in seen_paths:
                    continue
                seen_paths.add(norm)
                results.append(target)
        except Exception:
            continue

    return results


def _scan_chromium_apps(search_paths: list) -> list:
    """统一扫描所有基于 Chromium 的应用：Electron + CEF + 浏览器 + 定制变种"""
    from pathlib import Path
    results = []

    for sp in search_paths:
        if not os.path.exists(sp):
            continue
        try:
            for root, dirs, files in os.walk(sp):
                depth = root[len(sp):].count(os.sep)
                if depth > 6:
                    dirs.clear()
                    continue
                if not files:
                    continue

                file_set = set(files)
                if not _is_chromium_dir(file_set):
                    continue

                # 找到了 Chromium 运行时目录
                root_path = Path(root)

                # 找主 exe：收集同级和祖先目录的候选（最多向上 3 级），选最大的
                is_generic = _is_skip_directory(root)
                candidates = []
                max_depth = min(4, len(list(root_path.parents)) + 1)  # 同级 + 最多3级祖先
                ancestors = [root_path] + list(root_path.parents)[:3]
                for ancestor_idx, ancestor in enumerate(ancestors):
                    if ancestor_idx == 0:
                        exe = _find_main_exe(str(ancestor))
                    else:
                        if not _is_quality_ancestor(str(ancestor), str(ancestor), root):
                            continue
                        exe = _find_main_exe(str(ancestor))
                    if exe:
                        candidates.append((os.path.getsize(exe), exe))
                        if ancestor_idx == 0 and not is_generic:
                            break  # 非通用目录的同级 exe 可信，直接用
                if not candidates:
                    dirs.clear()
                    continue
                candidates.sort(key=lambda x: x[0], reverse=True)
                found_exe = candidates[0][1]
                markers_dir = root

                exe_path = str(Path(found_exe).resolve())
                app_type = _classify_chromium_app(exe_path, markers_dir)
                results.append({"path": exe_path, "type": app_type, "markers_dir": markers_dir})
                dirs.clear()
        except PermissionError:
            continue

    return results


def _parse_version(v: str) -> tuple:
    """解析版本号为可比较的元组"""
    if not v:
        return (0,)
    import re
    parts = re.split(r"[.\-_]", v)
    result = []
    for p in parts:
        try:
            result.append(int(p.strip()))
        except ValueError:
            # 非数字段当作 0，保证版本号可比较
            pass
    return tuple(result) if result else (0,)


def _dedup_by_name(apps: List[dict]) -> List[dict]:
    """同名应用去重：相同名称（忽略大小写）只保留版本号最高的"""
    groups: Dict[str, list] = {}
    for a in apps:
        key = a["name"].strip().lower()
        groups.setdefault(key, []).append(a)

    result = []
    for key, group in groups.items():
        if len(group) == 1:
            result.append(group[0])
        else:
            # 按版本号降序，取最高版本
            group.sort(key=lambda a: _parse_version(a.get("version", "")), reverse=True)
            best = group[0]
            result.append(best)
            others = len(group) - 1
            if others > 0:
                names = [a["version"] or "?" for a in group[1:]]
                print(f"[LocalAppControl] 去重: '{best['name']}' 保留 v{best['version']}, 丢弃 {others} 个旧版本 ({', '.join(names)})")

    return result


def scan_local_apps(search_paths: Optional[List[str]] = None) -> List[dict]:
    import platform
    import subprocess
    from pathlib import Path

    platform_name = platform.system().lower()
    mapped = {"windows": "win32", "darwin": "darwin", "linux": "linux"}.get(platform_name, platform_name)

    if search_paths is None:
        if mapped == "win32":
            default_paths = [
                "C:\\Program Files",
                "C:\\Program Files (x86)",
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs"),
            ]
            search_paths = _build_search_paths(default_paths)
        elif mapped == "darwin":
            search_paths = ["/Applications", os.path.expanduser("~/Applications")]
        elif mapped == "linux":
            search_paths = ["/usr/share", "/usr/bin", "/opt", os.path.expanduser("~/.local/share")]
        else:
            raise NotImplementedError(f"Platform {mapped} not supported")

    search_paths = [p for p in search_paths if p and os.path.exists(p)]

    # 统一扫描所有 Chromium 应用
    all_found = _scan_chromium_apps(search_paths)

    # 补充：通过开始菜单快捷方式发现漏掉的应用（如 lx-music）
    if mapped == "win32":
        before_count = len(all_found)
        known_exes = {i["path"].lower().replace("\\", "/") for i in all_found}
        start_menu_paths = _scan_start_menu(known_exes)
        for sm_path in start_menu_paths:
            # 排除系统组件
            if "edgewebview" in sm_path.lower() or "msedgewebview2" in sm_path.lower():
                continue
            try:
                p = Path(sm_path)
                d = str(p.parent)
                check_dirs = [d]
                for sub in os.listdir(d):
                    sub_path = os.path.join(d, sub)
                    if os.path.isdir(sub_path):
                        check_dirs.append(sub_path)
                for cd in check_dirs[:5]:
                    if _is_chromium_dir(set(os.listdir(cd)) if os.path.exists(cd) else set()):
                        app_type = _classify_chromium_app(sm_path, cd)
                        all_found.append({"path": sm_path, "type": app_type, "markers_dir": cd})
                        break
            except Exception:
                continue
        start_count = len(all_found) - before_count
        if start_count > 0:
            print(f"[LocalAppControl] 开始菜单补充发现 {start_count} 个应用")

    type_names = {
        "electron": "electron",
        "cef": "cef",
        "browser": "browser",
        "chromium": "chromium",
    }
    apps = []
    seen = set()

    for info in all_found:
        try:
            exe_path = info["path"]
            app_type = info.get("type", "chromium")

            norm = Path(exe_path).resolve().as_posix().lower()
            if norm in seen:
                continue
            seen.add(norm)

            # 过滤系统组件
            if "edgewebview" in norm or "msedgewebview2" in norm:
                continue
            # 过滤 NVIDIA CEF（后台组件不支持调试）
            if "nvidia" in norm and ("cef" in norm or "overlay" in norm):
                continue

            p = Path(exe_path)
            name = p.parent.name
            version = ""

            if mapped == "win32":
                try:
                    ps_cmd = (
                        f"$item = Get-Item '{exe_path}'; "
                        "$v = $item.VersionInfo; "
                        "Write-Output ('PN:' + $v.ProductName); "
                        "Write-Output ('PV:' + $v.ProductVersion); "
                        "Write-Output ('FV:' + $v.FileVersion)"
                    )
                    si = subprocess.run(
                        ["powershell", "-NoProfile", "-Command", ps_cmd],
                        capture_output=True, text=True, timeout=10
                    )
                    if si.stdout:
                        for line in si.stdout.splitlines():
                            line = line.strip()
                            if line.startswith("PN:") and len(line) > 3:
                                prod_name = line[3:].strip()
                                if prod_name and "electron" not in prod_name.lower():
                                    name = prod_name
                            if line.startswith("PV:") and len(line) > 3:
                                ver = line[3:].strip()
                                if ver:
                                    version = ver
                            if line.startswith("FV:") and not version and len(line) > 3:
                                ver = line[3:].strip()
                                if ver:
                                    version = ver
                except Exception:
                    pass
            elif mapped == "darwin":
                plist_path = p.parent.parent / "Contents" / "Info.plist"
                if plist_path.exists():
                    try:
                        import plistlib
                        plist = plistlib.loads(plist_path.read_bytes())
                        name = plist.get("CFBundleDisplayName") or plist.get("CFBundleName") or name
                        version = plist.get("CFBundleShortVersionString") or plist.get("CFBundleVersion") or ""
                    except Exception:
                        pass

            # 清洗 ProductName 中的 Launcher/启动器 后缀（飞书的 ProductName 是 "Feishu Launcher"）
            nl = name.lower()
            dir_lower = p.parent.name.lower()
            if nl.endswith(" launcher") and nl[:-9].strip() == dir_lower:
                name = p.parent.name
            elif name.endswith("启动器") and len(name) > 3 and name[:-3].strip() == p.parent.name:
                name = p.parent.name

            is_running = False
            pid = 0
            try:
                if mapped == "win32":
                    ps_cmd = f"Get-Process -Name '{p.stem}' -ErrorAction SilentlyContinue | ForEach-Object {{ $_.Id }}"
                    si = subprocess.run(
                        ["powershell", "-NoProfile", "-Command", ps_cmd],
                        capture_output=True, text=True, timeout=10
                    )
                    if si.stdout.strip():
                        pids = [int(x) for x in si.stdout.strip().split() if x.strip().isdigit()]
                        if pids:
                            is_running = True
                            pid = pids[0]
                elif mapped in ("darwin", "linux"):
                    si = subprocess.run(
                        ["pgrep", "-f", exe_path], capture_output=True, text=True, timeout=5
                    )
                    if si.stdout.strip():
                        pids = [int(x) for x in si.stdout.strip().split() if x.strip().isdigit()]
                        if pids:
                            is_running = True
                            pid = pids[0]
            except Exception:
                pass

            name_lower = name.lower()
            if any(k in name_lower for k in ("microsoft visual c++", "vc_redist", "_data_path")):
                continue
            if any(k in name_lower for k in ("genshin", "yuanshen", "honkai", "star rail")):
                continue
            # 后台组件/服务，非用户交互应用
            if any(k in name_lower for k in ("nvidia app", "nvidia overlay", "webview2")):
                continue
            # 过滤开始菜单带来的卸载程序/安装器/启动器
            if any(k in name_lower for k in ("卸载", "uninstall", "installer", "setup wizard")):
                continue
            # 过滤 WebView2
            if "webview2" in name_lower:
                continue

            apps.append({
                "id": norm,
                "name": name,
                "path": exe_path,
                "version": version,
                "appType": app_type,
                "isElectron": app_type == "electron",
                "isRunning": is_running,
                "pid": pid,
            })
        except Exception as e:
            print(f"[LocalAppControl] 跳过 {info.get('path', '?')}: {e}")
            continue

    # 同名应用去重：相同名称只保留最高版本
    apps = _dedup_by_name(apps)

    # "XXX Launcher" 去重: 如果 "XXX" 已存在，去掉 "XXX Launcher"
    app_names = {a["name"].lower().strip() for a in apps}
    def _is_launcher_of(name):
        n = name.lower().strip()
        # "XXX Launcher" / "XXX启动器"
        if n.endswith(" launcher"):
            return n[:-9].strip() in app_names
        if n.endswith("启动器") and len(n) > 3:
            return n[:-3].strip() in app_names
        # 纯 "launcher" 或 "启动器" 无意义
        if n in ("launcher", "启动器"):
            return True
        return False
    apps = [a for a in apps if not _is_launcher_of(a["name"])]

    # 路径去重: 同一目录下的不同入口只留一个
    dir_map = {}
    for a in apps:
        parent = os.path.dirname(a["path"]).lower().replace("\\", "/")
        if parent not in dir_map:
            dir_map[parent] = a
        else:
            existing = dir_map[parent]
            def _name_score(n):
                s = n.lower()
                if any(k in s for k in ("uninst", "update", "setup", "repair", "卸载", "安装", "修复", "crashpad")):
                    return -1
                if any(k in s for k in ("launcher", "启动器")):
                    return 0
                return 1
            if _name_score(a["name"]) > _name_score(existing["name"]):
                dir_map[parent] = a
    apps = list(dir_map.values())

    # 按 CDP 兼容性排序：electron > browser > cef > chromium
    _type_order = {"electron": 0, "browser": 1, "cef": 2, "chromium": 3}
    apps.sort(key=lambda a: (_type_order.get(a["appType"], 99), a["name"].lower()))

    type_counts = {}
    for a in apps:
        type_counts[a["appType"]] = type_counts.get(a["appType"], 0) + 1

    summary = ", ".join(f"{v} {type_names.get(k, k)}" for k, v in type_counts.items())
    print(f"[LocalAppControl] 扫描完成: {len(apps)} 个应用 ({summary})")
    return apps
