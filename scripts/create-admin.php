<?php
declare(strict_types=1);
require __DIR__ . '/../api/bootstrap.php';
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
if ($argc < 2 || !preg_match('/^[a-zA-Z0-9_.-]{3,80}$/', $argv[1])) {
    fwrite(STDERR, "Usage: php scripts/create-admin.php <username> [admin|editor|--reset]\n"); exit(2);
}
$username = $argv[1];
$resetPassword = ($argv[2] ?? '') === '--reset';
$role = $resetPassword ? null : ($argv[2] ?? 'admin');
if (!$resetPassword && !in_array($role, ['admin','editor'], true)) { fwrite(STDERR, "Role must be admin or editor, or use --reset to change an existing account password.\n"); exit(2); }
if (getenv('LCUP_ADMIN_INITIAL_PASSWORD') !== false) {
    $password = (string)getenv('LCUP_ADMIN_INITIAL_PASSWORD');
    putenv('LCUP_ADMIN_INITIAL_PASSWORD=');
} elseif (PHP_OS_FAMILY === 'Windows') {
    fwrite(STDERR, "Use scripts/create-admin.ps1 so your password is not echoed in the terminal.\n"); exit(2);
} else {
    system('stty -echo'); fwrite(STDOUT, "Password: "); $password = trim((string)fgets(STDIN)); system('stty echo'); fwrite(STDOUT, "\n");
}
if (strlen($password) < 12 || !preg_match('/[a-z]/',$password) || !preg_match('/[A-Z]/',$password) || !preg_match('/[0-9]/',$password) || !preg_match('/[^a-zA-Z0-9]/',$password)) { fwrite(STDERR, "Use at least 12 characters with uppercase, lowercase, a number, and a symbol.\n"); exit(2); }
$pdo = db();
$hash = password_hash($password, PASSWORD_DEFAULT);
if ($resetPassword) {
    $q = $pdo->prepare('UPDATE admin_users SET password_hash=? WHERE username=?');
    $q->execute([$hash, $username]);
    if ($q->rowCount() !== 1) { fwrite(STDERR, "No administrator account named '{$username}' was found.\n"); exit(1); }
    fwrite(STDOUT, "Password updated for administrator account '{$username}'.\n");
} else {
    $q=$pdo->prepare('INSERT INTO admin_users (username,password_hash,role) VALUES (?,?,?)');
    try {
        $pdo->beginTransaction();
        $q->execute([$username,$hash,$role]);
        if ($role === 'admin') {
            $pdo->prepare('UPDATE admin_setup_state SET completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP) WHERE id=1')->execute();
        }
        $pdo->commit();
        fwrite(STDOUT,"Created administrator account '{$username}' with role '{$role}'.\n");
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        fwrite(STDERR,"Account was not created. The username may already exist or the database is unavailable.\n");
        exit(1);
    }
}
