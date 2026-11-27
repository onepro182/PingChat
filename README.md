# PingChat

> Windows app (recommended): see [docs/DESKTOP-APP.md](docs/DESKTOP-APP.md)

Interface web de discussion style WhatsApp, professionnelle et autonome.
Projet de demonstration : aucune connexion a WhatsApp ni a aucun numero,
les messages sont fictifs et stockes dans `js/data.js`.

## Lancer le projet

Aucune installation. Ouvrez simplement `index.html` dans un navigateur :

```bash
# Option 1 : double-cliquer sur index.html

# Option 2 : petit serveur local (recommande)
cd pingchat
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Fonctionnalites

- Mode sombre (bouton lune/soleil, suit le theme du systeme, memorise)
- Messages vocaux : enregistrement micro, onde sonore, lecture/pause, navigation dans l'audio
- Envoi d'images : bouton, glisser-deposer ou coller, apercu avec legende, visionneuse plein ecran
- Recherche dans la liste (noms + contenu) et recherche dans la discussion avec surlignage et precedent/suivant
- Repondre a un message (citation), copier, supprimer
- Selecteur d'emojis
- Filtres Toutes / Non lues / Epinglees, epingler, vider ou supprimer une discussion, nouvelle discussion
- Sauvegarde locale des messages texte (localStorage)
- Reponses automatiques simulees, "en train d'ecrire", coches lu / recu
- Logo et favicon (`assets/`), responsive mobile

Les images et messages vocaux restent en memoire de la session (non sauvegardes).
Le micro demande un contexte securise (https ou localhost).

## Ajouts (v3)

- Contact par defaut **Instinct** (+1 (650) 658-8328). Version locale : aucun vrai message n'est envoye.
- Suppression des discussions : bouton corbeille dans la liste, menu de la discussion, ou "Supprimer toutes les discussions".
- Reactions emoji sur les messages (menu du message, clic sur la reaction pour la retirer).
- Statuts (24 h) : texte colore ou photo, visionneuse avec progression.
- Sons (envoi, reception, reaction), notifications navigateur, compteur de non lus dans l'onglet.

## WhatsApp reel (XAMPP + API Cloud de Meta)

Voir [docs/SETUP-WHATSAPP.md](docs/SETUP-WHATSAPP.md). Le dossier `server/` contient le backend PHP. `server/config.php` (secrets) est ignore par git.

## Mode WhatsApp Web (non officiel, scan QR)

Voir [docs/SETUP-WHATSAPP-WEB.md](docs/SETUP-WHATSAPP-WEB.md). Pont Node local dans `bridge/` (Baileys). Session dans `bridge/data/` (ignoree par git).

## Structure

```
pingchat/
├── index.html      # Structure de la page
├── assets/
│   ├── logo.svg
│   └── favicon.svg
├── css/
│   └── style.css   # Styles (palette WhatsApp, responsive)
├── js/
│   ├── data.js     # Donnees fictives (a remplacer par une API/WebSocket)
│   └── app.js      # Logique : rendu, navigation, envoi, recherche
└── README.md
```

## Vers une application de bureau

La structure est prete pour un empaquetage futur avec Electron ou Tauri :

1. Placer ces fichiers dans le dossier `renderer/` (Electron) ou `src/` (Tauri).
2. Aucune dependance npm n'est necessaire : le code est en pur HTML/CSS/JS.
3. Pour connecter un vrai backend plus tard, remplacer `CONVERSATIONS`
   dans `js/data.js` par des appels API ou WebSocket ; `js/app.js` consomme
   deja les donnees via cette interface unique.
