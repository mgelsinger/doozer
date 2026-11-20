; Doozer's addition to the installer that Tauri builds (docs/release.md).
;
; Tauri's own uninstaller removes the program, its shortcuts, its entry under "Installed
; apps" and the "Start with Windows" line in the user's Run key (it removes a value named
; after the product, and that is the name the app writes: a test in lib.rs keeps the two
; the same). It offers one tick box, worded in English.nsh beside this file: also delete
; the save. That box is the choice about the pet. Unticked, which is how it starts, the
; save stays in
;   %APPDATA%\com.doozer.desktop\
; and a later install finds Doozer as it was left.
;
; What it leaves behind when the box is not ticked is the browser's cache,
;   %LOCALAPPDATA%\com.doozer.desktop\
; Nothing of the pet is in it (the page keeps nothing there); it is some tens of megabytes
; of the browser's own files. It is removed here whether or not the save is kept, except
; when a newer installer is running the old uninstaller on the way to an update.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    SetShellVarContext current
    RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}
!macroend
