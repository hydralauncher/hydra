!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\hydralauncher-updater"
  ${endIf}
!macroend
