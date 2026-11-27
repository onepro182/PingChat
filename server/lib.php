<?php
// PingChat - fonctions communes (config, base SQLite, appels WhatsApp Cloud API)

function pc_config() {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $f = __DIR__ . '/config.php';
    if (!is_file($f)) { $cfg = []; return $cfg; }
    $cfg = require $f;
    return is_array($cfg) ? $cfg : [];
}
function cfg($k, $d = '') { $c = pc_config(); return isset($c[$k]) && $c[$k] !== '' ? $c[$k] : $d; }

function pc_db() {
    static $db = null;
    if ($db) return $db;
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    $db = new PDO('sqlite:' . $dir . '/pingchat.sqlite');
    $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $db->exec('CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wa_id TEXT UNIQUE,
        phone TEXT NOT NULL,
        direction TEXT NOT NULL,         -- in | out
        type TEXT NOT NULL DEFAULT "text",
        body TEXT NOT NULL DEFAULT "",
        status TEXT NOT NULL DEFAULT "sent", -- sent | delivered | read | failed
        error TEXT,
        ts INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
    )');
    $db->exec('CREATE INDEX IF NOT EXISTS idx_phone ON messages(phone, id)');
    $db->exec('CREATE TABLE IF NOT EXISTS contacts (phone TEXT PRIMARY KEY, name TEXT)');
    return $db;
}

function json_out($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// Les endpoints api/* ne doivent etre utilises que depuis TON ordinateur.
// Un tunnel (ngrok, cloudflared) expose tout le dossier : on refuse donc toute
// requete qui arrive via le tunnel (en-tetes X-Forwarded-* ou nom d'hote public).
function require_local() {
    $host = strtolower(preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? ''));
    $ok = in_array($host, ['localhost', '127.0.0.1', '[::1]'], true)
        && in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)
        && empty($_SERVER['HTTP_X_FORWARDED_FOR'])
        && empty($_SERVER['HTTP_X_FORWARDED_HOST']);
    if (!$ok) json_out(['ok' => false, 'error' => 'forbidden'], 403);
}

// Numero -> chiffres seulement, format international sans "+"
function norm_phone($p) {
    $d = preg_replace('/\D+/', '', (string)$p);
    if ($d === '') return '';
    if (strpos((string)$p, '+') === false) {
        if (strpos($d, '00') === 0) $d = substr($d, 2);
        elseif ($d[0] === '0') $d = cfg('default_country', '212') . substr($d, 1);
    }
    return $d;
}

function wa_call($payload) {
    $id = cfg('phone_number_id'); $tok = cfg('access_token');
    if (!$id || !$tok) return [0, ['error' => ['message' => 'phone_number_id / access_token manquants dans config.php']]];
    $url = 'https://graph.facebook.com/' . cfg('graph_version', 'v21.0') . '/' . $id . '/messages';
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $tok, 'Content-Type: application/json'],
        ]);
        $res = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($res === false) return [0, ['error' => ['message' => 'cURL: ' . $err]]];
    } else {
        $ctx = stream_context_create(['http' => [
            'method' => 'POST', 'content' => $body, 'timeout' => 20, 'ignore_errors' => true,
            'header' => "Authorization: Bearer $tok\r\nContent-Type: application/json\r\n",
        ]]);
        $res = @file_get_contents($url, false, $ctx);
        $code = 0;
        if (isset($http_response_header[0]) && preg_match('/ (\d{3}) /', $http_response_header[0], $m)) $code = (int)$m[1];
        if ($res === false) return [0, ['error' => ['message' => 'Connexion a graph.facebook.com impossible (active l\'extension curl ou openssl dans php.ini)']]];
    }
    return [$code, json_decode($res, true) ?: ['error' => ['message' => 'Reponse invalide']]];
}

// Derniere reception d'un message de ce contact (pour la fenetre de 24 h)
function window_open($phone) {
    $st = pc_db()->prepare('SELECT MAX(ts) FROM messages WHERE phone = ? AND direction = "in"');
    $st->execute([$phone]);
    $last = (int)$st->fetchColumn();
    return $last && (time() - $last) < 24 * 3600;
}
