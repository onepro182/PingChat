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

## Several WhatsApp accounts (v1.1.0)
- The left bar lists your accounts. Click one to switch. A red badge shows unread messages of the other accounts. Green dot = connected.
- `+` adds an account (it asks for a name, then shows its own QR). The gear opens the list to rename or delete accounts.
- Each account has its own session folder: `%APPDATA%\PingChat\whatsapp-data\accounts\<id>\`.
- Notifications show the contact and the account name.
- Upgrading from v1.0.0: just run the new exe. Your existing session is moved into account 1 automatically, no new QR needed.
- Every account keeps one WhatsApp connection open (roughly 50 to 100 MB of memory each). The app asks for confirmation from the 5th account and stops at 10.
