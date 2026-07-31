"""
shortcut_hook — 단축키 캡처용 Windows 저수준 키보드 후크 (재작성 스텁)

원본이 유실되어 안전한 스텁으로 대체함. button_editor.py는 이 모듈의
is_available()이 False면 자동으로 grabKeyboard 폴백을 사용하므로
단축키 캡처 기능 자체는 계속 동작한다 (Win 키 조합 캡처만 제한됨).

추후 원본 복구 또는 SetWindowsHookEx(WH_KEYBOARD_LL) 기반 재구현 시
이 파일만 교체하면 된다. 계약:
  - is_available() -> bool
  - ShortcutHook(parent): QObject
      · 시그널 captured(str)  — "ctrl+shift+s" 형식
      · start() -> bool
      · stop()
"""
from PyQt6.QtCore import QObject, pyqtSignal


def is_available() -> bool:
    """저수준 후크 사용 가능 여부 — 스텁은 항상 False (폴백 사용 유도)."""
    return False


class ShortcutHook(QObject):
    captured = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)

    def start(self) -> bool:
        return False

    def stop(self):
        pass
