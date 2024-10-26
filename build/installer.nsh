!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    RMDir /r "$APPDATA\hydra"
    RMDir /r "$LOCALAPPDATA\hydralauncher-updater"
  ${endIf}
!macroend
