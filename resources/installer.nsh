# Custom NSIS installer hooks for Halo
#
# Fixes "cannot be closed" errors during upgrade install that occur when:
#   1. Child processes (file-watcher worker etc.) survive parent death
#   2. Old uninstaller returns non-zero exit code
#   3. CopyFiles fails on old app.asar.unpacked files (permissions/read-only)
#
# electron-builder's default only addresses scenario 1 partially (no /t flag).
# This override handles all three by:
#   - Tree-killing the process (covers #1)
#   - Pre-cleaning the unpacked directory (covers #3)
#   - Defining customUnInstallCheck to tolerate old uninstaller failure (covers #2)

# ─── Hook 1: Process check ──────────────────────────────────────────
# Replaces the default _CHECK_APP_RUNNING macro.
# Called from installSection.nsh BEFORE uninstallOldVersion and file extraction.

!macro customCheckAppRunning
  # ── Step 1: Kill process tree ──
  # Check if the app is running under the current user.
  nsExec::Exec `cmd /c tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO csv | %SYSTEMROOT%\System32\find.exe "${APP_EXECUTABLE_FILENAME}"`
  Pop $R0

  ${if} $R0 == 0
    # App is running — force-kill the entire process tree.
    # /f = force  /t = tree (terminates child processes: file-watcher worker, etc.)
    DetailPrint `Closing "${PRODUCT_NAME}" and child processes...`
    nsExec::Exec `cmd /c taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%" 2>nul`
    Pop $R0
    # Allow the OS to release all file handles.
    Sleep 2000
  ${endIf}

  # ── Step 2: Pre-clean unpacked native modules ──
  # Remove old app.asar.unpacked directory to prevent CopyFiles failures.
  # Files in this directory (node-pty prebuilds, better-sqlite3 .node,
  # cloudflared, @parcel/watcher) may have read-only attributes or
  # restrictive NTFS ACLs from the previous installation that block
  # overwriting. Deleting first ensures a clean slate for extraction.
  #
  # This runs BEFORE uninstallOldVersion — the old uninstaller's file
  # deletion will simply skip already-removed files (NSIS Delete/RMDir
  # do not fail on missing targets).
  IfFileExists "$INSTDIR\resources\app.asar.unpacked\*.*" 0 +3
    DetailPrint `Removing old unpacked resources...`
    RMDir /r "$INSTDIR\resources\app.asar.unpacked"
!macroend

# ─── Hook 2: Old uninstaller result check ────────────────────────────
# Called from handleUninstallResult (installUtil.nsh) for SHELL_CONTEXT.
# If the old uninstaller returns non-zero (e.g. it has its own broken
# CHECK_APP_RUNNING, or fails to delete files), the default behavior
# shows "uninstallFailed" and Quits. We skip that — the new installer
# will overwrite all files and registry entries anyway.

!macro customUnInstallCheck
  # Accept whatever the old uninstaller returned.
  # Leftover files (if any) will be overwritten by the new installation.
!macroend

!macro customUnInstallCheckCurrentUser
  # Same tolerance for HKEY_CURRENT_USER path.
!macroend
