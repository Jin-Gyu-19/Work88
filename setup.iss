; SupportDeck Inno Setup 스크립트 — build.py [3/3] 단계에서 사용.
; (유실된 원본을 재작성한 버전)
; 관리자 권한 없이 사용자 폴더(%LOCALAPPDATA%\Programs)에 설치.

#define MyAppName "SupportDeck"
#define MyAppVersion "2.2.0"
#define MyAppPublisher "SupportDeck"
#define MyAppExeName "SupportDeck.exe"

[Setup]
AppId={{8C1A2E77-4B3D-4F5E-9D2A-SupportDeck01}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; 관리자 권한 없이 설치 (이후 업데이트도 UAC 없이)
PrivilegesRequired=lowest
OutputDir=installer
OutputBaseFilename=SupportDeck_Setup_v{#MyAppVersion}
SetupIconFile=icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "startupicon"; Description: "Windows 시작 시 자동 실행"; GroupDescription: "추가 옵션:"

[Files]
Source: "dist\SupportDeck\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startupicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
