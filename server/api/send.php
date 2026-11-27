<?php
// POST JSON {to, text}            -> message texte (si fenetre de 24 h ouverte)
// POST JSON {to, template:true}   -> modele (hello_world) pour ouvrir/reouvrir la conversation
require __DIR__ . '/../lib.php';
require_local();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(['ok' => false, 'error' => 'POST requis'], 405);
$in = json_decode(file_get_contents('php://input'), true) ?: [];
$to = norm_phone($in['to'] ?? '');
if (!$to) json_out(['ok' => false, 'error' => 'Numero invalide'], 400);
$db = pc_db();

if (!empty($in['template'])) {
    $payload = ['messaging_product' => 'whatsapp', 'to' => $to, 'type' => 'template',
        'template' => ['name' => cfg('template_name', 'hello_world'), 'language' => ['code' => cfg('template_lang', 'en_US')]]];
    $label = '[modele ' . cfg('template_name', 'hello_world') . ']';
} else {
    $text = trim((string)($in['text'] ?? ''));
    if ($text === '') json_out(['ok' => false, 'error' => 'Message vide'], 400);
    if (!window_open($to)) {
        json_out(['ok' => false, 'error' => 'window_closed',
            'message' => 'Fenetre de 24 h fermee : ce contact doit d\'abord t\'ecrire, ou envoie un modele.'], 409);
    }
    $payload = ['messaging_product' => 'whatsapp', 'to' => $to, 'type' => 'text', 'text' => ['body' => $text, 'preview_url' => false]];
    $label = $text;
}

list($code, $res) = wa_call($payload);
if ($code >= 200 && $code < 300 && !empty($res['messages'][0]['id'])) {
    $db->prepare('INSERT INTO messages(wa_id, phone, direction, type, body, status, ts) VALUES (?,?,?,?,?,?,?)')
       ->execute([$res['messages'][0]['id'], $to, 'out', 'text', $label, 'sent', time()]);
    json_out(['ok' => true, 'id' => (int)$db->lastInsertId()]);
}
$msg = $res['error']['message'] ?? 'Echec de l\'envoi';
json_out(['ok' => false, 'error' => 'send_failed', 'message' => $msg, 'code' => $res['error']['code'] ?? $code], 502);
