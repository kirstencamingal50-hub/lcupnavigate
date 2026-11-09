<?php
declare(strict_types=1);

const APP_ROOT = __DIR__ . '/..';

require_once APP_ROOT . '/vendor/autoload.php';
// On Hostinger, place .env one directory ABOVE public_html.
// For local XAMPP development, the project-root .env remains supported.
\Dotenv\Dotenv::createImmutable(dirname(APP_ROOT))->safeLoad();
\Dotenv\Dotenv::createImmutable(APP_ROOT)->safeLoad();

function app_env(string $key, ?string $default = null): ?string
{
    $value = getenv($key);
    if (is_string($value) && $value !== '') return $value;
    foreach ([$_ENV[$key] ?? null, $_SERVER[$key] ?? null] as $value) {
        if (is_string($value)) return $value;
    }
    return $default;
}

function app_config(): array
{
    $environment = app_env('LCUP_ENV') ?: 'development';
    if ($environment !== 'development' && (!app_env('LCUP_DB_HOST') || !app_env('LCUP_DB_NAME') || !app_env('LCUP_DB_USER') || !app_env('LCUP_DB_PASS'))) {
        throw new RuntimeException('Production database environment variables are incomplete.');
    }
    return [
        'environment' => $environment,
        'db_host' => app_env('LCUP_DB_HOST') ?: '127.0.0.1',
        'db_port' => app_env('LCUP_DB_PORT') ?: '3306',
        'db_name' => app_env('LCUP_DB_NAME') ?: 'lcup_campus_nav',
        'db_user' => app_env('LCUP_DB_USER') ?: 'root',
        'db_pass' => app_env('LCUP_DB_PASS') ?: '',
        'cookie_secure' => filter_var(app_env('LCUP_COOKIE_SECURE') ?: ($environment === 'development' ? '0' : '1'), FILTER_VALIDATE_BOOL),
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
    $secure = app_config()['cookie_secure'];
    session_name('LCUPSESSID');
    session_set_cookie_params([
        'lifetime' => 0, 'path' => '/', 'secure' => $secure,
        'httponly' => true, 'samesite' => 'Strict',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.cookie_httponly', '1');
    session_start();
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
    $config = app_config();
    $remoteAddress = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    if (empty($_SESSION['admin']) && $config['environment'] === 'development' &&
        app_env('LCUP_ADMIN_AUTH_BYPASS') === '1' && in_array($remoteAddress, ['127.0.0.1', '::1'], true)) {
        $localAdmin = db()->query("SELECT id,full_name,username,email,role FROM admin_users WHERE active=1 ORDER BY FIELD(role,'admin','editor','viewer'),id LIMIT 1")->fetch();
        if ($localAdmin) {
            $_SESSION['admin'] = [
                'id' => (int)$localAdmin['id'],
                'full_name' => $localAdmin['full_name'],
                'username' => $localAdmin['username'],
                'email' => $localAdmin['email'],
                'role' => $localAdmin['role'],
            ];
        }
    }
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

require_once __DIR__ . '/email.php';
