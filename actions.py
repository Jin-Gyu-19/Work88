"""
액션 실행 모듈
"""
import os
import sys
import subprocess
import webbrowser


def run_action(btn: dict):
    action_type  = btn.get("action_type", "")
    action_value = btn.get("action_value", "")
    admin        = btn.get("admin", False)

    if action_type == "url":
        _open_url(action_value)
    elif action_type == "folder":
        _open_folder(action_value)
    elif action_type == "cmd":
        _run_cmd(action_value, admin)
    elif action_type == "app":
        _run_app(action_value, admin)
    elif action_type == "copy":
        _copy_text(action_value)
    elif action_type == "show_desktop":
        _show_desktop()
    elif action_type == "shortcut":
        _run_shortcut(action_value)
    elif action_type in ("timer", "counter"):
        pass


def _open_url(url):
    try:
        # 옛 버전 호환: action_type=url로 저장된 파일 경로(.url/.lnk/일반 파일) → startfile로 처리
        # Windows 경로 패턴(C:\...) 또는 실제 존재하는 파일이면 OS에 위임
        if url and (
            (len(url) >= 3 and url[1] == ':' and (url[2] == '\\' or url[2] == '/')) or
            url.startswith('\\\\') or
            os.path.exists(url)
        ):
            try:
                os.startfile(os.path.expandvars(url))
                return
            except Exception as e:
                print(f"파일 열기 fallback 오류: {e}")
        # 정상 URL 처리
        if not url.startswith(("http://", "https://", "ftp://", "file://")):
            url = "https://" + url
        webbrowser.open(url)
    except Exception as e:
        print(f"URL 열기 오류: {e}")


def _open_folder(path):
    try:
        path = os.path.expandvars(path)
        path = os.path.expanduser(path)
        if os.path.exists(path):
            os.startfile(path)
        else:
            os.startfile(os.path.dirname(path) or path)
    except Exception as e:
        print(f"폴더 열기 오류: {e}")


def _run_cmd(command, admin=False):
    try:
        if admin:
            import ctypes
            if command.lower() in ("cmd", "cmd.exe"):
                ctypes.windll.shell32.ShellExecuteW(None, "runas", "cmd.exe", None, None, 1)
            else:
                ctypes.windll.shell32.ShellExecuteW(None, "runas", "cmd.exe", f'/k "{command}"', None, 1)
        else:
            if command.lower() in ("cmd", "cmd.exe"):
                subprocess.Popen("cmd.exe", creationflags=subprocess.CREATE_NEW_CONSOLE)
            else:
                subprocess.Popen(f'cmd.exe /k "{command}"', creationflags=subprocess.CREATE_NEW_CONSOLE)
    except Exception as e:
        print(f"CMD 실행 오류: {e}")


def _run_app(path, admin=False):
    try:
        path = os.path.expandvars(path)
        path = os.path.expanduser(path)
        if admin:
            import ctypes
            ctypes.windll.shell32.ShellExecuteW(None, "runas", path, None, None, 1)
        else:
            os.startfile(path)
    except Exception as e:
        print(f"앱 실행 오류: {e}")


def _copy_text(text):
    try:
        import pyperclip
        pyperclip.copy(text)
    except Exception as e:
        # 폴백: ctypes로 Windows API 직접 호출
        try:
            import ctypes
            from ctypes import wintypes
            CF_UNICODETEXT = 13
            GMEM_MOVEABLE = 0x0002
            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32
            # 64비트에서 핸들/포인터가 32비트 int로 잘려 크래시하지 않게 타입 명시
            kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
            kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
            kernel32.GlobalLock.restype = ctypes.c_void_p
            kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
            kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
            kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
            user32.SetClipboardData.restype = wintypes.HANDLE
            user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]

            if not user32.OpenClipboard(0):
                raise OSError("OpenClipboard 실패")
            try:
                user32.EmptyClipboard()
                byte_data = (text or "").encode("utf-16-le") + b"\x00\x00"
                hCd = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(byte_data))
                if not hCd:
                    raise OSError("GlobalAlloc 실패")
                pchData = kernel32.GlobalLock(hCd)
                if not pchData:
                    kernel32.GlobalFree(hCd)
                    raise OSError("GlobalLock 실패")
                ctypes.memmove(pchData, byte_data, len(byte_data))
                kernel32.GlobalUnlock(hCd)
                if not user32.SetClipboardData(CF_UNICODETEXT, hCd):
                    kernel32.GlobalFree(hCd)
                    raise OSError("SetClipboardData 실패")
            finally:
                user32.CloseClipboard()
        except Exception as e2:
            print(f"클립보드 복사 오류: {e} / fallback: {e2}")


def _show_desktop():
    """바탕화면 보기 - Shell API 사용 (위젯은 Always on Top으로 유지)"""
    try:
        import ctypes
        # Shell의 ToggleDesktop 사용 - 가장 안정적인 방법
        ctypes.windll.shell32.ShellExecuteW(
            None, "open",
            "shell:::{3080F90D-D7AD-11D9-BD98-0000947B0257}",
            None, None, 1
        )
    except Exception:
        try:
            # 폴백: PostMessage로 Win+D 전송
            import ctypes
            HWND_BROADCAST = 0xFFFF
            WM_KEYDOWN = 0x0100
            WM_KEYUP   = 0x0101
            VK_LWIN    = 0x5B
            VK_D       = 0x44

            # 위젯 포커스 해제 후 키 전송
            ctypes.windll.user32.keybd_event(VK_LWIN, 0, 0, 0)
            ctypes.windll.user32.keybd_event(VK_D,    0, 0, 0)
            ctypes.windll.user32.keybd_event(VK_D,    0, 0x0002, 0)
            ctypes.windll.user32.keybd_event(VK_LWIN, 0, 0x0002, 0)
        except Exception as e:
            print(f"바탕화면 보기 오류: {e}")


def _run_shortcut(keys: str):
    """단축키 실행 - 예: ctrl+c, win+d, ctrl+shift+esc"""
    try:
        import ctypes
        import ctypes.wintypes
        import subprocess

        # Win 키 포함 단축키는 ctypes keybd_event로 실행
        parts_check = [k.strip().lower() for k in keys.replace("+", " ").split()]
        if "win" in parts_check:
            other_keys = [k for k in parts_check if k != "win"]
            VK_MAP = {
                "a":0x41,"b":0x42,"c":0x43,"d":0x44,"e":0x45,
                "f":0x46,"g":0x47,"h":0x48,"i":0x49,"j":0x4A,
                "k":0x4B,"l":0x4C,"m":0x4D,"n":0x4E,"o":0x4F,
                "p":0x50,"q":0x51,"r":0x52,"s":0x53,"t":0x54,
                "u":0x55,"v":0x56,"w":0x57,"x":0x58,"y":0x59,"z":0x5A,
                "0":0x30,"1":0x31,"2":0x32,"3":0x33,"4":0x34,
                "5":0x35,"6":0x36,"7":0x37,"8":0x38,"9":0x39,
                "ctrl":0x11,"shift":0x10,"alt":0x12,
                "f1":0x70,"f2":0x71,"f3":0x72,"f4":0x73,
                "f5":0x74,"f6":0x75,"f7":0x76,"f8":0x77,
                "f9":0x78,"f10":0x79,"f11":0x7A,"f12":0x7B,
                "esc":0x1B,"tab":0x09,"enter":0x0D,"space":0x20,
                "delete":0x2E,"left":0x25,"right":0x27,"up":0x26,"down":0x28,
            }
            KEYEVENTF_KEYUP = 0x0002
            ke = ctypes.windll.user32.keybd_event
            # Win 키 포함 전체 키 누르기
            all_vks = [0x5B]  # LWIN
            for k in other_keys:
                vk = VK_MAP.get(k)
                if vk:
                    all_vks.append(vk)
            for vk in all_vks:
                ke(vk, 0, 0, 0)
            import time; time.sleep(0.05)
            for vk in reversed(all_vks):
                ke(vk, 0, KEYEVENTF_KEYUP, 0)
            return

        # 키 매핑
        KEY_MAP = {
            "ctrl": 0x11, "control": 0x11,
            "shift": 0x10,
            "alt": 0x12,
            "win": 0x5B, "windows": 0x5B,
            "a": 0x41, "b": 0x42, "c": 0x43, "d": 0x44, "e": 0x45,
            "f": 0x46, "g": 0x47, "h": 0x48, "i": 0x49, "j": 0x4A,
            "k": 0x4B, "l": 0x4C, "m": 0x4D, "n": 0x4E, "o": 0x4F,
            "p": 0x50, "q": 0x51, "r": 0x52, "s": 0x53, "t": 0x54,
            "u": 0x55, "v": 0x56, "w": 0x57, "x": 0x58, "y": 0x59,
            "z": 0x5A,
            "0": 0x30, "1": 0x31, "2": 0x32, "3": 0x33, "4": 0x34,
            "5": 0x35, "6": 0x36, "7": 0x37, "8": 0x38, "9": 0x39,
            "f1": 0x70, "f2": 0x71, "f3": 0x72, "f4": 0x73,
            "f5": 0x74, "f6": 0x75, "f7": 0x76, "f8": 0x77,
            "f9": 0x78, "f10": 0x79, "f11": 0x7A, "f12": 0x7B,
            "esc": 0x1B, "escape": 0x1B,
            "tab": 0x09,
            "enter": 0x0D, "return": 0x0D,
            "space": 0x20,
            "backspace": 0x08,
            "delete": 0x2E,
            "home": 0x24, "end": 0x23,
            "pageup": 0x21, "pagedown": 0x22,
            "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
            "printscreen": 0x2C,
        }

        INPUT_KEYBOARD = 1
        KEYEVENTF_KEYUP = 0x0002

        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [
                ("wVk", ctypes.wintypes.WORD),
                ("wScan", ctypes.wintypes.WORD),
                ("dwFlags", ctypes.wintypes.DWORD),
                ("time", ctypes.wintypes.DWORD),
                ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
            ]

        class INPUT(ctypes.Structure):
            class _INPUT(ctypes.Union):
                _fields_ = [("ki", KEYBDINPUT)]
            _anonymous_ = ("_input",)
            _fields_ = [("type", ctypes.wintypes.DWORD), ("_input", _INPUT)]

        # 키 파싱
        parts = [k.strip().lower() for k in keys.replace("+", " ").split()]
        vk_list = []
        for p in parts:
            vk = KEY_MAP.get(p)
            if vk:
                vk_list.append(vk)

        if not vk_list:
            print(f"단축키 파싱 실패: {keys}")
            return

        # 키 누르기 + 떼기
        inputs = []
        for vk in vk_list:
            i = INPUT()
            i.type = INPUT_KEYBOARD
            i.ki.wVk = vk
            i.ki.dwFlags = 0
            inputs.append(i)
        for vk in reversed(vk_list):
            i = INPUT()
            i.type = INPUT_KEYBOARD
            i.ki.wVk = vk
            i.ki.dwFlags = KEYEVENTF_KEYUP
            inputs.append(i)

        arr = (INPUT * len(inputs))(*inputs)
        ctypes.windll.user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))
    except Exception as e:
        print(f"단축키 실행 오류: {e}")


ACTION_TYPES = [
    ("url",          "🌐 URL 열기"),
    ("folder",       "📁 폴더 열기"),
    ("app",          "⚡ 앱 실행"),
    ("cmd",          "💻 CMD 실행"),
    ("copy",         "📋 텍스트 복사"),
    ("show_desktop", "🖥️ 바탕화면 보기"),
    ("shortcut",     "⌨️ 단축키 실행"),
    ("timer",        "⏱️ 타이머"),
    ("counter",      "🔢 카운터"),
]
