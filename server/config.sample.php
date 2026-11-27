<?php
// Copie ce fichier en "config.php" et remplis tes valeurs.
// config.php est ignore par git : ne le publie JAMAIS.
return [
    // Meta > ton app > WhatsApp > API Setup
    'phone_number_id'   => '',   // "Phone number ID" (numero long, PAS le numero de telephone)
    'access_token'      => '',   // Access token (temporaire 24h, ou token permanent System User)
    'graph_version'     => 'v21.0', // utilise la version affichee dans l'exemple curl de Meta si differente

    // Meta > ton app > App settings > Basic
    'app_secret'        => '',   // "App secret" : sert a verifier que le webhook vient bien de Meta

    // Un mot de passe que TU inventes. Meme valeur dans Meta > WhatsApp > Configuration > Webhook
    'verify_token'      => '',

    // Modele utilise pour ouvrir une conversation (hors fenetre de 24 h). "hello_world" existe par defaut.
    'template_name'     => 'hello_world',
    'template_lang'     => 'en_US',

    // Indicatif par defaut pour les numeros saisis sans "+" (ex: 212 pour le Maroc)
    'default_country'   => '212',
];
