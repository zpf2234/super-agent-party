import os
import re
import json
import asyncio
import shortuuid
from datetime import datetime
from py.get_setting import USER_DATA_DIR

# 存放所有日记本的目录（独立于系统配置文件，每个角色一个 JSON 文件）
DIARY_DIR = os.path.join(USER_DATA_DIR, 'diary')

# 兜底日记本（无角色 / 未启用角色卡时使用）
DEFAULT_BOOK_ID = 'default'

# 旧版单文件日记（用于一次性迁移到 default 日记本）
LEGACY_DIARY_FILE = os.path.join(DIARY_DIR, 'diary_data.json')

# 每个日记本最多保留的条目数量（防止文件无限膨胀）
MAX_ENTRIES = 500


def _safe_book_id(book_id) -> str:
    """把角色 id 规整成安全的文件名片段"""
    bid = str(book_id or '').strip()
    if not bid:
        return DEFAULT_BOOK_ID
    bid = re.sub(r'[^A-Za-z0-9_\-]', '_', bid)
    return bid or DEFAULT_BOOK_ID


def _book_file(book_id) -> str:
    return os.path.join(DIARY_DIR, f'{_safe_book_id(book_id)}.json')


def _empty_book(character_id=None, character_name=""):
    return {
        "characterId": character_id,
        "characterName": character_name or "",
        "entries": [],
    }


async def _migrate_legacy_if_needed():
    """把旧版 diary_data.json 迁移为 default 日记本（仅一次）"""
    default_file = _book_file(DEFAULT_BOOK_ID)
    if os.path.exists(default_file) or not os.path.exists(LEGACY_DIARY_FILE):
        return
    try:
        def _do():
            with open(LEGACY_DIARY_FILE, 'r', encoding='utf-8') as f:
                old = json.load(f)
            entries = old.get("entries", []) if isinstance(old, dict) else []
            book = _empty_book()
            book["entries"] = entries
            with open(default_file, 'w', encoding='utf-8') as f:
                json.dump(book, f, ensure_ascii=False, indent=4)
        await asyncio.to_thread(_do)
        print("📔 [日记系统] 已将旧版日记迁移到默认日记本")
    except Exception as e:
        print(f"[Diary] 迁移旧版日记失败: {e}")


async def load_diary_data(book_id: str = DEFAULT_BOOK_ID):
    """读取某个日记本，返回 {"characterId":..., "characterName":..., "entries":[...]}"""
    os.makedirs(DIARY_DIR, exist_ok=True)
    if _safe_book_id(book_id) == DEFAULT_BOOK_ID:
        await _migrate_legacy_if_needed()
    path = _book_file(book_id)
    if not os.path.exists(path):
        return _empty_book()
    try:
        def _read():
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        data = await asyncio.to_thread(_read)
        if not isinstance(data, dict):
            return _empty_book()
        if "entries" not in data or not isinstance(data["entries"], list):
            data["entries"] = []
        data.setdefault("characterId", None)
        data.setdefault("characterName", "")
        return data
    except Exception as e:
        print(f"[Diary] 读取日记本 {book_id} 失败: {e}")
        return _empty_book()


async def save_diary_data(data, book_id: str = DEFAULT_BOOK_ID):
    """全量保存某个日记本"""
    os.makedirs(DIARY_DIR, exist_ok=True)
    if not isinstance(data, dict):
        data = _empty_book()
    if "entries" not in data or not isinstance(data["entries"], list):
        data["entries"] = []
    data.setdefault("characterId", None)
    data.setdefault("characterName", "")
    # 截断，仅保留最近 MAX_ENTRIES 条
    data["entries"] = data["entries"][-MAX_ENTRIES:]
    path = _book_file(book_id)
    try:
        def _write():
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
        await asyncio.to_thread(_write)
    except Exception as e:
        print(f"[Diary] 保存日记本 {book_id} 失败: {e}")


async def append_diary_entry(entry_type: str, content: str, title: str = "", pushed_to=None,
                             book_id: str = DEFAULT_BOOK_ID, character_id=None, character_name=""):
    """向指定日记本追加一条日记，返回新条目"""
    if not content:
        return None
    data = await load_diary_data(book_id)
    # 同步本子的角色信息（角色可能改名）
    if character_id is not None:
        data["characterId"] = character_id
    if character_name:
        data["characterName"] = character_name
    entry = {
        "id": str(shortuuid.ShortUUID().random(length=10)),
        "time": datetime.now().isoformat(),
        "type": entry_type,
        "title": title or "",
        "content": content,
        "pushedTo": pushed_to or [],
    }
    data["entries"].append(entry)
    await save_diary_data(data, book_id)
    print(f"📔 [日记系统] 新增日记 [{book_id}/{entry_type}]: {(title or content)[:30]}")
    return entry


async def delete_diary_entry(entry_id: str, book_id: str = DEFAULT_BOOK_ID):
    """从指定日记本删除一条日记"""
    data = await load_diary_data(book_id)
    before = len(data["entries"])
    data["entries"] = [e for e in data["entries"] if e.get("id") != entry_id]
    if len(data["entries"]) != before:
        await save_diary_data(data, book_id)
        return True
    return False


async def list_diary_books():
    """列出所有日记本（含默认兜底本）的概要信息，按最近更新时间倒序"""
    os.makedirs(DIARY_DIR, exist_ok=True)
    await _migrate_legacy_if_needed()
    books = []
    try:
        names = await asyncio.to_thread(lambda: os.listdir(DIARY_DIR))
    except Exception:
        names = []
    for fname in names:
        if not fname.endswith('.json'):
            continue
        if fname == os.path.basename(LEGACY_DIARY_FILE):
            continue
        book_id = fname[:-len('.json')]
        data = await load_diary_data(book_id)
        entries = data.get("entries", [])
        last_time = ""
        if entries:
            try:
                last_time = max(e.get("time", "") for e in entries)
            except Exception:
                last_time = entries[-1].get("time", "")
        books.append({
            "bookId": book_id,
            "characterId": data.get("characterId"),
            "characterName": data.get("characterName", ""),
            "count": len(entries),
            "lastTime": last_time,
            "isDefault": book_id == DEFAULT_BOOK_ID,
        })
    # 确保默认本始终存在于列表
    if not any(b["bookId"] == DEFAULT_BOOK_ID for b in books):
        books.append({
            "bookId": DEFAULT_BOOK_ID,
            "characterId": None,
            "characterName": "",
            "count": 0,
            "lastTime": "",
            "isDefault": True,
        })
    books.sort(key=lambda b: (b["isDefault"], b["lastTime"] or ""), reverse=True)
    return books
