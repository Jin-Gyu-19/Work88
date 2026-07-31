"""
버튼 편집 팝업 다이얼로그
"""
import os
import base64
from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QComboBox, QCheckBox, QFrame, QColorDialog,
    QGridLayout, QFileDialog, QScrollArea, QWidget
)
from PyQt6.QtCore import Qt, pyqtSignal, QBuffer, QIODevice, QObject, QEvent, QObject, QEvent
from PyQt6.QtGui import QColor, QPixmap

from actions import ACTION_TYPES

# 카테고리별 아이콘
ICON_CATEGORIES_BASE = [
    ("기술/컴퓨터", ["💻","🖥️","🖨️","⌨️","🖱️","📱","📺","🔌","🔋","⚡","🔧","🔨","🛠️","⚙️","🔩","🔗","💾","📡","🧲","🖲️"]),
    ("파일/문서",   ["📁","📂","🗂️","📄","📃","📋","📊","📈","📉","🗒️","🗓️","📅","📌","📍","🔖","🏷️","📎","✂️","🖊️","📝"]),
    ("인터넷/통신", ["🌐","🔍","📧","📨","📩","📬","💬","🔔","🔕","📢","📣","🔈","🔊","📞","☎️","📟","📠","🛰️","🔭"]),
    ("보안",        ["🔒","🔓","🔑","🗝️","🛡️","⚠️","🚨","🚧","🔐","🔏"]),
    ("미디어/엔터", ["🎵","🎶","🎮","🕹️","🎬","🎨","🖌️","✏️","📷","📸","📹","🎥","▶️","⏸️","⏹️","⏺️","🔄","🎭","🎪","🎯"]),
    ("앱/기능",     ["🚀","⭐","🌟","💫","✨","🔥","💥","🏆","🥇","💡","📦","📤","📥","🗃️","🗄️","🧩","🔮","🔬","🧪","🧬"]),
    ("장소/이동",   ["🏠","🏢","🏪","🏫","🏥","🚗","✈️","🚂","🚢","🛵","⏰","⌚","📍","🗺️","🧭","🌍","🌏","🌎","🏔️","🌆","🚕","🚌","🚑","🚒","🚓","🛻","🚚","🚁","🛸","⛵"]),
    ("기호/표시",   ["✅","❌","⭕","❓","❗","💯","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🔺","🔻","🔷","🔶","🔹","🔸","0️⃣","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣"]),
    ("사람/제스처", ["👤","👥","👋","👍","👎","✌️","🤝","👏","🙌","💪","☝️","👆","👇","👉","🤜","🫱","🫲"]),
    ("자연/날씨",   ["☀️","🌙","🌈","☁️","⛅","🌧️","❄️","💧","🌊","🌿","🌱","🌸","🌺","🍀","🌴","🎋","🌻","🍁","🌵","🪐","🌌","🌪️","🌤️","🌦️","🌩️","☃️","🌬️"]),
    ("동물",        ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🦆","🦅","🦉","🦇","🐺","🐴","🦄","🐝","🦋","🐌","🐞","🐢","🦎","🐍","🐙","🦑","🦀","🐡","🐠","🐟","🐬","🐳","🦈","🐘","🦒","🦘","🐕","🐈","🐇","🦔"]),
    ("음식/음료",   ["🍕","🍔","🌮","🍜","🍣","🍱","🍛","🍲","🍝","🥐","🥚","🍳","🥞","🥓","🍗","🍖","🌭","🍟","🧁","🎂","🍰","🍩","🍪","🍫","🍬","🍭","🍎","🍊","🍋","🍇","🍓","🍑","🍒","🥭","🍍","🥥","🥝","🥑","🌽","🥕","🍆","🧄","🥔","☕","🧃","🥤","🍺","🍷","🍸","🍹","🧉","🍵","🧊"]),
    ("스포츠/활동", ["⚽","🏀","🎾","⚾","🏈","🎱","🏓","🥊","🏋️","🧘","🚴","🏃","🎯","🎲","♟️","🎰","🎿","🏊","🤸","🧗","🏄","🤺","⛷️","🏂","🪂","🏌️","🏹","🎣","🤿","🥋","🏆","🥇","🥈","🥉"]),
    ("도구/건설",   ["🪛","🪚","⛏️","🪝","🧰","🪤","🗜️","🪜","🧱","🔗","⛓️","🪣","💡","🔦","🕯️","🪔","🧯","⚗️","🩺","🩻"]),
    ("우주/과학",   ["🚀","🛸","🪐","🌌","⭐","🌟","💫","☄️","🌙","☀️","🌍","🔭","🔬","🧪","🧫","🧬","⚗️","🔋","🧲","🌡️","⏱️","⏲️","🕰️"]),
    ("쇼핑/돈",     ["💰","💵","💴","💶","💷","💳","💸","🏦","🛒","🛍️","🎁","💎","🪙","💹","🏧"]),
    ("의료/건강",   ["💊","🩺","🏥","🩹","💉","🧬","🦷","👁️","🫀","🧠","🩻","🧪","🌡️","🩼","🦯","🧤","🧣"]),
    ("감정/표정",   ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","😉","😍","🥰","😘","😋","😛","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😞","😔","😟","😕","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","🤗","🤔","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😵","🤢","🤮","🤧","😷","🤒","🤕","😈","👿","👹","👺","🤡","💩","👻","💀","👽","🤖","🎃","😺","😸","😻","😼","😽","🙀","😿","😾"]),
    # 깃발 카테고리는 Windows Segoe UI Emoji가 RGI Flag Sequence 미지원으로 알파벳 2글자로 표시되는 한계 때문에 제거됨
]
ICON_LIST = [ic for _, icons in ICON_CATEGORIES_BASE for ic in icons]

def get_icon_categories(favorites=None):
    cats = []
    if favorites:
        cats.append(("⭐ 즐겨찾기", favorites))
    cats.extend(ICON_CATEGORIES_BASE)
    return cats

_FALLBACK_COLOR_PRESETS = [
    "#0a0a0d","#1a1d2e","#252a44","#2a2f44","#0f111c",
    "#3a0a0a","#5a1a1a","#7a1a2a","#6b2137","#4a0e2a",
    "#3a1e00","#4a2800","#0a2a0a","#0d3b1a","#0a3a2a",
    "#0a1a3a","#0d2137","#0a2d3a","#0a2d3a","#0d3a3a",
]

def get_color_presets(theme=None):
    """테마에 정의된 button_palette를 우선 사용, 없으면 폴백"""
    if theme and isinstance(theme, dict):
        palette = theme.get("button_palette")
        if palette:
            return palette
    return _FALLBACK_COLOR_PRESETS

# 타이머/카운터 제외한 액션 타입
CUSTOM_ACTION_TYPES = [t for t in ACTION_TYPES if t[0] not in ("timer", "counter")]


class ButtonEditorDialog(QDialog):
    saved = pyqtSignal(dict)
    deleted = pyqtSignal(int)

    def __init__(self, parent, theme, btn_data: dict, is_new: bool = False):
        super().__init__(parent)
        self.theme = theme
        self.btn_data = dict(btn_data)
        self._orig_btn_data = dict(btn_data)  # 취소 시 복원용
        self.is_new = is_new
        self.selected_color = btn_data.get("color", "#1a1a2e")
        self._image_b64 = btn_data.get("icon_image", None)
        # 이미지 파일 지연 삭제: 저장 전엔 디스크에서 지우지 않는다 (취소 시 데이터 손실 방지)
        self._pending_delete = set()   # 저장 시 삭제할 교체/제거된 이미지 경로
        self._session_images = set()   # 이번 편집에서 새로 만든 이미지 (취소 시 정리)
        self._drag_pos = None
        self._in_preview = False
        # 즐겨찾기 로드
        try:
            import json, os
            import config as _cfg
            fav_file = os.path.join(_cfg.get_data_dir(), "favorites.json")
            if os.path.exists(fav_file):
                with open(fav_file, encoding="utf-8") as f:
                    self._favorites = json.load(f)
            else:
                self._favorites = []
        except Exception:
            self._favorites = []
        self.setWindowTitle("버튼 추가" if is_new else "버튼 편집")
        self.setWindowFlags(Qt.WindowType.Dialog | Qt.WindowType.FramelessWindowHint)
        self.setAttribute(Qt.WidgetAttribute.WA_InputMethodEnabled, True)
        self.setMinimumWidth(340)
        self._build_ui()
        self._apply_style()

    def keyPressEvent(self, e):
        # 엔터/ESC 키로 창이 닫히지 않게 막기
        from PyQt6.QtCore import Qt as _Qt
        if e.key() in (_Qt.Key.Key_Return, _Qt.Key.Key_Enter, _Qt.Key.Key_Escape):
            return
        super().keyPressEvent(e)

    def mousePressEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            # 상단 40px 타이틀 영역에서만 드래그
            if e.position().y() < 40:
                self._drag_pos = e.globalPosition().toPoint() - self.frameGeometry().topLeft()

    def mouseMoveEvent(self, e):
        if e.buttons() == Qt.MouseButton.LeftButton and self._drag_pos:
            from PyQt6.QtWidgets import QApplication
            new_pos = e.globalPosition().toPoint() - self._drag_pos
            screen = QApplication.screenAt(e.globalPosition().toPoint())
            if screen is None:
                screen = QApplication.primaryScreen()
            sg = screen.availableGeometry()
            x = max(sg.left(), min(new_pos.x(), sg.right() - self.width()))
            y = max(sg.top(), min(new_pos.y(), sg.bottom() - self.height()))
            self.move(x, y)

    def mouseReleaseEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            self._drag_pos = None

    def _apply_style(self):
        t = self.theme
        self.setStyleSheet(f"""
            QDialog {{
                background: {t['bg']};
                border: 1px solid {t['border']};
                border-radius: 12px;
            }}
            QLabel {{
                color: {t['btn_text']};
                font-size: 12px;
                background: transparent;
            }}
            QLineEdit, QComboBox {{
                background: {t['header']};
                color: {t['btn_text']};
                border: 1px solid {t['border']};
                border-radius: 6px;
                padding: 6px 10px;
                font-size: 12px;
            }}
            QLineEdit:hover, QComboBox:hover {{ border: 1px solid {t['btn_sub']}; }}
            QLineEdit:focus, QComboBox:focus {{ border: 1px solid {t['accent']}; }}
            QComboBox::drop-down {{ border: none; width: 20px; }}
            QComboBox QAbstractItemView {{
                background: {t['header']};
                color: {t['btn_text']};
                selection-background-color: {t['accent']};
                border: 1px solid {t['border']};
                border-radius: 6px;
                padding: 4px;
            }}
            QCheckBox {{ color: {t['btn_text']}; font-size: 12px; spacing: 6px; }}
            QCheckBox::indicator {{
                width: 14px; height: 14px;
                border: 1px solid {t['border']};
                border-radius: 3px;
                background: {t['header']};
            }}
            QCheckBox::indicator:hover {{ border: 1px solid {t['btn_sub']}; }}
            QCheckBox::indicator:checked {{
                background: {t['accent']};
                border: 1px solid {t['accent']};
            }}
            QPushButton {{
                background: {t['header']};
                color: {t['btn_text']};
                border: 1px solid {t['border']};
                border-radius: 6px;
                padding: 6px 12px;
                font-size: 12px;
                font-weight: 600;
            }}
            QPushButton:hover {{ background: {t['btn_hover']}; border-color: {t['btn_sub']}; }}
            QPushButton:pressed {{ background: {t['btn_bg']}; }}
            QScrollArea {{ border: none; background: transparent; }}
            QScrollBar:vertical {{
                background: {t['bg']}; width: 8px; border-radius: 4px;
            }}
            QScrollBar::handle:vertical {{
                background: {t['border']}; border-radius: 4px; min-height: 30px;
            }}
            QScrollBar::handle:vertical:hover {{ background: {t['btn_sub']}; }}
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
        """)

    def _build_ui(self):
        t = self.theme
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(10)

        # 타이틀 + X 버튼
        title_row = QHBoxLayout()
        title_lbl = QLabel("✏️ 버튼 추가" if self.is_new else "✏️ 버튼 편집")
        title_lbl.setStyleSheet(f"color:{t['accent']};font-size:14px;font-weight:700;")
        title_row.addWidget(title_lbl)
        title_row.addStretch()
        close_btn = QPushButton("✕")
        close_btn.setFixedSize(22, 22)
        close_btn.setToolTip("닫기 (변경사항 취소)")
        # padding:0 필수 — 전역 QPushButton padding을 상속하면 ✕가 잘려 안 보인다
        close_btn.setStyleSheet(f"""
            QPushButton {{
                background:transparent; border:1px solid {t['border']}; border-radius:4px;
                color:{t['btn_text']}; font-size:13px; font-weight:700; padding:0;
            }}
            QPushButton:hover {{ background:{t['danger']}; border-color:{t['danger']}; color:white; }}
        """)
        close_btn.clicked.connect(self.reject)
        title_row.addWidget(close_btn)
        layout.addLayout(title_row)

        line = QFrame()
        line.setFrameShape(QFrame.Shape.HLine)
        line.setStyleSheet(f"background:{t['border']};max-height:1px;border:none;")
        layout.addWidget(line)

        # ── 아이콘 헤더 ───────────────────────────────────────
        icon_header = QHBoxLayout()
        icon_header.addWidget(QLabel("아이콘"))
        icon_header.addStretch()
        layout.addLayout(icon_header)

        # ── 이모지 그리드 (카테고리별) ──────────────────────────
        emoji_container = QWidget()
        emoji_container.setStyleSheet("background:transparent;")
        self._emoji_vbox = QVBoxLayout(emoji_container)
        self._emoji_vbox.setSpacing(4)
        self._emoji_vbox.setContentsMargins(2, 2, 2, 2)

        self.icon_btns = {}
        cur_icon = self.btn_data.get("icon", "💻")
        COLS_EMOJI = 6

        cats = get_icon_categories(self._favorites if self._favorites else None)
        for cat_name, icons in cats:
            cat_lbl = QLabel(cat_name)
            cat_lbl.setStyleSheet(f"color:{t['btn_sub']};font-size:10px;font-weight:700;background:transparent;border:none;padding:3px 0 1px 0;")
            self._emoji_vbox.addWidget(cat_lbl)
            row_widget = QWidget()
            row_widget.setStyleSheet("background:transparent;")
            row_grid = QGridLayout(row_widget)
            row_grid.setSpacing(3)
            row_grid.setContentsMargins(0, 0, 0, 0)
            is_fav_cat = cat_name == "⭐ 즐겨찾기"
            for i, ic in enumerate(icons):
                btn = QPushButton(ic)
                btn.setFixedSize(44, 44)
                is_sel = (ic == cur_icon and not self._image_b64)
                is_fav = ic in self._favorites
                border_color = t['accent'] if is_sel else ("#f0883e" if is_fav and not is_fav_cat else t['border'])
                btn.setStyleSheet(f"""
                    QPushButton {{
                        background: {t['accent']+'33' if is_sel else t['header']};
                        border: {'2px' if is_sel or (is_fav and not is_fav_cat) else '1px'} solid {border_color};
                        border-radius: 6px;
                        font-size: 18px;
                        padding: 2px;
                        font-family: 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;
                    }}
                    QPushButton:hover {{ background: {t['accent']}33; }}
                """)
                btn.clicked.connect(lambda _, x=ic: self._select_icon(x))
                btn.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
                btn.customContextMenuRequested.connect(lambda _, x=ic: self._toggle_favorite(x))
                self.icon_btns[ic] = btn
                row_grid.addWidget(btn, i // COLS_EMOJI, i % COLS_EMOJI)
            self._emoji_vbox.addWidget(row_widget)

        emoji_scroll = QScrollArea()
        emoji_scroll.setWidget(emoji_container)
        emoji_scroll.setWidgetResizable(True)
        emoji_scroll.setFixedHeight(220)
        emoji_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        emoji_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOn)
        emoji_scroll.setStyleSheet("QScrollArea { border:none; background:transparent; }")
        emoji_scroll.verticalScrollBar().setStyleSheet("""
            QScrollBar:vertical { background:#2d2d2d; width:8px; border-radius:4px; margin:0; }
            QScrollBar::handle:vertical { background:#888888; border-radius:4px; min-height:20px; }
            QScrollBar::handle:vertical:hover { background:#aaaaaa; }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height:0px; }
            QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical { background:none; }
        """)
        layout.addWidget(emoji_scroll)

        # ── 버튼 이름 ─────────────────────────────────────────
        layout.addWidget(QLabel("버튼 이름"))
        self.label_edit = QLineEdit(self.btn_data.get("label", ""))
        self.label_edit.setPlaceholderText("예: 메일, 캘린더, ChatGPT")
        self.label_edit.textChanged.connect(lambda: self._preview_on_widget())
        # 엔터 눌러도 아무 동작 없게 (창 닫힘 방지)
        self.label_edit.returnPressed.connect(lambda: None)
        layout.addWidget(self.label_edit)

        # ── 배경 색상 ─────────────────────────────────────────
        layout.addWidget(QLabel("배경 색상"))
        color_grid = QGridLayout()
        color_grid.setSpacing(3)
        self.color_btns = {}
        cols_per_row = 10
        # 현재 테마에 맞는 추천 팔레트 사용
        presets = get_color_presets(t)
        for i, c in enumerate(presets):
            cb = QPushButton()
            cb.setFixedSize(22, 22)
            is_sel = (c == self.selected_color)
            cb.setStyleSheet(f"""
                QPushButton {{
                    background: {c};
                    border-radius: 4px;
                    border: {'2px solid '+t['accent'] if is_sel else '1px solid '+t['border']};
                }}
                QPushButton:hover {{ border: 2px solid {t['accent']}; }}
            """)
            cb.clicked.connect(lambda _, x=c: self._select_color(x))
            self.color_btns[c] = cb
            color_grid.addWidget(cb, i // cols_per_row, i % cols_per_row)

        # 커스텀 색상 버튼
        custom_color_btn = QPushButton("🎨")
        custom_color_btn.setFixedSize(22, 22)
        custom_color_btn.setToolTip("직접 색 고르기")
        custom_color_btn.setStyleSheet(f"""
            QPushButton {{
                background: {t['header']};
                border-radius: 4px;
                border: 1px solid {t['border']};
                font-size: 11px;
                padding: 0;
            }}
            QPushButton:hover {{ border: 2px solid {t['accent']}; }}
        """)
        custom_color_btn.clicked.connect(self._pick_custom_color)
        last_row = len(presets) // cols_per_row
        last_col = len(presets) % cols_per_row
        color_grid.addWidget(custom_color_btn, last_row, last_col)
        layout.addLayout(color_grid)

        # ── 이미지 사용 ─────────────────────────────────────────
        img_row = QHBoxLayout()
        img_row.setSpacing(8)
        self.image_btn = QPushButton()
        self.image_btn.setFixedHeight(28)
        self.image_btn.clicked.connect(self._pick_image)
        img_row.addWidget(self.image_btn, 1)
        self.image_remove_btn = QPushButton("✕")
        self.image_remove_btn.setFixedSize(28, 28)
        self.image_remove_btn.setToolTip("이미지 제거")
        self.image_remove_btn.clicked.connect(self._remove_image)
        img_row.addWidget(self.image_remove_btn)
        layout.addLayout(img_row)
        self._update_image_button_label()

        # ── 동작 종류 ─────────────────────────────────────────
        layout.addWidget(QLabel("동작 종류"))
        self.action_combo = QComboBox()
        for key, label in CUSTOM_ACTION_TYPES:
            self.action_combo.addItem(label, key)
        cur_type = self.btn_data.get("action_type", "url")
        for i in range(self.action_combo.count()):
            if self.action_combo.itemData(i) == cur_type:
                self.action_combo.setCurrentIndex(i)
                break
        self.action_combo.currentIndexChanged.connect(self._on_action_changed)
        layout.addWidget(self.action_combo)

        self.value_label = QLabel("URL")
        layout.addWidget(self.value_label)

        # 단축키 입력 행 (단축키 타입일 때만 녹화 버튼 표시)
        value_row = QHBoxLayout()
        self.value_edit = QLineEdit(self.btn_data.get("action_value", ""))
        self.value_edit.setPlaceholderText("값 입력...")
        value_row.addWidget(self.value_edit)

        self.record_btn = QPushButton("🎯 단축키 캡처")
        self.record_btn.setFixedHeight(32)
        self.record_btn.setCheckable(True)
        self.record_btn.setStyleSheet(f"""
            QPushButton {{
                background: {t['header']};
                color: {t['btn_sub']};
                border: 1px solid {t['border']};
                border-radius: 6px;
                font-size: 11px;
                padding: 0 8px;
            }}
            QPushButton:checked {{
                background: {t['accent']}33;
                color: {t['accent']};
                border: 1px solid {t['accent']};
            }}
            QPushButton:hover {{ border: 1px solid {t['accent']}; }}
        """)
        self.record_btn.clicked.connect(self._toggle_record)
        self.record_btn.setVisible(False)
        value_row.addWidget(self.record_btn)
        layout.addLayout(value_row)

        # ── 단축키 빌더 (체크박스 modifier + 드롭박스 키) ─────────
        self.shortcut_builder = QWidget()
        sb_layout = QVBoxLayout(self.shortcut_builder)
        sb_layout.setContentsMargins(0, 4, 0, 0)
        sb_layout.setSpacing(6)
        sb_label = QLabel("직접 조합 만들기")
        sb_label.setStyleSheet(f"color:{t['btn_sub']};font-size:11px;font-weight:700;background:transparent;")
        sb_layout.addWidget(sb_label)
        sb_hint = QLabel("Win+E, Win+숫자처럼 Windows가 가로채는 단축키는 여기서 만들어줘")
        sb_hint.setStyleSheet(f"color:{t['btn_sub']};font-size:10px;background:transparent;")
        sb_hint.setWordWrap(True)
        sb_layout.addWidget(sb_hint)
        # modifier 체크박스 행
        mod_row = QHBoxLayout()
        mod_row.setSpacing(8)
        self.sc_ctrl = QCheckBox("Ctrl")
        self.sc_shift = QCheckBox("Shift")
        self.sc_alt = QCheckBox("Alt")
        self.sc_win = QCheckBox("Win")
        for cb in (self.sc_ctrl, self.sc_shift, self.sc_alt, self.sc_win):
            cb.setStyleSheet(f"""
                QCheckBox {{ color:{t['btn_text']}; font-size:11px; background:transparent; spacing:4px; }}
                QCheckBox::indicator {{ width:14px; height:14px; border:1px solid {t['border']}; border-radius:3px; background:{t['header']}; }}
                QCheckBox::indicator:checked {{ background:{t['accent']}; border-color:{t['accent']}; }}
            """)
            mod_row.addWidget(cb)
        mod_row.addStretch()
        sb_layout.addLayout(mod_row)
        # 메인 키 입력 + 적용 버튼
        key_row = QHBoxLayout()
        key_row.setSpacing(6)
        self.sc_key_input = QLineEdit()
        self.sc_key_input.setMaxLength(15)
        self.sc_key_input.setPlaceholderText("키 입력 (예: A, F5, Space, Enter, ↑)")
        self.sc_key_input.returnPressed.connect(self._apply_shortcut_builder)
        key_row.addWidget(self.sc_key_input, 1)
        apply_btn = QPushButton("↵ 적용")
        apply_btn.setFixedHeight(28)
        apply_btn.setStyleSheet(f"""
            QPushButton {{
                background:{t['accent']}; color:{t['bg']};
                border:1px solid {t['accent']}; border-radius:6px;
                padding:0 14px; font-size:11px; font-weight:700;
            }}
            QPushButton:hover {{ border-color:{t['btn_text']}; }}
        """)
        apply_btn.clicked.connect(self._apply_shortcut_builder)
        key_row.addWidget(apply_btn)
        sb_layout.addLayout(key_row)
        self.shortcut_builder.setVisible(False)
        layout.addWidget(self.shortcut_builder)

        self.admin_check = QCheckBox("관리자 권한으로 실행")
        self.admin_check.setChecked(self.btn_data.get("admin", False))
        layout.addWidget(self.admin_check)

        self._on_action_changed()

        # ── 하단 버튼 — design_tokens의 표준 스타일 사용 ───────
        from design_tokens import primary_btn, secondary_btn, destructive_btn
        btn_row = QHBoxLayout()
        if not self.is_new:
            del_btn = QPushButton("🗑️ 삭제")
            del_btn.setFixedHeight(32)
            del_btn.setStyleSheet(destructive_btn(t))
            del_btn.clicked.connect(self._delete)
            btn_row.addWidget(del_btn)

        btn_row.addStretch()

        cancel_btn = QPushButton("✕ 취소")
        cancel_btn.setFixedHeight(32)
        cancel_btn.setStyleSheet(secondary_btn(t))
        cancel_btn.clicked.connect(self.reject)
        btn_row.addWidget(cancel_btn)

        save_btn = QPushButton("✅ 저장")
        save_btn.setFixedHeight(32)
        save_btn.setStyleSheet(primary_btn(t))
        save_btn.clicked.connect(self._save)
        btn_row.addWidget(save_btn)

        layout.addLayout(btn_row)



    def _select_icon(self, icon):
        if getattr(self, '_in_preview', False):
            return
        t = self.theme
        self._deselect_all_icons()
        self.icon_btns[icon].setStyleSheet(f"""
            QPushButton {{
                background: {t['accent']}33;
                border: 2px solid {t['accent']};
                border-radius: 6px;
                font-size: 18px;
                padding: 2px;
                font-family: 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;
            }}
        """)
        self.btn_data["icon"] = icon
        self._image_b64 = None
        self._preview_on_widget()

    def _deselect_all_icons(self):
        if getattr(self, '_in_preview', False):
            return
        t = self.theme
        for ic, btn in self.icon_btns.items():
            is_fav = ic in self._favorites
            border_color = "#f0883e" if is_fav else t['border']
            border_width = "2px" if is_fav else "1px"
            btn.setStyleSheet(f"""
                QPushButton {{
                    background: {t['header']};
                    border: {border_width} solid {border_color};
                    border-radius: 6px;
                    font-size: 18px;
                    padding: 2px;
                    font-family: 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;
                }}
                QPushButton:hover {{ background: {t['accent']}33; }}
            """)

    def _select_color(self, color):
        t = self.theme
        self.selected_color = color
        # 색상 선택 시 이미지 해제 (색상이 우선 → 이미지 모드 종료)
        # 파일 삭제는 저장 시점으로 미룸 — 취소하면 이미지가 그대로 남는다
        if self._image_b64:
            self._pending_delete.add(self._image_b64)
            self._image_b64 = None
            self._update_image_button_label()
        for c, btn in self.color_btns.items():
            btn.setStyleSheet(f"""
                QPushButton {{
                    background: {c};
                    border-radius: 4px;
                    border: {'2px solid '+t['accent'] if c == color else '1px solid '+t['border']};
                }}
                QPushButton:hover {{ border: 2px solid {t['accent']}; }}
            """)
        self._preview_on_widget()

    def _pick_custom_color(self):
        color = QColorDialog.getColor(QColor(self.selected_color), self, "색상 선택")
        if color.isValid():
            self.selected_color = color.name()
            self._select_color(self.selected_color)

    # ── 이미지 선택/제거 ───────────────────────────────────
    def _update_image_button_label(self):
        """이미지 버튼 라벨/상태 갱신."""
        try:
            t = self.theme
            has_img = bool(self._image_b64)
            if has_img:
                import os
                fname = os.path.basename(self._image_b64)
                label = f"🖼️  {fname[:24]}{'...' if len(fname) > 24 else ''}"
            else:
                label = "🖼️  이미지 선택"
            self.image_btn.setText(label)
            self.image_btn.setStyleSheet(f"""
                QPushButton {{
                    background: {t['btn_bg']};
                    color: {t['accent'] if has_img else t['btn_text']};
                    border: 1px solid {t['accent'] if has_img else t['border']};
                    border-radius: 6px;
                    padding: 4px 10px;
                    text-align: left;
                    font-size: 11px;
                }}
                QPushButton:hover {{ border-color: {t['accent']}; }}
            """)
            self.image_remove_btn.setVisible(has_img)
            # padding:0 필수 — 전역 QPushButton padding을 상속하면 ✕가 잘려 안 보인다
            self.image_remove_btn.setStyleSheet(f"""
                QPushButton {{
                    background: transparent;
                    color: {t['btn_text']};
                    border: 1px solid {t['border']};
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 700;
                    padding: 0;
                }}
                QPushButton:hover {{ background: {t['danger']}; color: white; border-color: {t['danger']}; }}
            """)
        except Exception:
            pass

    def _pick_image(self):
        """이미지 선택 → ImageEditorDialog → AppData/images 저장."""
        try:
            from image_editor import pick_and_edit_image
            import config as _cfg
            # 버튼 ID 기반 경로 (편집 중인 버튼)
            btn_id = self.btn_data.get("id", "new")
            save_path = _cfg.make_button_image_path(btn_id)
            ok = pick_and_edit_image(self, self.theme, save_path, output_size=512)
            if ok:
                # 이전 이미지는 저장 시점에 정리 (취소 시 원본 유지)
                old = self._image_b64
                if old and old != save_path:
                    self._pending_delete.add(old)
                self._session_images.add(save_path)
                self._image_b64 = save_path
                self._update_image_button_label()
        except Exception as e:
            from PyQt6.QtWidgets import QMessageBox
            QMessageBox.warning(self, "오류", f"이미지 선택 중 오류:\n{e}")
            import traceback; traceback.print_exc()

    def _remove_image(self):
        """현재 설정된 이미지 제거 (파일 삭제는 저장 시점에)."""
        try:
            if self._image_b64:
                self._pending_delete.add(self._image_b64)
                self._image_b64 = None
                self._update_image_button_label()
        except Exception:
            pass

    def _on_action_changed(self):
        cur = self.action_combo.currentData()
        placeholders = {
            "url":    "https://www.example.com",
            "folder": "%USERPROFILE%\\Documents",
            "app":    "C:\\Program Files\\...\\app.exe",
            "cmd":    "cmd.exe  또는  명령어 입력",
            "copy":   "복사할 텍스트 입력",
        }
        labels = {
            "url":    "URL",
            "folder": "폴더 경로",
            "app":    "실행 파일 경로",
            "cmd":    "명령어",
            "copy":   "복사할 텍스트",
        }
        self.value_label.setText(labels.get(cur, "값"))
        self.value_edit.setPlaceholderText(placeholders.get(cur, ""))
        self.admin_check.setVisible(cur in ("cmd", "app"))
        self.record_btn.setVisible(cur == "shortcut")
        # 단축키 빌더 (체크박스 + 드롭박스)는 shortcut 모드일 때만
        if hasattr(self, "shortcut_builder"):
            self.shortcut_builder.setVisible(cur == "shortcut")
        if cur != "shortcut":
            self.record_btn.setChecked(False)

    def _apply_shortcut_builder(self):
        """체크박스 modifier + 입력 키 → value_edit에 'ctrl+shift+a' 형식으로 설정."""
        parts = []
        if self.sc_ctrl.isChecked():  parts.append("ctrl")
        if self.sc_shift.isChecked(): parts.append("shift")
        if self.sc_alt.isChecked():   parts.append("alt")
        if self.sc_win.isChecked():   parts.append("win")
        key_raw = self.sc_key_input.text().strip()
        if not key_raw:
            from PyQt6.QtWidgets import QMessageBox
            QMessageBox.information(
                self, "키 입력 필요",
                "메인 키를 입력해줘 (예: A, F5, Space, ↑)"
            )
            self.sc_key_input.setFocus()
            return
        # 입력값을 actions.py KEY_MAP 형식으로 변환
        key_lc = key_raw.lower()
        symbol_map = {
            "←": "left", "↑": "up", "→": "right", "↓": "down",
            "esc": "esc", "escape": "esc",
            "tab": "tab", "enter": "enter", "return": "enter",
            "space": "space", "스페이스": "space",
            "backspace": "backspace", "백스페이스": "backspace",
            "delete": "delete", "del": "delete",
            "home": "home", "end": "end",
            "pageup": "pageup", "pgup": "pageup",
            "pagedown": "pagedown", "pgdn": "pagedown",
            "printscreen": "printscreen", "prtsc": "printscreen",
        }
        key_lc = symbol_map.get(key_lc, key_lc)
        parts.append(key_lc)
        self.value_edit.setText("+".join(parts))
        # action_type이 shortcut이 아니면 자동으로 변경 (UX 안전망)
        try:
            for i in range(self.action_combo.count()):
                if self.action_combo.itemData(i) == "shortcut":
                    if self.action_combo.currentIndex() != i:
                        self.action_combo.setCurrentIndex(i)
                    break
        except Exception:
            pass
        # 입력창 정리 (다음 입력 편하게)
        self.sc_key_input.clear()
        for cb in (self.sc_ctrl, self.sc_shift, self.sc_alt, self.sc_win):
            cb.setChecked(False)

    def _toggle_record(self, checked):
        if checked:
            self.record_btn.setText("⏺ 키를 눌러주세요... (ESC 취소)")
            self.value_edit.clear()
            self.value_edit.setReadOnly(True)
            self.value_edit.setPlaceholderText("단축키를 눌러주세요 (Win 키 포함 OK)...")
            # ── 1차: Windows 저수준 후크 시도 (Win+E 등 OS 단축키 캡처) ──
            self._hook = None
            try:
                from shortcut_hook import ShortcutHook, is_available
                if is_available():
                    self._hook = ShortcutHook(self)
                    self._hook.captured.connect(self._on_hook_captured)
                    if not self._hook.start():
                        self._hook = None
            except Exception:
                self._hook = None
            # ── 2차: 후크 실패 시 grabKeyboard 폴백 ──
            if self._hook is None:
                self.value_edit.installEventFilter(self)
                self.value_edit.setFocus()
                try:
                    self.value_edit.grabKeyboard()
                except Exception:
                    pass
        else:
            self.record_btn.setText("🎯 단축키 캡처")
            self.value_edit.setReadOnly(False)
            self.value_edit.removeEventFilter(self)
            try:
                self.value_edit.releaseKeyboard()
            except Exception:
                pass
            # 후크 정리
            if getattr(self, "_hook", None) is not None:
                try:
                    self._hook.stop()
                except Exception:
                    pass
                self._hook = None

    def _on_hook_captured(self, combo: str):
        """LL 후크에서 단축키 캡처 완료 → value_edit에 반영."""
        try:
            if combo:  # 빈 문자열이면 ESC 취소
                self.value_edit.setText(combo)
            self.record_btn.setChecked(False)
            self._toggle_record(False)
        except Exception:
            pass

    def eventFilter(self, obj, event):
        if obj == self.value_edit and self.record_btn.isChecked():
            # ShortcutOverride도 가로채서 Qt가 단축키로 처리하기 전에 막음
            if event.type() == QEvent.Type.ShortcutOverride:
                event.accept()
                return True
            if event.type() == QEvent.Type.KeyPress:
                key = event.key()
                mods = event.modifiers()

                # 수식키만 누른 경우 무시
                if key in (Qt.Key.Key_Control, Qt.Key.Key_Shift, Qt.Key.Key_Alt,
                           Qt.Key.Key_Meta, Qt.Key.Key_Super_L, Qt.Key.Key_Super_R):
                    return True

                parts = []
                if mods & Qt.KeyboardModifier.ControlModifier: parts.append("ctrl")
                if mods & Qt.KeyboardModifier.ShiftModifier:   parts.append("shift")
                if mods & Qt.KeyboardModifier.AltModifier:     parts.append("alt")
                if mods & Qt.KeyboardModifier.MetaModifier:    parts.append("win")
                key_map = {
                    Qt.Key.Key_A: "a", Qt.Key.Key_B: "b", Qt.Key.Key_C: "c",
                    Qt.Key.Key_D: "d", Qt.Key.Key_E: "e", Qt.Key.Key_F: "f",
                    Qt.Key.Key_G: "g", Qt.Key.Key_H: "h", Qt.Key.Key_I: "i",
                    Qt.Key.Key_J: "j", Qt.Key.Key_K: "k", Qt.Key.Key_L: "l",
                    Qt.Key.Key_M: "m", Qt.Key.Key_N: "n", Qt.Key.Key_O: "o",
                    Qt.Key.Key_P: "p", Qt.Key.Key_Q: "q", Qt.Key.Key_R: "r",
                    Qt.Key.Key_S: "s", Qt.Key.Key_T: "t", Qt.Key.Key_U: "u",
                    Qt.Key.Key_V: "v", Qt.Key.Key_W: "w", Qt.Key.Key_X: "x",
                    Qt.Key.Key_Y: "y", Qt.Key.Key_Z: "z",
                    Qt.Key.Key_0: "0", Qt.Key.Key_1: "1", Qt.Key.Key_2: "2",
                    Qt.Key.Key_3: "3", Qt.Key.Key_4: "4", Qt.Key.Key_5: "5",
                    Qt.Key.Key_6: "6", Qt.Key.Key_7: "7", Qt.Key.Key_8: "8",
                    Qt.Key.Key_9: "9",
                    Qt.Key.Key_F1: "f1", Qt.Key.Key_F2: "f2", Qt.Key.Key_F3: "f3",
                    Qt.Key.Key_F4: "f4", Qt.Key.Key_F5: "f5", Qt.Key.Key_F6: "f6",
                    Qt.Key.Key_F7: "f7", Qt.Key.Key_F8: "f8", Qt.Key.Key_F9: "f9",
                    Qt.Key.Key_F10: "f10", Qt.Key.Key_F11: "f11", Qt.Key.Key_F12: "f12",
                    Qt.Key.Key_Escape: "esc", Qt.Key.Key_Tab: "tab",
                    Qt.Key.Key_Return: "enter", Qt.Key.Key_Enter: "enter",
                    Qt.Key.Key_Space: "space", Qt.Key.Key_Backspace: "backspace",
                    Qt.Key.Key_Delete: "delete", Qt.Key.Key_Home: "home",
                    Qt.Key.Key_End: "end", Qt.Key.Key_PageUp: "pageup",
                    Qt.Key.Key_PageDown: "pagedown", Qt.Key.Key_Left: "left",
                    Qt.Key.Key_Right: "right", Qt.Key.Key_Up: "up",
                    Qt.Key.Key_Down: "down", Qt.Key.Key_Print: "printscreen",
                }
                key_name = key_map.get(key)
                if key_name:
                    parts.append(key_name)
                if parts:
                    self.value_edit.setText("+".join(parts))
                    self.record_btn.setChecked(False)
                    self.record_btn.setText("🎯 단축키 캡처")
                    self.value_edit.setReadOnly(False)
                    self.value_edit.removeEventFilter(self)
                    try:
                        self.value_edit.releaseKeyboard()
                    except Exception:
                        pass
                return True
        return super().eventFilter(obj, event)

    def _save_favorites(self):
        try:
            import json, os
            import config as _cfg
            fav_file = os.path.join(_cfg.get_data_dir(), "favorites.json")
            with open(fav_file, "w", encoding="utf-8") as f:
                json.dump(self._favorites, f, ensure_ascii=False)
        except Exception:
            pass

    def _toggle_favorite(self, icon):
        if icon in self._favorites:
            self._favorites.remove(icon)
        else:
            self._favorites.append(icon)
        self._save_favorites()
        self._rebuild_emoji_grid()

    def _rebuild_emoji_grid(self):
        """즐겨찾기 변경 시 그리드 재빌드"""
        try:
            t = self.theme
            cur_icon = self.btn_data.get("icon", "💻")
            COLS_EMOJI = 6
            while self._emoji_vbox.count():
                item = self._emoji_vbox.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
            self.icon_btns = {}
            cats = get_icon_categories(self._favorites if self._favorites else None)
            for cat_name, icons in cats:
                cat_lbl = QLabel(cat_name)
                cat_lbl.setStyleSheet(f"color:{t['btn_sub']};font-size:10px;font-weight:700;background:transparent;border:none;padding:3px 0 1px 0;")
                self._emoji_vbox.addWidget(cat_lbl)
                row_widget = QWidget()
                row_widget.setStyleSheet("background:transparent;")
                row_grid = QGridLayout(row_widget)
                row_grid.setSpacing(3)
                row_grid.setContentsMargins(0,0,0,0)
                is_fav_cat = cat_name == "⭐ 즐겨찾기"
                for i, ic in enumerate(icons):
                    btn = QPushButton(ic)
                    btn.setFixedSize(44, 44)
                    is_sel = (ic == cur_icon and not self._image_b64)
                    is_fav = ic in self._favorites
                    border_color = t['accent'] if is_sel else ("#f0883e" if is_fav and not is_fav_cat else t['border'])
                    btn.setStyleSheet(f"""
                        QPushButton {{
                            background: {t['accent']+'33' if is_sel else t['header']};
                            border: {'2px' if is_sel or (is_fav and not is_fav_cat) else '1px'} solid {border_color};
                            border-radius: 6px;
                            font-size: 18px;
                            padding: 2px;
                            font-family: 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif;
                        }}
                        QPushButton:hover {{ background: {t['accent']}33; }}
                    """)
                    btn.clicked.connect(lambda _, x=ic: self._select_icon(x))
                    btn.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
                    btn.customContextMenuRequested.connect(lambda _, x=ic: self._toggle_favorite(x))
                    self.icon_btns[ic] = btn
                    row_grid.addWidget(btn, i // COLS_EMOJI, i % COLS_EMOJI)
                self._emoji_vbox.addWidget(row_widget)
        except Exception as e:
            print(f"rebuild error: {e}")

    def _preview_on_widget(self):
        """이미지→색상 전환 시 크래시 방지용 stub. (실시간 미리보기 비활성)"""
        pass

    def _cleanup_images_on_cancel(self):
        """취소 시: 이번 편집에서 새로 만든 이미지만 삭제 (원본은 보존)."""
        try:
            import config as _cfg
            orig = self._orig_btn_data.get("icon_image")
            for p in self._session_images:
                if p and p != orig:
                    _cfg.remove_button_image(p)
            self._session_images.clear()
            self._pending_delete.clear()
        except Exception:
            pass

    def _cleanup_images_on_save(self):
        """저장 시: 교체/제거로 더 이상 안 쓰는 이미지 삭제."""
        try:
            import config as _cfg
            for p in self._pending_delete:
                if p and p != self._image_b64:
                    _cfg.remove_button_image(p)
            self._pending_delete.clear()
            self._session_images.clear()
        except Exception:
            pass

    def reject(self):
        self._cleanup_images_on_cancel()
        try:
            parent = self.parent()
            btn_id = self._orig_btn_data.get("id", -1)
            for btn_widget in parent._btn_widgets:
                if btn_widget.btn_data.get("id") == btn_id:
                    btn_widget.btn_data = self._orig_btn_data
                    btn_widget._apply_style()
                    btn_widget._refresh_label()
                    break
        except Exception:
            pass
        try:
            self.record_btn.setChecked(False)
            self.record_btn.setText("🎯 단축키 캡처")
            self.value_edit.setReadOnly(False)
            self.removeEventFilter(self)
        except Exception:
            pass
        # 후크 정리 (열려있으면 닫기)
        try:
            if getattr(self, "_hook", None) is not None:
                self._hook.stop()
                self._hook = None
        except Exception:
            pass
        super().reject()

    def _cleanup_hook(self):
        """후크/grabKeyboard leak 방지 — 어떤 경로로 닫혀도 호출."""
        try:
            if getattr(self, "_hook", None) is not None:
                self._hook.stop()
                self._hook = None
        except Exception:
            pass
        try:
            self.value_edit.releaseKeyboard()
        except Exception:
            pass

    def closeEvent(self, e):
        # X 버튼/Alt+F4 등 모든 닫힘 경로에서 후크 정리
        self._cleanup_hook()
        super().closeEvent(e)

    def _save(self):
        self.btn_data["label"] = self.label_edit.text().strip() or "버튼"
        self.btn_data["color"] = self.selected_color
        self.btn_data["action_type"] = self.action_combo.currentData()
        self.btn_data["action_value"] = self.value_edit.text().strip()
        self.btn_data["admin"] = self.admin_check.isChecked()
        self.btn_data["icon_image"] = self._image_b64
        self._cleanup_images_on_save()
        self._cleanup_hook()
        self.saved.emit(self.btn_data)
        self.accept()

    def _delete(self):
        # 버튼 삭제: 이번 편집에서 만든 새 이미지도 정리 (원본 이미지는 삭제 핸들러가 처리)
        self._cleanup_images_on_cancel()
        self._cleanup_hook()
        self.deleted.emit(self.btn_data.get("id", -1))
        self.accept()
