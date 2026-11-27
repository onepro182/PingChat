' PingChat : demarre le pont WhatsApp en arriere-plan (sans fenetre noire)
' Double-clic : demarre et ouvre PingChat. Avec l'argument "silent" : demarre sans ouvrir le navigateur.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
silent = (WScript.Arguments.Count > 0)

If Not fso.FolderExists(dir & "\node_modules") Then
  MsgBox "Lance d'abord start-whatsapp.bat une seule fois (installation des modules), puis reessaie.", 48, "PingChat"
  WScript.Quit
End If
sh.CurrentDirectory = dir
If sh.Run("cmd /c where node", 0, True) <> 0 Then
  MsgBox "Node.js n'est pas installe (ou pas trouve). Installe la version LTS depuis https://nodejs.org", 48, "PingChat"
  WScript.Quit
End If
If Not fso.FolderExists(dir & "\data") Then fso.CreateFolder(dir & "\data")

' Si le fichier journal depasse 2 Mo, on le vide
logf = dir & "\data\bridge.log"
If fso.FileExists(logf) Then
  If fso.GetFile(logf).Size > 2097152 Then fso.DeleteFile logf
End If

' 0 = fenetre cachee, False = ne pas attendre
sh.Run "cmd /c node server.mjs >> data\bridge.log 2>&1", 0, False

If Not silent Then
  WScript.Sleep 3000
  sh.Run "http://localhost:3000/"
End If
