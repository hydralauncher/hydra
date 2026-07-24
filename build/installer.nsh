!macro customInstall
  nsExec::ExecToLog '"$SYSDIR\schtasks.exe" /Create /TN "Hydra Overlay Input" /TR "$\"$INSTDIR\resources\hydra-native\hydra-overlay-input.exe$\"" /SC ONCE /SD 01/01/2099 /ST 00:00 /RL HIGHEST /IT /F'
!macroend

!macro customUnInstall
  nsExec::ExecToLog '"$SYSDIR\schtasks.exe" /Delete /TN "Hydra Overlay Input" /F'
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\hydralauncher-updater"
  ${endIf}
!macroend
