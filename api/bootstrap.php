<?php
declare(strict_types=1);

const APP_ROOT = __DIR__ . '/..';

function app_config(): array
{
    $environment = getenv('LCUP_ENV') ?: 'development';
    if ($environment !== 'development' && (!getenv('LCUP_DB_HOST') || !getenv('LCUP_DB_NAME') || !getenv('LCUP_DB_USER') || getenv('LCUP_DB_PASS') === false || getenv('LCUP_DB_PASS') === '')) {
        throw new RuntimeException('Production database environment variables are incomplete.');
    }
    $sameSite = getenv('LCUP_COOKIE_SAMESITE') ?: 'Strict';
    if (!in_array($sameSite, ['Strict', 'Lax', 'None'], true)) {
        throw new RuntimeException('LCUP_COOKIE_SAMESITE must be Strict, Lax, or None.');
    }
    $cookieSecure = filter_var(getenv('LCUP_COOKIE_SECURE') ?: ($environment === 'development' ? '0' : '1'), FILTER_VALIDATE_BOOL);
    if ($sameSite === 'None' && !$cookieSecure) {
        throw new RuntimeException('Cross-site session cookies require LCUP_COOKIE_SECURE=1.');
    }
    return [
        'environment' => $environment,
        'db_host' => getenv('LCUP_DB_HOST') ?: '127.0.0.1',
        'db_port' => getenv('LCUP_DB_PORT') ?: '3306',
        'db_name' => getenv('LCUP_DB_NAME') ?: 'lcup_campus_nav',
        'db_user' => getenv('LCUP_DB_USER') ?: 'root',
        'db_pass' => getenv('LCUP_DB_PASS') ?: '',
        'cookie_secure' => $cookieSecure,
        'cookie_samesite' => $sameSite,
    ];
}

function db(): PDO
{
    static $pdo;
    if ($pdo instanceof PDO) return $pdo;
    $c = app_config();
    if ($c['environment'] !== 'development' && $c['db_user'] === 'root') throw new RuntimeException('Production must use a dedicated least-privilege MySQL account.');
    $dsn = "mysql:host={$c['db_host']};port={$c['db_port']};dbname={$c['db_name']};charset=utf8mb4";
    $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    return $pdo;
}

function start_app_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $config = app_config();
    session_name('LCUPSESSID');
    session_set_cookie_params([
        'lifetime' => 0, 'path' => '/', 'secure' => $config['cookie_secure'],
        'httponly' => true, 'samesite' => $config['cookie_samesite'],
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.cookie_httponly', '1');
    session_start();
}

function configure_cors(): void
{
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
    $origins = array_values(array_filter(array_map(
        'trim',
        explode(',', getenv('LCUP_CORS_ORIGINS') ?: '')
    )));
    $environment = getenv('LCUP_ENV') ?: 'development';

    if ($origin !== '' && in_array($origin, $origins, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
        header('Access-Control-Max-Age: 600');
        header('Vary: Origin');
    } elseif ($origin !== '' && $environment !== 'development') {
        json_response(['ok' => false, 'error' => ['message' => 'This website origin is not allowed to use the API.']], 403);
    }

    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        if ($origin === '' || !in_array($origin, $origins, true)) {
            json_response(['ok' => false, 'error' => ['message' => 'This website origin is not allowed to use the API.']], 403);
        }
        http_response_code(204);
        exit;
    }
}

function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function ok(mixed $data = null, int $status = 200): never
{
    json_response(['ok' => true, 'data' => $data], $status);
}

function fail(string $message, int $status = 400, array $details = []): never
{
    json_response(['ok' => false, 'error' => ['message' => $message] + ($details ? ['details' => $details] : [])], $status);
}

function request_data(): array
{
    if (str_starts_with(strtolower((string)($_SERVER['CONTENT_TYPE'] ?? '')), 'multipart/form-data')) return $_POST;
    $raw = file_get_contents('php://input');
    if (!$raw) return $_POST;
    $body = json_decode($raw, true);
    if (!is_array($body)) fail('Request body must be a JSON object.', 400);
    return $body;
}

function require_admin(string $minimumRole = 'editor'): array
{
    start_app_session();
    $user = $_SESSION['admin'] ?? null;
    if (!$user) fail('Administrator sign-in is required.', 401);
    $accountQuery = db()->prepare('SELECT role,active FROM admin_users WHERE id=? LIMIT 1');
    $accountQuery->execute([(int)$user['id']]);
    $account = $accountQuery->fetch();
    if (!$account || !(int)$account['active']) {
        unset($_SESSION['admin']);
        fail('This administrator account is no longer active. Sign in again with an active account.', 401);
    }
    $user['role'] = (string)$account['role'];
    $_SESSION['admin']['role'] = $user['role'];
    $rank = ['viewer' => 1, 'editor' => 2, 'admin' => 3];
    if (($rank[$user['role']] ?? 0) < ($rank[$minimumRole] ?? 2)) fail('This administrator role cannot perform that operation.', 403);
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!hash_equals($_SESSION['csrf'] ?? '', $token)) fail('The request security token is invalid. Reload and try again.', 419);
    }
    return $user;
}

function audit(PDO $pdo, array $user, string $action, string $entity, ?int $entityId, array $before = [], array $after = []): void
{
    $q = $pdo->prepare('INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, before_json, after_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $q->execute([$user['id'], $action, $entity, $entityId, $before ? json_encode($before) : null, $after ? json_encode($after) : null, $_SERVER['REMOTE_ADDR'] ?? null]);
}

function positive_id(mixed $value): int
{
    $id = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$id) fail('A valid record ID is required.');
    return (int)$id;
}

function text_field(array $data, string $key, int $max, bool $required = false): ?string
{
    $value = trim((string)($data[$key] ?? ''));
    if ($required && $value === '') fail("{$key} is required.");
    if (mb_strlen($value) > $max) fail("{$key} exceeds {$max} characters.");
    return $value === '' ? null : $value;
}

function uploaded_image_path(array $data, string $key = 'image_path'): ?string
{
    $path = text_field($data, $key, 255);
    if ($path === null) return null;
    if (!preg_match('~^uploads/photos/[a-f0-9]{48}\.(png|jpg|webp)$~D', $path)) fail('Choose an image uploaded through the campus admin form.');
    return $path;
}

function rate_limit_login(): void
{
    db()->exec('DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL 1 DAY');
    $hash = hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    $q = db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip_hash=? AND attempted_at >= NOW() - INTERVAL 15 MINUTE');
    $q->execute([$hash]);
    if ((int)$q->fetchColumn() >= 8) fail('Too many sign-in attempts. Try again in 15 minutes.', 429);
}

function record_login_failure(): void
{
    $hash = hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    db()->prepare('INSERT INTO login_attempts (ip_hash) VALUES (?)')->execute([$hash]);
}

function csrf_token(): string
{
    start_app_session();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}

function require_public_csrf(): void
{
    if (!hash_equals(csrf_token(), (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
        fail('The request security token is invalid. Reload and try again.', 419);
    }
}

function send_admin_auth_code(string $email, string $code, string $purpose): void
{
    $from = getenv('LCUP_MAIL_FROM') ?: '';
    if (!filter_var($from, FILTER_VALIDATE_EMAIL)) {
        fail('Email delivery is not configured. Ask the system administrator to configure LCUP_MAIL_FROM and the server mail relay.', 503);
    }
    $subject = $purpose === 'signup' ? 'Verify your NaviGATE administrator email' : 'Reset your NaviGATE administrator password';
    $message = "Your NaviGATE verification code is {$code}.\n\nThis code expires in 10 minutes. If you did not request it, you can ignore this message.";
    if (!mail($email, $subject, $message, ['From' => $from, 'Content-Type' => 'text/plain; charset=UTF-8'])) {
        fail('The verification email could not be sent. Check the server mail relay and try again.', 503);
    }
}
