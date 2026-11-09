<?php
declare(strict_types=1);

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\SMTP;

function admin_mail_config(): array
{
    $host = app_env('SMTP_HOST') ?: '';
    $port = filter_var(app_env('SMTP_PORT'), FILTER_VALIDATE_INT);
    $username = app_env('SMTP_USERNAME') ?: '';
    $password = app_env('SMTP_PASSWORD') ?: '';
    $secure = strtolower(app_env('SMTP_SECURE') ?: 'false');
    $from = app_env('LCUP_MAIL_FROM') ?: '';
    $appUrl = rtrim(app_env('APP_URL') ?: '', '/');

    if ($host === '' || !$port || $username === '' || $password === '' ||
        str_contains(strtolower($username . $password), 'your_brevo') ||
        !in_array($secure, ['false', '0', 'starttls'], true)) {
        throw new RuntimeException('Brevo SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_SECURE, and LCUP_MAIL_FROM in the server .env file.');
    }

    $fromName = 'NaviGATE';
    $fromEmail = $from;
    if (preg_match('/^(.+?)\s*<([^<>]+)>$/', $from, $matches)) {
        $fromName = trim($matches[1], " \t\n\r\0\x0B\"'");
        $fromEmail = trim($matches[2]);
    }
    if (!filter_var($fromEmail, FILTER_VALIDATE_EMAIL) || str_contains(strtolower($fromEmail), 'your-verified-sender')) {
        throw new RuntimeException('Set LCUP_MAIL_FROM to an email address verified in Brevo.');
    }
    if (!filter_var($appUrl, FILTER_VALIDATE_URL) || !in_array(strtolower((string)parse_url($appUrl, PHP_URL_SCHEME)), ['http', 'https'], true)) {
        throw new RuntimeException('Set APP_URL to the public base URL of the NaviGATE application.');
    }
    if ((app_env('LCUP_ENV') ?: 'development') !== 'development' && strtolower((string)parse_url($appUrl, PHP_URL_SCHEME)) !== 'https') {
        throw new RuntimeException('Production APP_URL must use HTTPS.');
    }
    if ($secure !== 'false' && $secure !== '0' && $secure !== 'starttls') {
        throw new RuntimeException('SMTP_SECURE must be false to use STARTTLS on port 587.');
    }

    return compact('host', 'port', 'username', 'password', 'fromName', 'fromEmail', 'appUrl');
}

function admin_mailer(): PHPMailer
{
    $config = admin_mail_config();
    $mailer = new PHPMailer(true);
    $mailer->isSMTP();
    $mailer->Host = $config['host'];
    $mailer->Port = $config['port'];
    $mailer->SMTPAuth = true;
    $mailer->Username = $config['username'];
    $mailer->Password = $config['password'];
    $mailer->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
    $mailer->Timeout = 12;
    $mailer->SMTPDebug = SMTP::DEBUG_OFF;
    $mailer->CharSet = PHPMailer::CHARSET_UTF8;
    $mailer->setFrom($config['fromEmail'], $config['fromName']);
    return $mailer;
}

function admin_email_template(string $heading, string $message, string $buttonLabel, string $url, string $code = ''): string
{
    $escape = static fn(string $value): string => htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $codeBlock = $code === '' ? '' : '<p style="margin:24px 0 8px;color:#526174">Or enter this verification code:</p><p style="margin:0;color:#153a72;font-size:28px;font-weight:700;letter-spacing:8px">' . $escape($code) . '</p>';
    return '<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,sans-serif;color:#172b45">'
        . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">'
        . '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:14px;overflow:hidden">'
        . '<tr><td style="padding:24px 30px;background:#154c91;color:#fff;font-size:22px;font-weight:700">NaviGATE <span style="font-size:13px;font-weight:400">LCUP</span></td></tr>'
        . '<tr><td style="padding:30px"><h1 style="margin:0 0 14px;font-size:22px">' . $escape($heading) . '</h1>'
        . '<p style="margin:0;color:#526174;line-height:1.6">' . $escape($message) . '</p>'
        . '<p style="margin:26px 0"><a href="' . $escape($url) . '" style="display:inline-block;padding:13px 20px;border-radius:8px;background:#1859a9;color:#fff;font-weight:700;text-decoration:none">' . $escape($buttonLabel) . '</a></p>'
        . $codeBlock
        . '<p style="margin:24px 0 0;color:#718096;font-size:13px;line-height:1.6">This request expires in 10 minutes. If you did not request it, ignore this email and contact your system administrator if you are concerned about account security.</p>'
        . '</td></tr></table></td></tr></table></body></html>';
}

function send_admin_mail(string $to, string $subject, string $html, string $plain): void
{
    try {
        $mailer = admin_mailer();
        $mailer->addAddress($to);
        $mailer->isHTML(true);
        $mailer->Subject = $subject;
        $mailer->Body = $html;
        $mailer->AltBody = $plain;
        $mailer->send();
    } catch (Throwable $error) {
        error_log('NaviGATE email delivery failed: ' . get_class($error));
        if ($error instanceof RuntimeException && str_contains($error->getMessage(), 'not configured')) throw $error;
        throw new RuntimeException('Email delivery failed. Check Brevo SMTP settings, sender verification, and outbound port 587.', 0, $error);
    }
}

function send_admin_auth_code(string $email, string $code, string $purpose, string $challengeToken): void
{
    $config = admin_mail_config();
    $signup = $purpose === 'signup';
    $url = $config['appUrl'] . '/pages/admin/login.html#' . ($signup ? 'verify=' : 'reset=') . rawurlencode($challengeToken);
    $subject = $signup ? 'Verify your NaviGATE administrator email' : 'Reset your NaviGATE administrator password';
    $heading = $signup ? 'Verify your email address' : 'Reset your administrator password';
    $message = $signup
        ? 'Welcome to NaviGATE. Verify this email address to submit your administrator account for approval.'
        : 'A password reset was requested for your NaviGATE administrator account. Use the secure link or code below to continue.';
    $label = $signup ? 'Verify email address' : 'Reset password';
    $plain = $message . "\n\n" . $label . ': ' . $url . ($code === '' ? '' : "\n\nVerification code: " . $code) . "\nThis request expires in 10 minutes.";
    send_admin_mail($email, $subject, admin_email_template($heading, $message, $label, $url, $code), $plain);
}

function send_admin_auth_code_or_fail(string $email, string $code, string $purpose, string $challengeToken): void
{
    try {
        send_admin_auth_code($email, $code, $purpose, $challengeToken);
    } catch (Throwable $error) {
        error_log('NaviGATE authentication email could not be sent: ' . get_class($error));
        fail('Email delivery is unavailable. Configure Brevo SMTP and a verified sender in the server .env file, then try again.', 503);
    }
}

function send_admin_password_reset_email(string $email, string $token): void
{
    send_admin_auth_code($email, '', 'password_reset', $token);
}

function send_admin_notification(string $email, string $subject, string $message): void
{
    $config = admin_mail_config();
    $html = admin_email_template('Account security notice', $message, 'Open NaviGATE', $config['appUrl'] . '/pages/admin/login.html');
    send_admin_mail($email, $subject, $html, $message . "\n\nIf you did not make this change, contact your system administrator.");
}

function verify_admin_smtp_connection(): void
{
    try {
        $mailer = admin_mailer();
        if (!$mailer->smtpConnect()) throw new RuntimeException('SMTP server did not accept the connection.');
        $mailer->smtpClose();
    } catch (Throwable $error) {
        error_log('NaviGATE SMTP connection test failed: ' . get_class($error));
        throw new RuntimeException('Brevo SMTP connection or authentication failed. Check the SMTP login, SMTP key, STARTTLS settings, and outbound port 587.');
    }
}
