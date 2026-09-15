; ViGEmBus virtual gamepad driver, required for gamepad input in console
; streaming. The installer runs elevated, so the download is pinned to the
; exact release asset and never executed unverified: a substituted asset would
; otherwise be a local privilege escalation. Missing driver is not fatal:
; keyboard and mouse streaming keep working without it.
!define VIGEM_SETUP_URL "https://github.com/nefarius/ViGEmBus/releases/download/v1.22.0/ViGEmBus_1.22.0_x64_x86_arm64.exe"
; SHA-256 of the v1.22.0 asset published at that release URL. Its Authenticode
; signature is Valid and issued to "CN=Nefarius Software Solutions e.U."
; (DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1) — the hash is the
; stronger pin of the two, and the only one that can be checked reliably from
; this installer: Get-FileHash/Get-AuthenticodeSignature are not loadable in
; the PowerShell reached from a 32-bit NSIS installer (module auto-loading
; finds CommandNotFound for both). certutil and findstr always are.
!define VIGEM_SETUP_SHA256 "89220A7865076B342892F98865F3499FB7C4CFD673159E89D352C360FD014C6A"

!macro customInstall
  ${ifNot} ${isUpdated}
    IfFileExists "$SYSDIR\drivers\ViGEmBus.sys" vigemDone 0

    DetailPrint "Downloading ViGEmBus driver for gamepad support..."
    NSISdl::download /TIMEOUT=30000 "${VIGEM_SETUP_URL}" "$PLUGINSDIR\ViGEmBus-setup.exe"
    Pop $0
    StrCmp $0 "success" 0 vigemSkip

    ; certutil prints the SHA-256 on its own line, so findstr matches the
    ; digest whatever the installer's UI language is, and its exit code is 0
    ; only for the pinned bytes. Anything else (mismatch, unreadable file,
    ; missing certutil) falls through to the skip path and nothing is run.
    DetailPrint "Verifying the ViGEmBus installer..."
    nsExec::ExecToStack '"$SYSDIR\cmd.exe" /c certutil -hashfile "$PLUGINSDIR\ViGEmBus-setup.exe" SHA256 | findstr /i /c:"${VIGEM_SETUP_SHA256}"'
    Pop $0 ; 0 when the pinned SHA-256 is in certutil's output
    StrCmp $0 "0" vigemVerified vigemUnverified

    vigemUnverified:
    DetailPrint "ViGEmBus installer failed verification (exit $0); it was not run, gamepad input will be unavailable"
    Goto vigemDone

    vigemVerified:
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
