# PingChat for Windows (desktop app)

1. Download `PingChat-Portable-1.0.0.exe` from the Releases page:
   https://github.com/onepro182/PingChat/releases
2. Double-click it. No Node, no terminal, no install needed.
3. Windows may show "Windows protected your PC" (the app is not code-signed).
   Click **More info**, then **Run anyway**.
4. Scan the QR code with WhatsApp (Linked devices).
5. Closing the window sends PingChat to the tray (near the clock). Right-click the tray icon to open, see status, start with Windows, or quit.

Session data is stored in `%APPDATA%\PingChat\whatsapp-data`. The app listens on localhost only (port 38211).

Build it yourself: `cd desktop && npm install && npm run build`.
