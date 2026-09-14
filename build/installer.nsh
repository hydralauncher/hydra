!macro customInstall
  ${ifNot} ${isUpdated}
    ; ViGEmBus virtual gamepad driver, required for gamepad input in
    ; console streaming. Missing driver is not fatal: keyboard and mouse
    ; streaming keep working without it.
    IfFileExists "$SYSDIR\drivers\ViGEmBus.sys" vigemDone 0

    DetailPrint "Downloading ViGEmBus driver for gamepad support..."
    NSISdl::download /TIMEOUT=30000 "https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe" "$PLUGINSDIR\ViGEmBus-setup.exe"
    Pop $0
    StrCmp $0 "success" 0 vigemSkip

    DetailPrint "Installing ViGEmBus driver..."
    ExecWait '"$PLUGINSDIR\ViGEmBus-setup.exe" /qn' $1
    IntCmp $1 0 vigemDone vigemSkip vigemSkip

    vigemSkip:
    DetailPrint "ViGEmBus driver install failed or was cancelled (code $1); gamepad input will be unavailable"
    vigemDone:
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\hydralauncher-updater"
  ${endIf}
!macroend
