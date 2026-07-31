# -*- mode: python ; coding: utf-8 -*-
# SupportDeck PyInstaller spec — build.py가 `PyInstaller SupportDeck.spec --clean`으로 사용.
# (유실된 원본을 재작성한 버전. onedir 빌드 → Inno Setup(setup.iss)이 installer로 포장)

a = Analysis(
    ['main_qtweb.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('widget.html', '.'),          # 위젯 화면 (필수)
        ('icon.ico', '.'),
        ('icon_splash.png', '.'),      # 인트로 아이콘
        ('manual.html', '.'),
        ('aessets', 'aessets'),        # 계절 장식 스프라이트
        ('fonts', 'fonts'),
    ],
    hiddenimports=[
        'PyQt6.QtWebEngineWidgets',
        'PyQt6.QtWebEngineCore',
        'PyQt6.QtWebChannel',
        'widget',
        'button_editor',
        'image_editor',
        'design_tokens',
        'shortcut_hook',
        'actions',
        'config',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter'],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='SupportDeck',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icon.ico',
    version='version.txt',
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='SupportDeck',
)
