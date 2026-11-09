<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $path = trim((string)($_GET['resource'] ?? ''), '/');
    $body = in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) ? request_data() : [];

    if ($path === 'auth/entry' && $method === 'GET') {
        start_app_session();
        if (isset($_SESSION['admin'])) { require_admin('viewer'); ok(['role'=>'admin']); }
        ok(['role' => $_SESSION['visitor'] ?? null]);
    }
    if ($path === 'auth/entry' && $method === 'POST') {
        start_app_session();
        if (($body['role'] ?? '') !== 'visitor') fail('Invalid entry role.', 400);
        if (isset($_SESSION['admin'])) {
            require_admin('viewer');
            ok(['role' => 'admin']);
        }
        $_SESSION['visitor'] = 'visitor';
        ok(['role' => 'visitor']);
    }

    $pdo = db();
    $id = isset($_GET['id']) ? positive_id($_GET['id']) : null;
    if ($path === 'auth/csrf' && $method === 'GET') ok(['token' => csrf_token()]);
    if ($path === 'auth/login-status' && $method === 'GET') {
        ok(['configured'=>(int)$pdo->query('SELECT COUNT(*) FROM admin_users WHERE role=\'admin\' AND active=1')->fetchColumn()>0]);
    }
    if ($path === 'admin/email-test' && $method === 'POST') {
        $admin = require_admin('admin');
        $q = $pdo->prepare('SELECT email FROM admin_users WHERE id=? AND active=1 LIMIT 1');
        $q->execute([(int)$admin['id']]);
        $email = (string)$q->fetchColumn();
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Add a valid email address to your administrator profile before testing email.', 400);
        try {
            verify_admin_smtp_connection();
            send_admin_notification($email, 'NaviGATE email delivery test', 'This is a test email confirming the NaviGATE server can send mail through Brevo SMTP.');
        } catch (Throwable $error) {
            error_log('NaviGATE authorized SMTP test failed: ' . get_class($error));
            fail('SMTP test failed. Check the server .env settings, Brevo sender verification, and outbound port 587.', 503);
        }
        ok(['sent' => true, 'recipient' => $email]);
    }
    if ($path === 'auth/google-config' && $method === 'GET') {
        $clientId = app_env('GOOGLE_CLIENT_ID') ?: '';
        $nonce = '';
        if ($clientId !== '') {
            start_app_session();
            $nonce = bin2hex(random_bytes(32));
            $_SESSION['google_nonce'] = $nonce;
        }
        ok(['client_id' => $clientId, 'nonce' => $nonce]);
    }
    if ($path === 'auth/register' && $method === 'POST') {
        require_public_csrf();
        rate_limit_login();
        $username = trim((string)($body['username'] ?? ''));
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $password = (string)($body['password'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_.-]{3,80}$/D', $username)) fail('Username must be 3–80 characters using letters, numbers, dots, underscores, or hyphens.');
        if (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address.');
        if (!hash_equals($password, (string)($body['confirm_password'] ?? ''))) fail('The passwords do not match.');
        if (strlen($password) < 12 || !preg_match('/[A-Z]/', $password) || !preg_match('/[a-z]/', $password) || !preg_match('/[0-9]/', $password) || !preg_match('/[^A-Za-z0-9]/', $password)) {
            fail('Password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.');
        }
        $duplicate = $pdo->prepare("SELECT id FROM admin_users WHERE username=? UNION SELECT id FROM admin_auth_challenges WHERE username=? AND purpose='signup' AND email<>? AND expires_at>NOW() LIMIT 1");
        $duplicate->execute([$username, $username, $email]);
        if ($duplicate->fetch()) fail('That username is already in use.', 409);
        $duplicate = $pdo->prepare('SELECT id FROM admin_users WHERE email=? LIMIT 1');
        $duplicate->execute([$email]);
        if ($duplicate->fetch()) fail('That email address is already registered.', 409);

        $token = bin2hex(random_bytes(32));
        $code = (string)random_int(100000, 999999);
        $pdo->prepare('DELETE FROM admin_auth_challenges WHERE expires_at<NOW()')->execute();
        $pdo->prepare('DELETE FROM admin_auth_challenges WHERE email=? AND purpose=\'signup\'')->execute([$email]);
        $insert = $pdo->prepare('INSERT INTO admin_auth_challenges (token_hash,purpose,email,username,password_hash,code_hash,expires_at,resend_after) VALUES (?,\'signup\',?,?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE),DATE_ADD(NOW(),INTERVAL 60 SECOND))');
        $insert->execute([hash('sha256', $token), $email, $username, password_hash($password, PASSWORD_DEFAULT), password_hash($code, PASSWORD_DEFAULT)]);
        send_admin_auth_code_or_fail($email, $code, 'signup', $token);
        record_login_failure();
        ok(['challenge_token' => $token, 'resend_after' => 60], 201);
    }
    if ($path === 'auth/resend-code' && $method === 'POST') {
        require_public_csrf();
        rate_limit_login();
        $token = (string)($body['challenge_token'] ?? '');
        if ($token === '') {
            start_app_session();
            $token = (string)($_SESSION['password_reset_challenge'] ?? '');
        }
        if (!preg_match('/^[a-f0-9]{64}$/D', $token)) fail('This verification request is invalid or has expired.', 400);
        $q = $pdo->prepare('SELECT id,purpose,email,account_id,resend_after FROM admin_auth_challenges WHERE token_hash=? AND expires_at>NOW() LIMIT 1');
        $q->execute([hash('sha256', $token)]);
        $challenge = $q->fetch();
        if (!$challenge || ($challenge['purpose'] === 'password_reset' && !hash_equals((string)($_SESSION['password_reset_challenge'] ?? ''), $token))) fail('This verification request is invalid or has expired.', 400);
        if (strtotime((string)$challenge['resend_after']) > time()) fail('Please wait before requesting another code.', 429);
        $code = (string)random_int(100000, 999999);
        if ($challenge['purpose'] === 'signup' || $challenge['account_id']) {
            send_admin_auth_code_or_fail((string)$challenge['email'], $code, (string)$challenge['purpose'], $token);
        }
        $pdo->prepare('UPDATE admin_auth_challenges SET code_hash=?,resend_after=DATE_ADD(NOW(),INTERVAL 60 SECOND) WHERE id=?')
            ->execute([password_hash($code, PASSWORD_DEFAULT), $challenge['id']]);
        record_login_failure();
        ok(['resend_after' => 60]);
    }
    if ($path === 'auth/verify-code' && $method === 'POST') {
        require_public_csrf();
        rate_limit_login();
        $token = (string)($body['challenge_token'] ?? '');
        if ($token === '') {
            start_app_session();
            $token = (string)($_SESSION['password_reset_challenge'] ?? '');
        }
        $code = (string)($body['code'] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/D', $token) || !preg_match('/^[0-9]{6}$/D', $code)) fail('Enter the six-digit verification code.', 400);
        $q = $pdo->prepare('SELECT * FROM admin_auth_challenges WHERE token_hash=? AND expires_at>NOW() LIMIT 1');
        $q->execute([hash('sha256', $token)]);
        $challenge = $q->fetch();
        if (!$challenge || ($challenge['purpose'] === 'password_reset' && !hash_equals((string)($_SESSION['password_reset_challenge'] ?? ''), $token))) fail('This verification request is invalid or has expired. Start again.', 400);
        if ((int)$challenge['attempts'] >= 5) {
            $pdo->prepare('DELETE FROM admin_auth_challenges WHERE id=?')->execute([$challenge['id']]);
            fail('Too many incorrect codes. Start the request again.', 429);
        }
        if (!password_verify($code, (string)$challenge['code_hash'])) {
            $attempts = (int)$challenge['attempts'] + 1;
            if ($attempts >= 5) $pdo->prepare('DELETE FROM admin_auth_challenges WHERE id=?')->execute([$challenge['id']]);
            else $pdo->prepare('UPDATE admin_auth_challenges SET attempts=? WHERE id=?')->execute([$attempts, $challenge['id']]);
            record_login_failure();
            if ($attempts >= 5) fail('Too many incorrect codes. Start the request again.', 429);
            fail('That code is incorrect. Check your email and try again.', 400);
        }

        if ($challenge['purpose'] === 'signup') {
            try {
                $pdo->beginTransaction();
                $insert = $pdo->prepare('INSERT INTO admin_users (full_name,username,email,password_hash,email_verified_at,role,active) VALUES (?,?,?,?,NOW(),\'editor\',0)');
                $insert->execute([$challenge['full_name'], $challenge['username'], $challenge['email'], $challenge['password_hash']]);
                $pdo->prepare('DELETE FROM admin_auth_challenges WHERE id=?')->execute([$challenge['id']]);
                $pdo->commit();
            } catch (PDOException $error) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                if ($error->getCode() === '23000') fail('That username or email is already registered.', 409);
                throw $error;
            }
            record_login_failure();
            ok(['registered' => true, 'pending_approval' => true]);
        }
        $newPassword = (string)($body['password'] ?? '');
        if (strlen($newPassword) < 12 || !preg_match('/[A-Z]/', $newPassword) || !preg_match('/[a-z]/', $newPassword) || !preg_match('/[0-9]/', $newPassword) || !preg_match('/[^A-Za-z0-9]/', $newPassword)) {
            fail('Password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.');
        }
        if (!$challenge['account_id']) fail('If an active account matches that email, a reset code will be sent.');
        $pdo->beginTransaction();
        $updated = $pdo->prepare('UPDATE admin_users SET password_hash=? WHERE id=? AND active=1');
        $updated->execute([password_hash($newPassword, PASSWORD_DEFAULT), $challenge['account_id']]);
        if ($updated->rowCount() !== 1) {
            $pdo->rollBack();
            fail('This account is no longer active. Contact an administrator for help.', 403);
        }
        $pdo->prepare('DELETE FROM admin_auth_challenges WHERE id=?')->execute([$challenge['id']]);
        $pdo->commit();
        unset($_SESSION['password_reset_challenge']);
        $notificationSent = true;
        try {
            send_admin_notification((string)$challenge['email'], 'NaviGATE password changed', 'The password for your NaviGATE administrator account was changed. If you did not make this change, contact your system administrator immediately.');
        } catch (Throwable $error) {
            error_log('NaviGATE password-change notification failed: ' . get_class($error));
            $notificationSent = false;
        }
        record_login_failure();
        ok(['password_reset' => true, 'notification_sent' => $notificationSent]);
    }
    if ($path === 'auth/verify-link' && $method === 'POST') {
        require_public_csrf();
        $token = (string)($body['challenge_token'] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/D', $token)) fail('This verification link is invalid or has expired.', 400);
        $q = $pdo->prepare('SELECT * FROM admin_auth_challenges WHERE token_hash=? AND purpose=\'signup\' AND expires_at>NOW() LIMIT 1');
        $q->execute([hash('sha256', $token)]);
        $challenge = $q->fetch();
        if (!$challenge) fail('This verification link is invalid or has expired. Start sign-up again.', 400);
        try {
            $pdo->beginTransaction();
            $insert = $pdo->prepare('INSERT INTO admin_users (full_name,username,email,password_hash,email_verified_at,role,active) VALUES (?,?,?,?,NOW(),\'editor\',0)');
            $insert->execute([$challenge['full_name'], $challenge['username'], $challenge['email'], $challenge['password_hash']]);
            $pdo->prepare('DELETE FROM admin_auth_challenges WHERE id=?')->execute([$challenge['id']]);
            $pdo->commit();
        } catch (PDOException $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($error->getCode() === '23000') fail('That email address is already registered.', 409);
            throw $error;
        }
        record_login_failure();
        ok(['registered' => true, 'pending_approval' => true]);
    }
    if ($path === 'auth/reset-link' && $method === 'POST') {
        require_public_csrf();
        $token = (string)($body['challenge_token'] ?? '');
        $newPassword = (string)($body['password'] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/D', $token)) fail('This password reset link is invalid or has expired.', 400);
        if (strlen($newPassword) < 12 || !preg_match('/[A-Z]/', $newPassword) || !preg_match('/[a-z]/', $newPassword) || !preg_match('/[0-9]/', $newPassword) || !preg_match('/[^A-Za-z0-9]/', $newPassword)) {
            fail('Password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.');
        }
        $q = $pdo->prepare('SELECT id,account_id,email FROM admin_auth_challenges WHERE token_hash=? AND purpose=\'password_reset\' AND expires_at>NOW() LIMIT 1');
        $q->execute([hash('sha256', $token)]);
        $challenge = $q->fetch();
        if (!$challenge || !$challenge['account_id']) fail('This password reset link is invalid or has expired. Request a new reset email.', 400);
        $pdo->beginTransaction();
        $updated = $pdo->prepare('UPDATE admin_users SET password_hash=? WHERE id=? AND active=1');
        $updated->execute([password_hash($newPassword, PASSWORD_DEFAULT), $challenge['account_id']]);
        if ($updated->rowCount() !== 1) {
            $pdo->rollBack();
            fail('This account is no longer active. Contact an administrator for help.', 403);
        }
        $pdo->prepare('DELETE FROM admin_auth_challenges WHERE id=?')->execute([$challenge['id']]);
        $pdo->commit();
        $notificationSent = true;
        try {
            send_admin_notification((string)$challenge['email'], 'NaviGATE password changed', 'The password for your NaviGATE administrator account was changed. If you did not make this change, contact your system administrator immediately.');
        } catch (Throwable $error) {
            error_log('NaviGATE password-change notification failed: ' . get_class($error));
            $notificationSent = false;
        }
        record_login_failure();
        ok(['password_reset' => true, 'notification_sent' => $notificationSent]);
    }
    if ($path === 'auth/recover' && $method === 'POST') {
        require_public_csrf();
        rate_limit_login();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        if (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address.');
        $q = $pdo->prepare('SELECT id FROM admin_users WHERE email=? AND active=1 LIMIT 1');
        $q->execute([$email]);
        $accountId = $q->fetchColumn();
        $token = bin2hex(random_bytes(32));
        $code = (string)random_int(100000, 999999);
        $pdo->prepare('DELETE FROM admin_auth_challenges WHERE expires_at<NOW()')->execute();
        $pdo->prepare('DELETE FROM admin_auth_challenges WHERE email=? AND purpose=\'password_reset\'')->execute([$email]);
        $insert = $pdo->prepare('INSERT INTO admin_auth_challenges (token_hash,purpose,account_id,email,code_hash,expires_at,resend_after) VALUES (?,\'password_reset\',?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE),DATE_ADD(NOW(),INTERVAL 60 SECOND))');
        $insert->execute([hash('sha256', $token), $accountId ?: null, $email, password_hash($code, PASSWORD_DEFAULT)]);
        if ($accountId) send_admin_auth_code_or_fail($email, $code, 'password_reset', $token);
        start_app_session();
        $_SESSION['password_reset_challenge'] = $token;
        record_login_failure();
        ok(['resend_after' => 60, 'message' => 'If an active account matches that email, a verification code will be sent.']);
    }
    if ($path === 'auth/google' && $method === 'POST') {
        require_public_csrf();
        rate_limit_login();
        $clientId = app_env('GOOGLE_CLIENT_ID') ?: '';
        $credential = (string)($body['credential'] ?? '');
        if ($clientId === '' || $credential === '') fail('Google sign-in is not configured. Use email and password or ask the system administrator.', 503);
        if (strlen($credential) > 8192 || !function_exists('curl_init')) fail('Google sign-in is unavailable on this server.', 503);
        $curl = curl_init('https://oauth2.googleapis.com/tokeninfo?id_token=' . rawurlencode($credential));
        curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_SSL_VERIFYPEER => true]);
        $googleResponse = curl_exec($curl);
        $googleStatus = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        curl_close($curl);
        $identity = is_string($googleResponse) && $googleStatus === 200 ? json_decode($googleResponse, true) : null;
        if (!is_array($identity) || !hash_equals($clientId, (string)($identity['aud'] ?? '')) ||
            !in_array((string)($identity['iss'] ?? ''), ['accounts.google.com', 'https://accounts.google.com'], true) ||
            (int)($identity['exp'] ?? 0) <= time() || ($identity['email_verified'] ?? '') !== 'true' ||
            !hash_equals((string)($_SESSION['google_nonce'] ?? ''), (string)($identity['nonce'] ?? '')) ||
            empty($identity['sub']) || !filter_var((string)($identity['email'] ?? ''), FILTER_VALIDATE_EMAIL)) {
            record_login_failure();
            fail('Google could not verify this account. Try again or use email and password.', 401);
        }
        unset($_SESSION['google_nonce']);
        $googleEmail = strtolower((string)$identity['email']);
        $q = $pdo->prepare('SELECT id,full_name,username,email,role,active,google_sub FROM admin_users WHERE google_sub=? LIMIT 1');
        $q->execute([(string)$identity['sub']]);
        $user = $q->fetch();
        if ($user) {
            if (!(int)$user['active']) fail('This account is awaiting administrator approval or has been disabled.', 403);
            session_regenerate_id(true);
            $_SESSION = [];
            $_SESSION['admin'] = ['id' => (int)$user['id'], 'full_name' => $user['full_name'], 'username' => $user['username'], 'email' => $user['email'], 'role' => $user['role']];
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            ok(['user' => $_SESSION['admin'], 'csrf' => $_SESSION['csrf']]);
        }
        $q = $pdo->prepare('SELECT id FROM admin_users WHERE email=? LIMIT 1');
        $q->execute([$googleEmail]);
        if ($q->fetch()) fail('An account already uses this email. Sign in with its password; Google will not link accounts automatically.', 409);
        $username = 'google_' . substr(hash('sha256', (string)$identity['sub']), 0, 24);
        $name = trim((string)($identity['name'] ?? ''));
        if ($name === '') $name = $googleEmail;
        $insert = $pdo->prepare('INSERT INTO admin_users (full_name,username,email,password_hash,email_verified_at,google_sub,role,active) VALUES (?,?,?,?,NOW(),?,\'editor\',0)');
        try {
            $insert->execute([mb_substr($name, 0, 160), $username, $googleEmail, password_hash(bin2hex(random_bytes(32)), PASSWORD_DEFAULT), (string)$identity['sub']]);
        } catch (PDOException $error) {
            if ($error->getCode() === '23000') fail('This Google account could not be registered because it is already linked to an account.', 409);
            throw $error;
        }
        record_login_failure();
        ok(['registered' => true, 'pending_approval' => true]);
    }
    if ($path === 'auth/me' && $method === 'GET') {
        start_app_session();
        $user=isset($_SESSION['admin'])?require_admin('viewer'):null;
        ok(['user' => $user, 'csrf' => csrf_token()]);
    }
    if ($path === 'auth/login' && $method === 'POST') {
        $loginCsrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!hash_equals(csrf_token(), $loginCsrf)) fail('The request security token is invalid. Reload and try again.', 419);
        rate_limit_login();
        $username = trim((string)($body['username'] ?? ''));
        $password = (string)($body['password'] ?? '');
        $q = $pdo->prepare('SELECT id, full_name, username, email, password_hash, role, active FROM admin_users WHERE username = ? OR email = ? LIMIT 1');
        $q->execute([$username,$username]);
        $user = $q->fetch();
        if (!$user || !$user['active'] || !password_verify($password, $user['password_hash'])) {
            record_login_failure();
            fail('Invalid username or password.', 401);
        }
        session_regenerate_id(true);
        $_SESSION = [];
        $_SESSION['admin'] = ['id' => (int)$user['id'], 'full_name' => $user['full_name'], 'username' => $user['username'], 'email' => $user['email'], 'role' => $user['role']];
        $_SESSION['login_attempts'] = [];
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        ok(['user' => $_SESSION['admin'], 'csrf' => $_SESSION['csrf']]);
    }
    if ($path === 'auth/logout' && $method === 'POST') {
        start_app_session();
        if (empty($_SESSION['admin'])) fail('Administrator sign-in is required.',401);
        $logoutCsrf=$_SERVER['HTTP_X_CSRF_TOKEN']??'';
        if (!hash_equals($_SESSION['csrf']??'',$logoutCsrf)) fail('The request security token is invalid.',419);
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
        }
        session_destroy();
        ok(['logged_out' => true]);
    }
    if ($path === 'auth/profile' && in_array($method, ['GET','PUT'], true)) {
        $user = require_admin('viewer');
        if ($method === 'GET') {
            $q=$pdo->prepare('SELECT id,full_name,username,email,role FROM admin_users WHERE id=?'); $q->execute([$user['id']]);
            ok($q->fetch() ?: []);
        }
        $fullName=trim((string)($body['full_name']??'')); $username=trim((string)($body['username']??'')); $email=trim((string)($body['email']??''));
        if ($fullName==='' || mb_strlen($fullName)>160) fail('Enter a name up to 160 characters.');
        if (!preg_match('/^[a-zA-Z0-9_.-]{3,80}$/',$username)) fail('Username must be 3–80 characters using letters, numbers, dots, underscores, or hyphens.');
        if (!filter_var($email,FILTER_VALIDATE_EMAIL) || strlen($email)>254) fail('Enter a valid email address.');
        $dup=$pdo->prepare('SELECT id FROM admin_users WHERE (username=? OR email=?) AND id<>? LIMIT 1'); $dup->execute([$username,$email,$user['id']]);
        if ($dup->fetch()) fail('That username or email is already in use.',409);
        try { $pdo->prepare('UPDATE admin_users SET full_name=?,username=?,email=? WHERE id=?')->execute([$fullName,$username,$email,$user['id']]); }
        catch (PDOException $e) { if ($e->getCode()==='23000') fail('That username or email is already in use.',409); throw $e; }
        $_SESSION['admin']['full_name']=$fullName; $_SESSION['admin']['username']=$username; $_SESSION['admin']['email']=$email;
        audit($pdo,$user,'update','admin_profile',(int)$user['id']);
        ok(['full_name'=>$fullName,'username'=>$username,'email'=>$email,'role'=>$user['role']]);
    }
    if ($path === 'auth/password' && $method === 'POST') {
        $user=require_admin('viewer');
        $current=(string)($body['current_password']??''); $password=(string)($body['password']??'');
        if (strlen($password)<12 || !preg_match('/[a-z]/',$password) || !preg_match('/[A-Z]/',$password) || !preg_match('/[0-9]/',$password) || !preg_match('/[^a-zA-Z0-9]/',$password)) fail('Use at least 12 characters with uppercase, lowercase, a number, and a symbol.');
        $q=$pdo->prepare('SELECT password_hash FROM admin_users WHERE id=?'); $q->execute([$user['id']]);
        if (!password_verify($current,(string)$q->fetchColumn())) fail('Current password is incorrect.',403);
        $pdo->prepare('UPDATE admin_users SET password_hash=? WHERE id=?')->execute([password_hash($password,PASSWORD_DEFAULT),$user['id']]);
        audit($pdo,$user,'change_password','admin_account',(int)$user['id']);
        ok(['changed'=>true]);
    }

    if ($path === 'categories' && $method === 'GET') {
        $q = $pdo->query('SELECT id, name, slug FROM categories ORDER BY sort_order, name');
        ok($q->fetchAll());
    }
    if ($path === 'directory' && $method === 'GET') {
        $locations = $pdo->query("SELECT l.id, l.name, l.kind, l.description, l.image_path AS image, l.building_number, l.capacity, l.floor_count,
          l.department_name AS departmentName, l.contact_email AS contactEmail, l.contact_phone AS contactPhone, l.website_url AS websiteUrl,
          l.service_hours AS serviceHours, l.access_hours AS accessHours, l.days_open AS daysOpen, l.lunch_break AS lunchBreak,
          l.services, l.nearby_landmarks AS nearbyLandmarks, l.accessibility_status AS accessibilityStatus, l.accessibility_details AS accessibilityDetails,l.accessibility_features AS accessibilityFeatures,l.floor_label AS floorLabel,
          l.parent_building_id AS parentBuildingId,l.verified, c.name AS category, m.x, m.y, m.floor_number, m.map_key,
          b.name AS parent_building, m.id AS marker_id, m.route_node_id
          FROM locations l LEFT JOIN categories c ON c.id=l.category_id LEFT JOIN locations b ON b.id=l.parent_building_id
          LEFT JOIN map_markers m ON m.location_id=l.id AND m.active=1 WHERE l.active=1 ORDER BY l.kind, l.name")->fetchAll();
        $rooms = $pdo->query("SELECT r.id, r.building_id AS buildingId, r.name, r.room_number AS roomNumber, r.floor_number AS floorNumber, r.floor_label AS floorLabel, r.capacity, r.description, r.function_description AS functionDescription, r.image_path AS image,
          r.department_head AS departmentHead, r.contact_info AS contactInfo, r.contact_email AS contactEmail, r.contact_phone AS contactPhone, r.website_url AS websiteUrl,
          r.department_name AS departmentName, r.service_hours AS serviceHours, r.days_open AS daysOpen, r.lunch_break AS lunchBreak, r.services,
          r.nearby_landmarks AS nearbyLandmarks, r.accessibility_status AS accessibilityStatus, r.accessibility_details AS accessibilityDetails,
          r.verified, c.name AS category, b.name AS buildingName
          FROM rooms r JOIN locations b ON b.id=r.building_id LEFT JOIN categories c ON c.id=r.category_id WHERE r.active=1 AND b.active=1 ORDER BY b.name,r.floor_number,r.room_number")->fetchAll();
        $photos = $pdo->query('SELECT id,location_id AS locationId,room_id AS roomId,image_path AS image,alt_text AS altText,caption,sort_order AS sortOrder,is_cover AS isCover FROM facility_photos ORDER BY sort_order,id')->fetchAll();
        $locationPhotos=[];$roomPhotos=[];
        foreach($photos as $photo){if($photo['locationId']!==null)$locationPhotos[$photo['locationId']][]=$photo;else $roomPhotos[$photo['roomId']][]=$photo;}
        foreach($locations as &$location){$location['accessibilityFeatures']=$location['kind']==='building'?(json_decode((string)($location['accessibilityFeatures']??'[]'),true)?:[]):[];$location['photos']=$locationPhotos[$location['id']]??[];}unset($location);
        foreach($rooms as &$room){$room['photos']=$roomPhotos[$room['id']]??[];}unset($room);
        $floorPlans=$pdo->query('SELECT f.id,f.building_id,f.floor_number,f.original_name,f.mime_type,f.file_size,f.verified,CONCAT("uploads/floorplans/",f.stored_name) AS file_url FROM floor_plans f ORDER BY f.building_id,f.floor_number')->fetchAll();
        ok(['locations'=>$locations,'rooms'=>$rooms,'floorPlans'=>$floorPlans]);
    }
    if ($path === 'map' && $method === 'GET') {
        $markers = $pdo->query("SELECT m.id, m.location_id, m.route_node_id, l.name, l.kind, l.description, c.name AS category, m.x, m.y, m.floor_number, m.map_key, m.accessibility_status AS accessibility_value
          FROM map_markers m JOIN locations l ON l.id=m.location_id LEFT JOIN categories c ON c.id=l.category_id WHERE m.active=1 AND l.active=1 ORDER BY m.id")->fetchAll();
        $nodes = $pdo->query('SELECT id, node_key, x, y, floor_number FROM map_nodes WHERE active=1 ORDER BY id')->fetchAll();
        $edges = $pdo->query("SELECT e.id, e.from_node_id, e.to_node_id, e.weight, e.connection_type, e.verified, e.accessibility_status AS accessibility_value FROM map_connections e JOIN map_nodes f ON f.id=e.from_node_id JOIN map_nodes t ON t.id=e.to_node_id WHERE e.active=1 AND e.verified=1 AND f.active=1 AND t.active=1 AND (f.floor_number=t.floor_number OR e.connection_type IN ('stairs','ramp','elevator')) ORDER BY e.id")->fetchAll();
        ok(['markers' => $markers, 'nodes' => $nodes, 'connections' => $edges]);
    }
    if ($path === 'map/admin' && $method === 'GET') {
        require_admin('viewer');
        $markers=$pdo->query("SELECT m.id,m.location_id,m.route_node_id,l.name,l.kind,l.description,c.name AS category,m.x,m.y,m.floor_number,m.map_key,m.accessibility_status AS accessibility_value FROM map_markers m JOIN locations l ON l.id=m.location_id LEFT JOIN categories c ON c.id=l.category_id WHERE m.active=1 AND l.active=1 ORDER BY m.id")->fetchAll();
        $nodes=$pdo->query('SELECT id,node_key,x,y,floor_number FROM map_nodes WHERE active=1 ORDER BY id')->fetchAll();
        $edges=$pdo->query('SELECT e.id,e.from_node_id,e.to_node_id,e.weight,e.connection_type,e.verified,e.accessibility_status AS accessibility_value FROM map_connections e JOIN map_nodes f ON f.id=e.from_node_id JOIN map_nodes t ON t.id=e.to_node_id WHERE e.active=1 AND f.active=1 AND t.active=1 ORDER BY e.id')->fetchAll();
        ok(['markers'=>$markers,'nodes'=>$nodes,'connections'=>$edges]);
    }
    if ($path === 'routes/available' && $method === 'GET') {
        $routes=$pdo->query("SELECT r.*,sm.location_id AS start_location_id,sl.name AS start_name,dm.location_id AS destination_location_id,dl.name AS destination_name,sm.x AS start_x,sm.y AS start_y,dm.x AS destination_x,dm.y AS destination_y,
          CASE WHEN r.accessibility_status=1 AND COALESCE(sm.accessibility_status,0)=1 AND COALESCE(dm.accessibility_status,0)=1
            AND EXISTS (SELECT 1 FROM campus_route_segments rs WHERE rs.route_id=r.id)
            AND (SELECT COUNT(*) FROM campus_route_segments rs WHERE rs.route_id=r.id)=(SELECT COUNT(*)-1 FROM campus_route_points rp WHERE rp.route_id=r.id)
            AND NOT EXISTS (SELECT 1 FROM campus_route_segments rs LEFT JOIN map_connections c ON c.id=rs.connection_id WHERE rs.route_id=r.id AND (COALESCE(c.active,0)<>1 OR COALESCE(c.verified,0)<>1 OR COALESCE(c.accessibility_status,0)<>1))
            THEN 1 ELSE 0 END AS accessible_confirmed
          FROM campus_routes r JOIN map_markers sm ON sm.id=r.start_marker_id JOIN locations sl ON sl.id=sm.location_id JOIN map_markers dm ON dm.id=r.destination_marker_id JOIN locations dl ON dl.id=dm.location_id WHERE r.status='active' AND sm.active=1 AND dm.active=1 AND sl.active=1 AND dl.active=1 ORDER BY r.updated_at DESC,r.id DESC")->fetchAll();
        $pointQuery=$pdo->prepare('SELECT p.sequence_no,p.point_type,p.notes,n.id AS node_id,n.node_key,n.x,n.y,n.floor_number FROM campus_route_points p JOIN map_nodes n ON n.id=p.node_id WHERE p.route_id=? ORDER BY p.sequence_no');
        foreach($routes as &$route){$pointQuery->execute([(int)$route['id']]);$route['points']=$pointQuery->fetchAll();}
        unset($route);ok($routes);
    }
    if ($path === 'announcements' && $method === 'GET' && !isset($_GET['admin'])) {
        $q = $pdo->query("SELECT a.id, a.title, a.body AS details, a.status, a.featured AS pinned, a.event_start, a.event_end, a.created_at AS createdAt, a.image_path AS photo, l.name AS location
          FROM announcements a LEFT JOIN locations l ON l.id=a.location_id WHERE a.status='published' AND (a.publish_at IS NULL OR a.publish_at <= NOW()) ORDER BY a.featured DESC, a.publish_at DESC, a.created_at DESC");
        ok($q->fetchAll());
    }
    if ($path === 'floorplans' && $method === 'GET') {
        $q=$pdo->query('SELECT f.id,f.building_id,f.floor_number,f.original_name,f.mime_type,f.file_size,f.created_at,CONCAT("uploads/floorplans/",f.stored_name) AS file_url FROM floor_plans f ORDER BY f.building_id,f.floor_number');
        ok($q->fetchAll());
    }

    if ($path === 'admin/overview' && $method === 'GET') {
        require_admin('viewer');
        $counts = [
            'buildings'=>(int)$pdo->query("SELECT COUNT(*) FROM locations WHERE kind='building' AND active=1")->fetchColumn(),
            'facilities'=>(int)$pdo->query("SELECT COUNT(*) FROM locations WHERE kind='facility' AND active=1")->fetchColumn(),
            'rooms'=>(int)$pdo->query('SELECT COUNT(*) FROM rooms WHERE active=1')->fetchColumn(),
            'landmarks'=>(int)$pdo->query('SELECT COUNT(*) FROM map_markers WHERE active=1')->fetchColumn(),
            'campus_routes'=>(int)$pdo->query("SELECT COUNT(*) FROM campus_routes WHERE status='active'")->fetchColumn(),
            'announcements'=>(int)$pdo->query("SELECT COUNT(*) FROM announcements WHERE status='published' AND (publish_at IS NULL OR publish_at<=NOW())")->fetchColumn(),
            'upcoming_events'=>(int)$pdo->query("SELECT COUNT(*) FROM announcements WHERE status='published' AND event_start>=NOW() AND (publish_at IS NULL OR publish_at<=NOW())")->fetchColumn(),
        ];
        $activity=$pdo->query('SELECT al.action,al.entity_type,al.entity_id,al.created_at,COALESCE(au.username,\'Former administrator\') AS administrator FROM audit_logs al LEFT JOIN admin_users au ON au.id=al.admin_id ORDER BY al.created_at DESC,al.id DESC LIMIT 8')->fetchAll();
        ok(['counts'=>$counts,'recent_activity'=>$activity]);
    }

    if ($path === 'admin/system' && $method === 'GET') {
        require_admin();
        ok(['application'=>'NaviGATE LCUP Campus Navigation','version'=>'Not configured','database'=>'Connected','php'=>PHP_VERSION]);
    }

    $user = require_admin();
    if ($path === 'admin/accounts') {
        require_admin('admin');
        if ($method==='GET') {
            $rows=$pdo->query('SELECT id,full_name,username,email,role,active,created_at FROM admin_users ORDER BY created_at DESC,id DESC')->fetchAll();
            ok($rows);
        }
        if ($method==='PUT') {
            $id=positive_id($body['id']??$id); $role=(string)($body['role']??''); $active=(int)(bool)($body['active']??false);
            if (!in_array($role,['admin','editor','viewer'],true)) fail('Choose a valid administrator role.');
            if ($id===(int)$user['id'] && (!$active || $role!=='admin')) fail('You cannot deactivate or demote your own account.',409);
            $q=$pdo->prepare('SELECT role,active,username FROM admin_users WHERE id=?'); $q->execute([$id]); $before=$q->fetch();
            if (!$before) fail('Administrator account not found.',404);
            if ($before['role']==='admin' && (int)$before['active']===1 && (!$active || $role!=='admin')) {
                $n=(int)$pdo->query("SELECT COUNT(*) FROM admin_users WHERE role='admin' AND active=1")->fetchColumn();
                if ($n<=1) fail('The last active administrator cannot be disabled or demoted.',409);
            }
            $pdo->prepare('UPDATE admin_users SET role=?,active=? WHERE id=?')->execute([$role,$active,$id]);
            audit($pdo,$user,'update','admin_account',$id,['role'=>$before['role'],'active'=>(int)$before['active']],['role'=>$role,'active'=>$active]);
            ok(['id'=>$id,'role'=>$role,'active'=>$active]);
        }
        fail('Method not allowed.',405);
    }
    if ($path === 'routes' && $method === 'GET') {
        $routes = $pdo->query("SELECT r.*, sm.location_id AS start_location_id, sl.name AS start_name, dm.location_id AS destination_location_id, dl.name AS destination_name, sm.x AS start_x, sm.y AS start_y, dm.x AS destination_x, dm.y AS destination_y
          FROM campus_routes r JOIN map_markers sm ON sm.id=r.start_marker_id JOIN locations sl ON sl.id=sm.location_id JOIN map_markers dm ON dm.id=r.destination_marker_id JOIN locations dl ON dl.id=dm.location_id ORDER BY r.updated_at DESC, r.id DESC")->fetchAll();
        $pointQuery = $pdo->prepare('SELECT p.sequence_no,p.point_type,p.notes,n.id AS node_id,n.node_key,n.x,n.y,n.floor_number FROM campus_route_points p JOIN map_nodes n ON n.id=p.node_id WHERE p.route_id=? ORDER BY p.sequence_no');
        foreach ($routes as &$route) {
            $pointQuery->execute([(int)$route['id']]);
            $route['points'] = $pointQuery->fetchAll();
        }
        unset($route);
        ok($routes);
    }
    if ($path === 'routes' && in_array($method, ['POST','PUT','DELETE'], true)) {
        if ($method === 'DELETE') {
            $routeId = positive_id($body['id'] ?? $id);
            $q = $pdo->prepare('DELETE FROM campus_routes WHERE id=?');
            $q->execute([$routeId]);
            if (!$q->rowCount()) fail('Saved route not found.',404);
            audit($pdo,$user,'delete','campus_route',$routeId);
            ok(['id'=>$routeId,'walkways_preserved'=>true]);
        }

        $routeId = $method === 'PUT' ? positive_id($body['id'] ?? $id) : null;
        $name = text_field($body,'name',120,true);
        $startMarkerId = positive_id($body['start_marker_id'] ?? 0);
        $endMarkerId = positive_id($body['destination_marker_id'] ?? 0);
        if ($startMarkerId === $endMarkerId && ($body['status']??'incomplete')==='active') fail('A completed route needs two different endpoint markers.');
        $waypoints = $body['waypoints'] ?? [];
        if (!is_array($waypoints) || count($waypoints) > 80) fail('A route can have up to 80 intermediate points.');
        $status = (string)($body['status'] ?? 'incomplete');
        if (!in_array($status,['draft','incomplete','active','inactive'],true)) fail('Choose Draft, Incomplete, Completed, or Inactive for this route.');
        $accessibility = isset($body['accessibility_status']) && $body['accessibility_status'] !== '' ? (int)$body['accessibility_status'] : null;
        if ($accessibility !== null && !in_array($accessibility,[0,1],true)) fail('Invalid accessibility status.');
        $notes = text_field($body,'notes',1000);

        $pdo->beginTransaction();
        try {
            $getMarker = $pdo->prepare("SELECT m.id,m.location_id,m.route_node_id,m.x,m.y,m.floor_number,m.verified AS marker_verified,m.accessibility_status AS accessibility_value,l.name,l.active AS location_active,l.verified AS location_verified FROM map_markers m JOIN locations l ON l.id=m.location_id WHERE m.id=? AND m.active=1");
            $getMarker->execute([$startMarkerId]); $startMarker=$getMarker->fetch();
            $getMarker->execute([$endMarkerId]); $endMarker=$getMarker->fetch();
            if (!$startMarker || !$endMarker || !$startMarker['location_active'] || !$endMarker['location_active']) fail('Both endpoints must use active campus markers.');
            if ($status==='active' && $startMarkerId===$endMarkerId) fail('A completed route needs two different endpoints.');
            if ($routeId) {
                $exists=$pdo->prepare('SELECT id FROM campus_routes WHERE id=?');$exists->execute([$routeId]);if(!$exists->fetch())fail('Saved route not found.',404);
                $saveRoute=$pdo->prepare('UPDATE campus_routes SET name=?,start_marker_id=?,destination_marker_id=?,status=?,accessibility_status=?,notes=?,distance_map_units=NULL WHERE id=?');
                $saveRoute->execute([$name,$startMarkerId,$endMarkerId,$status,$accessibility,$notes,$routeId]);
                $pdo->prepare('DELETE FROM campus_route_points WHERE route_id=?')->execute([$routeId]);
                $pdo->prepare('DELETE FROM campus_route_segments WHERE route_id=?')->execute([$routeId]);
            } else {
                $saveRoute=$pdo->prepare('INSERT INTO campus_routes (name,start_marker_id,destination_marker_id,status,accessibility_status,notes,created_by) VALUES (?,?,?,?,?,?,?)');
                $saveRoute->execute([$name,$startMarkerId,$endMarkerId,$status,$accessibility,$notes,$user['id']]);
                $routeId=(int)$pdo->lastInsertId();
            }

            // Newly generated landmark drafts begin with the landmark as both
            // endpoints and no path. Keep this valid incomplete state editable.
            if ($startMarkerId===$endMarkerId && $status!=='active') {
                audit($pdo,$user,$method==='PUT'?'update':'create','campus_route',$routeId,[],['status'=>$status,'segments'=>0]);
                $pdo->commit();
                ok(['id'=>$routeId,'distance_map_units'=>null,'accessibility_status'=>$accessibility],$method==='POST'?201:200);
            }

            $nodeQuery=$pdo->prepare('SELECT id,node_key,x,y,floor_number FROM map_nodes WHERE id=? AND active=1');
            $insertNode=$pdo->prepare('INSERT INTO map_nodes (node_key,x,y,floor_number) VALUES (?,?,?,?)');
            $endpointNode=function(array $marker,string $side) use ($pdo,$nodeQuery,$insertNode,$routeId): int {
                $nodeId=(int)($marker['route_node_id']??0);
                if($nodeId){$nodeQuery->execute([$nodeId]);$node=$nodeQuery->fetch();if(!$node)fail('An endpoint points to an inactive route node. Update its map marker first.');}
                else {
                    $nodeKey='route-'.$routeId.'-'.$side;
                    $insertNode->execute([$nodeKey,(float)$marker['x'],(float)$marker['y'],(int)$marker['floor_number']]);
                    $nodeId=(int)$pdo->lastInsertId();
                    $pdo->prepare('UPDATE map_markers SET route_node_id=? WHERE id=?')->execute([$nodeId,(int)$marker['id']]);
                }
                return $nodeId;
            };
            $ordered=[];
            $ordered[]=['id'=>$endpointNode($startMarker,'start'),'type'=>'start','notes'=>null];
            foreach($waypoints as $index=>$point){
                if(!is_array($point))fail('Invalid waypoint data.');
                if(isset($point['node_id'])&&$point['node_id']!==''){
                    $nodeId=positive_id($point['node_id']);$nodeQuery->execute([$nodeId]);$node=$nodeQuery->fetch();if(!$node)fail('A selected waypoint is missing or inactive.');
                } else {
                    $x=filter_var($point['x']??null,FILTER_VALIDATE_FLOAT);$y=filter_var($point['y']??null,FILTER_VALIDATE_FLOAT);
                    if($x===false||$y===false||$x<0||$x>1330||$y<0||$y>1620)fail('A waypoint is outside the campus map bounds.');
                    $floor=max(0,(int)($point['floor_number']??0));$nodeKey='route-'.$routeId.'-p'.($index+1).'-'.bin2hex(random_bytes(3));
                    $insertNode->execute([$nodeKey,$x,$y,$floor]);$nodeId=(int)$pdo->lastInsertId();
                }
                $ordered[]=['id'=>$nodeId,'type'=>'waypoint','notes'=>text_field($point,'notes',255)];
            }
            $ordered[]=['id'=>$endpointNode($endMarker,'end'),'type'=>'destination','notes'=>null];

            $newCoordinates=[];$coordinateQuery=$pdo->prepare('SELECT x,y,floor_number FROM map_nodes WHERE id=?');
            foreach($ordered as $point){$coordinateQuery->execute([(int)$point['id']]);$coordinate=$coordinateQuery->fetch();$newCoordinates[]=[(float)$coordinate['x'],(float)$coordinate['y'],(int)$coordinate['floor_number']];}
            $candidateRoutes=$pdo->prepare('SELECT id FROM campus_routes WHERE id<>? AND ((start_marker_id=? AND destination_marker_id=?) OR (start_marker_id=? AND destination_marker_id=?))');
            $candidateRoutes->execute([$routeId,$startMarkerId,$endMarkerId,$endMarkerId,$startMarkerId]);
            $existingCoordinates=$pdo->prepare('SELECT n.x,n.y,n.floor_number FROM campus_route_points p JOIN map_nodes n ON n.id=p.node_id WHERE p.route_id=? ORDER BY p.sequence_no');
            while($candidate=$candidateRoutes->fetch()){
                $existingCoordinates->execute([(int)$candidate['id']]);$candidatePoints=$existingCoordinates->fetchAll();
                if(count($candidatePoints)!==count($newCoordinates))continue;
                foreach([false,true] as $reverse){$same=true;foreach($newCoordinates as $index=>$coordinate){$other=$candidatePoints[$reverse?count($candidatePoints)-1-$index:$index];if((int)$other['floor_number']!==$coordinate[2]||abs((float)$other['x']-$coordinate[0])>1||abs((float)$other['y']-$coordinate[1])>1){$same=false;break;}}if($same){$pdo->rollBack();fail('An identical route already exists. Edit the saved route instead of creating a duplicate.',409);}}
            }

            $pointInsert=$pdo->prepare('INSERT INTO campus_route_points (route_id,sequence_no,node_id,point_type,notes) VALUES (?,?,?,?,?)');
            foreach($ordered as $i=>$point)$pointInsert->execute([$routeId,$i+1,$point['id'],$point['type'],$point['notes']]);
            $edgeFind=$pdo->prepare('SELECT id,weight,accessibility_status,active,verified,connection_type FROM map_connections WHERE (from_node_id=? AND to_node_id=?) OR (from_node_id=? AND to_node_id=?) LIMIT 1');
            $edgeInsert=$pdo->prepare('INSERT INTO map_connections (from_node_id,to_node_id,weight,connection_type,verified,accessibility_status) VALUES (?,?,?,?,?,?)');
            $segmentInsert=$pdo->prepare('INSERT INTO campus_route_segments (route_id,sequence_no,connection_id) VALUES (?,?,?)');
            $nodeCoordinates=$pdo->prepare('SELECT x,y,floor_number FROM map_nodes WHERE id=?');$totalDistance=0.0;$allAccessible=true;
            for($i=0;$i<count($ordered)-1;$i++){
                if($status!=='active'){
                    $nodeCoordinates->execute([(int)$ordered[$i]['id']]);$a=$nodeCoordinates->fetch();
                    $nodeCoordinates->execute([(int)$ordered[$i+1]['id']]);$b=$nodeCoordinates->fetch();
                    $totalDistance+=hypot((float)$a['x']-(float)$b['x'],(float)$a['y']-(float)$b['y']);
                    continue;
                }
                $from=(int)$ordered[$i]['id'];$to=(int)$ordered[$i+1]['id'];if($from===$to)fail('Two consecutive route points are the same. Remove or reorder the duplicate waypoint.');
                $edgeFind->execute([$from,$to,$to,$from]);$edge=$edgeFind->fetch();
                if($edge){
                    if(!(int)$edge['active'])fail('A route segment is archived. Choose different points.');
                    $nodeCoordinates->execute([$from]);$a=$nodeCoordinates->fetch();
                    $nodeCoordinates->execute([$to]);$b=$nodeCoordinates->fetch();
                    if((int)$a['floor_number']!==(int)$b['floor_number']&&!in_array($edge['connection_type'],['stairs','ramp','elevator'],true))fail('Floor changes require a mapped stair, ramp, or elevator connection.');
                    $connId=(int)$edge['id'];$weight=(float)$edge['weight'];
                    $allAccessible=$allAccessible&&(int)$edge['active']===1&&(int)$edge['verified']===1&&(int)$edge['accessibility_status']===1;
                } else {
                    $nodeCoordinates->execute([$from]);$a=$nodeCoordinates->fetch();$nodeCoordinates->execute([$to]);$b=$nodeCoordinates->fetch();
                    if((int)$a['floor_number']!==(int)$b['floor_number'])fail('Floor changes need a mapped stair, ramp, or elevator connection first.');
                    $weight=max(0.1,hypot((float)$a['x']-(float)$b['x'],(float)$a['y']-(float)$b['y']));
                    $edgeInsert->execute([$from,$to,$weight,'walkway',0,null]);$connId=(int)$pdo->lastInsertId();
                    $allAccessible=false;
                }
                $totalDistance+=$weight;$segmentInsert->execute([$routeId,$i+1,$connId]);
            }
            $endpointsAccessible=(int)$startMarker['accessibility_value']===1&&(int)$endMarker['accessibility_value']===1;
            if($accessibility===1&&($status!=='active'||!$allAccessible||!$endpointsAccessible))fail('Accessible routes require verified active paths, accessible endpoints, and every accessible segment.');
            $routeAccessible=$accessibility;
            $pdo->prepare('UPDATE campus_routes SET distance_map_units=?,accessibility_status=? WHERE id=?')->execute([$totalDistance,$routeAccessible,$routeId]);
            audit($pdo,$user,$method==='PUT'?'update':'create','campus_route',$routeId,[],['status'=>$status,'segments'=>count($ordered)-1]);
            $pdo->commit();
            ok(['id'=>$routeId,'distance_map_units'=>round($totalDistance,2),'accessibility_status'=>$routeAccessible],$method==='POST'?201:200);
        } catch(Throwable $e) { if($pdo->inTransaction())$pdo->rollBack(); throw $e; }
    }
    if ($path === 'uploads' && $method === 'POST') {
        if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) fail('Choose a file that uploaded successfully.');
        $type=(string)($_POST['type']??'photo'); $isPlan=$type==='floorplan';
        $max=$isPlan?15*1024*1024:5*1024*1024;
        if ($_FILES['file']['size']>$max) fail($isPlan?'Floor plans must be 15 MB or smaller.':'Images must be 5 MB or smaller.',413);
        $mime=(new finfo(FILEINFO_MIME_TYPE))->file($_FILES['file']['tmp_name']);
        $allowed=$isPlan?['application/pdf'=>'pdf','image/png'=>'png','image/jpeg'=>'jpg','image/webp'=>'webp']:['image/png'=>'png','image/jpeg'=>'jpg','image/webp'=>'webp'];
        if (!isset($allowed[$mime])) fail('Unsupported file type. Upload a PNG, JPEG, WebP image' . ($isPlan?' or PDF.':'.'));
        $stored=bin2hex(random_bytes(24)).'.'.$allowed[$mime];$directory=APP_ROOT.'/uploads/'.($isPlan?'floorplans':'photos');
        if (!is_dir($directory) && !mkdir($directory,0750,true)) fail('Upload storage is unavailable.',503);
        if (!move_uploaded_file($_FILES['file']['tmp_name'],$directory.'/'.$stored)) fail('The uploaded file could not be stored.',500);
        if (!$isPlan) { audit($pdo,$user,'upload','image',null,[],['mime'=>$mime,'size'=>(int)$_FILES['file']['size']]); ok(['path'=>'uploads/photos/'.$stored],201); }
        $building=positive_id($_POST['building_id']??0);$floor=(int)($_POST['floor_number']??0);
        $check=$pdo->prepare("SELECT id FROM locations WHERE id=? AND kind='building' AND active=1");$check->execute([$building]);if(!$check->fetch()){unlink($directory.'/'.$stored);fail('Choose a valid building for this floor plan.');}
        try{$q=$pdo->prepare('INSERT INTO floor_plans (building_id,floor_number,original_name,stored_name,mime_type,file_size,uploaded_by) VALUES (?,?,?,?,?,?,?)');$q->execute([$building,$floor,basename($_FILES['file']['name']),$stored,$mime,(int)$_FILES['file']['size'],$user['id']]);$planId=(int)$pdo->lastInsertId();audit($pdo,$user,'upload','floor_plan',$planId);ok(['id'=>$planId,'file_url'=>'uploads/floorplans/'.$stored],201);}
        catch(Throwable $e){unlink($directory.'/'.$stored);throw $e;}
    }
    if ($path === 'floorplans' && $method === 'DELETE') {
        $rid=positive_id($body['id']??$id);$q=$pdo->prepare('SELECT stored_name FROM floor_plans WHERE id=?');$q->execute([$rid]);$plan=$q->fetch();if(!$plan)fail('Floor plan not found.',404);
        $pdo->prepare('DELETE FROM floor_plans WHERE id=?')->execute([$rid]);$file=APP_ROOT.'/uploads/floorplans/'.$plan['stored_name'];if(is_file($file))unlink($file);audit($pdo,$user,'delete','floor_plan',$rid);ok(['id'=>$rid]);
    }
    if ($path === 'facility-photos') {
        $user=require_admin('editor');
        $photoOwner=static function(string $type,int $ownerId)use($pdo):array{
            if(!in_array($type,['location','room'],true))fail('Invalid photo record type.');
            $table=$type==='location'?'locations':'rooms';
            $q=$pdo->prepare("SELECT id,image_path,name FROM {$table} WHERE id=? AND active=1");
            $q->execute([$ownerId]);$record=$q->fetch();if(!$record)fail('Campus record not found.',404);
            return $record;
        };
        if($method==='POST'){
            $type=(string)($body['owner_type']??'');$ownerId=positive_id($body['owner_id']??0);$owner=$photoOwner($type,$ownerId);
            $image=uploaded_image_path($body);if(!$image)fail('Upload a photo before adding it.');
            $alt=text_field($body,'alt_text',255,true);$caption=text_field($body,'caption',255);
            $q=$pdo->prepare('SELECT COUNT(*) FROM facility_photos WHERE '.($type==='location'?'location_id':'room_id').'=?');$q->execute([$ownerId]);$count=(int)$q->fetchColumn();
            $cover=isset($body['is_cover'])?(int)(bool)$body['is_cover']:($count===0?1:0);
            $pdo->beginTransaction();
            try{
                if($cover)$pdo->prepare('UPDATE facility_photos SET is_cover=0 WHERE '.($type==='location'?'location_id':'room_id').'=?')->execute([$ownerId]);
                $column=$type==='location'?'location_id':'room_id';$other=$type==='location'?'room_id':'location_id';
                $q=$pdo->prepare("INSERT INTO facility_photos ({$column},{$other},image_path,alt_text,caption,sort_order,is_cover) VALUES (?,NULL,?,?,?,?,?)");
                if($type==='room')$q=$pdo->prepare("INSERT INTO facility_photos ({$other},{$column},image_path,alt_text,caption,sort_order,is_cover) VALUES (NULL,?,?,?,?,?,?)");
                $q->execute([$ownerId,$image,$alt,$caption,max(0,min(65535,(int)($body['sort_order']??$count))),$cover]);
                $photoId=(int)$pdo->lastInsertId();
                if($cover||empty($owner['image_path']))$pdo->prepare("UPDATE ".($type==='location'?'locations':'rooms')." SET image_path=? WHERE id=?")->execute([$image,$ownerId]);
                $pdo->commit();
            }catch(Throwable $error){$pdo->rollBack();throw $error;}
            audit($pdo,$user,'create','facility_photo',$photoId);ok(['id'=>$photoId],201);
        }
        if($method==='PUT'){
            $photoId=positive_id($body['id']??$id);$alt=text_field($body,'alt_text',255,true);$caption=text_field($body,'caption',255);
            $cover=(int)(bool)($body['is_cover']??false);$sort=max(0,min(65535,(int)($body['sort_order']??0)));
            $q=$pdo->prepare('SELECT * FROM facility_photos WHERE id=?');$q->execute([$photoId]);$photo=$q->fetch();if(!$photo)fail('Photo not found.',404);
            $type=$photo['location_id']!==null?'location':'room';$ownerId=(int)($photo['location_id']??$photo['room_id']);$photoOwner($type,$ownerId);
            $pdo->beginTransaction();
            try{
                $column=$type==='location'?'location_id':'room_id';
                if($cover)$pdo->prepare("UPDATE facility_photos SET is_cover=0 WHERE {$column}=?")->execute([$ownerId]);
                $pdo->prepare('UPDATE facility_photos SET alt_text=?,caption=?,sort_order=?,is_cover=? WHERE id=?')->execute([$alt,$caption,$sort,$cover,$photoId]);
                if($cover)$pdo->prepare("UPDATE ".($type==='location'?'locations':'rooms')." SET image_path=? WHERE id=?")->execute([$photo['image_path'],$ownerId]);
                $pdo->commit();
            }catch(Throwable $error){$pdo->rollBack();throw $error;}
            audit($pdo,$user,'update','facility_photo',$photoId);ok(['id'=>$photoId]);
        }
        if($method==='DELETE'){
            $photoId=positive_id($body['id']??$id);$q=$pdo->prepare('SELECT * FROM facility_photos WHERE id=?');$q->execute([$photoId]);$photo=$q->fetch();if(!$photo)fail('Photo not found.',404);
            $type=$photo['location_id']!==null?'location':'room';$ownerId=(int)($photo['location_id']??$photo['room_id']);$photoOwner($type,$ownerId);$column=$type==='location'?'location_id':'room_id';$table=$type==='location'?'locations':'rooms';
            $pdo->beginTransaction();
            try{
                $pdo->prepare('DELETE FROM facility_photos WHERE id=?')->execute([$photoId]);
                if((int)$photo['is_cover']){$next=$pdo->prepare("SELECT id,image_path FROM facility_photos WHERE {$column}=? ORDER BY sort_order,id LIMIT 1");$next->execute([$ownerId]);$replacement=$next->fetch();if($replacement){$pdo->prepare('UPDATE facility_photos SET is_cover=1 WHERE id=?')->execute([$replacement['id']]);$pdo->prepare("UPDATE {$table} SET image_path=? WHERE id=?")->execute([$replacement['image_path'],$ownerId]);}else{$pdo->prepare("UPDATE {$table} SET image_path=NULL WHERE id=?")->execute([$ownerId]);}}
                $pdo->commit();
            }catch(Throwable $error){$pdo->rollBack();throw $error;}
            audit($pdo,$user,'delete','facility_photo',$photoId);ok(['id'=>$photoId]);
        }
        fail('Method not allowed.',405);
    }
    if ($path === 'locations') {
        if ($method === 'GET') {
            $q = $pdo->query('SELECT l.id,l.name,l.kind,l.description,l.building_number,l.floor_label,l.capacity,l.floor_count,l.category_id,l.parent_building_id,l.image_path,l.department_name,l.contact_email,l.contact_phone,l.website_url,l.service_hours,l.access_hours,l.days_open,l.lunch_break,l.services,l.nearby_landmarks,l.accessibility_status,l.accessibility_details,l.accessibility_features,l.active,l.created_at,l.updated_at,c.name AS category FROM locations l LEFT JOIN categories c ON c.id=l.category_id WHERE l.active=1 ORDER BY l.kind, l.name');
            $rows=$q->fetchAll();foreach($rows as &$row){$row['accessibility_features']=$row['kind']==='building'?(json_decode((string)($row['accessibility_features']??'[]'),true)?:[]):[];}unset($row);ok($rows);
        }
        if ($method === 'POST' || $method === 'PUT') {
            $recordId = $method === 'PUT' ? positive_id($body['id'] ?? $id) : null;
            $name = text_field($body, 'name', 150, true);
            $kind = (string)($body['kind'] ?? 'building');
            if (!in_array($kind, ['building', 'facility'], true)) fail('Invalid location kind.');
            $old=null;
            if($recordId){$oldq=$pdo->prepare('SELECT * FROM locations WHERE id=? AND active=1');$oldq->execute([$recordId]);$old=$oldq->fetch();if(!$old)fail('Location not found.',404);}
            $featureOptions=['wheelchair_entrance','elevator','ramp','accessible_restroom','accessible_parking','handrails','tactile_paving','braille_signage','hearing_assistance'];
            $rawFeatures=array_key_exists('accessibility_features',$body)?$body['accessibility_features']:($kind==='building'&&$old?json_decode((string)($old['accessibility_features']??'[]'),true):[]);
            if(!is_array($rawFeatures))fail('Building accessibility features must be a list.');
            foreach($rawFeatures as $feature){if(!is_string($feature)||!in_array($feature,$featureOptions,true))fail('Choose only supported building accessibility features.');}
            if($kind!=='building'&&$rawFeatures)fail('Accessibility features can only be assigned to buildings.');
            $accessibilityFeatures=$kind==='building'?array_values(array_unique($rawFeatures)):[];
            $accessibilityFeaturesJson=$accessibilityFeatures?json_encode($accessibilityFeatures,JSON_THROW_ON_ERROR):null;
            $categoryId = isset($body['category_id']) && $body['category_id'] !== '' ? positive_id($body['category_id']) : null;
            if ($categoryId) { $cq=$pdo->prepare('SELECT id FROM categories WHERE id=?');$cq->execute([$categoryId]);if(!$cq->fetchColumn())fail('Choose a valid campus category.'); }
            elseif (!empty($body['category'])) { $cq=$pdo->prepare('SELECT id FROM categories WHERE name=?');$cq->execute([$body['category']]);$categoryId=$cq->fetchColumn();if(!$categoryId)fail('Choose a valid campus category.'); }
            $parentId = isset($body['parent_building_id']) && $body['parent_building_id'] !== '' ? positive_id($body['parent_building_id']) : null;
            if ($parentId && $recordId && $parentId===$recordId) fail('A building cannot be its own parent.');
            if ($parentId) { $pq=$pdo->prepare("SELECT id FROM locations WHERE id=? AND kind='building' AND active=1");$pq->execute([$parentId]);if(!$pq->fetch())fail('Choose a valid parent building.'); }
            $floors = max(1, min(100, (int)($body['floor_count'] ?? 1))); $capacity=isset($body['capacity'])&&$body['capacity']!==''?max(0,(int)$body['capacity']):null;
            $email=text_field($body,'contact_email',254);if($email&&!filter_var($email,FILTER_VALIDATE_EMAIL))fail('Enter a valid contact email.');
            $website=text_field($body,'website_url',500);if($website&&(!filter_var($website,FILTER_VALIDATE_URL)||!preg_match('~^https?://~i',$website)))fail('Enter a valid HTTP or HTTPS website URL.');
            $accessibility=null;if(isset($body['accessibility_status'])&&$body['accessibility_status']!==''){$accessibility=filter_var($body['accessibility_status'],FILTER_VALIDATE_BOOLEAN,FILTER_NULL_ON_FAILURE);if($accessibility===null)fail('Choose valid accessibility information.');$accessibility=(int)$accessibility;}
            $image=uploaded_image_path($body);
            $fields = [$name, $kind, text_field($body, 'description', 4000), text_field($body, 'building_number', 40), text_field($body,'floor_label',80), $capacity, $floors, $categoryId, $parentId, $image,
                text_field($body,'department_name',160),$email,text_field($body,'contact_phone',40),$website,text_field($body,'service_hours',500),text_field($body,'access_hours',500),
                text_field($body,'days_open',160),text_field($body,'lunch_break',160),text_field($body,'services',4000),text_field($body,'nearby_landmarks',1000),$accessibility,text_field($body,'accessibility_details',1000),$accessibilityFeaturesJson];
            if ($recordId) {
                $q=$pdo->prepare('UPDATE locations SET name=?,kind=?,description=?,building_number=?,floor_label=?,capacity=?,floor_count=?,category_id=?,parent_building_id=?,image_path=?,department_name=?,contact_email=?,contact_phone=?,website_url=?,service_hours=?,access_hours=?,days_open=?,lunch_break=?,services=?,nearby_landmarks=?,accessibility_status=?,accessibility_details=?,accessibility_features=? WHERE id=?'); $q->execute([...$fields,$recordId]);
                audit($pdo,$user,'update','location',$recordId,$old,$fields); ok(['id'=>$recordId,'name'=>$name]);
            }
            $q=$pdo->prepare('INSERT INTO locations (name,kind,description,building_number,floor_label,capacity,floor_count,category_id,parent_building_id,image_path,department_name,contact_email,contact_phone,website_url,service_hours,access_hours,days_open,lunch_break,services,nearby_landmarks,accessibility_status,accessibility_details,accessibility_features) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'); $q->execute($fields); $newId=(int)$pdo->lastInsertId();
            if($image){$photo=$pdo->prepare('INSERT INTO facility_photos (location_id,image_path,alt_text,caption,is_cover) VALUES (?,?,?,?,1)');$photo->execute([$newId,$image,'Photo of '.$name,'Cover photo']);}
            audit($pdo,$user,'create','location',$newId,[],['name'=>$name,'kind'=>$kind]); ok(['id'=>$newId,'name'=>$name],201);
        }
        if ($method === 'DELETE') {
            $recordId=positive_id($body['id'] ?? $id); $q=$pdo->prepare('SELECT kind FROM locations WHERE id=? AND active=1'); $q->execute([$recordId]); $existing=$q->fetch(); if(!$existing)fail('Location not found.',404);
            if($existing['kind']==='building'){$q=$pdo->prepare('SELECT COUNT(*) FROM rooms WHERE building_id=? AND active=1');$q->execute([$recordId]);if((int)$q->fetchColumn())fail('Move or remove this building’s rooms before archiving the building.',409);}
            $q=$pdo->prepare('UPDATE locations SET active=0 WHERE id=?'); $q->execute([$recordId]); audit($pdo,$user,'archive','location',$recordId); ok(['id'=>$recordId]);
        }
    }
    if ($path === 'rooms') {
        if ($method === 'GET') ok($pdo->query('SELECT r.*, l.name AS building_name FROM rooms r JOIN locations l ON l.id=r.building_id WHERE r.active=1 ORDER BY l.name,r.floor_number,r.room_number')->fetchAll());
        if ($method === 'POST' || $method === 'PUT') {
            $recordId=$method==='PUT'?positive_id($body['id']??$id):null;
            $building=positive_id($body['building_id']??0); $name=text_field($body,'name',150,true); $number=text_field($body,'room_number',50,true);
            $buildingCheck=$pdo->prepare("SELECT id FROM locations WHERE id=? AND kind='building' AND active=1"); $buildingCheck->execute([$building]); if (!$buildingCheck->fetch()) fail('Select a valid campus building.');
            $floor=max(0,min(200,(int)($body['floor_number']??0))); $floorLabel=text_field($body,'floor_label',80); $capacity=isset($body['capacity'])&&$body['capacity']!==''?max(0,(int)$body['capacity']):null;
            $description=text_field($body,'description',4000); $fn=text_field($body,'function_description',1000); $head=text_field($body,'department_head',120);$contact=text_field($body,'contact_info',180);$category=isset($body['category_id'])&&$body['category_id']!==''?positive_id($body['category_id']):null; $image=uploaded_image_path($body);
            $email=text_field($body,'contact_email',254);if($email&&!filter_var($email,FILTER_VALIDATE_EMAIL))fail('Enter a valid contact email.');
            $website=text_field($body,'website_url',500);if($website&&(!filter_var($website,FILTER_VALIDATE_URL)||!preg_match('~^https?://~i',$website)))fail('Enter a valid HTTP or HTTPS website URL.');
            $accessibility=null;if(isset($body['accessibility_status'])&&$body['accessibility_status']!==''){$accessibility=filter_var($body['accessibility_status'],FILTER_VALIDATE_BOOLEAN,FILTER_NULL_ON_FAILURE);if($accessibility===null)fail('Choose valid accessibility information.');$accessibility=(int)$accessibility;}
            $detailFields=[$email,text_field($body,'contact_phone',40),$website,text_field($body,'department_name',160),text_field($body,'service_hours',500),text_field($body,'days_open',160),
                text_field($body,'lunch_break',160),text_field($body,'services',4000),text_field($body,'nearby_landmarks',1000),$accessibility,text_field($body,'accessibility_details',1000)];
            if ($category) { $cq=$pdo->prepare('SELECT id FROM categories WHERE id=?');$cq->execute([$category]);if(!$cq->fetchColumn())fail('Choose a valid campus category.'); }
            elseif (!empty($body['category'])) { $cq=$pdo->prepare('SELECT id FROM categories WHERE name=?');$cq->execute([$body['category']]);$category=$cq->fetchColumn();if(!$category)fail('Choose a valid campus category.'); }
            if ($recordId) { $q=$pdo->prepare('UPDATE rooms SET building_id=?,name=?,room_number=?,floor_number=?,floor_label=?,capacity=?,description=?,function_description=?,department_head=?,contact_info=?,category_id=?,image_path=?,contact_email=?,contact_phone=?,website_url=?,department_name=?,service_hours=?,days_open=?,lunch_break=?,services=?,nearby_landmarks=?,accessibility_status=?,accessibility_details=? WHERE id=? AND active=1'); $q->execute([$building,$name,$number,$floor,$floorLabel,$capacity,$description,$fn,$head,$contact,$category,$image,...$detailFields,$recordId]); if (!$q->rowCount()) { $c=$pdo->prepare('SELECT id FROM rooms WHERE id=? AND active=1');$c->execute([$recordId]);if(!$c->fetch())fail('Room not found.',404); } audit($pdo,$user,'update','room',$recordId); ok(['id'=>$recordId]); }
            $q=$pdo->prepare('INSERT INTO rooms (building_id,name,room_number,floor_number,floor_label,capacity,description,function_description,department_head,contact_info,category_id,image_path,contact_email,contact_phone,website_url,department_name,service_hours,days_open,lunch_break,services,nearby_landmarks,accessibility_status,accessibility_details) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'); $q->execute([$building,$name,$number,$floor,$floorLabel,$capacity,$description,$fn,$head,$contact,$category,$image,...$detailFields]);$newId=(int)$pdo->lastInsertId();if($image){$photo=$pdo->prepare('INSERT INTO facility_photos (room_id,image_path,alt_text,caption,is_cover) VALUES (?,?,?,?,1)');$photo->execute([$newId,$image,'Photo of '.$name,'Cover photo']);}audit($pdo,$user,'create','room',$newId);ok(['id'=>$newId],201);
        }
        if ($method==='DELETE') { $rid=positive_id($body['id']??$id);$q=$pdo->prepare('UPDATE rooms SET active=0 WHERE id=? AND active=1');$q->execute([$rid]);if(!$q->rowCount())fail('Room not found.',404);audit($pdo,$user,'archive','room',$rid);ok(['id'=>$rid]); }
    }
    if ($path === 'categories') {
        if (!in_array($user['role'], ['admin'], true)) fail('Administrator role is required.',403);
        if ($method==='POST') { $name=text_field($body,'name',80,true);$slug=strtolower(trim(preg_replace('/[^a-z0-9]+/i','-',$name),'-'));$q=$pdo->prepare('INSERT INTO categories (name,slug) VALUES (?,?)');$q->execute([$name,$slug]);$cid=(int)$pdo->lastInsertId();audit($pdo,$user,'create','category',$cid);ok(['id'=>$cid,'name'=>$name],201); }
        if ($method==='PUT') { $cid=positive_id($body['id']??$id);$name=text_field($body,'name',80,true);$slug=strtolower(trim(preg_replace('/[^a-z0-9]+/i','-',$name),'-'));$q=$pdo->prepare('UPDATE categories SET name=?,slug=? WHERE id=?');$q->execute([$name,$slug,$cid]);if(!$q->rowCount()){$c=$pdo->prepare('SELECT id FROM categories WHERE id=?');$c->execute([$cid]);if(!$c->fetch())fail('Category not found.',404);}audit($pdo,$user,'update','category',$cid);ok(['id'=>$cid,'name'=>$name]); }
        if ($method==='DELETE') { $cid=positive_id($body['id']??$id);$q=$pdo->prepare('SELECT (SELECT COUNT(*) FROM locations WHERE category_id=?)+(SELECT COUNT(*) FROM rooms WHERE category_id=?)');$q->execute([$cid,$cid]);if((int)$q->fetchColumn())fail('Category is assigned to campus records and cannot be deleted.',409);$q=$pdo->prepare('DELETE FROM categories WHERE id=?');$q->execute([$cid]);if(!$q->rowCount())fail('Category not found.',404);audit($pdo,$user,'delete','category',$cid);ok(['id'=>$cid]); }
        fail('Method not allowed.',405);
    }
    if ($path === 'announcements') {
        if ($method==='GET') ok($pdo->query('SELECT id,title,body AS details,status,featured AS pinned,publish_at,event_start,event_end,location_id,image_path AS photo,created_at AS createdAt FROM announcements ORDER BY created_at DESC')->fetchAll());
        if ($method==='POST' || $method==='PUT') { $rid=$method==='PUT'?positive_id($body['id']??$id):null;$title=text_field($body,'title',180,true);$details=text_field($body,'details',10000,true);$status=(string)($body['status']??'draft');if(!in_array($status,['draft','published','unpublished'],true))fail('Invalid announcement status.');$publish=$body['publish_at']??null;$start=$body['event_start']??null;$end=$body['event_end']??null;$location=isset($body['location_id'])&&$body['location_id']!==''?positive_id($body['location_id']):null;$featured=(int)(bool)($body['pinned']??false);$photo=uploaded_image_path($body);
            foreach(['publish_at'=>$publish,'event_start'=>$start,'event_end'=>$end] as $field=>$value){if($value!==null&&$value!==''&&!strtotime((string)$value))fail("{$field} is not a valid date and time.");}
            if($start&&$end&&strtotime((string)$end)<strtotime((string)$start))fail('The event end time must follow its start time.');
            if($location){$check=$pdo->prepare('SELECT id FROM locations WHERE id=? AND active=1');$check->execute([$location]);if(!$check->fetch())fail('Choose a valid campus location.');}
            if($rid){$q=$pdo->prepare('UPDATE announcements SET title=?,body=?,status=?,publish_at=?,event_start=?,event_end=?,location_id=?,featured=?,image_path=? WHERE id=?');$q->execute([$title,$details,$status,$publish,$start,$end,$location,$featured,$photo,$rid]);if(!$q->rowCount()){ $c=$pdo->prepare('SELECT id FROM announcements WHERE id=?');$c->execute([$rid]);if(!$c->fetch())fail('Announcement not found.',404); }audit($pdo,$user,'update','announcement',$rid);ok(['id'=>$rid]);}
            $q=$pdo->prepare('INSERT INTO announcements (title,body,status,publish_at,event_start,event_end,location_id,featured,image_path,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)');$q->execute([$title,$details,$status,$publish,$start,$end,$location,$featured,$photo,$user['id']]);$aid=(int)$pdo->lastInsertId();audit($pdo,$user,'create','announcement',$aid);ok(['id'=>$aid],201);
        }
        if($method==='DELETE'){$rid=positive_id($body['id']??$id);$q=$pdo->prepare('DELETE FROM announcements WHERE id=?');$q->execute([$rid]);if(!$q->rowCount())fail('Announcement not found.',404);audit($pdo,$user,'delete','announcement',$rid);ok(['id'=>$rid]);}
    }
    if ($path === 'map/markers' && in_array($method,['POST','PUT','DELETE'],true)) {
        $rid=$body['id']??$id;
        if($method==='DELETE'){
            $rid=positive_id($rid);
            $q=$pdo->prepare('SELECT COUNT(*) FROM campus_routes WHERE status=\'active\' AND (start_marker_id=? OR destination_marker_id=? OR landmark_marker_id=?)');$q->execute([$rid,$rid,$rid]);
            if((int)$q->fetchColumn()>0)fail('This marker is used by an active route. Edit or deactivate those routes first.',409);
            $q=$pdo->prepare('UPDATE map_markers SET active=0 WHERE id=?');$q->execute([$rid]);if(!$q->rowCount())fail('Marker not found.',404);
            audit($pdo,$user,'archive','map_marker',$rid);ok(['id'=>$rid]);
        }
        $location=positive_id($body['location_id']??0);$x=filter_var($body['x']??null,FILTER_VALIDATE_FLOAT);$y=filter_var($body['y']??null,FILTER_VALIDATE_FLOAT);if($x===false||$y===false||$x<0||$x>1330||$y<0||$y>1620)fail('Marker coordinates are outside the campus map bounds.');
        $q=$pdo->prepare('SELECT id FROM locations WHERE id=? AND active=1');$q->execute([$location]);if(!$q->fetch())fail('Marker location does not exist.');$floor=max(0,(int)($body['floor_number']??0));$key=text_field($body,'map_key',40)??'campus';
        $routeNode=isset($body['route_node_id'])&&$body['route_node_id']!==''?positive_id($body['route_node_id']):null;
        if($routeNode){$q=$pdo->prepare('SELECT id FROM map_nodes WHERE id=? AND active=1');$q->execute([$routeNode]);if(!$q->fetch())fail('Route node does not exist.');}
        $accessibility=isset($body['accessibility_status'])&&$body['accessibility_status']!==''?(int)$body['accessibility_status']:null;if($accessibility!==null&&!in_array($accessibility,[0,1],true))fail('Invalid marker accessibility status.');
        if($method==='PUT'){$rid=positive_id($rid);$q=$pdo->prepare('UPDATE map_markers SET location_id=?,route_node_id=?,x=?,y=?,floor_number=?,map_key=?,accessibility_status=?,active=1 WHERE id=?');$q->execute([$location,$routeNode,$x,$y,$floor,$key,$accessibility,$rid]);audit($pdo,$user,'update','map_marker',$rid);ok(['id'=>$rid]);}
        $pdo->beginTransaction();
        try {
            $existingMarker=$pdo->prepare('SELECT id FROM map_markers WHERE location_id=? AND map_key=? AND floor_number=? AND active=1 ORDER BY id LIMIT 1 FOR UPDATE');
            $existingMarker->execute([$location,$key,$floor]);$mid=(int)($existingMarker->fetchColumn()?:0);$wasExisting=$mid>0;
            if($wasExisting){$pdo->prepare('UPDATE map_markers SET route_node_id=COALESCE(?,route_node_id),x=?,y=?,accessibility_status=? WHERE id=?')->execute([$routeNode,$x,$y,$accessibility,$mid]);}
            else{$q=$pdo->prepare('INSERT INTO map_markers (location_id,route_node_id,x,y,floor_number,map_key,accessibility_status) VALUES (?,?,?,?,?,?,?)');$q->execute([$location,$routeNode,$x,$y,$floor,$key,$accessibility]);$mid=(int)$pdo->lastInsertId();}
            $existingDraft=$pdo->prepare('SELECT id,status FROM campus_routes WHERE landmark_marker_id=?');$existingDraft->execute([$mid]);$draftRow=$existingDraft->fetch();
            if($draftRow){$routeId=(int)$draftRow['id'];$draftStatus=(string)$draftRow['status'];}
            else{$draft=$pdo->prepare("INSERT INTO campus_routes (name,start_marker_id,destination_marker_id,landmark_marker_id,status,created_by) SELECT CONCAT('Draft: ',LEFT(name,112)),?,?,?,'incomplete',? FROM locations WHERE id=?");$draft->execute([$mid,$mid,$mid,$user['id'],$location]);$routeId=(int)$pdo->lastInsertId();$draftStatus='incomplete';}
            audit($pdo,$user,$wasExisting?'update':'create','map_marker',$mid);if(!$draftRow)audit($pdo,$user,'create','campus_route',$routeId,[],['status'=>$draftStatus,'landmark_marker_id'=>$mid]);
            $pdo->commit();ok(['id'=>$mid,'draft_route_id'=>$routeId,'draft_status'=>$draftStatus,'existing_marker'=>$wasExisting],$wasExisting?200:201);
        } catch(Throwable $e) { if($pdo->inTransaction())$pdo->rollBack(); throw $e; }
    }
    if ($path === 'map/nodes' && in_array($method,['POST','PUT','DELETE'],true)) {
        if($method==='DELETE'){
            $rid=positive_id($body['id']??$id);
            $pdo->beginTransaction();
            try {
                $q=$pdo->prepare('SELECT COUNT(DISTINCT r.id) FROM campus_routes r LEFT JOIN campus_route_points p ON p.route_id=r.id LEFT JOIN campus_route_segments s ON s.route_id=r.id LEFT JOIN map_connections c ON c.id=s.connection_id WHERE r.status=\'active\' AND (p.node_id=? OR c.from_node_id=? OR c.to_node_id=?)');$q->execute([$rid,$rid,$rid]);
                if((int)$q->fetchColumn()>0){$pdo->rollBack();fail('This node is used by an active route. Edit or deactivate those routes first.',409);}
                $q=$pdo->prepare('UPDATE map_connections SET active=0 WHERE active=1 AND (from_node_id=? OR to_node_id=?)');$q->execute([$rid,$rid]);
                $q=$pdo->prepare('UPDATE map_nodes SET active=0 WHERE id=? AND active=1');$q->execute([$rid]);
                if(!$q->rowCount()){$pdo->rollBack();fail('Walkway node not found.',404);}
                audit($pdo,$user,'archive','map_node',$rid);
                $pdo->commit();
                ok(['id'=>$rid,'connections_archived'=>true]);
            } catch(Throwable $error) {
                if($pdo->inTransaction())$pdo->rollBack();
                throw $error;
            }
        }
        $key=text_field($body,'node_key',80,true);$x=filter_var($body['x']??null,FILTER_VALIDATE_FLOAT);$y=filter_var($body['y']??null,FILTER_VALIDATE_FLOAT);if($x===false||$y===false||$x<0||$x>1330||$y<0||$y>1620)fail('Node coordinates are outside the campus map bounds.');$floor=max(0,(int)($body['floor_number']??0));
        if($method==='PUT'){$rid=positive_id($body['id']??$id);$q=$pdo->prepare('UPDATE map_nodes SET node_key=?,x=?,y=?,floor_number=? WHERE id=?');$q->execute([$key,$x,$y,$floor,$rid]);audit($pdo,$user,'update','map_node',$rid);ok(['id'=>$rid]);}
        $q=$pdo->prepare('INSERT INTO map_nodes (node_key,x,y,floor_number) VALUES (?,?,?,?)');$q->execute([$key,$x,$y,$floor]);$mid=(int)$pdo->lastInsertId();audit($pdo,$user,'create','map_node',$mid);ok(['id'=>$mid],201);
    }
    if ($path === 'map/connections' && in_array($method,['POST','PUT','DELETE'],true)) {
        if($method==='DELETE'){
            $rid=positive_id($body['id']??$id);
            $q=$pdo->prepare('SELECT COUNT(*) FROM campus_route_segments WHERE connection_id=?');$q->execute([$rid]);
            if((int)$q->fetchColumn()>0)fail('This connection is still referenced by a saved route. Edit or remove those routes first.',409);
            $q=$pdo->prepare('UPDATE map_connections SET active=0 WHERE id=?');$q->execute([$rid]);if(!$q->rowCount())fail('Connection not found.',404);
            audit($pdo,$user,'archive','map_connection',$rid);ok(['id'=>$rid]);
        }
        $from=positive_id($body['from_node_id']??0);
        $to=positive_id($body['to_node_id']??0);
        $weight=filter_var($body['weight']??null,FILTER_VALIDATE_FLOAT);
        if($from===$to||$weight===false||!is_finite((float)$weight)||(float)$weight<=0)fail('Connections need two different nodes and a positive distance.');
        $type=isset($body['connection_type'])?(string)$body['connection_type']:null;
        if($type!==null&&!in_array($type,['walkway','stairs','ramp','elevator'],true))fail('Invalid connection type.');
        $verified=null;
        if(array_key_exists('verified',$body)){
            if(!in_array($body['verified'],[0,1,'0','1',false,true],true))fail('Invalid connection verification status.');
            $verified=(int)$body['verified'];
        }
        $accessible=null;
        if(array_key_exists('accessible',$body)&&$body['accessible']!==null&&$body['accessible']!==''){
            $accessible=filter_var($body['accessible'],FILTER_VALIDATE_BOOLEAN,FILTER_NULL_ON_FAILURE);
            if($accessible===null)fail('Invalid accessibility status.');
            $accessible=(int)$accessible;
        }
        $low=min($from,$to);$high=max($from,$to);
        $q=$pdo->prepare('SELECT id,floor_number FROM map_nodes WHERE id IN (?,?) AND active=1');$q->execute([$low,$high]);$nodes=$q->fetchAll();
        if(count($nodes)!==2)fail('Both connection nodes must exist.');
        $differentFloors=(int)$nodes[0]['floor_number']!==(int)$nodes[1]['floor_number'];
        $rid=null;$existing=null;
        if($method==='PUT'){
            $rid=positive_id($body['id']??$id);
            $q=$pdo->prepare('SELECT from_node_id,to_node_id,connection_type,verified FROM map_connections WHERE id=?');$q->execute([$rid]);$existing=$q->fetch();
            if(!$existing)fail('Connection not found.',404);
        }
        $effectiveType=$type??($existing['connection_type']??'walkway');
        if($differentFloors&&!in_array($effectiveType,['stairs','ramp','elevator'],true))fail('Floor changes require a stairs, ramp, or elevator connection.');
        if($verified===1&&(($body['confirm_walkway']??false)!==true))fail('Confirm that this connection follows the selected campus path before verifying it.');
        $duplicateSql='SELECT id FROM map_connections WHERE ((from_node_id=? AND to_node_id=?) OR (from_node_id=? AND to_node_id=?))';
        $duplicateParams=[$low,$high,$high,$low];
        if($method==='PUT'){$duplicateSql.=' AND id<>?';$duplicateParams[]=$rid;}
        $duplicate=$pdo->prepare($duplicateSql.' LIMIT 1');$duplicate->execute($duplicateParams);
        if($duplicate->fetchColumn())fail('A connection between these nodes already exists.',409);
        if($method==='PUT'){
            $changed=(int)$existing['from_node_id']!==$low||(int)$existing['to_node_id']!==$high||$effectiveType!==$existing['connection_type'];
            $endpointsChanged=(int)$existing['from_node_id']!==$low||(int)$existing['to_node_id']!==$high;
            $q=$pdo->prepare('SELECT COUNT(*) FROM campus_route_segments WHERE connection_id=?');$q->execute([$rid]);$routeReferences=(int)$q->fetchColumn();
            if($routeReferences>0&&$endpointsChanged)fail('This connection belongs to a saved route. Edit the route before changing its endpoints.',409);
            $persistedVerification=$verified??($changed?0:(int)$existing['verified']);
            $q=$pdo->prepare('UPDATE map_connections SET from_node_id=?,to_node_id=?,weight=?,connection_type=?,verified=?,accessibility_status=? WHERE id=?');
            $q->execute([$low,$high,$weight,$effectiveType,$persistedVerification,$accessible,$rid]);
            if($routeReferences>0){
                $routeState=$pdo->prepare('UPDATE campus_routes SET distance_map_units=NULL,accessibility_status=NULL,status=IF(?,\'incomplete\',status) WHERE id IN (SELECT route_id FROM campus_route_segments WHERE connection_id=?)');
                $routeState->execute([$persistedVerification===0?1:0,$rid]);
            }
            audit($pdo,$user,'update','map_connection',$rid);ok(['id'=>$rid]);
        }
        $q=$pdo->prepare('INSERT INTO map_connections (from_node_id,to_node_id,weight,connection_type,verified,accessibility_status) VALUES (?,?,?,?,?,?)');
        $q->execute([$low,$high,$weight,$effectiveType,$verified??0,$accessible]);$eid=(int)$pdo->lastInsertId();
        audit($pdo,$user,'create','map_connection',$eid);ok(['id'=>$eid],201);
    }
    if (str_starts_with($path,'admin/')) fail('Administrator endpoint not found.',404);
    if (in_array($path,['locations','rooms','categories','announcements','routes','map/markers','map/nodes','map/connections'],true)) fail('Method not allowed.',405);
    fail('API resource not found.',404);
} catch (PDOException $e) {
    error_log('LCUP API database error: ' . $e->getMessage());
    if ($e->getCode() === '23000') fail('The change conflicts with an existing record or relationship.', 409);
    fail('The database request could not be completed. Check the database connection and record constraints.', 503);
} catch (Throwable $e) {
    error_log('LCUP API error: ' . $e->getMessage());
    fail('The request could not be completed.', 500);
}
