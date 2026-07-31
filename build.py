"""
SupportDeck Build Script
"""
import os
import sys
import subprocess

os.chdir(os.path.dirname(os.path.abspath(__file__)))

def find_python():
    # sys.executable 먼저 시도
    try:
        if os.path.exists(sys.executable) and os.path.getsize(sys.executable) > 0:
            test = subprocess.run([sys.executable, "--version"], capture_output=True, timeout=5)
            if test.returncode == 0:
                return sys.executable
    except Exception:
        pass
    # where python으로 탐색 (0바이트 제외, 실행 가능 여부 확인)
    try:
        result = subprocess.run("where python", shell=True, capture_output=True, text=True)
        for line in result.stdout.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                if os.path.exists(line) and os.path.getsize(line) > 0:
                    test = subprocess.run([line, "--version"], capture_output=True, timeout=5)
                    if test.returncode == 0:
                        return line
            except Exception:
                continue
    except Exception:
        pass
    return None

python = find_python()
if not python:
    print("Python not found! Please reinstall Python.")
    input("Press any key...")
    sys.exit(1)
print(f"Python: {python} ({os.path.getsize(python)} bytes)")

print("================================")
print("  SupportDeck Build Start")
print("================================")
print()

print("[1/3] Creating icon...")
ret = subprocess.run([python, "create_icon.py"])
if ret.returncode != 0:
    print("Icon creation failed!")
    input("Press any key...")
    sys.exit(1)
print("Icon created!")
print()

print("[2/3] Building exe with PyInstaller...")
ret = subprocess.run([python, "-m", "PyInstaller", "SupportDeck.spec", "--clean"])
if ret.returncode != 0:
    print("PyInstaller failed!")
    input("Press any key...")
    sys.exit(1)
print("Exe created!")
print()

print("[3/3] Building installer with Inno Setup...")
os.makedirs("installer", exist_ok=True)

inno_paths = [
    r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    r"C:\Program Files\Inno Setup 6\ISCC.exe",
]
inno = None
for p in inno_paths:
    if os.path.exists(p):
        inno = p
        break

if not inno:
    print("Inno Setup not found!")
    input("Press any key...")
    sys.exit(1)

ret = subprocess.run([inno, "setup.iss"])
if ret.returncode != 0:
    print("Inno Setup failed!")
    input("Press any key...")
    sys.exit(1)

print()
print("================================")
print("  Build Complete!")
print("  installer\\SupportDeck_Setup_v2.0.0.exe")
print("================================")
input("Press any key...")
