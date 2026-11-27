<?php
// POST JSON {phone} supprime la conversation localement (cache les messages) ; {id} un seul message
require __DIR__ . '/../lib.php';
require_local();
$in = json_decode(file_get_contents('php://input'), true) ?: [];
$db = pc_db();
if (!empty($in['phone'])) $db->prepare('UPDATE messages SET deleted = 1 WHERE phone = ?')->execute([norm_phone($in['phone'])]);
elseif (!empty($in['id'])) $db->prepare('UPDATE messages SET deleted = 1 WHERE id = ?')->execute([(int)$in['id']]);
json_out(['ok' => true]);
