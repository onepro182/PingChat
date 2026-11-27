# PingChat en mode "WhatsApp Web" (scan QR) - NON OFFICIEL

PingChat affiche tes vraies discussions WhatsApp (y compris celle avec Instinct), comme WhatsApp Web : tu scannes un QR, tu vois tes conversations, tu envoies et recois du texte en direct.

## A lire avant (3 points honnetes)

1. **Ce n'est pas officiel.** Ca utilise la bibliotheque libre **Baileys**, qui imite WhatsApp Web. Ca va contre les conditions d'utilisation de WhatsApp. **Ton numero peut etre bloque** (rarement avec un usage calme, mais possible). Utilise de preference un **numero secondaire**.
2. Ca peut cesser de marcher quand WhatsApp change quelque chose. Il faudra alors mettre a jour (`npm update` dans le dossier `bridge`).
3. Tout reste **sur ton PC** : le pont ecoute seulement `127.0.0.1` (personne d'autre ne peut s'y connecter). Le dossier `bridge/data/` contient ta session (= acces a ton WhatsApp) : ne le partage jamais, ne l'envoie jamais sur GitHub (il est ignore par git). XAMPP n'est **pas** necessaire.

## Etapes (Windows)

**1. Installer Node.js (une seule fois)** : va sur https://nodejs.org, telecharge la version **LTS** (20 ou plus), installe avec les options par defaut, puis redemarre le PC (ou ferme/rouvre les terminaux).

**2. Telecharger PingChat** : https://github.com/onepro182/PingChat > Code > Download ZIP. Decompresse (ex: `C:\pingchat`). Le dossier `bridge` doit etre dedans.

**3. Lancer** : double-clique sur `bridge\start-whatsapp.bat`.
- La premiere fois, il installe les modules (1 a 2 minutes, internet necessaire).
- Une fenetre noire reste ouverte : **ne la ferme pas** (c'est le pont). Ctrl+C pour arreter.
- Ton navigateur s'ouvre sur http://localhost:3000/ . Utilise cette adresse (pas la version GitHub Pages).

(Sans le .bat : ouvre un terminal dans le dossier `bridge`, puis `npm install` puis `node server.mjs`.)

**4. Scanner le QR** : PingChat affiche "Connecter WhatsApp" avec un code QR.
Sur le telephone : WhatsApp > Parametres (ou les 3 points) > **Appareils connectes** > **Connecter un appareil** > scanne le code. Le QR change toutes les ~20 secondes : s'il expire, un nouveau apparait tout seul.

**5. Utiliser** : tes discussions apparaissent (quelques secondes, parfois une minute pour l'historique). Clique sur une discussion, ecris, envoie. Les messages recus apparaissent en direct, avec notifications et sons si tu les as actives. Bouton "+" : ecrire a un nouveau numero (`+212600000000` ou `0600000000`).

**Les fois suivantes** : double-clique sur `start-whatsapp.bat` : pas de nouveau scan (la session est gardee dans `bridge\data`).

**Deconnecter** : menu (3 points) de PingChat > "Deconnecter WhatsApp", ou sur le telephone : Appareils connectes > PingChat/Mac > Deconnecter. Pour tout effacer : supprime le dossier `bridge\data`.

## Ce qui marche / ce qui ne marche pas

| | |
|---|---|
| Texte envoye et recu, en direct | oui |
| Liste des discussions, noms, non lus, groupes (lecture et envoi de texte) | oui |
| Coches envoye / delivre / lu | oui (a verifier en vrai) |
| Images, vocaux, documents recus | affiches comme `[image]`, `[message vocal]`... |
| Envoyer images / vocaux | pas encore |
| Anciens messages (avant la connexion) | seulement ce que WhatsApp envoie a la premiere synchronisation (recent) |
| Reactions, statuts WhatsApp, appels | non (les reactions et statuts de PingChat restent locaux) |
| Marquer comme lu cote WhatsApp | non : PingChat n'envoie pas d'accuse de lecture et ne te met pas "en ligne" |

## Depannage

| Probleme | Solution |
|---|---|
| "Pont injoignable" | La fenetre noire est fermee : relance `start-whatsapp.bat` |
| `npm` / `node` introuvable | Node.js pas installe ou terminal pas rouvert |
| Port 3000 deja pris | Dans un terminal : `set PORT=3001` puis `node server.mjs` et ouvre http://localhost:3001/ |
| Le QR n'apparait pas | Verifie internet. Attends 10 s. Supprime `bridge\data\auth` et relance |
| Deconnecte tout seul | Normal si tu as retire l'appareil depuis le telephone : rescanne |
| Plus rien ne marche apres des semaines | WhatsApp a change : `npm update` dans `bridge`, relance |
| Message d'avertissement WhatsApp / numero bloque | Arrete tout. Ne rescanne pas avec le meme numero. C'est le risque du mode non officiel |

## Fichiers

- `bridge/server.mjs` : le pont (Baileys + petit serveur local qui sert aussi l'interface).
- `bridge/start-whatsapp.bat` : lancement Windows.
- `bridge/package.json` : dependances (Baileys version fixee `7.0.0-rc14`, une version "release candidate").
- `js/app.js` : bascule automatiquement en mode WhatsApp Web quand `/api/state` repond avec le pont.

Securite du pont : ecoute `127.0.0.1` seulement, refuse les requetes dont l'hote n'est pas `localhost`, refuse les POST sans en-tete PingChat, ne sert que `index.html`, `css/`, `js/`, `assets/`.
