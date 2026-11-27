# PingChat

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

- Barre laterale : liste des discussions, recherche, badges non lus, heure du dernier message
- Zone de discussion : bulles entrantes/sortantes, coches (recu / lu), separateurs de date, bandeau de chiffrement
- Envoi de messages (Entree ou bouton) avec icone micro/envoyer dynamique
- Reponses automatiques simulees avec indicateur "en train d'ecrire"
- Avatars generes (initiales colorees, aucune image externe)
- Mise en page responsive (mobile : liste <-> discussion avec bouton retour)

## Structure

```
pingchat/
├── index.html      # Structure de la page
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
