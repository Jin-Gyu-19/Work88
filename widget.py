"""
SupportDeck 다이얼로그 모듈 — SettingsDialog / FolderEditDialog

(유실된 원본을 main_qtweb.py의 호환 레이어 규격에 맞춰 재작성한 버전)

main_qtweb.py가 기대하는 계약:
  - SettingsDialog(parent_window, theme, config, app_version=..., on_check_update=callable)
      · 시그널 saved(dict)  — 저장 버튼 → 새 config dict 방출
      · 옵션 클릭 = 즉시 적용(라이브 프리뷰): parent.config 직접 갱신 + parent._build_ui()
      · 취소(reject) = main_qtweb 쪽에서 원복 처리
  - FolderEditDialog(parent_window, theme, btn_data, is_new=bool)
      · 시그널 saved(dict) — 폴더 그룹 버튼 dict 방출
"""
import copy

from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtGui import QColor
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QGridLayout, QLabel, QLineEdit,
    QPushButton, QSlider, QCheckBox, QWidget, QColorDialog, QFrame,
)

import config as cfg_module
from design_tokens import (
    RADIUS, FONT, primary_btn, secondary_btn, input_field, dialog_container,
)

# 테마 표시 이름 (config.THEMES 키 순서 기준)
THEME_LABELS = {
    "minimal": "모던 미니멀",
    "glass":   "글래스",
    "neo":     "네오 평면",
    "gaming":  "다크 게이밍",
    "sakura":  "봄 벚꽃 🌸",
    "summer":  "여름 바다 🌊",
    "autumn":  "가을 단풍 🍁",
    "winter":  "겨울 설원 ❄️",
    "light":   "라이트",
}

LAYOUT_LABELS = [
    ("grid2",       "田 2열 격자"),
    ("horizontal2", "☰ 가로 2줄"),
    ("horizontal1", "― 가로 1줄"),
    ("vertical1",   "| 세로 1줄"),
]


def _section_label(text, theme):
    lb = QLabel(text)
    lb.setStyleSheet(
        f"color:{theme.get('btn_sub', '#888')}; font-size:{FONT['xs']}px;"
        f"font-weight:700; letter-spacing:1px; background:transparent;"
        f"margin-top:6px;"
    )
    return lb


class SettingsDialog(QDialog):
    """⚙ 설정 — 옵션 클릭 즉시 적용(라이브 프리뷰), 저장=확정, 취소=원복."""

    saved = pyqtSignal(dict)

    def __init__(self, parent, theme, config, app_version="", on_check_update=None):
        super().__init__(parent)
        self._mw = parent                 # SupportDeckWindow
        self._theme = dict(theme)
        self._cfg = config                # bridge.config와 같은 dict (라이브 프리뷰용 공유)
        self._on_check_update = on_check_update
        self._app_version = app_version

        self.setWindowTitle("SupportDeck 설정")
        self.setWindowFlags(self.windowFlags() & ~Qt.WindowType.WindowContextHelpButtonHint)
        self.setMinimumWidth(300)
        self.setStyleSheet(dialog_container(self._theme))

        root = QVBoxLayout(self)
        root.setContentsMargins(16, 14, 16, 14)
        root.setSpacing(8)

        # ── 타이틀 ──
        title = QLabel("⚙ 설정")
        title.setStyleSheet(
            f"font-size:{FONT['xl']}px; font-weight:800;"
            f"color:{self._theme.get('accent', '#58a6ff')}; background:transparent;"
        )
        root.addWidget(title)

        # ── 테마 ──
        root.addWidget(_section_label("테마", self._theme))
        theme_grid = QGridLayout()
        theme_grid.setSpacing(6)
        self._theme_btns = {}
        keys = [k for k in cfg_module.THEMES.keys()]
        for i, key in enumerate(keys):
            t = cfg_module.THEMES[key]
            b = QPushButton(THEME_LABELS.get(key, key))
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.setStyleSheet(self._theme_chip_css(t, selected=(self._cfg.get("theme") == key)))
            b.clicked.connect(lambda _, k=key: self._pick_theme(k))
            self._theme_btns[key] = b
            theme_grid.addWidget(b, i // 3, i % 3)
        root.addLayout(theme_grid)

        # ── 레이아웃 ──
        root.addWidget(_section_label("레이아웃", self._theme))
        lay_row = QGridLayout()
        lay_row.setSpacing(6)
        self._layout_btns = {}
        for i, (key, label) in enumerate(LAYOUT_LABELS):
            b = QPushButton(label)
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.setStyleSheet(self._chip_css(selected=(self._cfg.get("layout_mode", "grid2") == key)))
            b.clicked.connect(lambda _, k=key: self._pick_layout(k))
            self._layout_btns[key] = b
            lay_row.addWidget(b, i // 2, i % 2)
        root.addLayout(lay_row)

        # ── 작은 버튼 / 인트로 / 업데이트 확인 ──
        self._chk_small = QCheckBox("작은 버튼 (60px)")
        self._chk_small.setChecked(bool(self._cfg.get("small_buttons", False)))
        self._chk_small.toggled.connect(self._toggle_small)
        self._chk_intro = QCheckBox("시작 인트로 애니메이션")
        self._chk_intro.setChecked(bool(self._cfg.get("intro_animation", True)))
        self._chk_intro.toggled.connect(lambda on: self._set_cfg("intro_animation", bool(on)))
        self._chk_update = QCheckBox("시작 시 업데이트 자동 확인")
        self._chk_update.setChecked(bool(self._cfg.get("update_check", True)))
        self._chk_update.toggled.connect(lambda on: self._set_cfg("update_check", bool(on)))
        cb_css = (
            f"QCheckBox {{ color:{self._theme.get('btn_text', '#eee')};"
            f" font-size:{FONT['md']}px; background:transparent; spacing:8px; }}"
        )
        for cb in (self._chk_small, self._chk_intro, self._chk_update):
            cb.setStyleSheet(cb_css)
            root.addWidget(cb)

        # ── 투명도 ──
        root.addWidget(_section_label("투명도", self._theme))
        op_row = QHBoxLayout()
        self._op_slider = QSlider(Qt.Orientation.Horizontal)
        self._op_slider.setRange(50, 100)
        self._op_slider.setValue(int(float(self._cfg.get("opacity", 0.95)) * 100))
        self._op_slider.valueChanged.connect(self._change_opacity)
        self._op_label = QLabel(f"{self._op_slider.value()}%")
        self._op_label.setFixedWidth(38)
        op_row.addWidget(self._op_slider)
        op_row.addWidget(self._op_label)
        root.addLayout(op_row)

        # ── 배경색 ──
        bg_row = QHBoxLayout()
        self._bg_btn = QPushButton("🎨 배경색 변경")
        self._bg_btn.setStyleSheet(secondary_btn(self._theme))
        self._bg_btn.clicked.connect(self._pick_bg_color)
        bg_reset = QPushButton("↺ 기본값")
        bg_reset.setStyleSheet(secondary_btn(self._theme))
        bg_reset.clicked.connect(self._reset_bg_color)
        bg_row.addWidget(self._bg_btn)
        bg_row.addWidget(bg_reset)
        root.addLayout(bg_row)

        # ── 구분선 ──
        line = QFrame()
        line.setFrameShape(QFrame.Shape.HLine)
        line.setStyleSheet(f"color:{self._theme.get('border', '#333')};")
        root.addWidget(line)

        # ── 버전 + 업데이트 확인 ──
        ver_row = QHBoxLayout()
        ver = QLabel(f"버전 v{self._app_version}" if self._app_version else "")
        ver.setStyleSheet(
            f"color:{self._theme.get('btn_sub', '#888')}; font-size:{FONT['sm']}px;"
            f"background:transparent;"
        )
        ver_row.addWidget(ver)
        ver_row.addStretch(1)
        upd_btn = QPushButton("업데이트 확인")
        upd_btn.setStyleSheet(secondary_btn(self._theme))
        upd_btn.clicked.connect(self._check_update)
        ver_row.addWidget(upd_btn)
        root.addLayout(ver_row)

        # ── 저장/취소 ──
        btn_row = QHBoxLayout()
        btn_row.addStretch(1)
        cancel = QPushButton("취소")
        cancel.setStyleSheet(secondary_btn(self._theme))
        cancel.clicked.connect(self.reject)
        save = QPushButton("저장")
        save.setStyleSheet(primary_btn(self._theme))
        save.clicked.connect(self._save)
        btn_row.addWidget(cancel)
        btn_row.addWidget(save)
        root.addLayout(btn_row)

    # ── 스타일 헬퍼 ──────────────────────────────────
    def _chip_css(self, selected=False):
        t = self._theme
        border = t.get("accent", "#58a6ff") if selected else t.get("border", "#333")
        color = t.get("accent", "#58a6ff") if selected else t.get("btn_text", "#eee")
        return (
            f"QPushButton {{ background:{t.get('header', '#222')}; color:{color};"
            f" border:1px solid {border}; border-radius:{RADIUS['sm']}px;"
            f" padding:6px 8px; font-size:{FONT['sm']}px; }}"
            f"QPushButton:hover {{ border-color:{t.get('accent', '#58a6ff')}; }}"
        )

    def _theme_chip_css(self, theme_data, selected=False):
        cur = self._theme
        border = cur.get("accent", "#58a6ff") if selected else theme_data.get("border", "#333")
        return (
            f"QPushButton {{ background:{theme_data.get('bg', '#222')};"
            f" color:{theme_data.get('btn_text', '#eee')};"
            f" border:{'2' if selected else '1'}px solid {border};"
            f" border-radius:{RADIUS['sm']}px; padding:7px 6px;"
            f" font-size:{FONT['xs']}px; font-weight:600; }}"
        )

    # ── 라이브 프리뷰 적용 ───────────────────────────
    def _live_apply(self):
        try:
            self._mw.config = self._cfg
            self._mw._build_ui()
        except Exception as e:
            print(f"SettingsDialog live apply 오류: {e}")

    def _set_cfg(self, key, value):
        self._cfg[key] = value
        self._live_apply()

    def _pick_theme(self, key):
        old_default = cfg_module.THEMES.get(self._cfg.get("theme", ""), {}).get("bg")
        self._cfg["theme"] = key
        # 배경색이 옛 테마 기본값 그대로면 새 테마 기본값으로 따라가기
        if self._cfg.get("bg_color") in (None, "", old_default):
            self._cfg["bg_color"] = cfg_module.THEMES[key].get("bg")
        for k, b in self._theme_btns.items():
            b.setStyleSheet(self._theme_chip_css(cfg_module.THEMES[k], selected=(k == key)))
        self._live_apply()

    def _pick_layout(self, key):
        self._cfg["layout_mode"] = key
        for k, b in self._layout_btns.items():
            b.setStyleSheet(self._chip_css(selected=(k == key)))
        self._live_apply()

    def _toggle_small(self, on):
        self._cfg["small_buttons"] = bool(on)
        self._live_apply()

    def _change_opacity(self, v):
        self._op_label.setText(f"{v}%")
        self._cfg["opacity"] = v / 100.0
        try:
            self._mw.setWindowOpacity(v / 100.0)
        except Exception:
            pass

    def _pick_bg_color(self):
        cur = self._cfg.get("bg_color") or self._theme.get("bg", "#0a0a0d")
        col = QColorDialog.getColor(QColor(cur), self, "배경색 선택")
        if col.isValid():
            hexc = col.name()
            self._cfg["bg_color"] = hexc
            # main_qtweb의 _BgContainerShim 경유 — CSS 변수 즉시 반영
            try:
                self._mw.container.setStyleSheet(f"background: {hexc};")
            except Exception:
                pass
            self._live_apply()

    def _reset_bg_color(self):
        default = cfg_module.THEMES.get(self._cfg.get("theme", "gaming"), {}).get("bg")
        self._cfg["bg_color"] = default
        try:
            self._mw.container.setStyleSheet(f"background: {default};")
        except Exception:
            pass
        self._live_apply()

    def _check_update(self):
        if callable(self._on_check_update):
            try:
                self._on_check_update()
            except Exception as e:
                print(f"업데이트 확인 오류: {e}")

    def _save(self):
        self.saved.emit(copy.deepcopy(dict(self._cfg)))


class FolderEditDialog(QDialog):
    """폴더 그룹 버튼 만들기/편집 — 이름 + 아이콘(이모지)."""

    saved = pyqtSignal(dict)

    def __init__(self, parent, theme, btn_data, is_new=False):
        super().__init__(parent)
        self._theme = dict(theme)
        self._data = copy.deepcopy(btn_data)
        self._is_new = is_new

        self.setWindowTitle("새 폴더" if is_new else "폴더 편집")
        self.setMinimumWidth(280)
        self.setStyleSheet(dialog_container(self._theme) + input_field(self._theme))

        root = QVBoxLayout(self)
        root.setContentsMargins(16, 14, 16, 14)
        root.setSpacing(8)

        title = QLabel(("📁 새 폴더 만들기" if is_new else "📁 폴더 편집"))
        title.setStyleSheet(
            f"font-size:{FONT['lg']}px; font-weight:800;"
            f"color:{self._theme.get('accent', '#58a6ff')}; background:transparent;"
        )
        root.addWidget(title)

        root.addWidget(_section_label("이름", self._theme))
        self._name_edit = QLineEdit(self._data.get("label", ""))
        self._name_edit.setMaxLength(20)
        root.addWidget(self._name_edit)

        root.addWidget(_section_label("아이콘 (이모지)", self._theme))
        self._icon_edit = QLineEdit(self._data.get("icon", "🗂️"))
        self._icon_edit.setMaxLength(4)
        root.addWidget(self._icon_edit)

        hint = QLabel("폴더 안 버튼은 폴더에 들어간 뒤 +로 추가할 수 있어요.")
        hint.setWordWrap(True)
        hint.setStyleSheet(
            f"color:{self._theme.get('btn_sub', '#888')}; font-size:{FONT['xs']}px;"
            f"background:transparent;"
        )
        root.addWidget(hint)

        btn_row = QHBoxLayout()
        btn_row.addStretch(1)
        cancel = QPushButton("취소")
        cancel.setStyleSheet(secondary_btn(self._theme))
        cancel.clicked.connect(self.reject)
        save = QPushButton("저장")
        save.setStyleSheet(primary_btn(self._theme))
        save.clicked.connect(self._save)
        btn_row.addWidget(cancel)
        btn_row.addWidget(save)
        root.addLayout(btn_row)

    def _save(self):
        label = self._name_edit.text().strip() or "새 그룹"
        icon = self._icon_edit.text().strip() or "🗂️"
        self._data["label"] = label
        self._data["icon"] = icon
        self._data["action_type"] = "folder_group"
        if "buttons" not in self._data or self._data["buttons"] is None:
            self._data["buttons"] = []
        self.saved.emit(self._data)
        self.accept()
