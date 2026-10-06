Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

userProfile = WshShell.ExpandEnvironmentStrings("%USERPROFILE%")
proxyDir = userProfile & "\Documents\GitHub\antigravity-claude-proxy"
cmdLine = "cmd.exe /c cd /d """ & proxyDir & """ && node src/index.js > proxy.log 2>&1"

If fso.FolderExists(proxyDir) Then
    ' 0 = Hide window, False = Do not wait for completion
    WshShell.Run cmdLine, 0, False
End If
