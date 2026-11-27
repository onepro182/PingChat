<?php
require __DIR__ . '/../lib.php';
require_local();
json_out([
    'ok' => true,
    'configured' => (bool)(cfg('phone_number_id') && cfg('access_token')),
    'default_country' => (string)cfg('default_country', '212'),
    'webhook_ready' => (bool)(cfg('app_secret') && cfg('verify_token')),
]);
