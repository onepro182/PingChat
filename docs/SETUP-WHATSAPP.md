# PingChat + WhatsApp (API officielle Meta) + XAMPP

But : utiliser l'interface PingChat pour envoyer et recevoir de **vrais** messages WhatsApp, avec ton propre numero, via l'API officielle **WhatsApp Business Cloud API**. Pas de risque de bannissement, pas de bidouille.

```
Ton telephone (WhatsApp)  <-->  Meta (Cloud API)  <-->  tunnel HTTPS  <-->  XAMPP (PHP)  <-->  PingChat (navigateur)
```

> Regle d'or : **ne donne jamais** ton token ni ton App Secret a personne (ni dans un chat). Ils vont seulement dans `server/config.php`, sur ton PC. Ce fichier n'est jamais envoye sur GitHub (il est dans `.gitignore`).

## Limites a connaitre avant de commencer (important)

1. **Fenetre de 24 h.** Tu peux ecrire librement a un contact seulement pendant 24 h apres son dernier message vers toi. Apres, Meta n'accepte qu'un **modele** (template) approuve. PingChat gere ca : si la fenetre est fermee, il te propose d'envoyer le modele `hello_world`.
2. **Mode test.** Le numero de test fourni par Meta ne peut ecrire qu'a **5 numeros maximum**, que tu ajoutes et verifies toi-meme dans le tableau de bord. Parfait pour toi et quelques amis.
3. **Le numero de test n'est pas ton numero.** Tes contacts verront un numero de test Meta. Pour utiliser **ton propre numero** en production, il faut l'enregistrer dans l'API : il ne peut plus servir dans l'application WhatsApp normale en meme temps (sauf mode coexistence, selon disponibilite), et il faut verifier ton entreprise chez Meta. Les prix des conversations sont sur la page de tarification Meta : verifie-les avant de passer en production.
4. **Texte seulement** pour l'instant. Images et messages vocaux ne sont pas encore branches (il faut envoyer les fichiers a Meta d'abord). Les messages recus qui ne sont pas du texte apparaissent comme `[image]`, `[audio]`...
5. Le token temporaire de Meta expire en ~24 h. Pour un token durable : utilisateur systeme (System User) dans Meta Business Settings.
6. L'URL du tunnel gratuit change a chaque redemarrage : il faut alors la mettre a jour dans Meta.
7. Les captures d'ecran de Meta changent souvent. Si un bouton n'est pas la ou ce guide le dit, cherche le meme nom dans le menu WhatsApp > API Setup / Configuration.

## Etape 1 : installer le projet dans XAMPP (Ana 3andi XAMPP deja)

1. Telecharge le projet : https://github.com/onepro182/PingChat (bouton Code > Download ZIP).
2. Decompresse dans `C:\xampp\htdocs\pingchat` (le fichier `index.html` doit etre directement dans ce dossier).
3. Ouvre le panneau XAMPP et demarre **Apache**.
4. Verifie `C:\xampp\php\php.ini` : ces lignes ne doivent PAS commencer par `;` :
   `extension=curl`, `extension=openssl`, `extension=pdo_sqlite`, `extension=sqlite3`. Si tu changes, redemarre Apache.
5. Ouvre http://localhost/pingchat/ : PingChat s'affiche en mode demo. (Il faut bien utiliser cette adresse, pas la version GitHub Pages : seule la copie locale parle a ton serveur.)

## Etape 2 : compte developpeur Meta

1. Va sur https://developers.facebook.com et connecte-toi avec ton compte Facebook. Accepte de devenir developpeur (verification par telephone possible).
2. **Create App** > type **Business** (ou choisis le cas d'usage "Connect with customers through WhatsApp"). Donne un nom (ex: PingChat).
3. Ajoute le produit **WhatsApp**. Meta cree un compte WhatsApp Business de test avec un **numero de test**.
4. Va dans **WhatsApp > API Setup** :
   - Copie le **Phone number ID** (long nombre, pas le numero de telephone).
   - Dans "To", ajoute **ton numero perso** (avec +212...) et valide avec le code recu sur WhatsApp.
   - Clique **Generate access token** et copie le token.
5. Va dans **App settings > Basic** et copie l'**App secret** (clique Show).

## Etape 3 : remplir la config locale

1. Dans `C:\xampp\htdocs\pingchat\server\`, copie `config.sample.php` en `config.php`.
2. Ouvre `config.php` avec le Bloc-notes et remplis :
   - `phone_number_id` : l'ID copie a l'etape 2.4
   - `access_token` : le token de l'etape 2.4
   - `app_secret` : l'App secret de l'etape 2.5
   - `verify_token` : invente un mot de passe, ex: `pingchat-ZXcv8821` (tu le re-saisis a l'etape 4)
   - `default_country` : `212` (Maroc) pour que `0600000000` devienne `212600000000`
3. Enregistre. Ne partage pas ce fichier.

## Etape 4 : tunnel HTTPS (Meta doit pouvoir joindre ton PC)

Meta envoie les messages recus vers une adresse HTTPS publique. XAMPP est local, donc on cree un tunnel :

**Option A, Cloudflare (gratuit, sans compte) :**
1. Telecharge `cloudflared` pour Windows depuis le site Cloudflare (cloudflared-windows-amd64.exe).
2. Dans un terminal : `cloudflared tunnel --url http://localhost:80`
3. Il affiche une adresse du type `https://xxxx.trycloudflare.com`. Garde la fenetre ouverte.

**Option B, ngrok :** cree un compte gratuit, installe ngrok, puis `ngrok http 80`.

Le tunnel expose tout ton dossier, mais les pages `server/api/*` (envoi, lecture) **refusent** toute requete qui vient du tunnel : seul `localhost` peut les utiliser. Seul `webhook.php` est utilisable de l'exterieur, et il exige la signature de Meta.

## Etape 5 : brancher le webhook dans Meta

1. Meta > **WhatsApp > Configuration > Webhook > Edit**.
2. **Callback URL** : `https://xxxx.trycloudflare.com/pingchat/server/webhook.php`
3. **Verify token** : exactement le `verify_token` de `config.php`.
4. Clique **Verify and save**. (Echec ? Verifie que Apache tourne, que le tunnel est ouvert, et que le token est identique.)
5. Dans **Webhook fields**, clique **Subscribe** sur **messages**.

## Etape 6 : tester

1. Recharge http://localhost/pingchat/ : un message "Connecte a WhatsApp" apparait.
2. Depuis ton telephone, envoie "salam" au **numero de test** (il est affiche dans API Setup). Apres quelques secondes, la discussion apparait dans PingChat.
3. Reponds depuis PingChat : le message arrive sur ton WhatsApp. Les coches deviennent bleues quand tu le lis.
4. Pour ecrire a quelqu'un qui ne t'a pas ecrit depuis plus de 24 h : PingChat propose d'envoyer le modele `hello_world`. Une fois que la personne repond, tu peux ecrire librement.
5. Nouvelle discussion (+) : saisis un numero (`+212600000000` ou `0600000000`). Il doit etre dans ta liste de destinataires de test (etape 2.4).

## Depannage rapide

| Probleme | Cause probable |
|---|---|
| "Serveur detecte, mais config.php n'est pas rempli" | `config.php` absent ou vide |
| Rien n'arrive dans PingChat | Tunnel ferme, URL webhook pas mise a jour, ou "messages" non souscrit |
| Webhook "Verify" echoue | `verify_token` different, ou Apache arrete |
| Webhook recu mais ignore | `app_secret` faux (la signature est refusee, code 403) |
| Envoi refuse "Recipient not in allowed list" | Numero pas ajoute/verifie dans API Setup |
| Envoi refuse, erreur de token | Token expire (24 h) : regenere-le dans Meta et colle-le dans `config.php` |
| "Fenetre de 24 h fermee" | Normal : envoie le modele ou attends que le contact ecrive |

## Fichiers

- `server/webhook.php` : verification Meta (GET) et reception messages/statuts (POST, signature HMAC verifiee).
- `server/api/send.php` : envoi texte ou modele. `messages.php` : lecture. `delete.php` : suppression locale. `status.php` : etat.
- `server/lib.php` : config, base SQLite (`server/data/pingchat.sqlite`, creee automatiquement), appel Graph API.
- `server/config.sample.php` : modele de config (copie en `config.php`).
- `js/app.js` : mode WhatsApp active automatiquement quand `server/api/status.php` repond.

Les messages sont stockes en clair dans la base SQLite sur ton PC. La suppression d'une discussion la cache de PingChat (elle ne supprime rien chez WhatsApp).
