!macro customInstall
  nsExec::ExecToLog '"$SYSDIR\schtasks.exe" /End /TN "Hydra Overlay Input"'
  CreateDirectory "$PROGRAMFILES64\Hydra Overlay Input"
  CopyFiles /SILENT "$INSTDIR\resources\hydra-native\hydra-overlay-input.exe" "$PROGRAMFILES64\Hydra Overlay Input\hydra-overlay-input.exe"
  CopyFiles /SILENT "$INSTDIR\resources\hydra-native\PresentMon.exe" "$PROGRAMFILES64\Hydra Overlay Input\PresentMon.exe"
  nsExec::ExecToLog '"$SYSDIR\schtasks.exe" /Create /TN "Hydra Overlay Input" /TR "$\"$PROGRAMFILES64\Hydra Overlay Input\hydra-overlay-input.exe$\" --data-directory $\"$APPDATA\hydralauncher\overlay-input$\" --client-executable $\"$INSTDIR\Hydra.exe$\"" /SC ONCE /SD 01/01/2099 /ST 00:00 /RL HIGHEST /IT /F'
!macroend

!macro customUnInstall
  nsExec::ExecToLog '"$SYSDIR\schtasks.exe" /End /TN "Hydra Overlay Input"'
  nsExec::ExecToLog '"$SYSDIR\schtasks.exe" /Delete /TN "Hydra Overlay Input" /F'
  RMDir /r "$PROGRAMFILES64\Hydra Overlay Input"
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\hydralauncher-updater"
  ${endIf}
!macroend
