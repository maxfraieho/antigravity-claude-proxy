Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

userProfile = WshShell.ExpandEnvironmentStrings("%USERPROFILE%")
layaDir = userProfile & "\bin\laya"
logPath = layaDir & "\laya.log"
daemonScript = layaDir & "\laya_daemon.py"

cmdLine = "cmd.exe /c python """ & daemonScript & """ --host 0.0.0.0 --port 9623 >> """ & logPath & """ 2>&1"

If fso.FileExists(daemonScript) Then
    ' 0 = Hide window, False = Do not wait for completion
    WshShell.Run cmdLine, 0, False
End If
