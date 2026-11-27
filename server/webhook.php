<?php
// Point d'entree appele par Meta (via ton tunnel HTTPS).
// GET  : verification du webhook (hub.challenge)
// POST : messages recus + statuts (envoye / delivre / lu), signature verifiee
require __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $tok = cfg('verify_token');
    if ($tok && ($_GET['hub_mode'] ?? '') === 'subscribe' && hash_equals($tok, (string)($_GET['hub_verify_token'] ?? ''))) {
        header('Content-Type: text/plain');
        echo $_GET['hub_challenge'] ?? '';
        exit;
    }
    http_response_code(403); echo 'forbidden'; exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit; }

$raw = file_get_contents('php://input');
$secret = cfg('app_secret');
$sig = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';
// Sans app_secret on refuse tout : sinon n'importe qui pourrait injecter des messages.
if (!$secret || !hash_equals('sha256=' . hash_hmac('sha256', $raw, $secret), $sig)) {
    http_response_code(403); echo 'bad signature'; exit;
}

$data = json_decode($raw, true);
$db = pc_db();
foreach (($data['entry'] ?? []) as $entry) {
    foreach (($entry['changes'] ?? []) as $ch) {
        $v = $ch['value'] ?? [];
        foreach (($v['contacts'] ?? []) as $c) {
            $p = norm_phone($c['wa_id'] ?? '');
            $n = $c['profile']['name'] ?? '';
            if ($p && $n) $db->prepare('INSERT OR REPLACE INTO contacts(phone, name) VALUES (?, ?)')->execute([$p, $n]);
        }
        foreach (($v['messages'] ?? []) as $m) {
            $type = $m['type'] ?? 'text';
            $body = $type === 'text' ? ($m['text']['body'] ?? '') : '[' . $type . ']';
            if ($type === 'button') $body = $m['button']['text'] ?? '[button]';
            if ($type === 'reaction') $body = 'reaction ' . ($m['reaction']['emoji'] ?? '');
            $db->prepare('INSERT OR IGNORE INTO messages(wa_id, phone, direction, type, body, status, ts) VALUES (?,?,?,?,?,?,?)')
               ->execute([$m['id'] ?? null, norm_phone($m['from'] ?? ''), 'in', $type === 'text' ? 'text' : 'other', $body, 'delivered', (int)($m['timestamp'] ?? time())]);
        }
        foreach (($v['statuses'] ?? []) as $s) {
            $err = isset($s['errors'][0]) ? ($s['errors'][0]['title'] ?? 'erreur') : null;
            $db->prepare('UPDATE messages SET status = ?, error = COALESCE(?, error) WHERE wa_id = ?')
               ->execute([$s['status'] ?? 'sent', $err, $s['id'] ?? '']);
        }
    }
}
http_response_code(200);
echo 'ok';
