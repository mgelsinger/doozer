; Doozer's additions to the installer that Tauri builds (docs/release.md).
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
; Two things it leaves behind when the box is not ticked are removed here, whether or not
; the save is kept:
;
;   1. The key where the installer notes the folder it installed into,
;        HKCU\Software\Doozer\Doozer        (${MANUPRODUCTKEY}; its parent is ${MANUKEY})
;      Tauri keeps it for the next install to find the same folder, and clears it only
;      with the box ticked. Version 1.0.0 left it behind on every ordinary uninstall. The
;      parent goes too, if nothing else is in it.
;   2. The browser's cache,
;        %LOCALAPPDATA%\com.doozer.desktop\
;      Nothing of the pet is in it (the page keeps nothing there); it is some tens of
;      megabytes of the browser's own files.
;
; Neither is touched when a newer installer is running the old uninstaller on the way to
; an update ($UpdateMode): then the program is coming straight back, and wants both.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    ; As Tauri's own uninstaller clears them when the box is ticked, line for line.
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"

    SetShellVarContext current
    RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}
!macroend
