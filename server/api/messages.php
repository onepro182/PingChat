<?php
// GET ?since=ID  -> tous les messages (ou seulement les nouveaux) + contacts
require __DIR__ . '/../lib.php';
require_local();
$since = (int)($_GET['since'] ?? 0);
$db = pc_db();
$st = $db->prepare('SELECT id, wa_id, phone, direction, type, body, status, error, ts FROM messages WHERE id > ? AND deleted = 0 ORDER BY id ASC LIMIT 1000');
$st->execute([$since]);
$msgs = $st->fetchAll(PDO::FETCH_ASSOC);
// statuts mis a jour des messages sortants recents
$upd = $db->query('SELECT id, status, error FROM messages WHERE direction = "out" AND deleted = 0 ORDER BY id DESC LIMIT 100')->fetchAll(PDO::FETCH_ASSOC);
$names = [];
foreach ($db->query('SELECT phone, name FROM contacts') as $r) $names[$r['phone']] = $r['name'];
json_out(['ok' => true, 'messages' => $msgs, 'statuses' => $upd, 'names' => $names]);
