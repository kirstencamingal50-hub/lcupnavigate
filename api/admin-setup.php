<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

configure_cors();

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $pdo = db();

    if ($method === 'GET') {
        $setupKey = getenv('LCUP_ADMIN_SETUP_KEY') ?: '';
        $state = $pdo->query('SELECT completed_at FROM admin_setup_state WHERE id=1')->fetchColumn();
        $accountCount = (int)$pdo->query("SELECT COUNT(*) FROM admin_users WHERE role='admin'")->fetchColumn();
        ok(['available' => strlen($setupKey) >= 32 && $state === null && $accountCount === 0]);
    }
    if ($method !== 'POST') fail('Use GET to check setup status or POST to create the first administrator.', 405);

    start_app_session();
    $csrf = $_SESSION['csrf'] ?? '';
    if ($csrf === '' || !hash_equals($csrf, (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
        fail('The request security token is invalid. Reload and try again.', 419);
    }

    rate_limit_login();
    $body = request_data();
    $setupKey = getenv('LCUP_ADMIN_SETUP_KEY') ?: '';
    if (strlen($setupKey) < 32) fail('One-time administrator setup is not configured on the server.', 503);
    $providedKey = $body['setup_key'] ?? null;
    if (!is_string($providedKey) || !hash_equals($setupKey, $providedKey)) {
        record_login_failure();
        fail('The setup secret is incorrect.', 403);
    }

    foreach (['full_name', 'username', 'email', 'password'] as $field) {
        if (!isset($body[$field]) || !is_string($body[$field])) fail("{$field} is required.");
    }
    $fullName = trim($body['full_name']);
    $username = trim($body['username']);
    $email = trim($body['email']);
    $password = $body['password'];
    if ($fullName === '' || mb_strlen($fullName) > 160) fail('Enter a name up to 160 characters.');
    if (!preg_match('/^[A-Za-z0-9_.-]{3,80}$/D', $username)) fail('Username must be 3–80 characters using letters, numbers, dots, underscores, or hyphens.');
    if (mb_strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address.');
    if (strlen($password) < 12 || !preg_match('/[A-Z]/', $password) || !preg_match('/[a-z]/', $password) || !preg_match('/[0-9]/', $password) || !preg_match('/[^A-Za-z0-9]/', $password)) {
        fail('Password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.');
    }

    $lockName = 'lcup_first_admin_setup';
    $locked = (int)$pdo->query("SELECT GET_LOCK('{$lockName}', 5)")->fetchColumn() === 1;
    if (!$locked) fail('Administrator setup is busy. Wait a moment and try again.', 503);

    $failure = null;
    $accountId = null;
    try {
        $pdo->beginTransaction();
        $state = $pdo->query('SELECT completed_at FROM admin_setup_state WHERE id=1 FOR UPDATE')->fetchColumn();
        $accountCount = (int)$pdo->query("SELECT COUNT(*) FROM admin_users WHERE role='admin'")->fetchColumn();
        if ($state !== null || $accountCount !== 0) {
            $failure = ['Administrator setup has already been completed.', 409];
            $pdo->rollBack();
        } else {
            $insert = $pdo->prepare('INSERT INTO admin_users (full_name, username, email, password_hash, role, active) VALUES (?, ?, ?, ?, \'admin\', 1)');
            $insert->execute([$fullName, $username, $email, password_hash($password, PASSWORD_DEFAULT)]);
            $accountId = (int)$pdo->lastInsertId();
            $updated = $pdo->exec('UPDATE admin_setup_state SET completed_at=CURRENT_TIMESTAMP WHERE id=1 AND completed_at IS NULL');
            if ($updated !== 1) {
                $failure = ['Administrator setup state could not be finalized.', 500];
                $pdo->rollBack();
            } else {
                $pdo->commit();
            }
        }
    } catch (PDOException $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $failure = $error->getCode() === '23000'
            ? ['That username or email is already in use.', 409]
            : ['The administrator account could not be created. Check the database and setup migration.', 503];
        if ($error->getCode() !== '23000') error_log('First administrator setup failed: ' . $error->getMessage());
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('First administrator setup failed: ' . $error->getMessage());
        $failure = ['The administrator account could not be created.', 500];
    } finally {
        $pdo->query("SELECT RELEASE_LOCK('{$lockName}')");
    }

    if ($failure !== null) fail($failure[0], $failure[1]);
    session_regenerate_id(true);
    $_SESSION['admin'] = ['id' => $accountId, 'username' => $username, 'full_name' => $fullName, 'role' => 'admin'];
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
    ok(['created' => true], 201);
} catch (PDOException $error) {
    error_log('Administrator setup endpoint failed: ' . $error->getMessage());
    fail('The administrator setup service is unavailable. Check the database connection and setup migration.', 503);
} catch (Throwable $error) {
    error_log('Administrator setup endpoint failed: ' . $error->getMessage());
    fail('The administrator setup request could not be completed.', 500);
}
