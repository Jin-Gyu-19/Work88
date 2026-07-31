"""
설정 저장/불러오기
"""
import json
import os
import sys


# ─────────────────────────────────────────────────────────────
# 경로
# ─────────────────────────────────────────────────────────────
def get_data_dir():
    """설정 파일 저장 디렉토리 반환 (exe: AppData, 개발: 스크립트 폴더)"""
    if getattr(sys, 'frozen', False):
        d = os.path.join(os.path.expandvars("%APPDATA%"), "SupportDeck")
    else:
        d = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(d, exist_ok=True)
    return d


CONFIG_FILE = os.path.join(get_data_dir(), "config.json")


def get_images_dir():
    """버튼/배경 이미지 저장 디렉토리. {data_dir}/images/."""
    d = os.path.join(get_data_dir(), "images")
    os.makedirs(d, exist_ok=True)
    return d


def make_button_image_path(btn_id) -> str:
    """버튼 ID로 이미지 경로 생성 (PNG)."""
    import time, uuid, re
    # btn_id에서 경로 문자 제거 (import된 config의 이상한 id로 images 밖에 쓰는 것 방지)
    safe_id = re.sub(r"[^0-9A-Za-z_-]", "_", str(btn_id))[:32] or "x"
    # btn_id + timestamp + 짧은 uuid → 캐시 갱신 + 동시 생성 충돌 방지
    suffix = uuid.uuid4().hex[:6]
    fname = f"btn_{safe_id}_{int(time.time() * 1000)}_{suffix}.png"
    return os.path.join(get_images_dir(), fname)


def remove_button_image(image_path: str) -> bool:
    """버튼 삭제 시 연결된 이미지 파일도 제거."""
    if not image_path:
        return False
    try:
        if os.path.exists(image_path):
            os.remove(image_path)
            return True
    except Exception:
        pass
    return False


# ─────────────────────────────────────────────────────────────
# 기본 버튼
# ─────────────────────────────────────────────────────────────
DEFAULT_BUTTONS = [
    {"id": 0, "label": "CMD",      "icon": "💻", "color": "#1a1d2e", "action_type": "cmd",          "action_value": "cmd.exe",                       "admin": False},
    {"id": 1, "label": "캡처",     "icon": "📷", "color": "#1a1d2e", "action_type": "shortcut",     "action_value": "win+shift+s",                   "admin": False},
    {"id": 2, "label": "바탕화면", "icon": "🖥️", "color": "#1a1d2e", "action_type": "show_desktop", "action_value": "",                              "admin": False},
    {"id": 3, "label": "내 문서",  "icon": "📁", "color": "#1a1d2e", "action_type": "folder",       "action_value": "%USERPROFILE%\\Documents",      "admin": False},
    {"id": 4, "label": "Google",   "icon": "🌐", "color": "#1a1d2e", "action_type": "url",          "action_value": "https://www.google.com",        "admin": False},
]


# ─────────────────────────────────────────────────────────────
# 테마 (A/B/C/D)
# - style_kind: widget.py가 외형 분기를 위해 참조
#     "minimal" → A · 모던 미니멀 (1px 보더, 평면)
#     "glass"   → B · 글래스 (반투명 + 그라디언트 타이틀)
#     "neo"     → C · 네오 평면 (차분한 보라빛 그레이, 부드러운 인터랙션)
#     "gaming"  → D · 다크 게이밍 (그라디언트 버튼 + 네온 글로우 보더)
# - folder_colors: 폴더 그룹 4분할 아이콘 색상
# - button_palette: 버튼 배경색 추천 팔레트 (button_editor에서 사용)
# - title_font: 헤더 타이틀 폰트 (mono / sans)
# - title_glow: 타이틀에 텍스트 글로우를 줄지 (gaming만 True)
# ─────────────────────────────────────────────────────────────
THEMES = {
    # ─ A · 모던 미니멀 ─────────────────────────────────────
    "minimal": {
        "style_kind":    "minimal",
        "bg":            "#0a0a0c",
        "header":        "#131316",
        "border":        "#27272a",
        "btn_bg":        "#131316",
        "btn_hover":     "#1f1f23",
        "btn_text":      "#f5f5f5",
        "btn_sub":       "#71717a",
        "accent":        "#cbd5e1",          # 차가운 회색 — 무채색 유지하되 btn_text와 구분
        "danger":        "#f87171",
        "success":       "#4ade80",
        "warn":          "#fbbf24",
        "plus_bg":       "#0a0a0c",
        "plus_hover":    "#1f1f23",
        "drag_highlight":"#cbd5e133",
        "title_font":    "sans",
        "title_glow":    False,
        "folder_colors": ["#f87171", "#fbbf24", "#4ade80", "#60a5fa"],  # 일관된 카테고리 4색
        "button_palette": [
            "#0a0a0c", "#131316", "#1f1f23", "#27272a", "#3f3f46",
            "#52525b", "#71717a", "#a1a1aa", "#d4d4d8", "#f5f5f5",
            "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
            "#3b82f6", "#8b5cf6", "#ec4899", "#f43f5e", "#14b8a6",
            "#fecaca", "#fed7aa", "#fef3c7", "#bbf7d0", "#bae6fd",
            "#ddd6fe", "#fbcfe8", "#fce7f3", "#e0f2fe", "#d1fae5",
        ],
    },

    # ─ B · 글래스 (투명도 기반) ────────────────────────────
    "glass": {
        "style_kind":    "glass",
        "bg":            "#1c1c26",
        "header":        "#26263a",
        "border":        "#3a3a55",
        "btn_bg":        "#2a2a3e",
        "btn_hover":     "#363650",
        "btn_text":      "#ffffff",
        "btn_sub":       "#a8a8c0",
        "accent":        "#7dd3fc",          # 차가운 하늘색 — 투명감
        "danger":        "#fb7185",
        "success":       "#6ee7b7",
        "warn":          "#fcd34d",
        "plus_bg":       "#252535",
        "plus_hover":    "#33334a",
        "drag_highlight":"#7dd3fc33",  # alpha 통일됨
        "title_font":    "sans",
        "title_glow":    False,
        "folder_colors": ["#fb7185", "#fcd34d", "#6ee7b7", "#7dd3fc"],  # 동일 4색 패턴
        "button_palette": [
            "#1c1c26", "#26263a", "#2a2a3e", "#33334a", "#3a3a55",
            "#7dd3fc", "#a78bfa", "#f0abfc", "#5eead4", "#a7ffeb",
            "#ffd180", "#ff8a80", "#ccff90", "#cfd8dc", "#eceff1",
            "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6",
            "#fecaca", "#fed7aa", "#fef3c7", "#bbf7d0", "#bae6fd",
            "#ddd6fe", "#fbcfe8", "#fce7f3", "#e0f2fe", "#d1fae5",
        ],
    },

    # ─ C · 네오 평면 (그림자 없이 색상으로만) ──────────────
    "neo": {
        "style_kind":    "neo",
        "bg":            "#232633",
        "header":        "#2c303d",
        "border":        "#1a1c25",
        "btn_bg":        "#2c303d",
        "btn_hover":     "#363a4a",
        "btn_text":      "#d4d8e8",
        "btn_sub":       "#8089a8",
        "accent":        "#b794f6",          # 부드러운 보라 — 차분
        "danger":        "#fb7185",
        "success":       "#5eead4",
        "warn":          "#fcd34d",
        "plus_bg":       "#262936",
        "plus_hover":    "#2c303d",
        "drag_highlight":"#b794f633",
        "title_font":    "sans",
        "title_glow":    False,
        "folder_colors": ["#fb7185", "#fcd34d", "#5eead4", "#b794f6"],  # 동일 4색 패턴
        "button_palette": [
            "#232633", "#2c303d", "#363a4a", "#3f4458", "#1a1c25",
            "#b794f6", "#a78bfa", "#5eead4", "#fcd34d", "#fb7185",
            "#94a3b8", "#cbd5e1", "#e2e8f0", "#475569", "#334155",
            "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6",
            "#fecaca", "#fed7aa", "#fef3c7", "#bbf7d0", "#bae6fd",
            "#ddd6fe", "#fbcfe8", "#fce7f3", "#e0f2fe", "#d1fae5",
        ],
    },

    # ─ D · 다크 게이밍 ────────────────────────────────────
    "gaming": {
        "style_kind":    "gaming",
        "bg":            "#0a0a0d",
        "header":        "#0f111c",
        "border":        "#2a2f44",
        "btn_bg":        "#1a1d2e",
        "btn_hover":     "#252a44",
        "btn_text":      "#e6edf3",
        "btn_sub":       "#6e7691",
        "accent":        "#58a6ff",          # 밝은 네온 파랑 — 게이밍
        "danger":        "#f85149",
        "success":       "#3fb950",
        "warn":          "#d29922",
        "plus_bg":       "#0f111c",
        "plus_hover":    "#1a1d2e",
        "drag_highlight":"#58a6ff33",  # alpha 통일됨 (44→33)
        "title_font":    "mono",
        "title_glow":    True,
        "folder_colors": ["#f85149", "#d29922", "#3fb950", "#58a6ff"],  # 동일 4색 패턴
        "button_palette": [
            "#0a0a0d", "#0f111c", "#1a1d2e", "#252a44", "#2a2f44",
            "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
            "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e",
            "#fecaca", "#fed7aa", "#fef3c7", "#bbf7d0", "#bae6fd",
            "#ddd6fe", "#fbcfe8", "#fce7f3", "#e0f2fe", "#d1fae5",
            "#fca5a5", "#fdba74", "#fde047", "#86efac", "#7dd3fc",
            "#c4b5fd", "#f9a8d4", "#a1a1aa", "#d4d4d8", "#f5f5f5",
        ],
    },

    # ─ F · 봄 벚꽃 (연핑크 라이트) ─────────────────────────
    "sakura": {
        "style_kind":    "light",
        "bg":            "#fdf0f5",
        "header":        "#fbe4ee",
        "border":        "#f2c9dc",
        "btn_bg":        "#ffffff",
        "btn_hover":     "#fdeaf2",
        "btn_text":      "#43202f",          # 진한 플럼 브라운 — 밝은 배경 대비
        "btn_sub":       "#9c5c76",
        "accent":        "#c2255c",          # 딥 체리핑크 — WCAG AA
        "danger":        "#c92a2a",
        "success":       "#2f9e44",
        "warn":          "#e8590c",
        "plus_bg":       "#fdf0f5",
        "plus_hover":    "#fbe4ee",
        "drag_highlight":"#c2255c33",
        "title_font":    "sans",
        "title_glow":    False,
        "folder_colors": ["#f06595", "#f59f00", "#40c057", "#4dabf7"],
        "button_palette": [
            "#ffffff", "#fdf0f5", "#fbe4ee", "#ffdeeb", "#fcc2d7",
            "#faa2c1", "#f783ac", "#f06595", "#e64980", "#c2255c",
            "#fff0f6", "#ffe3e3", "#fff9db", "#ebfbee", "#e7f5ff",
            "#f3f0ff", "#d0bfff", "#ffd8a8", "#96f2d7", "#f8f9fa",
        ],
    },

    # ─ G · 여름 바다 (민트 라이트) ─────────────────────────
    "summer": {
        "style_kind":    "light",
        "bg":            "#eefaf9",
        "header":        "#d9f2f0",
        "border":        "#abdfda",
        "btn_bg":        "#ffffff",
        "btn_hover":     "#e3f7f5",
        "btn_text":      "#0b3a36",          # 딥 틸 — 밝은 배경 대비
        "btn_sub":       "#4c8a84",
        "accent":        "#0b7285",          # 딥 오션 틸 — WCAG AA
        "danger":        "#c92a2a",
        "success":       "#2b8a3e",
        "warn":          "#e8590c",
        "plus_bg":       "#eefaf9",
        "plus_hover":    "#d9f2f0",
        "drag_highlight":"#0b728533",
        "title_font":    "sans",
        "title_glow":    False,
        "folder_colors": ["#ff8787", "#ffd43b", "#38d9a9", "#339af0"],
        "button_palette": [
            "#ffffff", "#eefaf9", "#d9f2f0", "#c3fae8", "#96f2d7",
            "#63e6be", "#38d9a9", "#20c997", "#0ca678", "#0b7285",
            "#e7f5ff", "#d0ebff", "#a5d8ff", "#74c0fc", "#4dabf7",
            "#fff9db", "#ffec99", "#ffe066", "#ffd8a8", "#f8f9fa",
        ],
    },

    # ─ H · 가을 단풍 (웜 크림 라이트) ──────────────────────
    "autumn": {
        "style_kind":    "light",
        "bg":            "#faf4ea",
        "header":        "#f4e8d4",
        "border":        "#e2cfae",
        "btn_bg":        "#fffdf8",
        "btn_hover":     "#f8efdf",
        "btn_text":      "#452f1c",          # 딥 브라운 — 밝은 배경 대비
        "btn_sub":       "#8a6d4b",
        "accent":        "#d9480f",          # 딥 오렌지 — WCAG AA
        "danger":        "#c92a2a",
        "success":       "#5c940d",
        "warn":          "#e67700",
        "plus_bg":       "#faf4ea",
        "plus_hover":    "#f4e8d4",
        "drag_highlight":"#d9480f33",
        "title_font":    "sans",
        "title_glow":    False,
        "folder_colors": ["#e03131", "#f08c00", "#66a80f", "#a87332"],
        "button_palette": [
            "#fffdf8", "#faf4ea", "#f4e8d4", "#ffe8cc", "#ffd8a8",
            "#ffc078", "#ffa94d", "#ff922b", "#e8590c", "#d9480f",
            "#fff4e6", "#fff9db", "#ffec99", "#e9d8a6", "#d4a373",
            "#b08968", "#7f5539", "#a3b18a", "#606c38", "#f5ebe0",
        ],
    },

    # ─ I · 겨울 설원 (아이스 블루 라이트) ──────────────────
    "winter": {
        "style_kind":    "light",
        "bg":            "#f4f7fb",
        "header":        "#e7eef7",
        "border":        "#c8d6e9",
        "btn_bg":        "#ffffff",
        "btn_hover":     "#edf2fa",
        "btn_text":      "#1b2a41",          # 딥 네이비 — 밝은 배경 대비
        "btn_sub":       "#5c718c",
        "accent":        "#1864ab",          # 딥 윈터 블루 — WCAG AA
        "danger":        "#c92a2a",
        "success":       "#2b8a3e",
        "warn":          "#e8590c",
        "plus_bg":       "#f4f7fb",
        "plus_hover":    "#e7eef7",
        "drag_highlight":"#1864ab33",
        "title_font":    "sans",
        "title_glow":    False,
        "folder_colors": ["#e64980", "#fab005", "#40c057", "#4dabf7"],
        "button_palette": [
            "#ffffff", "#f4f7fb", "#e7eef7", "#dbe4f0", "#d0ebff",
            "#a5d8ff", "#74c0fc", "#4dabf7", "#339af0", "#1864ab",
            "#e5dbff", "#d0bfff", "#edf2ff", "#dee2e6", "#ced4da",
            "#adb5bd", "#868e96", "#495057", "#f1f3f5", "#e9ecef",
        ],
    },

    # ─ E · 라이트 (밝은 톤) ───────────────────────────────
    "light": {
        "style_kind":    "light",
        "bg":            "#fafafa",
        "header":        "#f4f4f5",
        "border":        "#d4d4d8",
        "btn_bg":        "#ffffff",
        "btn_hover":     "#f4f4f5",
        "btn_text":      "#18181b",          # 어두운 글씨
        "btn_sub":       "#52525b",
        "accent":        "#c2410c",          # 진한 오렌지 — WCAG AA (4.85:1)
        "danger":        "#dc2626",          # 진한 레드 — WCAG AA (4.83:1)
        "success":       "#15803d",
        "warn":          "#b45309",
        "plus_bg":       "#fafafa",
        "plus_hover":    "#fff7ed",
        "drag_highlight":"#c2410c33",
        "title_font":    "sans",
        "title_glow":    False,
        "folder_colors": ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"],  # 비비드 4색
        "button_palette": [
            "#ffffff", "#fafafa", "#f4f4f5", "#e4e4e7", "#d4d4d8",
            "#fecaca", "#fed7aa", "#fef3c7", "#bbf7d0", "#bae6fd",
            "#ddd6fe", "#fbcfe8", "#a1a1aa", "#71717a", "#52525b",
            "#f97316", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899",
        ],
    },
}


# 옛 테마 키 → 새 테마 키 매핑 (기존 사용자 마이그레이션)
_LEGACY_THEME_MAP = {
    "dark":     "gaming",
    "midnight": "gaming",
    "forest":   "neo",
    "crimson":  "neo",
    "slate":    "minimal",
}


# ─────────────────────────────────────────────────────────────
# 기본 설정
# ─────────────────────────────────────────────────────────────
DEFAULT_CONFIG = {
    "x": 100,
    "y": 100,
    "width": 260,
    "always_on_top": True,
    "opacity": 0.95,
    "theme": "gaming",   # 기본 테마: D (현재 dark와 가장 유사)
    "layout_mode": "grid2",
    "buttons": DEFAULT_BUTTONS,
    "first_run_shown": False,  # 첫 실행 환영 메시지 표시 여부
    # ── 자동 업데이트 확인 ──
    # 업데이트 서버 주소는 보안상 main_qtweb.py의 UPDATE_MANIFEST_URL 상수에 고정
    # (config로 바꿀 수 있으면 가짜 업데이트 서버 유도 공격이 가능해서 제거함)
    "update_check": True,          # 시작 시 새 버전 자동 확인
    "update_skip_version": "",     # '이 버전 건너뛰기' 한 버전
}


# ─────────────────────────────────────────────────────────────
# I/O
# ─────────────────────────────────────────────────────────────


def _migrate_and_fill(cfg):
    """로드된 dict에 테마 마이그레이션 + 누락 키 보완."""
    theme = cfg.get("theme", "gaming")
    if theme in _LEGACY_THEME_MAP:
        cfg["theme"] = _LEGACY_THEME_MAP[theme]
    elif theme not in THEMES:
        cfg["theme"] = "gaming"
    import copy
    # 더 이상 쓰지 않는 키 제거 (업데이트 주소는 코드 상수로 이동 — config로 못 바꿈)
    for obsolete in ("update_url", "update_page_url"):
        cfg.pop(obsolete, None)
    for k, v in DEFAULT_CONFIG.items():
        if k not in cfg:
            # deepcopy: DEFAULT_BUTTONS 같은 mutable 기본값이 공유·오염되지 않게
            cfg[k] = copy.deepcopy(v)
    return cfg


def _try_load_json(path):
    """JSON 파일 로드 시도 - 실패 시 None 반환."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return None
        return data
    except Exception:
        return None


def load_config():
    """안전한 config 로드 - 메인 파일이 깨지면 .bak 백업에서 자동 복원."""
    backup_file = CONFIG_FILE + ".bak"
    cfg = _try_load_json(CONFIG_FILE) if os.path.exists(CONFIG_FILE) else None
    if cfg is None and os.path.exists(backup_file):
        cfg = _try_load_json(backup_file)
        if cfg is not None:
            print(f"[config] main file damaged - restored from backup: {backup_file}")
            try:
                save_config(cfg)
            except Exception:
                pass
    if cfg is None:
        import copy
        cfg = copy.deepcopy(DEFAULT_CONFIG)
        try:
            save_config(cfg)
        except Exception:
            pass
        return cfg
    return _migrate_and_fill(cfg)


def save_config(cfg):
    """원자적 저장 - 임시 파일에 쓰고 rename, fsync로 디스크 강제 쓰기, .bak 백업 유지."""
    import tempfile
    import shutil
    dir_path = os.path.dirname(CONFIG_FILE) or "."
    os.makedirs(dir_path, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".config_tmp_", suffix=".json", dir=dir_path)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
            f.flush()
            try:
                os.fsync(f.fileno())
            except Exception:
                pass
    except Exception:
        try:
            os.remove(tmp_path)
        except Exception:
            pass
        raise
    backup_path = CONFIG_FILE + ".bak"
    if os.path.exists(CONFIG_FILE):
        try:
            shutil.copy2(CONFIG_FILE, backup_path)
        except Exception:
            pass
    os.replace(tmp_path, CONFIG_FILE)


def get_theme(name="gaming"):
    if name in _LEGACY_THEME_MAP:
        name = _LEGACY_THEME_MAP[name]
    return THEMES.get(name, THEMES["gaming"])
