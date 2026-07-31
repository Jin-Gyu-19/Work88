"""
SupportDeck 디자인 토큰 — radius/font/spacing 스케일 + 표준 컴포넌트 스타일.

모든 다이얼로그가 이 모듈에서 일관된 스타일을 가져다 씀.
"""

# ─── Border-radius scale ──────────────────────────────────────
# 기존 12개 다른 값(2,3,4,5,6,7,8,10,12,16,18,20) → 4단계로 정리
RADIUS = {
    "sm": 6,    # 인풋, 툴팁, 작은 배지
    "md": 10,   # 버튼, 헤더 버튼
    "lg": 14,   # 다이얼로그, 카드
    "xl": 18,   # 위젯 최상위 컨테이너
}

# ─── Font-size scale ──────────────────────────────────────────
# 기존 11개 값 → 6단계로 정리
FONT = {
    "xs":  10,  # caption, 카테고리 라벨
    "sm":  11,  # 작은 UI 텍스트
    "md":  12,  # 본문 (기본)
    "lg":  14,  # 강조 본문, 메뉴 항목
    "xl":  18,  # 섹션 제목, 큰 이모지
    "2xl": 28,  # 큰 이모지 버튼 아이콘
}

# ─── Spacing scale (4의 배수) ─────────────────────────────────
SPACE = {
    "1": 4,
    "2": 8,
    "3": 12,
    "4": 16,
    "5": 20,
    "6": 24,
}


# ─── 표준 버튼 스타일 생성기 ──────────────────────────────────
def primary_btn(theme):
    """주요 액션 (저장, 확인)."""
    t = theme
    return f"""
        QPushButton {{
            background: {t['accent']};
            color: {t['bg']};
            border: 1px solid {t['accent']};
            border-radius: {RADIUS['md']}px;
            padding: 8px 18px;
            font-size: {FONT['md']}px;
            font-weight: 700;
        }}
        QPushButton:hover {{ border-color: {t['btn_text']}; }}
        QPushButton:pressed {{ background: {t['accent']}; opacity: 0.85; }}
    """


def secondary_btn(theme):
    """보조 액션 (취소, 적용)."""
    t = theme
    return f"""
        QPushButton {{
            background: {t['header']};
            color: {t['btn_text']};
            border: 1px solid {t['border']};
            border-radius: {RADIUS['md']}px;
            padding: 8px 18px;
            font-size: {FONT['md']}px;
            font-weight: 500;
        }}
        QPushButton:hover {{ border-color: {t['accent']}; color: {t['accent']}; }}
    """


def destructive_btn(theme):
    """파괴적 액션 (삭제)."""
    t = theme
    return f"""
        QPushButton {{
            background: {t['danger']}22;
            color: {t['danger']};
            border: 1px solid {t['danger']}66;
            border-radius: {RADIUS['md']}px;
            padding: 8px 14px;
            font-size: {FONT['md']}px;
            font-weight: 600;
        }}
        QPushButton:hover {{
            background: {t['danger']};
            color: white;
            border-color: {t['danger']};
        }}
    """


def input_field(theme):
    """QLineEdit, QComboBox 공통."""
    t = theme
    return f"""
        QLineEdit, QComboBox {{
            background: {t['header']};
            color: {t['btn_text']};
            border: 1px solid {t['border']};
            border-radius: {RADIUS['sm']}px;
            padding: 6px 10px;
            font-size: {FONT['md']}px;
        }}
        QLineEdit:focus, QComboBox:focus {{
            border-color: {t['accent']};
        }}
        QLineEdit:disabled, QComboBox:disabled {{
            color: {t['btn_sub']};
        }}
    """


def dialog_container(theme):
    """다이얼로그 외곽 스타일 — 모든 모달이 공통으로 사용."""
    t = theme
    return f"""
        QDialog {{
            background: {t['bg']};
            border: 1px solid {t['border']};
            border-radius: {RADIUS['lg']}px;
        }}
        QLabel {{
            color: {t['btn_text']};
            font-size: {FONT['md']}px;
            background: transparent;
        }}
    """
