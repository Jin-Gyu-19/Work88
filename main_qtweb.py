"""
SupportDeck — PyQt6 + QWebEngineView 진입점
HTML/CSS 디자인 자유도 100% + PyQt6 프레임리스/트레이/항상위
실행:
    py main_qtweb.py
"""
import os
import sys
import json

# ── 최소 import만 먼저 (시작 속도 최적화) ──
from PyQt6.QtCore import Qt, QUrl, pyqtSlot, QObject, QPoint, QTimer, QEvent, QRect, QRectF, QPropertyAnimation, QEasingCurve
from PyQt6.QtGui import QIcon, QAction, QCursor, QPainterPath, QRegion
from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QSystemTrayIcon, QMenu, QWidget
)

# ── WebEngine은 lazy import (QApplication 생성 후 import하면 초기화 빠름) ──
QWebEngineView = None
QWebEnginePage = None
QWebEngineSettings = None
QWebChannel = None

def _init_webengine():
    """WebEngine 모듈을 지연 import — app 생성 직후 호출."""
    global QWebEngineView, QWebEnginePage, QWebEngineSettings, QWebChannel
    from PyQt6.QtWebEngineWidgets import QWebEngineView as _View
    from PyQt6.QtWebEngineCore import QWebEnginePage as _Page, QWebEngineSettings as _Settings
    from PyQt6.QtWebChannel import QWebChannel as _Channel
    QWebEngineView = _View
    QWebEnginePage = _Page
    QWebEngineSettings = _Settings
    QWebChannel = _Channel

import config as cfg_module

# 앱 버전 (bump_version.py가 version.txt/setup.iss/latest.json과 함께 자동 갱신)
APP_VERSION = "2.2.0"

# 업데이트 서버 주소 — 보안상 코드에 고정 (config.json으로 못 바꿈).
# config에서 읽으면 config 파일을 조작해 가짜 업데이트 서버로 유도하는 공격이 가능해짐.
UPDATE_MANIFEST_URL = "https://pub-52f656e472a74341bc85f2dae0be8e3f.r2.dev/latest.json"
UPDATE_PAGE_URL     = "https://supportdeck.pages.dev/"

# actions는 실제 버튼 클릭 시에만 필요 → lazy
_act_module = None
def _get_actions():
    global _act_module
    if _act_module is None:
        import actions as _a
        _act_module = _a
    return _act_module


# ─────────────────────────────────────────────────────────────
# 리소스 경로 — PyInstaller onefile 빌드에서 _MEIPASS 처리
# ─────────────────────────────────────────────────────────────
def resource_path(filename: str) -> str:
    """widget.html, icon.ico 등 정적 리소스의 절대 경로 반환.
    PyInstaller 빌드 시: 임시 추출 폴더(sys._MEIPASS)에서 탐색.
    개발 환경: 스크립트와 같은 폴더."""
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, filename)


# ─────────────────────────────────────────────────────────────
# 윈도우 사이즈 계산 — 레이아웃 모드별
# ─────────────────────────────────────────────────────────────
def calc_window_size(n_btns: int, layout_mode: str = "grid2", small: bool = False, extra_btns: int = 0) -> tuple[int, int]:
    """버튼 개수 + 레이아웃 모드 + 작은버튼 모드 → (width, height)
    extra_btns: 폴더 안일 때 뒤로가기 버튼 1개 등 추가
    """
    btn_size = 60 if small else 100
    gap = 6 if small else 8
    pad = gap        # ★ 상하좌우 padding = gap (사용자 요청)
    border = 1       # .widget border 1px

    # 헤더 실측
    header_btn_h = 20 if small else 22
    if layout_mode == "vertical1":
        if small:
            header_inner = 6 + 14 + 2 + 20 + 4
        else:
            header_inner = 6 + 18 + 2 + 22 + 4
        sep_section = 1 + 8
    elif layout_mode == "horizontal1":
        # 가로 1줄: 컴팩트 헤더 (padding 2+2=4 + height + margin 2)
        header_inner = 4 + (20 if small else 22) + 2
        sep_section = 1 + 4
    elif small:
        header_inner = 4 + 20 + 4
        sep_section = 1 + 8
    else:
        header_inner = 4 + 4 + 28 + 4
        sep_section = 1 + 8
    header_h = header_inner + sep_section

    # +버튼 1개 + extra (폴더 안 뒤로가기 등)
    total = n_btns + 1 + extra_btns

    if layout_mode == "vertical1":
        cols, rows = 1, total
    elif layout_mode == "horizontal1":
        cols, rows = total, 1
    elif layout_mode == "horizontal2":
        cols, rows = (total + 1) // 2, 2
    else:  # grid2
        cols, rows = 2, (total + 1) // 2

    # 내부 콘텐츠 사이즈 (버튼 + gap)
    content_w = cols * btn_size + (cols - 1) * gap
    content_h = rows * btn_size + (rows - 1) * gap

    # 전체 위젯 사이즈 = 콘텐츠 + pad*2 + border*2
    w = content_w + pad * 2 + border * 2
    h = header_h + content_h + pad * 2 + border * 2

    # 가로 1줄 모드: 둥근 모서리(18px)에 우측 끝 +버튼 점선이 잘리지 않게 width 여유 추가
    if layout_mode == "horizontal1":
        w += 10

    # 헤더 최소 폭 보장
    title_w = 75 if small else 105   # "⚡ SUPPORTDECK" 추정 폭
    if layout_mode == "vertical1":
        # 두 줄 헤더: max(title 폭, 헤더 버튼 폭) + 패딩 (큰+작은 모두)
        btn_row_w = 4 * header_btn_h + 3 * 4
        header_min_w = max(title_w, btn_row_w) + pad * 2 + border * 2
    else:
        # 한 줄 헤더: title + 헤더 버튼 + gap 다 들어가야
        header_min_w = title_w + 4 * header_btn_h + 3 * 2 + pad * 2 + border * 2
    if w < header_min_w:
        w = header_min_w
    return (w, h)


# ─────────────────────────────────────────────────────────────
# Bridge — JS ↔ Python 통신 (QObject)
# ─────────────────────────────────────────────────────────────
class Bridge(QObject):
    def __init__(self, window):
        super().__init__()
        self.window = window
        # 창(window.cfg)과 같은 dict 객체를 공유 — 두 사본이 서로 덮어써서
        # 설정이 조용히 되돌아가는 문제 방지 (last-writer-wins 클로버링)
        self.config = getattr(window, "cfg", None)
        if self.config is None:
            self.config = cfg_module.load_config()
        self._current_folder_id = None  # 현재 진입한 폴더의 id (None이면 루트)

    # ── 폴더 컨텍스트 헬퍼 ────────────────────────────
    def _find_folder(self, folder_id):
        """루트 buttons에서 해당 id의 폴더 dict 찾기"""
        if folder_id is None:
            return None
        for b in self.config.get("buttons", []):
            if b.get("id") == folder_id and b.get("action_type") == "folder_group":
                return b
        return None

    def _current_buttons(self):
        """현재 컨텍스트의 버튼 리스트 (루트 or 폴더 안)"""
        folder = self._find_folder(self._current_folder_id)
        if folder is not None:
            return folder.get("buttons", [])
        return self.config.get("buttons", [])

    def _save_current_buttons(self, buttons):
        """현재 컨텍스트의 버튼 리스트 저장"""
        folder = self._find_folder(self._current_folder_id)
        if folder is not None:
            folder["buttons"] = buttons
        else:
            self.config["buttons"] = buttons
        cfg_module.save_config(self.config)

    # ── 설정/액션 ────────────────────────────────────
    @pyqtSlot(result=str)
    def get_config(self):
        # 현재 컨텍스트 정보도 함께 전달
        data = dict(self.config)
        folder = self._find_folder(self._current_folder_id)
        data["_current_folder"] = {
            "id": folder.get("id") if folder else None,
            "label": folder.get("label") if folder else None,
            "buttons": folder.get("buttons", []) if folder else None,
        }
        # 테마 dict 동봉 (JS에서 CSS 변수 설정)
        data["theme_data"] = self._get_theme()
        return json.dumps(data, ensure_ascii=False)

    @pyqtSlot(int, result=bool)
    def run_action(self, idx):
        """버튼 액션 실행 (folder_group이면 폴더 진입)"""
        try:
            buttons = self._current_buttons()
            if 0 <= idx < len(buttons):
                btn = buttons[idx]
                # 폴더 그룹 → 진입
                if btn.get("action_type") == "folder_group":
                    self._current_folder_id = btn.get("id")
                    self._refresh_grid()
                    self._update_window_size()
                    return True
                # 일반 액션
                _get_actions().run_action(btn)
                return True
        except Exception as e:
            print(f"run_action 오류: {e}")
        return False

    # ── 윈도우 드래그 (HTML 헤더 → PyQt 윈도우 이동) ──
    @pyqtSlot(int, int)
    def move_window_by(self, dx, dy):
        """HTML 헤더 드래그 → 상대 이동. 드래그 중에는 snap 비활성 (clamp만)"""
        try:
            pos = self.window.pos()
            nx, ny = pos.x() + dx, pos.y() + dy
            if hasattr(self.window, "clamp_and_snap"):
                nx, ny = self.window.clamp_and_snap(nx, ny, snap=False)
            self.window.move(nx, ny)
        except Exception as e:
            print(f"move_window_by 오류: {e}")

    @pyqtSlot()
    def save_window_pos(self):
        """드래그 종료 시 snap 적용 + config 저장 + 숨김 모드 재시작"""
        try:
            # 드래그 종료 시 snap 적용 — 거리 5px로 줄여서 거의 가장자리에 닿아야만 끌림
            if hasattr(self.window, "clamp_and_snap"):
                sx, sy = self.window.clamp_and_snap(self.window.x(), self.window.y(),
                                                    snap=True, snap_dist=5)
                if (sx, sy) != (self.window.x(), self.window.y()):
                    self.window.move(sx, sy)
            pos = self.window.pos()
            self.config["x"] = pos.x()
            self.config["y"] = pos.y()
            cfg_module.save_config(self.config)
            if hasattr(self.window, "cfg"):
                self.window.cfg = self.config
            self.window._widget_auto_pos = None
            if getattr(self.window, "_hidden_edge", None) is not None:
                self.window._hidden_edge = None
                if hasattr(self.window, "_hide_check_timer"):
                    self.window._hide_check_timer.stop()
                self.window.minimize_to_edge()
        except Exception as e:
            print(f"save_window_pos 오류: {e}")

    # ── 외부에서 드롭된 파일/URL → 새 버튼 ───────────
    @pyqtSlot(str)
    def add_dropped_shortcut(self, uri):
        """파일 경로(file:///...) 또는 URL → 즉시 새 버튼 추가.
        action_type을 드롭된 항목에 따라 자동 결정:
        - URL (http/https/ftp...) → 'url'
        - 디렉토리 → 'folder'
        - 실행 파일/단축키 → 'app'
        - 일반 파일 → 'app' (os.startfile로 기본 프로그램에서 열림)
        """
        try:
            import os, urllib.parse
            uri = (uri or "").strip()
            if not uri:
                return
            label = "새 바로가기"
            icon = "📌"
            action_value = uri
            action_type = "url"  # 기본값 (URL로 시작)

            if uri.startswith("file:///"):
                # file:///C:/path/file.exe → C:\path\file.exe
                path = urllib.parse.unquote(uri[8:]).replace("/", "\\")
                action_value = path
                base = os.path.basename(path.rstrip("\\"))
                label = (os.path.splitext(base)[0] or base or "파일")[:25]
                if os.path.isdir(path):
                    # 📁 폴더 → 폴더 열기
                    icon = "📁"
                    action_type = "folder"
                else:
                    ext = os.path.splitext(path)[1].lower()
                    # .url 파일 → 안의 URL 추출 (Windows 인터넷 단축키)
                    if ext == ".url":
                        try:
                            import configparser
                            inner_url = None
                            # 여러 인코딩 순차 시도 (utf-8-sig가 BOM 자동 제거)
                            for enc in ("utf-8-sig", "utf-8", "utf-16", "utf-16-le", "cp949", "latin-1"):
                                try:
                                    with open(path, "r", encoding=enc) as f:
                                        text = f.read()
                                    # configparser 우선 시도
                                    try:
                                        cp = configparser.ConfigParser(interpolation=None)
                                        cp.read_string(text)
                                        inner_url = cp.get("InternetShortcut", "URL", fallback=None)
                                    except Exception:
                                        inner_url = None
                                    # configparser 실패하면 줄별 파싱
                                    if not inner_url:
                                        for line in text.splitlines():
                                            if line.upper().startswith("URL="):
                                                inner_url = line[4:].strip()
                                                break
                                    if inner_url:
                                        break
                                except Exception:
                                    continue
                            if inner_url:
                                action_value = inner_url
                                action_type = "url"
                                icon = "🌐"
                                from urllib.parse import urlparse
                                try:
                                    host = urlparse(inner_url).netloc or inner_url
                                    label = host.replace("www.", "")[:25] or label
                                except Exception:
                                    pass
                                new_id = self._new_id()
                                new_data = {
                                    "id": new_id, "label": label, "icon": icon,
                                    "color": "#1a1d2e", "action_type": action_type,
                                    "action_value": action_value, "admin": False, "icon_image": None,
                                }
                                from button_editor import ButtonEditorDialog
                                theme = self._get_theme()
                                dlg = ButtonEditorDialog(self.window, theme, new_data, is_new=True)
                                dlg.saved.connect(self._on_button_saved)
                                self._ensure_widget_visible_during_dialog(dlg)
                                dlg.show()
                                self._position_dialog(dlg)
                                dlg.exec()
                                return
                        except Exception as _e:
                            print(f".url 파싱 실패, 일반 파일로 fallback: {_e}")
                    # 실행 가능한 모든 파일 → 'app' (기본 프로그램으로 열림)
                    action_type = "app"
                    if ext in (".exe", ".bat", ".cmd", ".com", ".lnk"):
                        icon = "⚙️"
                    elif ext in (".jpg", ".png", ".gif", ".jpeg", ".webp", ".bmp", ".tiff"):
                        icon = "🖼️"
                    elif ext in (".mp4", ".avi", ".mkv", ".mov", ".wmv", ".webm"):
                        icon = "🎬"
                    elif ext in (".mp3", ".wav", ".flac", ".aac", ".ogg"):
                        icon = "🎵"
                    elif ext == ".pdf":
                        icon = "📕"
                    elif ext in (".doc", ".docx"):
                        icon = "📘"
                    elif ext in (".xls", ".xlsx", ".csv"):
                        icon = "📊"
                    elif ext in (".ppt", ".pptx"):
                        icon = "📙"
                    elif ext in (".txt", ".md", ".log"):
                        icon = "📝"
                    elif ext in (".zip", ".rar", ".7z", ".tar", ".gz"):
                        icon = "🗜️"
                    else:
                        icon = "📄"
            else:
                # http/https/기타 URL → 'url'
                icon = "🌐"
                action_type = "url"
                from urllib.parse import urlparse
                try:
                    host = urlparse(uri).netloc or uri
                    label = host.replace("www.", "")[:25] or "링크"
                except Exception:
                    label = uri[:25]

            new_id = self._new_id()
            new_data = {
                "id": new_id, "label": label, "icon": icon,
                "color": "#1a1d2e", "action_type": action_type,
                "action_value": action_value, "admin": False, "icon_image": None,
            }
            # 즉시 추가 X → ButtonEditorDialog 열어서 사용자가 편집/확인 후 저장
            from button_editor import ButtonEditorDialog
            theme = self._get_theme()
            dlg = ButtonEditorDialog(self.window, theme, new_data, is_new=True)
            dlg.saved.connect(self._on_button_saved)
            self._ensure_widget_visible_during_dialog(dlg)
            dlg.show()
            self._position_dialog(dlg)
            dlg.exec()
        except Exception as e:
            print(f"add_dropped_shortcut 오류: {e}")
            import traceback; traceback.print_exc()

    @pyqtSlot(int, int, result=bool)
    def swap_buttons(self, i, j):
        """드래그앤드롭으로 두 버튼 위치 교환 (현재 컨텍스트 안에서)"""
        try:
            buttons = list(self._current_buttons())
            n = len(buttons)
            if 0 <= i < n and 0 <= j < n and i != j:
                buttons[i], buttons[j] = buttons[j], buttons[i]
                self._save_current_buttons(buttons)
                self._refresh_grid()
                return True
        except Exception as e:
            print(f"swap_buttons 오류: {e}")
        return False

    @pyqtSlot(result=bool)
    def exit_folder(self):
        """폴더에서 뒤로가기"""
        self._current_folder_id = None
        self._refresh_grid()
        self._update_window_size()
        return True

    # ── 윈도우 컨트롤 ───────────────────────────────
    @pyqtSlot(result=bool)
    def toggle_pin(self):
        new_state = not self.config.get("always_on_top", True)
        self.config["always_on_top"] = new_state
        cfg_module.save_config(self.config)
        flags = self.window.windowFlags()
        if new_state:
            flags |= Qt.WindowType.WindowStaysOnTopHint
        else:
            flags &= ~Qt.WindowType.WindowStaysOnTopHint
        self.window.setWindowFlags(flags)
        self.window.show()
        return new_state

    @pyqtSlot(result=bool)
    def minimize_to_tray(self):
        """— 버튼 → 가장 가까운 화면 가장자리로 숨김 (작업표시줄 자동숨김 효과)"""
        try:
            self.window.minimize_to_edge()
            self.window.view.page().runJavaScript('if(window.setMinimized) setMinimized(true);')
        except Exception as e:
            print(f"minimize_to_tray 오류: {e}")
            self.window.hide()
        return True

    @pyqtSlot(result=bool)
    def restore_widget(self):
        """□ 버튼 → 완전 복원 (원래 위치)"""
        try:
            self.window.restore_from_edge()
            self.window.view.page().runJavaScript('if(window.setMinimized) setMinimized(false);')
        except Exception as e:
            print(f"restore_widget 오류: {e}")
        return True

    @pyqtSlot(result=bool)
    def quit_app(self):
        QApplication.quit()
        return True

    # ── 다이얼로그 헬퍼 ─────────────────────────────
    def _get_theme(self):
        theme_key = self.config.get("theme", "gaming")
        if hasattr(cfg_module, "THEMES"):
            return cfg_module.THEMES.get(theme_key, cfg_module.THEMES.get("gaming", {}))
        return {}

    def _show_widget_for_action(self):
        """메뉴/액션 시작 시 위젯 펼치고 타이머 정지. 반환: was_hidden 플래그."""
        was_hidden = getattr(self.window, "_hidden_edge", None) is not None
        if was_hidden:
            shown_pos = getattr(self.window, "_shown_pos", None)
            if shown_pos is not None:
                self.window.move(shown_pos)
                self.window._is_shown_at_edge = True
                self.window._set_petals_paused(False)
            if hasattr(self.window, "_hide_check_timer"):
                self.window._hide_check_timer.stop()
        return was_hidden

    def _restore_hidden_after_action(self, was_hidden):
        """액션 끝났는데 dialog 안 띄울 때만 호출 — 다시 가장자리 숨김."""
        if was_hidden and getattr(self.window, "_hidden_edge", None) is not None:
            self.window._hidden_edge = None
            if hasattr(self.window, "_hide_check_timer"):
                self.window._hide_check_timer.stop()
            self.window.minimize_to_edge()

    def _ensure_widget_visible_during_dialog(self, dlg):
        """다이얼로그가 떠있는 동안 위젯 펼친 상태 유지, 닫히면 다시 숨김."""
        if getattr(dlg, "_visible_hooked", False):
            return
        dlg._visible_hooked = True
        try:
            was_hidden = getattr(self.window, "_hidden_edge", None) is not None
            if was_hidden:
                shown_pos = getattr(self.window, "_shown_pos", None)
                if shown_pos is not None:
                    self.window.move(shown_pos)
                    self.window._is_shown_at_edge = True
                    self.window._set_petals_paused(False)
                if hasattr(self.window, "_hide_check_timer"):
                    self.window._hide_check_timer.stop()

            def _on_finished(_r=None):
                if was_hidden and getattr(self.window, "_hidden_edge", None) is not None:
                    self.window._hidden_edge = None
                    if hasattr(self.window, "_hide_check_timer"):
                        self.window._hide_check_timer.stop()
                    self.window.minimize_to_edge()

            if hasattr(dlg, "finished"):
                dlg.finished.connect(_on_finished)
        except Exception as e:
            print(f"_ensure_widget_visible_during_dialog 오류: {e}")

    def _position_dialog(self, dlg, gap: int = 10):
        """다이얼로그를 메인 위젯과 겹치지 않게 자동 배치 (오른쪽 우선, 공간 없으면 왼쪽)"""
        try:
            dlg.adjustSize()
            QApplication.processEvents()  # show 후 실제 사이즈 반영 대기
            # sizeHint vs 실제 width 중 큰 값 사용 (overlap 방지)
            dlg_w = max(dlg.sizeHint().width(), dlg.width(), 280)
            dlg_h = max(dlg.sizeHint().height(), dlg.height(), 400)

            main_geom = self.window.frameGeometry()
            screen = QApplication.screenAt(main_geom.center())
            if screen is None:
                screen = QApplication.primaryScreen()
            avail = screen.availableGeometry()

            right_x = main_geom.right() + gap
            if right_x + dlg_w <= avail.right():
                x = right_x
            else:
                left_x = main_geom.left() - dlg_w - gap
                if left_x >= avail.left():
                    x = left_x
                else:
                    x = avail.left() + (avail.width() - dlg_w) // 2

            y = main_geom.top()
            if y + dlg_h > avail.bottom():
                y = max(avail.top(), avail.bottom() - dlg_h)
            if y < avail.top():
                y = avail.top()

            dlg.move(x, y)
        except Exception as e:
            print(f"_position_dialog 오류: {e}")

    def _refresh_grid(self):
        """JS에 그리드 새로고침 신호"""
        try:
            import json as _json
            folder = self._find_folder(self._current_folder_id)
            payload = {
                "buttons": self._current_buttons(),
                "folder": {
                    "id": folder.get("id") if folder else None,
                    "label": folder.get("label") if folder else None,
                },
                "layout_mode": self.config.get("layout_mode", "grid2"),
                "theme": self.config.get("theme"),
                "theme_data": self._get_theme(),
                "bg_color": self.config.get("bg_color"),
                "small_buttons": self.config.get("small_buttons", False),
            }
            data_json = _json.dumps(payload, ensure_ascii=False)
            js = f"if(window.refreshButtons) refreshButtons({_json.dumps(data_json)});"
            self.window.view.page().runJavaScript(js)
        except Exception as e:
            print(f"_refresh_grid 오류: {e}")

    def _update_window_size(self):
        """현재 컨텍스트 버튼 개수 + 레이아웃 + 작은버튼 → 윈도우 크기 재계산"""
        try:
            n = len(self._current_buttons())
            extra = 1 if self._current_folder_id is not None else 0  # 폴더 안: 뒤로가기 버튼
            mode = self.config.get("layout_mode", "grid2")
            small = self.config.get("small_buttons", False)
            w, h = calc_window_size(n, mode, small, extra)
            # 부드러운 크기 전환 (폴더 진입/이탈 시 어색한 점프 방지)
            if hasattr(self.window, "_animate_resize"):
                self.window._animate_resize(w, h)
            else:
                self.window.setFixedSize(w, h)
        except Exception as e:
            print(f"_update_window_size 오류: {e}")

    # ── 버튼 저장/삭제 콜백 ───────────────────────────
    def _on_button_saved(self, btn_data):
        buttons = list(self._current_buttons())
        replaced = False
        for i, b in enumerate(buttons):
            if b.get("id") == btn_data.get("id"):
                buttons[i] = btn_data
                replaced = True
                break
        if not replaced:
            buttons.append(btn_data)
        self._save_current_buttons(buttons)
        self._refresh_grid()
        self._update_window_size()

    def _on_button_deleted(self, btn_id):
        # 삭제되는 버튼의 연결 이미지 파일도 정리
        for b in self._current_buttons():
            if b.get("id") == btn_id and b.get("icon_image"):
                try:
                    cfg_module.remove_button_image(b["icon_image"])
                except Exception:
                    pass
                break
        buttons = [b for b in self._current_buttons() if b.get("id") != btn_id]
        self._save_current_buttons(buttons)
        self._refresh_grid()
        self._update_window_size()

    def _menu_stylesheet(self, theme):
        return f"""
            QMenu {{ background:{theme.get('bg','#0d1117')}; border:1px solid {theme.get('accent','#58a6ff')}; border-radius:8px; padding:4px; }}
            QMenu::item {{ color:{theme.get('btn_text','#e6edf3')}; padding:8px 16px; font-size:13px; border-radius:5px; }}
            QMenu::item:selected {{ background:{theme.get('accent','#58a6ff')}33; color:{theme.get('accent','#58a6ff')}; }}
            QMenu::item:disabled {{ color:{theme.get('btn_sub','#6e7691')}; }}
        """

    def _new_id(self):
        """루트 + 모든 폴더 안 ID 통합하여 신규 ID 발급"""
        all_ids = []
        for b in self.config.get("buttons", []):
            all_ids.append(b.get("id", 0))
            for sub in b.get("buttons", []) or []:
                all_ids.append(sub.get("id", 0))
        return max(all_ids, default=-1) + 1

    @pyqtSlot(int, result=bool)
    def show_edit_menu(self, idx):
        """우클릭 → 편집/삭제 메뉴 (folder_group이면 FolderEditDialog 사용)"""
        try:
            from PyQt6.QtWidgets import QMenu
            from PyQt6.QtGui import QCursor

            buttons = self._current_buttons()
            if not (0 <= idx < len(buttons)):
                return False
            btn = buttons[idx]
            theme = self._get_theme()
            is_folder = (btn.get("action_type") == "folder_group")

            menu = QMenu(self.window)
            menu.setStyleSheet(self._menu_stylesheet(theme))
            edit_act = menu.addAction("✏️ 편집")
            del_act  = menu.addAction("🗑️ 삭제")

            # 메뉴 떠있는 동안 위젯 펼침
            was_hidden = self._show_widget_for_action()
            chosen = menu.exec(QCursor.pos())

            if chosen is None:
                self._restore_hidden_after_action(was_hidden)
                return True
            if chosen == edit_act:
                if is_folder:
                    from widget import FolderEditDialog
                    dlg = FolderEditDialog(self.window, theme, btn, is_new=False)
                    dlg.saved.connect(self._on_button_saved)
                else:
                    from button_editor import ButtonEditorDialog
                    dlg = ButtonEditorDialog(self.window, theme, btn, is_new=False)
                    dlg.saved.connect(self._on_button_saved)
                    if hasattr(dlg, "deleted"):
                        dlg.deleted.connect(self._on_button_deleted)
                self._ensure_widget_visible_during_dialog(dlg)
                dlg.show()
                self._position_dialog(dlg)
                dlg.exec()
            elif chosen == del_act:
                self._on_button_deleted(btn.get("id", -1))
                self._restore_hidden_after_action(was_hidden)
            return True
        except Exception as e:
            print(f"show_edit_menu 오류: {e}")
            import traceback; traceback.print_exc()
            return False

    @pyqtSlot(result=bool)
    def add_button(self):
        """+ 버튼 → 일반/폴더그룹 메뉴 (타이머/카운터 제거)"""
        try:
            from PyQt6.QtWidgets import QMenu
            from PyQt6.QtGui import QCursor

            theme = self._get_theme()
            menu = QMenu(self.window)
            menu.setStyleSheet(self._menu_stylesheet(theme))

            a_normal = menu.addAction("🔘 새 버튼")
            a_folder = menu.addAction("📁 새 폴더")

            # 폴더 안에서는 중첩 폴더 비허용
            if self._current_folder_id is not None:
                a_folder.setEnabled(False)

            # 메뉴 떠있는 동안 위젯 펼침
            was_hidden = self._show_widget_for_action()
            chosen = menu.exec(QCursor.pos())
            if chosen is None:
                self._restore_hidden_after_action(was_hidden)
                return True

            new_id = self._new_id()

            if chosen == a_normal:
                from button_editor import ButtonEditorDialog
                new_data = {
                    "id": new_id, "label": "새 버튼", "icon": "💻",
                    "color": "#1a1d2e", "action_type": "url",
                    "action_value": "", "admin": False, "icon_image": None,
                }
                dlg = ButtonEditorDialog(self.window, theme, new_data, is_new=True)
                dlg.saved.connect(self._on_button_saved)
                self._ensure_widget_visible_during_dialog(dlg)
                dlg.show()
                self._position_dialog(dlg)
                dlg.exec()

            elif chosen == a_folder:
                from widget import FolderEditDialog
                new_data = {
                    "id": new_id, "label": "새 그룹", "icon": "🗂️",
                    "color": "#1a2d2d", "action_type": "folder_group",
                    "action_value": "", "admin": False, "icon_image": None,
                    "buttons": [],
                }
                dlg = FolderEditDialog(self.window, theme, new_data, is_new=True)
                dlg.saved.connect(self._on_button_saved)
                self._ensure_widget_visible_during_dialog(dlg)
                dlg.show()
                self._position_dialog(dlg)
                dlg.exec()

            return True
        except Exception as e:
            print(f"add_button 오류: {e}")
            import traceback; traceback.print_exc()
            return False

    @pyqtSlot(result=bool)
    def _manual_update_check(self):
        """설정창의 '업데이트 확인' 버튼 → 즉시 업데이트 확인 (최신이면 알림)."""
        try:
            upd = getattr(self.window, "_updater", None)
            if upd is None:
                upd = UpdateChecker(self.window)
                self.window._updater = upd
            upd.check(manual=True)
        except Exception as e:
            print(f"수동 업데이트 확인 오류: {e}")

    def _discard_settings_dialog(self):
        """이전 설정창 정리 — 저장 후 hide()된 창이 쌓이면서 신호 연결이 남는 것 방지.
        reject()를 타면 옛 설정으로 되돌리므로 close() 대신 신호 끊고 파기한다."""
        dlg = getattr(self, "_settings_dlg", None)
        self._settings_dlg = None
        if dlg is None:
            return
        try:
            for sig in ("saved", "rejected"):
                try:
                    getattr(dlg, sig).disconnect()
                except Exception:
                    pass
            dlg.hide()
            dlg.deleteLater()
        except RuntimeError:
            pass  # 이미 파괴된 C++ 객체
        except Exception:
            pass

    @pyqtSlot(result=bool)
    def open_settings(self):
        """⚙ → 설정 다이얼로그 (modeless). 옵션 클릭=즉시 적용. 취소=원복. 저장=확정"""
        try:
            from widget import SettingsDialog
            import copy
            # 이미 떠 있으면 새로 만들지 않고 그 창을 앞으로 (⚙ 연타 시 창 중복 방지)
            existing = getattr(self, "_settings_dlg", None)
            if existing is not None:
                visible = False
                try:
                    visible = existing.isVisible()
                except RuntimeError:
                    self._settings_dlg = None  # 이미 파괴됨
                if visible:
                    existing.raise_()
                    existing.activateWindow()
                    return True
                self._discard_settings_dialog()  # 저장 후 숨겨진 옛 창 정리
            theme = self._get_theme()
            orig_cfg = copy.deepcopy(self.config)
            dlg = SettingsDialog(self.window, theme, self.config,
                                 app_version=APP_VERSION,
                                 on_check_update=self._manual_update_check)
            self._ensure_widget_visible_during_dialog(dlg)

            saved_called = [False]

            def _on_saved(new_cfg):
                try:
                    saved_called[0] = True
                    # 테마가 바뀌었는데 bg_color는 옛 테마 기본 bg 그대로면 → 새 테마 기본 bg로 자동 reset
                    # (사용자가 다크 테마 검정 bg 그대로 두고 라이트 테마 가면 검정이 그대로 남는 거 방지)
                    try:
                        old_theme = orig_cfg.get("theme")
                        new_theme = new_cfg.get("theme")
                        if old_theme and new_theme and old_theme != new_theme:
                            old_default_bg = cfg_module.THEMES.get(old_theme, {}).get("bg")
                            new_default_bg = cfg_module.THEMES.get(new_theme, {}).get("bg")
                            cur_bg = new_cfg.get("bg_color")
                            if new_default_bg and cur_bg == old_default_bg:
                                new_cfg["bg_color"] = new_default_bg
                    except Exception:
                        pass
                    self.config = dict(new_cfg)
                    cfg_module.save_config(self.config)
                    self.window.cfg = self.config
                    self._refresh_grid()
                    self._update_window_size()
                    self.window.setWindowOpacity(self.config.get("opacity", 0.95))
                    # modeless dialog hide (close는 closeEvent chain 유발 → hide만)
                    # ★ hide()는 finished 시그널을 안 쏴서 _on_finished(재최소화) 복원이 안 돎.
                    #   저장 전 최소화(가장자리 숨김) 상태였으면 여기서 직접 다시 숨김.
                    def _hide_and_restore_min():
                        try:
                            dlg.hide()
                            if getattr(self.window, "_hidden_edge", None) is not None:
                                self.window._hidden_edge = None
                                if hasattr(self.window, "_hide_check_timer"):
                                    self.window._hide_check_timer.stop()
                                self.window.minimize_to_edge()
                        except Exception as _e:
                            print(f"_on_saved hide/remin 오류: {_e}")
                    QTimer.singleShot(100, _hide_and_restore_min)
                except Exception as e:
                    print(f"_on_saved 오류: {e}")
                    import traceback; traceback.print_exc()

            def _on_rejected():
                # 저장된 적 있으면 복구 skip (저장 후 X 클릭 등의 경우)
                if saved_called[0]:
                    return
                # 취소: 진입 전 cfg로 완전 복구
                self.config = orig_cfg
                self.window.cfg = orig_cfg
                cfg_module.save_config(orig_cfg)
                self._refresh_grid()
                self._update_window_size()
                self.window.setWindowOpacity(orig_cfg.get("opacity", 0.95))

            if hasattr(dlg, "saved"):
                dlg.saved.connect(_on_saved)
            dlg.rejected.connect(_on_rejected)
            dlg.setModal(False)
            self._ensure_widget_visible_during_dialog(dlg)
            dlg.show()
            self._position_dialog(dlg)
            dlg._auto_pos = dlg.pos()
            self._settings_dlg = dlg
            return True
        except Exception as e:
            print(f"open_settings 오류: {e}")
            import traceback; traceback.print_exc()
            return False



# ─────────────────────────────────────────────────────────────
# Main Window
# ─────────────────────────────────────────────────────────────
class _BgContainerShim:
    """SettingsDialog의 `self._main_widget.container.setStyleSheet(...)` 호환용 가짜 객체.
    CSS 문자열에서 background 색을 추출해 widget.html의 --bg CSS 변수로 즉시 반영."""
    def __init__(self, window):
        self._window = window

    def setStyleSheet(self, css: str):
        try:
            import re
            m = re.search(r'background\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))', css)
            if not m:
                return
            bg = m.group(1)
            # config 업데이트 + JS에 즉시 변경 전송
            self._window.cfg["bg_color"] = bg
            page = self._window.view.page()
            js = f'document.documentElement.style.setProperty("--bg", {json.dumps(bg)});'
            page.runJavaScript(js)
        except Exception as e:
            print(f"_BgContainerShim 오류: {e}")


class SupportDeckWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.cfg = cfg_module.load_config()
        self._drag_pos = None
        # SettingsDialog 호환 — 옛 widget.py가 기대하는 속성들
        self._is_collapsed = False
        self.container = _BgContainerShim(self)

        # 윈도우 크기 계산 — 레이아웃/작은버튼 반영
        n_btns = len(self.cfg.get("buttons", []))
        mode = self.cfg.get("layout_mode", "grid2")
        small = self.cfg.get("small_buttons", False)
        win_w, win_h = calc_window_size(n_btns, mode, small)

        # 프레임리스 + 투명 배경 + 항상 위
        flags = Qt.WindowType.FramelessWindowHint | Qt.WindowType.Tool
        if self.cfg.get("always_on_top", True):
            flags |= Qt.WindowType.WindowStaysOnTopHint
        self.setWindowFlags(flags)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        # WA_NoSystemBackground 제거 — Frameless+Transparent에서 size 변경 paint 막는 알려진 이슈
        # QMainWindow 자체 배경 투명 (centralWidget 외 영역 회색 잔여 방지)
        self.setStyleSheet(
            "QMainWindow { background: transparent; border: none; }"
            "QWidget#centralWidget { background: transparent; }"
        )
        self.setContentsMargins(0, 0, 0, 0)
        self.setWindowOpacity(self.cfg.get("opacity", 0.95))

        # 위치 / 크기
        self.setFixedSize(win_w, win_h)
        self.move(self.cfg.get("x", 100), self.cfg.get("y", 100))
        self.setWindowTitle("SupportDeck")

        # WebView — 캐시 비활성화 (코드 수정 즉시 반영)
        from PyQt6.QtWebEngineCore import QWebEngineProfile
        _profile = QWebEngineProfile.defaultProfile()
        try:
            _profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.NoCache)
            _profile.setPersistentCookiesPolicy(QWebEngineProfile.PersistentCookiesPolicy.NoPersistentCookies)
        except Exception:
            pass

        self.view = QWebEngineView()
        self.view.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.view.setStyleSheet("background: transparent;")
        self.view.page().setBackgroundColor(Qt.GlobalColor.transparent)
        self.setCentralWidget(self.view)
        # centralWidget이 윈도우 전체를 차지하도록 margin 0 보장
        cw = self.centralWidget()
        if cw is not None:
            cw.setContentsMargins(0, 0, 0, 0)
            cw.setObjectName("centralWidget")

        # WebChannel
        self.channel = QWebChannel()
        self.bridge = Bridge(self)
        self.channel.registerObject("bridge", self.bridge)
        self.view.page().setWebChannel(self.channel)

        # HTML 로드 (빌드/개발 환경 모두 대응)
        html_path = resource_path("widget.html")
        self.view.setUrl(QUrl.fromLocalFile(html_path))

        # ★ 외부 파일/URL drop을 PyQt 차원에서 받기 (Chromium이 file.path 안 줘서)
        self.setAcceptDrops(True)
        # WebEngineView의 자식(Chromium widget)에 이벤트 필터 설치
        self.view.loadFinished.connect(self._install_drop_filter)

    def _install_drop_filter(self, ok):
        """WebEngineView 자식 widget들에 drop 이벤트 필터 설치 (Chromium widget 포함)"""
        try:
            self.view.setAcceptDrops(True)
            self.view.installEventFilter(self)
            for child in self.view.findChildren(QWidget):
                child.setAcceptDrops(True)
                child.installEventFilter(self)
        except Exception as e:
            print(f"_install_drop_filter 오류: {e}")

    # ── 시작 인트로(큰 아이콘 → 이동+축소로 위젯이 됨, 전부 GPU) ──
    # 잘림/떨림 0 원칙: 네이티브 창은 애니메이션 리사이즈를 안 함.
    #   - 풀스크린 투명 오버레이로 고정 → 그 위에서 아이콘을 CSS transform
    #     (translate+scale)으로 '이동하면서 축소' → 웹뷰 리사이즈가 없어 잘림 없음.
    #   - 끝에서 창을 위젯 크기로 '즉시' 스냅 + 위젯 페이드인.
    def start_intro(self):
        """일반 show() 대신 호출."""
        if not self.cfg.get("intro_animation", True):
            self.show()
            return
        self._intro_final = QRect(self.x(), self.y(), self.width(), self.height())
        self._intro_target_op = self.cfg.get("opacity", 0.95)
        final = self._intro_final
        fx, fy, fw, fh = final.x(), final.y(), final.width(), final.height()
        screen = QApplication.screenAt(final.center()) or QApplication.primaryScreen()
        sg = screen.availableGeometry()
        scx, scy = sg.center().x(), sg.center().y()                # 화면 중앙(절대좌표)
        # 아이콘은 정사각형 → 끝 크기는 '위젯의 짧은 변'에 맞춤(가로형도 안전)
        end_px = max(40, int(min(fw, fh) * 0.92))
        big_px = int(min(max(fw, fh) * 1.18, min(sg.width(), sg.height()) * 0.57))  # 시작 큰 아이콘(조금 더 ↓)
        big_px = max(big_px, end_px + 2)
        # 오버레이 창: 가능하면 '위젯 좌상단'을 원점으로 → 끝에서 폭/높이만 줄여
        # 위젯 크기로 스냅하면 좌상단이 안 변해 이음매(점프)가 없음. 큰 아이콘(+그림자)이
        # 그 창에 다 들어와야 함. 안 되면 풀스크린으로 폴백.
        mg = 60
        need_l, need_t = scx - big_px // 2 - mg, scy - big_px // 2 - mg
        need_r, need_b = scx + big_px // 2 + mg, scy + big_px // 2 + mg
        if need_l >= fx and need_t >= fy:
            owx, owy = fx, fy
            ow, oh = max(fx + fw, need_r) - owx, max(fy + fh, need_b) - owy
        else:
            owx, owy, ow, oh = sg.x(), sg.y(), sg.width(), sg.height()
        self._intro_overlay = QRect(owx, owy, ow, oh)
        self._intro_coords = {
            "icx": scx - owx, "icy": scy - owy, "base": int(big_px),
            "s0": 1.0, "s1": round(end_px / big_px, 4),
            "dx": (fx + end_px // 2 + 6) - scx, "dy": (fy + fh // 2) - scy,   # 아이콘: 화면중앙→위젯 좌측
            "wx": fx - owx, "wy": fy - owy, "ww": fw, "wh": fh,       # 위젯: 최종 화면자리
            "ws0": round(end_px / fw, 4),       # 위젯 블룸 시작 스케일 ≈ 아이콘 크기(폭 기준)
        }
        print(f"[intro] widget={fw}x{fh} overlay={ow}x{oh}@({owx},{owy}) big={big_px} end={end_px} s1={self._intro_coords['s1']}")
        self.setMinimumSize(0, 0)
        self.setMaximumSize(16777215, 16777215)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.setGeometry(self._intro_overlay)
        self.setWindowOpacity(0.0)
        self._intro_started = False
        self._intro_finished = False
        self.show()
        self.view.loadFinished.connect(self._intro_on_loaded)
        QTimer.singleShot(2500, self._intro_begin)

    def _intro_on_loaded(self, ok):
        try:
            self.view.loadFinished.disconnect(self._intro_on_loaded)
        except Exception:
            pass
        QTimer.singleShot(60, self._intro_begin)

    def _intro_begin(self):
        if getattr(self, "_intro_started", False):
            return
        self._intro_started = True
        # 아이콘 크게 셋업 + 창 페이드인
        try:
            self.view.page().runJavaScript(
                "if(window.setupIntro) setupIntro(%s);" % json.dumps(self._intro_coords))
        except Exception:
            pass
        self._intro_fade = QPropertyAnimation(self, b"windowOpacity")
        self._intro_fade.setDuration(240)
        self._intro_fade.setStartValue(0.0)
        self._intro_fade.setEndValue(self._intro_target_op)
        self._intro_fade.start()
        # 큰 아이콘 잠깐 보여준 뒤 이동+축소 (위젯 더 빨리 나오게 대기 단축)
        QTimer.singleShot(250, self._intro_move)

    def _intro_move(self):
        # 아이콘 이동+축소 (GPU). 창은 그대로 → 잘림/떨림 없음.
        try:
            self.view.page().runJavaScript("if(window.playIntroMove) playIntroMove();")
        except Exception:
            pass
        # 이동 '도중에' 위젯을 펼치기 시작(겹침) + 아이콘은 위젯에 '도착할 즈음' 페이드(증발 X)
        QTimer.singleShot(160, self._intro_build)      # 위젯 펼침 시작(이동과 동시)
        QTimer.singleShot(420, self._intro_iconfade)   # 아이콘이 위젯에 거의 도착했을 때 사라짐
        QTimer.singleShot(1100, self._intro_finish)    # 빌드 끝난 뒤 창 스냅(안 보임)

    def _intro_build(self):
        try:
            self.view.page().runJavaScript("if(window.introBuild) introBuild();")
        except Exception:
            pass

    def _intro_iconfade(self):
        try:
            self.view.page().runJavaScript("if(window.introIconFade) introIconFade();")
        except Exception:
            pass

    def _intro_finish(self):
        if getattr(self, "_intro_finished", False):
            return
        self._intro_finished = True
        final = getattr(self, "_intro_final", None)
        if final is None:
            return
        # 위젯은 이미 최종 화면자리에 풀사이즈로 떠 있음 → 창 폭/높이만 위젯 크기로 스냅
        # (오버레이 좌상단 == 위젯 좌상단이면 위치가 안 변해 이음매 없음). 그 뒤 위젯 복원.
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, False)
        self.setFixedSize(final.width(), final.height())
        self.move(final.x(), final.y())
        try:
            self.view.page().runJavaScript("if(window.introSettle) introSettle();")
        except Exception:
            pass

    # ── 드래그앤드롭 보조: 항상-위 토글 + +버튼 hover 피드백 ──
    def _set_topmost(self, on):
        """런타임에 항상-위(TOPMOST)만 토글 (창 재생성/깜빡임 없이, Windows)."""
        try:
            if sys.platform != "win32":
                return
            import ctypes
            HWND_TOPMOST, HWND_NOTOPMOST = -1, -2
            SWP = 0x0001 | 0x0002 | 0x0010  # NOSIZE | NOMOVE | NOACTIVATE
            ctypes.windll.user32.SetWindowPos(
                int(self.winId()), HWND_TOPMOST if on else HWND_NOTOPMOST, 0, 0, 0, 0, SWP)
        except Exception:
            pass

    def _drag_below_begin(self):
        """드래그가 위젯 위에 있는 동안 잠깐 항상-위 해제 → OS 드래그 파일이 위로 보임."""
        self._drag_active = True
        if not self.cfg.get("always_on_top", True):
            return
        self._set_topmost(False)
        if not hasattr(self, "_drag_restore_timer"):
            self._drag_restore_timer = QTimer(self)
            self._drag_restore_timer.setSingleShot(True)
            self._drag_restore_timer.timeout.connect(self._drag_below_end)
        self._drag_restore_timer.start(1200)   # DragMove마다 갱신 → 드래그 끝나면 복원

    def _drag_below_end(self):
        """드롭/드래그 종료 → 항상-위 복원 + +버튼 하이라이트 정리."""
        self._drag_active = False
        if hasattr(self, "_drag_restore_timer"):
            self._drag_restore_timer.stop()
        if self.cfg.get("always_on_top", True):
            self._set_topmost(True)
        try:
            self.view.page().runJavaScript("if(window.dragHoverClear) dragHoverClear();")
        except Exception:
            pass

    def eventFilter(self, obj, event):
        """WebEngineView 자식에서 발생한 drag/drop 가로채기"""
        try:
            t = event.type()
            if t == QEvent.Type.DragEnter or t == QEvent.Type.DragMove:
                if event.mimeData().hasUrls():
                    event.acceptProposedAction()
                    self._drag_below_begin()   # 드래그 파일이 위젯 위로 보이게
                    try:
                        pt = self.view.mapFromGlobal(QCursor.pos())
                        self.view.page().runJavaScript(
                            f"if(window.dragHoverAt) dragHoverAt({pt.x()},{pt.y()});")
                    except Exception:
                        pass
                    return True
            elif t == QEvent.Type.Drop:
                if event.mimeData().hasUrls():
                    urls = event.mimeData().urls()
                    if urls and hasattr(self, "bridge"):
                        for url in urls:
                            path = url.toLocalFile()
                            if path:
                                uri = "file:///" + path.replace("\\", "/")
                            else:
                                uri = url.toString()
                            # 비동기로 호출 (이벤트 처리 끝난 후)
                            QTimer.singleShot(0, lambda u=uri: self.bridge.add_dropped_shortcut(u))
                            break  # 첫 파일만
                    event.acceptProposedAction()
                    self._drag_below_end()     # 항상-위 복원 + 하이라이트 정리
                    return True
        except Exception as e:
            print(f"eventFilter 오류: {e}")
        return super().eventFilter(obj, event)

    def dragEnterEvent(self, e):
        if e.mimeData().hasUrls():
            e.acceptProposedAction()

    def dropEvent(self, e):
        if e.mimeData().hasUrls():
            urls = e.mimeData().urls()
            if urls and hasattr(self, "bridge"):
                for url in urls:
                    path = url.toLocalFile()
                    uri = ("file:///" + path.replace("\\", "/")) if path else url.toString()
                    QTimer.singleShot(0, lambda u=uri: self.bridge.add_dropped_shortcut(u))
                    break
            e.acceptProposedAction()

    def resizeEvent(self, e):
        """리사이즈 시 둥근 모양 마스크 — 직각 잔여 테두리 제거"""
        super().resizeEvent(e)
        try:
            radius = 18  # CSS --radius와 동일
            path = QPainterPath()
            path.addRoundedRect(QRectF(self.rect()), radius, radius)
            region = QRegion(path.toFillPolygon().toPolygon())
            self.setMask(region)
        except Exception:
            pass

    # ── 윈도우 드래그 (HTML이 -webkit-app-region 못 쓰므로 PyQt가 직접) ─
    def mousePressEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            if e.position().y() < 30:
                self._drag_pos = e.globalPosition().toPoint() - self.frameGeometry().topLeft()

    def mouseMoveEvent(self, e):
        if e.buttons() == Qt.MouseButton.LeftButton and self._drag_pos:
            new_pos = e.globalPosition().toPoint() - self._drag_pos
            # 드래그 중에는 snap 비활성 — 자석 효과가 드래그 방해 안 함
            x, y = self.clamp_and_snap(new_pos.x(), new_pos.y(), snap=False)
            self.move(x, y)

    def mouseReleaseEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            if self._drag_pos:
                # 드래그 종료 시 snap 적용 — 5px로 약하게
                snapped_x, snapped_y = self.clamp_and_snap(self.x(), self.y(),
                                                          snap=True, snap_dist=5)
                if (snapped_x, snapped_y) != (self.x(), self.y()):
                    self.move(snapped_x, snapped_y)
                pos = self.pos()
                self.cfg["x"] = pos.x()
                self.cfg["y"] = pos.y()
                cfg_module.save_config(self.cfg)
                self._widget_auto_pos = None
                if getattr(self, "_hidden_edge", None) is not None:
                    self._hidden_edge = None
                    if hasattr(self, "_hide_check_timer"):
                        self._hide_check_timer.stop()
                    self.minimize_to_edge()
            self._drag_pos = None

    def _animate_to(self, target_pos, duration=220, on_finished=None):
        """위치 슬라이드 애니메이션 (현재 → target_pos)"""
        try:
            if hasattr(self, "_pos_anim") and self._pos_anim is not None:
                self._pos_anim.stop()
            anim = QPropertyAnimation(self, b"pos")
            anim.setDuration(duration)
            anim.setStartValue(self.pos())
            anim.setEndValue(target_pos)
            anim.setEasingCurve(QEasingCurve.Type.OutCubic)
            if on_finished:
                anim.finished.connect(on_finished)
            anim.start()
            self._pos_anim = anim
        except Exception as e:
            print(f"_animate_to 오류: {e}")
            self.move(target_pos)
            if on_finished:
                on_finished()

    def _animate_resize(self, target_w, target_h, duration=130):
        """위젯 크기를 빠르게 전환 (화면 축소되는 듯한 느낌)"""
        try:
            from PyQt6.QtCore import QSize
            cur = self.size()
            if cur.width() == target_w and cur.height() == target_h:
                return  # 변경 없음
            # 진행 중인 애니메이션 정리
            for attr in ("_resize_anim_min", "_resize_anim_max"):
                a = getattr(self, attr, None)
                if a is not None:
                    try: a.stop()
                    except: pass
            target = QSize(target_w, target_h)
            # OutExpo: 빠르게 시작 후 막판에 부드럽게 정착 (화면 축소 느낌)
            curve = QEasingCurve.Type.OutExpo
            self._resize_anim_min = QPropertyAnimation(self, b"minimumSize")
            self._resize_anim_min.setDuration(duration)
            self._resize_anim_min.setStartValue(cur)
            self._resize_anim_min.setEndValue(target)
            self._resize_anim_min.setEasingCurve(curve)
            self._resize_anim_max = QPropertyAnimation(self, b"maximumSize")
            self._resize_anim_max.setDuration(duration)
            self._resize_anim_max.setStartValue(cur)
            self._resize_anim_max.setEndValue(target)
            self._resize_anim_max.setEasingCurve(curve)
            self._resize_anim_min.start()
            self._resize_anim_max.start()
        except Exception as e:
            print(f"_animate_resize 오류: {e}")
            self.setFixedSize(target_w, target_h)

    def _set_petals_paused(self, paused: bool):
        """벚꽃 꽃잎 애니메이션 정지/재개 — 가장자리 숨김 동안 CPU 절약."""
        try:
            self.view.page().runJavaScript(
                f"window.setPetalsPaused && setPetalsPaused({'true' if paused else 'false'})")
        except Exception:
            pass

    def minimize_to_edge(self):
        """가장 가까운 가장자리로 영구 숨김 (3px만 보임). 마우스 hover 시 잠깐 펼침."""
        try:
            if getattr(self, "_hidden_edge", None) is not None:
                return  # 이미 숨김 모드
            screen = QApplication.screenAt(self.frameGeometry().center())
            if screen is None:
                screen = QApplication.primaryScreen()
            avail = screen.availableGeometry()
            pos = self.pos()
            win_w = self.width()
            win_h = self.height()
            d_left  = pos.x() - avail.left()
            d_right = avail.right() - (pos.x() + win_w)
            d_top   = pos.y() - avail.top()
            # 하단(bottom)은 작업표시줄과 충돌 우려로 제외 — 상/좌/우 중에서만 선택
            min_d = min(d_left, d_right, d_top)

            self._hidden_orig_pos = QPoint(pos.x(), pos.y())  # 트레이 클릭 시 복원용
            self._hidden_avail = avail
            self._is_shown_at_edge = False
            peek = 3

            if min_d == d_left:
                self._hidden_edge = "left"
                self._hidden_pos = QPoint(avail.left() - win_w + peek, pos.y())
                self._shown_pos = QPoint(avail.left(), pos.y())
            elif min_d == d_right:
                self._hidden_edge = "right"
                self._hidden_pos = QPoint(avail.right() - peek, pos.y())
                self._shown_pos = QPoint(avail.right() - win_w, pos.y())
            else:  # d_top
                self._hidden_edge = "top"
                self._hidden_pos = QPoint(pos.x(), avail.top() - win_h + peek)
                self._shown_pos = QPoint(pos.x(), avail.top())

            # 마우스 polling 준비
            if not hasattr(self, "_hide_check_timer"):
                self._hide_check_timer = QTimer(self)
                self._hide_check_timer.setInterval(100)
                self._hide_check_timer.timeout.connect(self._check_mouse_proximity)
            # 슬라이드 애니메이션 → 끝나면 polling 시작 (꽃잎도 정지)
            self._set_petals_paused(True)
            self._animate_to(self._hidden_pos, duration=220,
                             on_finished=lambda: self._hide_check_timer.start())
        except Exception as e:
            print(f"minimize_to_edge 오류: {e}")

    def _check_mouse_proximity(self):
        """마우스 hover 토글: 가장자리 근처면 펼침, 위젯 벗어나면 다시 숨김"""
        try:
            if getattr(self, "_hidden_edge", None) is None:
                if hasattr(self, "_hide_check_timer"):
                    self._hide_check_timer.stop()
                return
            cursor_pos = QCursor.pos()
            avail = self._hidden_avail
            edge = self._hidden_edge
            proximity = 3  # 화면 진짜 끝(닿을 정도)에서만 펼침 — 작업표시줄 자동숨김처럼
            win_w = self.width()
            win_h = self.height()
            sx, sy = self._shown_pos.x(), self._shown_pos.y()
            shown_geom = QRect(sx, sy, win_w, win_h)

            if self._is_shown_at_edge:
                # 펼친 상태: 위젯 + 5px buffer 밖이면 다시 숨김
                buffer = 5
                if not shown_geom.adjusted(-buffer, -buffer, buffer, buffer).contains(cursor_pos):
                    if getattr(self, "_drag_active", False):
                        return  # 드래그 중엔 펼친 채 유지 (드롭할 수 있게)
                    self._is_shown_at_edge = False
                    self._set_petals_paused(True)
                    self._animate_to(self._hidden_pos, duration=160)
            else:
                # 숨김 상태: 마우스가 가장자리 근처면 펼침
                near = False
                if edge == "left" and cursor_pos.x() < avail.left() + proximity \
                        and sy <= cursor_pos.y() <= sy + win_h:
                    near = True
                elif edge == "right" and cursor_pos.x() > avail.right() - proximity \
                        and sy <= cursor_pos.y() <= sy + win_h:
                    near = True
                elif edge == "top" and cursor_pos.y() < avail.top() + proximity \
                        and sx <= cursor_pos.x() <= sx + win_w:
                    near = True
                elif edge == "bottom" and cursor_pos.y() > avail.bottom() - proximity \
                        and sx <= cursor_pos.x() <= sx + win_w:
                    near = True
                if near:
                    self._is_shown_at_edge = True
                    self._set_petals_paused(False)
                    self._animate_to(self._shown_pos, duration=160)
                    if getattr(self, "_drag_active", False):
                        self._set_topmost(False)   # 드래그 중엔 raise 대신 NOTOPMOST 유지 → 파일이 위로
                    else:
                        self.raise_()
        except Exception as e:
            print(f"_check_mouse_proximity 오류: {e}")

    def restore_from_edge(self):
        """트레이 클릭 시 완전 복원: 원래 위치로 슬라이드 + 숨김 모드 해제"""
        try:
            orig = getattr(self, "_hidden_orig_pos", None)
            self._hidden_edge = None
            self._is_shown_at_edge = False
            self._set_petals_paused(False)
            if hasattr(self, "_hide_check_timer"):
                self._hide_check_timer.stop()
            if orig is not None:
                self._animate_to(orig, duration=220,
                                 on_finished=lambda: (self.raise_(), self.activateWindow()))
            else:
                self.raise_()
                self.activateWindow()
            self._hidden_orig_pos = None
        except Exception as e:
            print(f"restore_from_edge 오류: {e}")

    def clamp_and_snap(self, x, y, snap_dist=15, snap=True):
        """위젯 위치를 모든 모니터 union 안으로 clamp. snap=True면 가장자리 자석 효과 적용."""
        try:
            screens = QApplication.screens()
            if not screens:
                return x, y
            win_w = self.width()
            win_h = self.height()
            # 1) 모든 모니터 union으로 화면 밖 방지
            total_geom = screens[0].availableGeometry()
            for s in screens[1:]:
                total_geom = total_geom.united(s.availableGeometry())
            x = max(total_geom.left(), min(x, total_geom.right() - win_w))
            y = max(total_geom.top(), min(y, total_geom.bottom() - win_h))
            # snap 비활성이면 clamp만 반환 (드래그 중에 가장자리에 안 끌리게)
            if not snap:
                return x, y
            # 2) snap — 현재 모니터 가장자리에 다른 모니터가 인접 안 한 경우에만 (인접이면 자유 이동)
            center = QPoint(x + win_w // 2, y + win_h // 2)
            screen = QApplication.screenAt(center)
            if screen is None:
                screen = QApplication.screenAt(QCursor.pos()) or QApplication.primaryScreen()
            avail = screen.availableGeometry()

            # 인접 모니터 존재 여부 (5px 오차 허용)
            tol = 5
            def has_neighbor_left():
                return any(s is not screen and abs(s.availableGeometry().right() - avail.left()) < tol for s in screens)
            def has_neighbor_right():
                return any(s is not screen and abs(s.availableGeometry().left() - avail.right()) < tol for s in screens)
            def has_neighbor_top():
                return any(s is not screen and abs(s.availableGeometry().bottom() - avail.top()) < tol for s in screens)
            def has_neighbor_bottom():
                return any(s is not screen and abs(s.availableGeometry().top() - avail.bottom()) < tol for s in screens)

            # 좌측 snap (왼쪽에 다른 모니터 없을 때만)
            if x - avail.left() < snap_dist and not has_neighbor_left():
                x = avail.left()
            elif (avail.right() - (x + win_w)) < snap_dist and not has_neighbor_right():
                x = avail.right() - win_w
            if y - avail.top() < snap_dist and not has_neighbor_top():
                y = avail.top()
            elif (avail.bottom() - (y + win_h)) < snap_dist and not has_neighbor_bottom():
                y = avail.bottom() - win_h
            return x, y
        except Exception as e:
            print(f"clamp_and_snap 오류: {e}")
            return x, y

    # ── SettingsDialog 호환 레이어 ───────────────────
    @property
    def config(self):
        """SettingsDialog가 mw.config['...']로 접근 — self.cfg 별칭"""
        return self.cfg

    @config.setter
    def config(self, value):
        self.cfg = value
        if hasattr(self, "bridge"):
            self.bridge.config = value

    def _build_ui(self):
        """라이브 프리뷰 — 메모리만 적용 (디스크 저장은 _save 시에만)"""
        try:
            if hasattr(self, "bridge"):
                self.bridge.config = self.cfg
                n = len(self.bridge._current_buttons())
                extra = 1 if self.bridge._current_folder_id is not None else 0
                mode = self.cfg.get("layout_mode", "grid2")
                small = self.cfg.get("small_buttons", False)
                w, h = calc_window_size(n, mode, small, extra)
                self.setUpdatesEnabled(False)
                self.setMinimumSize(0, 0)
                self.setMaximumSize(16777215, 16777215)
                self.setGeometry(self.x(), self.y(), w, h)
                self.resize(w, h)
                self.setFixedSize(w, h)
                wh = self.windowHandle()
                if wh is not None:
                    wh.resize(w, h)
                if hasattr(self, "view") and self.view is not None:
                    self.view.resize(w, h)
                self.setUpdatesEnabled(True)
                self.update()
                self.repaint()
                QApplication.processEvents()
                self.bridge._refresh_grid()
                QTimer.singleShot(50, self.bridge._refresh_grid)
            self.setWindowOpacity(self.cfg.get("opacity", 0.95))
            self.update()
            QApplication.processEvents()

            dlg = getattr(self.bridge, "_settings_dlg", None) if hasattr(self, "bridge") else None
            if dlg is not None and dlg.isVisible():
                widget_auto_pos = getattr(self, "_widget_auto_pos", None)
                user_moved = (widget_auto_pos is not None and self.pos() != widget_auto_pos)
                if not user_moved:
                    self._position_self_to_dialog(dlg)
                    self._widget_auto_pos = self.pos()
        except Exception as e:
            print(f"_build_ui 오류: {e}", flush=True)
            import traceback; traceback.print_exc()

    def _position_self_to_dialog(self, dlg, gap: int = 10):
        """위젯을 다이얼로그 옆에 안 겹치게 배치 (왼쪽 우선, 공간 없으면 오른쪽)"""
        try:
            QApplication.processEvents()
            dlg_x = dlg.x()
            dlg_y = dlg.y()
            dlg_w = max(dlg.width(), dlg.sizeHint().width(), 280)
            dlg_h = max(dlg.height(), dlg.sizeHint().height(), 400)
            dlg_left = dlg_x
            dlg_right = dlg_x + dlg_w
            dlg_top = dlg_y

            screen = QApplication.screenAt(dlg.frameGeometry().center())
            if screen is None:
                screen = QApplication.primaryScreen()
            avail = screen.availableGeometry()
            main_w = self.width()
            main_h = self.height()

            left_x = dlg_left - main_w - gap
            if left_x >= avail.left():
                x = left_x
            else:
                right_x = dlg_right + gap
                if right_x + main_w <= avail.right():
                    x = right_x
                else:
                    x = avail.left() + max(0, (avail.width() - main_w) // 2)

            y = dlg_top
            if y + main_h > avail.bottom():
                y = max(avail.top(), avail.bottom() - main_h)
            if y < avail.top():
                y = avail.top()

            self.move(x, y)
        except Exception as e:
            print(f"_position_self_to_dialog 오류: {e}")


def setup_tray(app, window):
    icon_path = resource_path("icon.ico")
    icon = QIcon(icon_path) if os.path.exists(icon_path) else QIcon()
    tray = QSystemTrayIcon(icon, parent=app)
    tray.setToolTip("SupportDeck")
    menu = QMenu()
    # 트레이 메뉴 스타일 — 위젯 테마 톤과 통일 (다크 + accent 보더)
    menu.setStyleSheet("""
        QMenu {
            background: #0f111c;
            border: 1px solid #58a6ff;
            border-radius: 10px;
            padding: 6px;
            color: #e6edf3;
        }
        QMenu::item {
            padding: 8px 18px;
            border-radius: 6px;
            font-size: 13px;
        }
        QMenu::item:selected {
            background: #58a6ff33;
            color: #58a6ff;
        }
        QMenu::separator {
            height: 1px;
            background: #2a2f44;
            margin: 4px 8px;
        }
    """)
    show_act = QAction("🖥️ 위젯 열기")
    show_act.triggered.connect(lambda: (window.restore_from_edge() if getattr(window, "_hidden_edge", None) is not None else (window.show(), window.activateWindow()), window.view.page().runJavaScript('if(window.setMinimized) setMinimized(false);')))
    menu.addAction(show_act)
    menu.addSeparator()
    quit_act = QAction("✕ 종료")
    quit_act.triggered.connect(app.quit)
    menu.addAction(quit_act)
    tray.setContextMenu(menu)
    def _on_activated(reason):
        if reason in (QSystemTrayIcon.ActivationReason.DoubleClick,
                      QSystemTrayIcon.ActivationReason.Trigger):
            if getattr(window, "_hidden_edge", None) is not None:
                window.restore_from_edge()
            else:
                window.show()
                window.activateWindow()
            try:
                window.view.page().runJavaScript('if(window.setMinimized) setMinimized(false);')
            except Exception:
                pass
    tray.activated.connect(_on_activated)
    tray.show()
    return tray


def _show_first_run_welcome(window):
    """첫 실행 시 환영 메시지 — config['first_run_shown'] = True로 저장."""
    try:
        from PyQt6.QtWidgets import QMessageBox
        cfg = window.cfg
        if cfg.get("first_run_shown", False):
            return
        msg = QMessageBox(window)
        msg.setWindowTitle("SupportDeck")
        msg.setTextFormat(Qt.TextFormat.RichText)
        msg.setText(
            "<div style='padding:4px 8px;'>"
            "<div style='font-size:18px;font-weight:700;color:#58a6ff;margin-bottom:4px;'>"
            "⚡ SupportDeck</div>"
            "<div style='font-size:12px;color:#9ca3af;margin-bottom:18px;'>"
            "딱 3가지만 알면 끝</div>"
            "<table cellspacing='0' cellpadding='6' style='border-spacing:0;'>"
            "<tr><td style='padding-right:12px;vertical-align:top;'>"
            "<span style='font-size:20px;color:#58a6ff;'>➕</span></td>"
            "<td style='vertical-align:top;'>"
            "<div style='font-size:13px;font-weight:600;color:#e6edf3;'>버튼 추가</div>"
            "<div style='font-size:12px;color:#9ca3af;'>+를 누르거나, 파일·URL을 끌어다 놔</div>"
            "</td></tr>"
            "<tr><td style='padding-right:12px;vertical-align:top;'>"
            "<span style='font-size:20px;color:#58a6ff;'>✏️</span></td>"
            "<td style='vertical-align:top;'>"
            "<div style='font-size:13px;font-weight:600;color:#e6edf3;'>편집·삭제</div>"
            "<div style='font-size:12px;color:#9ca3af;'>버튼 우클릭 → 편집. 끌어서 위치 바꿈</div>"
            "</td></tr>"
            "<tr><td style='padding-right:12px;vertical-align:top;'>"
            "<span style='font-size:20px;color:#58a6ff;'>⤵</span></td>"
            "<td style='vertical-align:top;'>"
            "<div style='font-size:13px;font-weight:600;color:#e6edf3;'>화면 가장자리로 숨김</div>"
            "<div style='font-size:12px;color:#9ca3af;'>헤더의 — 버튼. 마우스 갖다 대면 다시 펼침</div>"
            "</td></tr>"
            "</table></div>"
        )
        msg.setStyleSheet(
            "QMessageBox{background:#0a0a0d;min-width:380px;}"
            "QMessageBox QLabel{color:#e6edf3;background:transparent;min-width:360px;}"
            "QPushButton{background:#1a1d2e;color:#e6edf3;border:1px solid #2a2f44;"
            "border-radius:6px;padding:7px 22px;min-width:70px;font-size:12px;font-weight:500;}"
            "QPushButton:hover{border-color:#58a6ff;color:#58a6ff;}"
        )
        ok_btn = msg.addButton("확인", QMessageBox.ButtonRole.AcceptRole)
        msg.setDefaultButton(ok_btn)
        msg.exec()
        # 한 번 보여줬으면 어떤 버튼/닫기든 다시 안 뜨게 저장
        cfg["first_run_shown"] = True
        try:
            cfg_module.save_config(cfg)
        except Exception as e:
            print(f"first_run_shown 저장 실패: {e}")
    except Exception as e:
        print(f"_show_first_run_welcome 오류: {e}")


def _on_app_quit():
    """앱 종료 시 안전망: 열린 다이얼로그 + 후크 등 강제 정리."""
    try:
        from PyQt6.QtWidgets import QApplication, QDialog
        for w in QApplication.topLevelWidgets():
            if isinstance(w, QDialog) and w.isVisible():
                try:
                    w.close()
                except Exception:
                    pass
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────
# 자동 업데이트 확인 (latest.json 비교 → 새 버전이면 알림)
# ─────────────────────────────────────────────────────────────
def _ver_tuple(v):
    try:
        return tuple(int(x) for x in str(v).strip().split(".")[:3])
    except Exception:
        return (0, 0, 0)


class UpdateChecker(QObject):
    """시작 후 latest.json을 받아 현재 버전(APP_VERSION)과 비교 → 새 버전이면 알림."""
    def __init__(self, window):
        super().__init__(window)
        self.window = window
        self._nam = None

    def check(self, manual=False):
        self._manual = manual
        try:
            cfg = self.window.cfg
            if not manual and not cfg.get("update_check", True):
                return  # 자동 확인이 꺼져 있으면 시작 시엔 조용히 넘어감
            url = UPDATE_MANIFEST_URL
            if not url or not url.lower().startswith("https://"):
                if manual:
                    from PyQt6.QtWidgets import QMessageBox
                    QMessageBox.information(self.window, "업데이트", "업데이트 서버가 설정되어 있지 않아요.")
                return  # HTTPS만 허용 (평문 HTTP·기타 스킴 차단)
            from PyQt6.QtNetwork import QNetworkAccessManager, QNetworkRequest
            if self._nam is None:
                self._nam = QNetworkAccessManager(self)
            req = QNetworkRequest(QUrl(url))
            req.setHeader(QNetworkRequest.KnownHeaders.UserAgentHeader,
                          f"SupportDeck/{APP_VERSION}")
            try:
                req.setAttribute(QNetworkRequest.Attribute.CacheLoadControlAttribute,
                                 QNetworkRequest.CacheLoadControl.AlwaysNetwork)
            except Exception:
                pass
            reply = self._nam.get(req)
            reply.finished.connect(lambda r=reply: self._on_reply(r))
        except Exception as e:
            print(f"업데이트 확인 시작 오류: {e}")

    def _on_reply(self, reply):
        manual = getattr(self, "_manual", False)
        from PyQt6.QtWidgets import QMessageBox
        try:
            from PyQt6.QtNetwork import QNetworkReply
            if reply.error() != QNetworkReply.NetworkError.NoError:
                if manual:
                    QMessageBox.information(self.window, "업데이트",
                        "업데이트 확인에 실패했어요.\n인터넷 연결을 확인해주세요.")
                return
            m = json.loads(bytes(reply.readAll()).decode("utf-8"))
            latest = str(m.get("version", "")).strip()
            if not latest or _ver_tuple(latest) <= _ver_tuple(APP_VERSION):
                if manual:
                    QMessageBox.information(self.window, "업데이트",
                        f"현재 최신 버전이에요.  (v{APP_VERSION})")
                return
            # 수동 확인이면 '건너뛴 버전'도 무시하고 항상 안내
            if not manual and latest == self.window.cfg.get("update_skip_version", ""):
                return
            self._prompt(m, latest)
        except Exception as e:
            print(f"업데이트 확인 오류: {e}")
            if manual:
                try:
                    QMessageBox.information(self.window, "업데이트", "업데이트 정보를 읽지 못했어요.")
                except Exception:
                    pass
        finally:
            try:
                reply.deleteLater()
            except Exception:
                pass

    def _prompt(self, m, latest):
        from PyQt6.QtWidgets import QMessageBox
        notes = m.get("notes_ko") or m.get("notes_en") or []
        body = f"새 버전 v{latest} 이 나왔어요!  (현재 v{APP_VERSION})"
        if notes:
            body += "\n\n변경사항\n" + "\n".join("· " + str(n) for n in notes[:6])
        box = QMessageBox(self.window)
        box.setWindowTitle("SupportDeck 업데이트")
        box.setText(body)
        up_btn = box.addButton("지금 업데이트", QMessageBox.ButtonRole.AcceptRole)
        skip_btn = box.addButton("이 버전 건너뛰기", QMessageBox.ButtonRole.DestructiveRole)
        box.addButton("나중에", QMessageBox.ButtonRole.RejectRole)
        box.setDefaultButton(up_btn)
        box.exec()
        clicked = box.clickedButton()
        if clicked is up_btn:
            self._start_update(m)
        elif clicked is skip_btn:
            self.window.cfg["update_skip_version"] = latest
            try:
                cfg_module.save_config(self.window.cfg)
            except Exception:
                pass

    def _open_page(self, m):
        """폴백: 다운로드 페이지를 브라우저로 연다 (https만)."""
        from PyQt6.QtGui import QDesktopServices
        target = (UPDATE_PAGE_URL or m.get("url") or "").strip()
        if target.lower().startswith("https://"):
            QDesktopServices.openUrl(QUrl(target))

    def _start_update(self, m):
        """설치파일 다운로드 → SHA-256 검증 → 사일런트 설치 → 앱 종료(설치 후 자동 재시작)."""
        import os, tempfile
        from PyQt6.QtWidgets import QMessageBox, QProgressDialog
        from PyQt6.QtNetwork import QNetworkAccessManager, QNetworkRequest
        url = (m.get("url") or "").strip()
        if not url.lower().startswith("https://"):
            return self._open_page(m)  # 안전: https 아니면 그냥 페이지 열기
        self._exp_sha = (m.get("sha256") or "").strip().lower()
        # 보안: SHA-256 없이는 자동 설치 안 함 — 무결성 검증이 유일한 안전장치
        import re as _re
        if not _re.fullmatch(r"[0-9a-f]{64}", self._exp_sha):
            QMessageBox.information(self.window, "업데이트",
                "이 버전은 자동 설치 정보(무결성 해시)가 없어서\n다운로드 페이지를 대신 열어드릴게요.")
            return self._open_page(m)
        # 보안: 파일명은 URL 마지막 조각에서 취하되 경로 문자를 제거하고 형식 검증 (경로 탈출 방지)
        fname = os.path.basename(url.split("?")[0].rstrip("/").replace("\\", "/").split("/")[-1])
        if not _re.fullmatch(r"[\w.\- ]+\.exe", fname):
            fname = "SupportDeck_Setup.exe"
        self._dl_path = os.path.join(tempfile.gettempdir(), fname)
        try:
            self._dl_fh = open(self._dl_path, "wb")
        except Exception as e:
            QMessageBox.warning(self.window, "업데이트", f"임시 파일을 만들 수 없어요: {e}")
            return
        if self._nam is None:
            self._nam = QNetworkAccessManager(self)
        req = QNetworkRequest(QUrl(url))
        req.setHeader(QNetworkRequest.KnownHeaders.UserAgentHeader, f"SupportDeck/{APP_VERSION}")
        self._dl_reply = self._nam.get(req)
        self._dl_canceled = False
        self._prog = QProgressDialog("업데이트 다운로드 중…", "취소", 0, 100, self.window)
        self._prog.setWindowTitle("SupportDeck 업데이트")
        self._prog.setWindowModality(Qt.WindowModality.WindowModal)
        self._prog.setMinimumDuration(0)
        self._prog.setAutoClose(False)
        self._prog.setAutoReset(False)
        self._prog.setValue(0)
        self._prog.canceled.connect(self._cancel_update)
        self._dl_reply.downloadProgress.connect(self._on_dl_progress)
        self._dl_reply.readyRead.connect(self._on_dl_ready)
        self._dl_reply.finished.connect(lambda r=self._dl_reply: self._on_dl_finished(r))

    def _cancel_update(self):
        self._dl_canceled = True
        try:
            self._dl_reply.abort()
        except Exception:
            pass

    def _on_dl_ready(self):
        try:
            if self._dl_fh and self._dl_reply:
                self._dl_fh.write(bytes(self._dl_reply.readAll()))
        except Exception:
            pass

    def _on_dl_progress(self, recv, total):
        try:
            if total > 0 and self._prog:
                self._prog.setMaximum(100)
                self._prog.setValue(int(recv * 100 / total))
        except Exception:
            pass

    def _on_dl_finished(self, reply):
        import os, hashlib, subprocess
        from PyQt6.QtWidgets import QMessageBox, QApplication
        from PyQt6.QtNetwork import QNetworkReply
        try:
            try:
                self._dl_fh.write(bytes(reply.readAll()))
            except Exception:
                pass
            try:
                self._dl_fh.close()
            except Exception:
                pass
            if self._prog:
                self._prog.close()
            if self._dl_canceled or reply.error() != QNetworkReply.NetworkError.NoError:
                self._cleanup_dl()
                if not self._dl_canceled:
                    QMessageBox.warning(self.window, "업데이트", "다운로드에 실패했어요. 잠시 후 다시 시도해주세요.")
                return
            # SHA-256 검증 — 해시가 없으면 설치하지 않음 (필수)
            if not self._exp_sha:
                self._cleanup_dl()
                QMessageBox.critical(self.window, "업데이트 중단",
                    "무결성 해시 정보가 없어 설치를 취소했어요.")
                return
            h = hashlib.sha256()
            with open(self._dl_path, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            if h.hexdigest().lower() != self._exp_sha:
                self._cleanup_dl()
                QMessageBox.critical(self.window, "업데이트 중단",
                    "다운로드한 파일이 손상되었거나 변조되었습니다.\n보안을 위해 설치를 취소했어요.")
                return
            # 사일런트 설치 실행 (설치 마법사 끝에 앱 자동 재시작) → 앱 종료
            try:
                DETACHED_PROCESS = 0x00000008
                subprocess.Popen([self._dl_path, "/VERYSILENT", "/SUPPRESSMSGBOXES"],
                                 close_fds=True, creationflags=DETACHED_PROCESS)
            except Exception as e:
                QMessageBox.warning(self.window, "업데이트", f"설치 프로그램을 실행하지 못했어요: {e}")
                return
            QApplication.instance().quit()
        except Exception as e:
            print(f"업데이트 설치 오류: {e}")
        finally:
            try:
                reply.deleteLater()
            except Exception:
                pass

    def _cleanup_dl(self):
        import os
        try:
            os.remove(self._dl_path)
        except Exception:
            pass


def main():
    QApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    app.aboutToQuit.connect(_on_app_quit)
    _init_webengine()
    window = SupportDeckWindow()
    window.start_intro()
    tray = setup_tray(app, window)
    QTimer.singleShot(1000, lambda: _show_first_run_welcome(window))
    # 자동 업데이트 확인 (인트로·환영창 끝난 뒤)
    window._updater = UpdateChecker(window)
    QTimer.singleShot(6000, window._updater.check)
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
