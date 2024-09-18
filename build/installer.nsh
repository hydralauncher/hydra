!macro customUnInstall
  RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
  RMDir /r "$APPDATA\hydra"
!macroend