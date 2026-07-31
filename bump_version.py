#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SupportDeck 버전 일괄 변경 스크립트 (MAJOR.MINOR.PATCH)

사용법:
  py bump_version.py 2.1.0      # 버전 직접 지정
  py bump_version.py major      # 큰 변경  (2.0.3 -> 3.0.0)
  py bump_version.py minor      # 기능 추가 (2.0.3 -> 2.1.0)
  py bump_version.py patch      # 버그 수정 (2.0.3 -> 2.0.4)
  py bump_version.py            # 현재 버전만 보기

규칙:
  MAJOR = 큰 변경 / MINOR = 기능 추가 / PATCH = 자잘한 버그 수정

한 번에 맞춰지는 파일:
  - version.txt              (filevers/prodvers + FileVersion/ProductVersion)
  - setup.iss                (#define MyAppVersion)
  - main_qtweb.py            (APP_VERSION = 앱 내부 버전, 업데이트 확인용)
  - download_page/latest.json (version, date, 다운로드 url 파일명, 자동)
"""
import os
import re
import sys
import json
import hashlib
import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
VERSION_TXT = os.path.join(BASE, "version.txt")
SETUP_ISS = os.path.join(BASE, "setup.iss")
LATEST_JSON = os.path.join(BASE, "download_page", "latest.json")
MAIN_PY = os.path.join(BASE, "main_qtweb.py")

SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def read_current():
    """setup.iss → version.txt 순으로 현재 버전 탐지."""
    for path, pat in (
        (SETUP_ISS, r'#define\s+MyAppVersion\s+"([\d.]+)"'),
        (VERSION_TXT, r"FileVersion'?\s*,\s*u?'([\d.]+)'"),
    ):
        if os.path.exists(path):
            m = re.search(pat, open(path, encoding="utf-8").read())
            if m:
                v = m.group(1)
                # 항상 3자리로 정규화
                parts = (v.split(".") + ["0", "0", "0"])[:3]
                return ".".join(parts)
    return "0.0.0"


def bump(cur, part):
    M, m, p = (int(x) for x in cur.split("."))
    if part == "major":
        return f"{M+1}.0.0"
    if part == "minor":
        return f"{M}.{m+1}.0"
    if part == "patch":
        return f"{M}.{m}.{p+1}"
    raise ValueError(part)


def update_version_txt(new):
    if not os.path.exists(VERSION_TXT):
        return False
    M, m, p = new.split(".")
    s = open(VERSION_TXT, encoding="utf-8").read()
    s = re.sub(r"filevers=\(\s*\d+,\s*\d+,\s*\d+,\s*\d+\s*\)",
               f"filevers=({M}, {m}, {p}, 0)", s)
    s = re.sub(r"prodvers=\(\s*\d+,\s*\d+,\s*\d+,\s*\d+\s*\)",
               f"prodvers=({M}, {m}, {p}, 0)", s)
    s = re.sub(r"(u'FileVersion'\s*,\s*u')[\d.]+(')", rf"\g<1>{new}\g<2>", s)
    s = re.sub(r"(u'ProductVersion'\s*,\s*u')[\d.]+(')", rf"\g<1>{new}\g<2>", s)
    open(VERSION_TXT, "w", encoding="utf-8").write(s)
    return True


def update_setup_iss(new):
    if not os.path.exists(SETUP_ISS):
        return False
    s = open(SETUP_ISS, encoding="utf-8").read()
    s2 = re.sub(r'(#define\s+MyAppVersion\s+")[\d.]+(")', rf"\g<1>{new}\g<2>", s)
    if s2 == s:
        return False
    open(SETUP_ISS, "w", encoding="utf-8").write(s2)
    return True


def update_main_py(new):
    if not os.path.exists(MAIN_PY):
        return False
    s = open(MAIN_PY, encoding="utf-8").read()
    s2 = re.sub(r'(APP_VERSION\s*=\s*")[\d.]+(")', rf"\g<1>{new}\g<2>", s, count=1)
    if s2 == s:
        return False
    open(MAIN_PY, "w", encoding="utf-8").write(s2)
    return True


def update_latest_json(new):
    if not os.path.exists(LATEST_JSON):
        return False
    data = json.load(open(LATEST_JSON, encoding="utf-8"))
    data["version"] = new
    data["date"] = datetime.date.today().isoformat()
    # 다운로드 url 파일명에 버전이 들어있으면 같이 교체 (SupportDeck-Setup-x.y.z.exe)
    if isinstance(data.get("url"), str):
        data["url"] = re.sub(r"(SupportDeck[-_]?Setup[-_]?v?)[\d.]+(\.exe)",
                             rf"\g<1>{new}\g<2>", data["url"], flags=re.I)
    # 빌드된 설치파일이 있으면 SHA-256 계산해서 넣기 (없으면 비움 → 빌드 후 다시 실행)
    exe = os.path.join(BASE, "installer", f"SupportDeck_Setup_v{new}.exe")
    if os.path.exists(exe):
        h = hashlib.sha256()
        with open(exe, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        data["sha256"] = h.hexdigest()
        print(f"  · SHA-256 계산 완료: {data['sha256'][:16]}…")
    else:
        data["sha256"] = ""
        print(f"  · 설치파일 아직 없음 → sha256 비움 (빌드 후 'py bump_version.py {new}' 다시 실행 권장)")
    json.dump(data, open(LATEST_JSON, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    open(LATEST_JSON, "a", encoding="utf-8").write("\n")
    return True


def fill_sha_only(ver):
    """버전 변경 없이, 빌드된 설치파일의 SHA-256만 latest.json에 채움."""
    if not os.path.exists(LATEST_JSON):
        print("[오류] latest.json 이 없어요.")
        return False
    exe = os.path.join(BASE, "installer", f"SupportDeck_Setup_v{ver}.exe")
    if not os.path.exists(exe):
        print(f"[오류] 설치파일이 없어요: {exe}")
        print("       먼저 빌드(build.py)를 끝낸 뒤 실행하세요.")
        return False
    h = hashlib.sha256()
    with open(exe, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    data = json.load(open(LATEST_JSON, encoding="utf-8"))
    data["sha256"] = h.hexdigest()
    json.dump(data, open(LATEST_JSON, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    open(LATEST_JSON, "a", encoding="utf-8").write("\n")
    print(f"  ✓ SHA-256 채움 (v{ver}): {data['sha256']}")
    return True


def main():
    cur = read_current()
    arg = sys.argv[1].strip().lower() if len(sys.argv) > 1 else ""

    if not arg:
        print(f"현재 버전: {cur}")
        print("사용법: py bump_version.py <버전 | major | minor | patch | sha>")
        return

    if arg == "sha":
        # 버전 변경 없이 현재 버전 설치파일의 sha256만 채움 (빌드 후 실행)
        sys.exit(0 if fill_sha_only(cur) else 1)

    if arg in ("major", "minor", "patch"):
        new = bump(cur, arg)
    elif SEMVER.match(arg):
        new = arg
    else:
        print(f"[오류] 버전 형식이 이상해요: '{arg}'  (예: 2.1.0 또는 major/minor/patch)")
        sys.exit(1)

    print(f"버전 변경:  {cur}  →  {new}")
    results = [
        ("version.txt", update_version_txt(new)),
        ("setup.iss", update_setup_iss(new)),
        ("main_qtweb.py (APP_VERSION)", update_main_py(new)),
        ("download_page/latest.json", update_latest_json(new)),
    ]
    for name, ok in results:
        print(f"  {'✓ 갱신' if ok else '· 건너뜀(파일 없음/변경 없음)'}  {name}")
    print("\n완료! latest.json의 변경사항(notes_ko / notes_en)은 직접 적어주세요.")
    print("그다음: 빌드(build.py) → 설치파일을 R2 업로드 → latest.json을 R2/Pages에 반영")


if __name__ == "__main__":
    main()
