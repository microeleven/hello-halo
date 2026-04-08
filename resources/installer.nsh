# Custom NSIS installer hooks for Halo
#
# Override the default process-check hook (customCheckAppRunning).
#
# electron-builder default uses `taskkill /im` which only kills the main
# process. On Windows, forked child processes (e.g. the file-watcher worker
# spawned via child_process.fork) are NOT automatically killed when the
# parent dies, so the installer detects them as still running and shows
# "cannot be closed".
#
# This override uses `taskkill /f /t` (force + tree) to terminate the entire
# process tree before installation proceeds. If the app is not running, the
# check exits immediately with no delay.

!macro customCheckAppRunning
  # Check if the app process is running under the current user.
  # Uses the same per-user tasklist approach as electron-builder default
  # (consistent with perMachine: false in package.json).
  nsExec::Exec `cmd /c tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO csv | %SYSTEMROOT%\System32\find.exe "${APP_EXECUTABLE_FILENAME}"`
  Pop $R0

  ${if} $R0 == 0
    # App is running — kill the entire process tree.
    # /f = force  /t = tree (terminates all child processes too)
    DetailPrint `Closing "${PRODUCT_NAME}" and child processes...`
    nsExec::Exec `cmd /c taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%" 2>nul`
    Pop $R0
    # Allow the OS to release all file handles before installer writes files.
    Sleep 2000
  ${endIf}
  # App not running: no kill, no sleep — continue immediately.
!macroend
