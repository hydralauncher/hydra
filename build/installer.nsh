!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    RMDir /r "$APPDATA\hydra"
  ${endIf}
!macroend
