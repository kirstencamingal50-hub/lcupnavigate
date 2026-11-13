(() => {
  const isLogin = location.pathname.endsWith('/login.html');
  const loginPath = 'login.html';
  let challengeToken = '';
  let challengeMode = '';
  let recoveryAccessToken = '';
  let resendTimer = null;

  async function check() {
    try {
      const state = await window.CampusApi.get('auth/me');
      if (isLogin) {
        const emailAction = new URLSearchParams(location.hash.slice(1));
        const openingEmailAction = location.hash.startsWith('#verify=') ||
          location.hash.startsWith('#reset=') ||
          (emailAction.has('access_token') && ['signup', 'recovery'].includes(emailAction.get('type')));
        if (state.user && !openingEmailAction) {
          location.replace('dashboard.html');
          return false;
        }
        return true;
      }
      if (!state.user) { location.replace(loginPath); return false; }
      document.body.dataset.adminRole = state.user.role;
      document.querySelectorAll('[data-admin-name]').forEach(node => node.textContent = state.user.full_name || state.user.username);
      return true;
    } catch {
      if (!isLogin) { location.replace(loginPath); return false; }
      return true;
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!isLogin) {
      await check();
      return;
    }
    const statusFor = id => document.getElementById(id);
    const loginForm = statusFor('login-form');
    const signupForm = statusFor('signup-form');
    const recoveryForm = statusFor('recovery-form');
    const authViews = statusFor('auth-views');
    const otpScreen = statusFor('otp-screen');
    const otpForm = statusFor('otp-form');
    const otpInputs = [...document.querySelectorAll('.admin-otp-inputs input')];
    const heading = statusFor('auth-heading');
    const description = statusFor('auth-description');
    const googleArea = statusFor('google-auth-area');
    const googleUnavailable = statusFor('google-unavailable');
    const divider = document.querySelector('.admin-auth-divider');
    const approvalNote = document.querySelector('.admin-auth-approval-note');
    const loginStatus = statusFor('login-status');

    async function checkSetupResponse(response) {
      let result;
      try { result = await response.json(); }
      catch { throw new Error('The administrator setup service returned an invalid response.'); }
      if (!response.ok || !result.ok) throw new Error(result.error?.message || `Setup failed (${response.status}).`);
      return result.data;
    }

    const setupButton = statusFor('show-admin-setup');
    const setupForm = statusFor('admin-setup-form');
    const setupStatus = statusFor('admin-setup-status');
    if (setupButton && setupForm && setupStatus) {
      try {
        const state = await checkSetupResponse(await fetch('../../api/admin-setup.php', { credentials: 'same-origin' }));
        setupButton.hidden = !state.available;
      } catch (error) {
        setupStatus.textContent = error.message;
      }
      setupButton.addEventListener('click', () => {
        setupForm.hidden = !setupForm.hidden;
        setupButton.setAttribute('aria-expanded', String(!setupForm.hidden));
        if (!setupForm.hidden) setupForm.elements.full_name.focus();
      });
      setupForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!setupForm.reportValidity()) return;
        const data = new FormData(setupForm);
        if (data.get('password') !== data.get('confirm_password')) {
          setupStatus.textContent = 'The passwords do not match.';
          return;
        }
        const button = setupForm.querySelector('[type="submit"]');
        button.disabled = true;
        setupStatus.textContent = 'Creating administrator account…';
        try {
          const csrf = await window.CampusApi.get('auth/csrf');
          await checkSetupResponse(await fetch('../../api/admin-setup.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.token },
            body: JSON.stringify(Object.fromEntries(data))
          }));
          await window.CampusApi.request('auth/login', {
            method: 'POST',
            body: { username: data.get('email'), password: data.get('password') }
          });
          setupStatus.textContent = 'Administrator account created. Opening the admin dashboard…';
          location.replace('dashboard.html');
        } catch (error) {
          setupStatus.textContent = error.message;
          button.disabled = false;
        }
      });
    }

    document.querySelectorAll('[data-password-toggle]').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const input = toggle.parentElement.querySelector('input');
        if (!input) return;
        const showing = input.type === 'password';
        input.type = showing ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', String(showing));
        toggle.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
        const icon = toggle.querySelector('.material-symbols-rounded');
        if (icon) icon.textContent = showing ? 'visibility_off' : 'visibility';
      });
    });

    function setAuthView(view) {
      const isRecovery = view === 'recovery';
      if (!isRecovery) {
        document.querySelectorAll('.admin-auth-tabs [role="tab"]').forEach(tab => {
          const active = tab.dataset.authView === view;
          tab.classList.toggle('is-active', active);
          tab.setAttribute('aria-selected', String(active));
        });
      }
      loginForm.hidden = view !== 'login';
      signupForm.hidden = view !== 'signup';
      recoveryForm.hidden = !isRecovery;
      document.querySelector('.admin-auth-tabs').hidden = isRecovery;
      divider.hidden = isRecovery;
      googleArea.hidden = isRecovery || googleArea.dataset.configured !== 'true';
      googleUnavailable.hidden = isRecovery || googleUnavailable.dataset.configured === 'true';
      approvalNote.hidden = isRecovery;
      if (view === 'signup') {
        heading.textContent = 'Create your account';
        description.textContent = 'Verify your email to request administrator access.';
        document.getElementById('signup-username').focus();
      } else if (isRecovery) {
        heading.textContent = 'Reset your password';
        description.textContent = 'We’ll send a verification code to your administrator email.';
        document.getElementById('recovery-email').focus();
      } else {
        heading.textContent = 'Welcome back';
        description.textContent = 'Sign in to manage campus information and administrator accounts.';
      }
    }

    document.querySelectorAll('[data-auth-view]').forEach(button => {
      button.addEventListener('click', () => {
        setAuthView(button.dataset.authView);
      });
    });
    document.querySelector('[data-show-recovery]').addEventListener('click', () => setAuthView('recovery'));

    function startResendCountdown(seconds) {
      const button = statusFor('resend-code');
      if (resendTimer) clearInterval(resendTimer);
      let remaining = Math.max(0, Number(seconds) || 0);
      const update = () => {
        button.disabled = remaining > 0;
        button.textContent = remaining > 0 ? `Resend code in ${remaining}s` : 'Resend Code';
        if (remaining > 0) remaining--;
        else clearInterval(resendTimer);
      };
      update();
      if (remaining > 0) resendTimer = setInterval(update, 1000);
    }

    function showOtp(mode, email, result) {
      challengeToken = result.challenge_token;
      challengeMode = mode;
      authViews.hidden = true;
      otpScreen.hidden = false;
      heading.textContent = 'Verify your email';
      description.textContent = '';
      statusFor('otp-description').textContent = mode === 'recovery'
        ? `If an active account matches ${email}, a six-digit code has been sent. The code expires in 10 minutes.`
        : `Enter the six-digit code sent to ${email}. The code expires in 10 minutes.`;
      statusFor('otp-status').textContent = '';
      statusFor('reset-password-label').hidden = mode !== 'recovery';
      statusFor('reset-password-field').hidden = mode !== 'recovery';
      statusFor('reset-password-confirm-label').hidden = mode !== 'recovery';
      statusFor('reset-password-confirm').hidden = mode !== 'recovery';
      statusFor('reset-password-hint').hidden = mode !== 'recovery';
      statusFor('reset-password').required = mode === 'recovery';
      statusFor('reset-password-confirm').required = mode === 'recovery';
      statusFor('auth-otp-fields').hidden = false;
      otpInputs.forEach(input => { input.required = true; });
      resendButton.hidden = false;
      otpForm.querySelector('[type="submit"]').textContent = mode === 'recovery' ? 'Reset password' : 'Verify';
      otpInputs.forEach(input => { input.value = ''; });
      startResendCountdown(result.resend_after);
      otpInputs[0].focus();
    }

    function showLoginWithMessage(message) {
      otpScreen.hidden = true;
      authViews.hidden = false;
      setAuthView('login');
      loginStatus.textContent = message;
      document.getElementById('username').focus();
    }

    otpInputs.forEach((input, index) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(-1);
        if (input.value && otpInputs[index + 1]) otpInputs[index + 1].focus();
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Backspace' && !input.value && otpInputs[index - 1]) otpInputs[index - 1].focus();
      });
      input.addEventListener('paste', event => {
        const pasted = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6);
        if (!pasted) return;
        event.preventDefault();
        [...pasted].forEach((digit, digitIndex) => { if (otpInputs[digitIndex]) otpInputs[digitIndex].value = digit; });
        otpInputs[Math.min(pasted.length, otpInputs.length) - 1].focus();
      });
    });

    const resendButton = statusFor('resend-code');
    resendButton.addEventListener('click', async () => {
      resendButton.disabled = true;
      statusFor('otp-status').textContent = 'Sending a new code…';
      try {
        const result = await window.CampusApi.request('auth/resend-code', {
          method: 'POST',
          body: { challenge_token: challengeToken, email: challengeToken, purpose: challengeMode }
        });
        statusFor('otp-status').textContent = challengeMode === 'recovery'
          ? 'If an active account matches that email, a new code has been sent.'
          : 'A new code has been sent.';
        startResendCountdown(result.resend_after);
      } catch (error) {
        statusFor('otp-status').textContent = error.message;
        startResendCountdown(15);
      }
    });
    document.querySelector('[data-auth-back]').addEventListener('click', () => {
      if (resendTimer) clearInterval(resendTimer);
      showLoginWithMessage('');
    });

    signupForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!signupForm.reportValidity()) return;
      if (signupForm.elements.password.value !== signupForm.elements.confirm_password.value) {
        statusFor('signup-status').textContent = 'The passwords do not match.';
        signupForm.elements.confirm_password.focus();
        return;
      }
      const button = signupForm.querySelector('[type="submit"]');
      button.disabled = true;
      statusFor('signup-status').textContent = 'Sending your verification code…';
      try {
        const result = await window.CampusApi.request('auth/register', {
          method: 'POST',
          body: Object.fromEntries(new FormData(signupForm))
        });
        if (result.email_confirmation_required === false) {
          statusFor('signup-status').textContent = 'Your account was created and is pending administrator approval.';
          signupForm.reset();
        } else {
          showOtp('signup', signupForm.elements.email.value.trim(), result);
        }
      } catch (error) {
        statusFor('signup-status').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    recoveryForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!recoveryForm.reportValidity()) return;
      const button = recoveryForm.querySelector('[type="submit"]');
      button.disabled = true;
      statusFor('recovery-status').textContent = 'Requesting a recovery code…';
      try {
        const result = await window.CampusApi.request('auth/recover', {
          method: 'POST',
          body: { email: recoveryForm.elements.email.value.trim() }
        });
        showOtp('recovery', recoveryForm.elements.email.value.trim(), result);
      } catch (error) {
        statusFor('recovery-status').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    otpForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!otpForm.reportValidity()) return;
      if ((challengeMode === 'recovery' || challengeMode === 'reset-link') &&
          statusFor('reset-password').value !== statusFor('reset-password-confirm').value) {
        statusFor('otp-status').textContent = 'The passwords do not match.';
        statusFor('reset-password-confirm').focus();
        return;
      }
      const code = otpInputs.map(input => input.value).join('');
      const button = otpForm.querySelector('[type="submit"]');
      button.disabled = true;
      statusFor('otp-status').textContent = challengeMode === 'recovery' || challengeMode === 'reset-link'
        ? 'Verifying and updating your password…'
        : 'Verifying your email…';
      try {
        const result = challengeMode === 'reset-link'
          ? await window.CampusApi.request('auth/reset-link', {
              method: 'POST',
              body: {
                challenge_token: challengeToken,
                access_token: recoveryAccessToken || undefined,
                password: statusFor('reset-password').value
              }
            })
          : await window.CampusApi.request('auth/verify-code', {
              method: 'POST',
              body: {
                challenge_token: challengeToken,
                email: challengeToken,
                purpose: challengeMode,
                code,
                ...(challengeMode === 'recovery' ? { password: statusFor('reset-password').value } : {})
              }
            });
        if (challengeMode === 'recovery' || challengeMode === 'reset-link') {
          if (resendTimer) clearInterval(resendTimer);
          showLoginWithMessage(result.notification_sent === false
            ? 'Your password has been reset. The security notification email could not be sent; contact your system administrator if you did not make this change.'
            : 'Your password has been reset. You can now sign in.');
        } else {
          button.disabled = true;
          button.textContent = 'Email verified';
          resendButton.disabled = true;
          if (resendTimer) clearInterval(resendTimer);
          statusFor('otp-status').textContent = result.pending_approval
            ? 'Email verified. Your account is pending administrator approval before access is enabled.'
            : 'Email verified.';
        }
      } catch (error) {
        statusFor('otp-status').textContent = error.message;
        button.disabled = false;
      }
    });

    for (const [form, field] of [[loginForm, 'username'], [loginForm, 'password']]) {
      if (!form.elements[field]) throw new Error(`Missing login field: ${field}`);
    }
    if (!await check()) return;
    const emailLink = new URLSearchParams(location.hash.slice(1));
    const verifyToken = emailLink.get('verify');
    const resetToken = emailLink.get('reset');
    const accessToken = emailLink.get('access_token');
    const linkType = emailLink.get('type');
    const verifyAccessToken = accessToken && linkType === 'signup' ? accessToken : '';
    const resetAccessToken = accessToken && linkType === 'recovery' ? accessToken : '';
    if (verifyToken || resetToken || verifyAccessToken || resetAccessToken) {
      history.replaceState(null, '', location.pathname + location.search);
      authViews.hidden = true;
      otpScreen.hidden = false;
      statusFor('otp-description').textContent = '';
      statusFor('otp-status').textContent = '';
      if (verifyToken || verifyAccessToken) {
        heading.textContent = 'Verify your email';
        statusFor('otp-heading').textContent = 'Verifying your email';
        statusFor('auth-otp-fields').hidden = true;
        otpInputs.forEach(input => { input.required = false; });
        statusFor('reset-password-label').hidden = true;
        statusFor('reset-password-field').hidden = true;
        statusFor('reset-password-confirm-label').hidden = true;
        statusFor('reset-password-confirm').hidden = true;
        statusFor('reset-password-hint').hidden = true;
        resendButton.hidden = true;
        statusFor('otp-status').textContent = 'Verifying your email…';
        try {
          const result = await window.CampusApi.request('auth/verify-link', {
            method: 'POST',
            body: {
              challenge_token: verifyToken,
              access_token: verifyAccessToken || undefined
            }
          });
          showLoginWithMessage(result.pending_approval
            ? 'Email verified. Your account is pending administrator approval before access is enabled.'
            : 'Email verified. You can now sign in.');
        } catch (error) {
          statusFor('otp-status').textContent = error.message;
          statusFor('otp-heading').textContent = 'Email verification';
        }
        return;
      }
      challengeToken = resetToken || '';
      recoveryAccessToken = resetAccessToken;
      challengeMode = 'reset-link';
      statusFor('otp-heading').textContent = 'Choose a new password';
      statusFor('otp-description').textContent = 'Enter and confirm a new password for your administrator account.';
      statusFor('auth-otp-fields').hidden = true;
      otpInputs.forEach(input => { input.required = false; });
      statusFor('reset-password-label').hidden = false;
      statusFor('reset-password-field').hidden = false;
      statusFor('reset-password-confirm-label').hidden = false;
      statusFor('reset-password-confirm').hidden = false;
      statusFor('reset-password-hint').hidden = false;
      statusFor('reset-password').required = true;
      statusFor('reset-password-confirm').required = true;
      statusFor('otp-form').querySelector('[type="submit"]').textContent = 'Reset password';
      resendButton.hidden = true;
      statusFor('reset-password').focus();
      return;
    }
    try {
      const accountState = await window.CampusApi.get('auth/login-status');
      if (!accountState.configured) {
        loginStatus.textContent = 'No active administrator account is configured. Ask the authorized system administrator to create the first administrator account.';
        loginForm.querySelectorAll('input, button[type="submit"]').forEach(control => { control.disabled = true; });
      }
    } catch (error) {
      loginStatus.textContent = error.message;
      loginForm.querySelectorAll('input, button[type="submit"]').forEach(control => { control.disabled = true; });
    }
    loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!loginForm.reportValidity()) return;
      const button = loginForm.querySelector('[type="submit"]');
      button.disabled = true;
      loginStatus.textContent = 'Signing in…';
      try {
        const user = await window.CampusApi.request('auth/login', {
          method: 'POST',
          body: { username: loginForm.elements.username.value.trim(), password: loginForm.elements.password.value }
        });
        if (!user.user) throw new Error('Sign-in did not return an administrator session.');
        location.replace('dashboard.html');
      } catch (error) {
        loginStatus.textContent = error.message;
        button.disabled = false;
      }
    });

    try {
      const config = await window.CampusApi.get('auth/google-config');
      if (!config.client_id) {
        googleUnavailable.hidden = false;
        googleUnavailable.dataset.configured = 'false';
        return;
      }
      googleArea.dataset.configured = 'true';
      googleArea.hidden = false;
      googleUnavailable.dataset.configured = 'true';
      googleUnavailable.hidden = true;
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        window.google.accounts.id.initialize({
          client_id: config.client_id,
          nonce: config.nonce,
          callback: async response => {
            const googleStatus = statusFor('google-status');
            googleStatus.textContent = 'Verifying your Google account…';
            try {
              const result = await window.CampusApi.request('auth/google', { method: 'POST', body: { credential: response.credential } });
              if (result.user) location.replace('dashboard.html');
              else if (result.pending_approval) googleStatus.textContent = 'Your email is verified. Your account is pending administrator approval before access is enabled.';
            } catch (error) {
              googleStatus.textContent = error.message;
            }
          },
          auto_select: false
        });
        window.google.accounts.id.renderButton(statusFor('google-button'), {
          type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', width: Math.min(360, googleArea.clientWidth || 320)
        });
      };
      script.onerror = () => {
        statusFor('google-status').textContent = 'Google sign-in could not be loaded. Use email and password instead.';
      };
      document.head.appendChild(script);
    } catch (error) {
      googleUnavailable.hidden = false;
      googleUnavailable.dataset.configured = 'false';
      googleUnavailable.textContent = `Google sign-in could not be configured: ${error.message}`;
    }
  });

  document.addEventListener('click', async event => {
    if (!event.target.closest('[data-admin-logout]')) return;
    event.preventDefault();
    try { await window.CampusApi.request('auth/logout', { method: 'POST', body: {} }); }
    finally { location.replace(loginPath); }
  });
})();
