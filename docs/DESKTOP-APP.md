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

## v1.2.0: new look and more features
- New identity "Pulse": indigo night with a coral/amber accent, own logo and wordmark, dark and light themes.
- Photos, videos, voice notes, audio, documents and stickers you receive are downloaded and shown. Files are stored under `%APPDATA%\PingChat\whatsapp-data\accounts\<id>\media\`.
- Send photos (with caption), videos and any file up to 30 MB (paperclip button, drag and drop, or paste).
- Reply to a message (quote), and real emoji reactions (sent to WhatsApp, and reactions from others are shown).
- Messages are marked as read on WhatsApp when you open the chat.
- Calls: PingChat cannot place or answer calls. An incoming call shows a banner with a Refuse button, and missed calls appear in the chat.
- Not available yet: sending voice notes (receiving works).

## v1.3
Supprimer pour tous / pour moi, modifier (15 min, ses messages), transferer, favoris, recherche dans les discussions et globale, indicateur d'ecriture, photos de profil, infos de groupe et noms des expediteurs, reglage pour desactiver les accuses de lecture (sans accuses, on ne voit plus non plus ceux des autres). Envoi de notes vocales: pas encore.

## v1.4
Galerie medias/documents/liens par discussion, epingler/archiver/sourdine (synchro WhatsApp en essayant), vrais statuts (voir, publier texte ou photo, supprimer), creation et gestion de groupes (nom, description, ajouter/retirer, admins, quitter), envoi et reception de positions (saisie manuelle des coordonnees si la geolocalisation n'est pas disponible).
