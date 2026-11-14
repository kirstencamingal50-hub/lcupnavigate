
import { currentUser, bearerToken } from './_shared/authorization.mjs';
import { HttpError, errorResponse, requestBody, requiredText, optionalText, requireMethod, success, unwrap } from './_shared/http.mjs';
import { getPublicClient, getServiceClient, publicSupabaseConfig } from './_shared/supabase.mjs';
import { mutateResource } from './_shared/mutations.mjs';
import { deleteFloorplan, facilityPhotos, mediaHandler, mediaUrl, uploadMetadata } from './_shared/media.mjs';

const adminDatabase = () => getServiceClient();

function authRedirectUrl(path = '/pages/admin/login.html') {
  const appUrl = process.env.APP_URL;
  if (!appUrl) throw new HttpError(503, 'Set APP_URL to the deployed HTTPS site URL before using administrator email flows.');
  return new URL(path, `${appUrl.replace(/\/+$/, '')}/`).toString();
}

function publicProfile(profile) {
  return {
    id: profile.legacy_admin_id ?? profile.id,
    full_name: profile.full_name,
    username: profile.username,
    email: profile.email,
    role: profile.role,
    active: profile.active,
    created_at: profile.created_at
  };
}

function normalizeAnnouncement(row) {
  return {
    id: row.id,
    title: row.title,
    details: row.body,
    status: row.status,
    pinned: row.featured,
    publish_at: row.publish_at,
    event_start: row.event_start,
    event_end: row.event_end,
    location_id: row.location_id,
    photo: row.image_path ? mediaUrl(row.image_path) : null,
    createdAt: row.created_at,
    location: row.location?.name || null
  };
}

async function getDirectory() {
  const db = adminDatabase();

  const [locationResult, roomResult, photoResult, planResult] = await Promise.all([
    db.from('locations')
      .select(`\n        *,\n        category:categories(name)\n      `)
      .eq('active', true)
      .order('kind')
      .order('name'),

    db.from('rooms')
      .select('*, building:locations!rooms_building_id_fkey(name,active), category:categories(name)')
      .eq('active', true)
      .order('floor_number')
      .order('room_number'),

    db.from('facility_photos')
      .select('id,location_id,room_id,image_path,alt_text,caption,sort_order,is_cover')
      .order('sort_order')
      .order('id'),

    db.from('floor_plans')
      .select('id,building_id,floor_number,original_name,mime_type,file_size,verified,stored_name')
      .order('building_id')
      .order('floor_number')
  ]);

  const locations = unwrap(locationResult) || [];
  const roomRows = unwrap(roomResult) || [];
  const photos = unwrap(photoResult) || [];
  const plans = unwrap(planResult) || [];

  const locationPhotos = new Map();
  const roomPhotos = new Map();

  for (const photo of photos) {
    const key = String(photo.location_id ?? photo.room_id);
    const target = photo.location_id === null ? roomPhotos : locationPhotos;

    target.set(key, [...(target.get(key) || []), {
      id: photo.id,
      locationId: photo.location_id,
      roomId: photo.room_id,
      image: mediaUrl(photo.image_path),
      altText: photo.alt_text,
      caption: photo.caption,
      sortOrder: photo.sort_order,
      isCover: photo.is_cover
    }]);
  }

  const locationRows = locations.map(row => ({
    ...row,
    image_path: row.image_path ? mediaUrl(row.image_path) : null,
    image: row.image_path ? mediaUrl(row.image_path) : null,
    category: row.category?.name || null,
    parent_building_name: row.parent_building?.name || null,
    parentBuilding: row.parent_building || null,
    accessibilityFeatures: row.kind === 'building' && Array.isArray(row.accessibility_features)
      ? row.accessibility_features
      : [],
    photos: locationPhotos.get(String(row.id)) || []
  }));

  const activeBuildingIds = new Set(
    locations
      .filter(row => row.kind === 'building')
      .map(row => String(row.id))
  );

  const rooms = roomRows
    .filter(row => row.building?.active)
    .map(row => ({
      ...row,
      buildingId: row.building_id,
      floorNumber: row.floor_number,
      building_name: row.building?.name || null,
      buildingName: row.building?.name || null,
      category: row.category?.name || null,
      image_path: row.image_path ? mediaUrl(row.image_path) : null,
      image: row.image_path ? mediaUrl(row.image_path) : null,
      photos: roomPhotos.get(String(row.id)) || []
    }));

  return {
    locations: locationRows,
    rooms,
    floorPlans: plans
      .filter(plan =>
        plan.verified &&
        activeBuildingIds.has(String(plan.building_id))
      )
      .map(plan => ({
        id: plan.id,
        building_id: plan.building_id,
        floor_number: plan.floor_number,
        original_name: plan.original_name,
        mime_type: plan.mime_type,
        file_size: plan.file_size,
        verified: plan.verified,
        file_url: mediaUrl(`floor-plans/${plan.stored_name}`)
      }))
  };
}

async function getMap(admin = false) {
  const db = adminDatabase();

  const [markerResult, nodeResult, connectionResult] = await Promise.all([
    db.from('map_markers')
      .select(`
        id,
        location_id,
        route_node_id,
        x,
        y,
        floor_number,
        map_key,
        accessibility_status,
        active,
        verified,
        location:locations!map_markers_location_id_fkey(
          name,
          kind,
          description,
          active,
          category:categories(name)
        )
      `)
      .eq('active', true)
      .order('id'),

    db.from('map_nodes')
      .select('id,node_key,x,y,floor_number,active,verified')
      .eq('active', true)
      .order('id'),

    db.from('map_connections')
      .select(`
        id,
        from_node_id,
        to_node_id,
        weight,
        connection_type,
        verified,
        accessibility_status,
        active,
        from_node:map_nodes!map_connections_from_node_id_fkey(floor_number),
        to_node:map_nodes!map_connections_to_node_id_fkey(floor_number)
      `)
      .eq('active', true)
      .order('id')
  ]);

  const markers = unwrap(markerResult) || [];
  const nodes = unwrap(nodeResult) || [];
  const rawConnections = unwrap(connectionResult) || [];

  const connections = rawConnections.map(edge => {
    const fromFloor = edge.from_node?.floor_number;
    const toFloor = edge.to_node?.floor_number;

    const sameFloor =
      fromFloor !== undefined &&
      toFloor !== undefined &&
      Number(fromFloor) === Number(toFloor);

    const isVerticalConnection = [
      'stairs',
      'ramp',
      'elevator'
    ].includes(String(edge.connection_type || '').toLowerCase());

    const isValidFloorTransition =
      sameFloor || isVerticalConnection;

    const accessibleConfirmed =
      edge.verified === true &&
      edge.accessibility_status === true &&
      isValidFloorTransition;

    return {
      ...edge,
      isValidFloorTransition,
      accessible_confirmed: accessibleConfirmed,
      accessibility_value: edge.accessibility_status
    };
  });

  return {
    markers: markers
      .filter(marker => marker.location?.active)
      .map(marker => ({
        id: marker.id,
        location_id: marker.location_id,
        route_node_id: marker.route_node_id,
        name: marker.location?.name,
        kind: marker.location?.kind,
        description: marker.location?.description,
        category: marker.location?.category?.name || null,
        x: marker.x,
        y: marker.y,
        floor_number: marker.floor_number,
        map_key: marker.map_key,
        accessibility_value: marker.accessibility_status
      })),

    nodes,

    connections: connections
      .filter(edge => admin || (edge.isValidFloorTransition && edge.verified))
      .map(edge => ({
        ...edge,
        accessible_confirmed: edge.accessible_confirmed,
        accessibility_value: edge.accessibility_status
      }))
  };
}

async function getRoutes(availableOnly) {
  const db = adminDatabase();

  let query = db.from('campus_routes')
    .select('*, start_marker:map_markers!campus_routes_start_marker_id_fkey(id,location_id,x,y,location:locations(name,active)), destination_marker:map_markers!campus_routes_destination_marker_id_fkey(id,location_id,x,y,location:locations(name,active))')
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false });

  if (availableOnly) query = query.eq('status', 'active');

  const routes = unwrap(await query) || [];

  const pointsResult = unwrap(await db.from('campus_route_points')
    .select('route_id,sequence_no,point_type,notes,node:map_nodes(id,node_key,x,y,floor_number)')
    .order('sequence_no')) || [];

  return routes.filter(route => {
    if (!availableOnly) return true;

    return route.start_marker?.location?.active &&
      route.destination_marker?.location?.active;
  }).map(route => {
    const points = pointsResult.filter(
      point => String(point.route_id) === String(route.id)
    );

    return {
      ...route,
      start_location_id: route.start_marker?.location_id,
      start_name: route.start_marker?.location?.name,
      destination_location_id: route.destination_marker?.location_id,
      destination_name: route.destination_marker?.location?.name,
      start_x: route.start_marker?.x,
      start_y: route.start_marker?.y,
      destination_x: route.destination_marker?.x,
      destination_y: route.destination_marker?.y,
      points: points.map(point => ({
        sequence_no: point.sequence_no,
        point_type: point.point_type,
        notes: point.notes,
        node_id: point.node?.id,
        node_key: point.node?.node_key,
        x: point.node?.x,
        y: point.node?.y,
        floor_number: point.node?.floor_number
      }))
    };
  });
}

async function authResource(event, resource, method, body) {
  const auth = getPublicClient().auth;
  const db = adminDatabase();

  if (resource === 'auth/entry') {
    if (method === 'GET') {
      const user = await currentUser(event, false);
      return success({ role: user?.role === 'admin' ? 'admin' : null });
    }

    requireMethod(event, ['POST']);

    if (body.role !== 'visitor') {
      throw new HttpError(400, 'Invalid entry role.');
    }

    return success({ role: 'visitor' });
  }

  if (resource === 'auth/csrf' && method === 'GET') {
    return success({ token: null });
  }

  if (resource === 'auth/login-status' && method === 'GET') {
    const result = await db.from('admin_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('active', true);

    if (result.error) throw result.error;

    return success({ configured: (result.count || 0) > 0 });
  }

  if (resource === 'auth/refresh' && method === 'POST') {
    const refreshToken = requiredText(body.refresh_token, 'Refresh token', 4096);
    const { data, error } = await auth.refreshSession({
      refresh_token: refreshToken
    });

    if (error || !data.session) {
      throw new HttpError(401, 'Your sign-in has expired. Sign in again.');
    }

    return success({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at
    });
  }

  if (resource === 'admin/bootstrap') {
    if (method === 'GET') {
      const setupSecret = process.env.INITIAL_ADMIN_SETUP_KEY || '';

      const admins = await db.from('admin_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('active', true);

      if (admins.error) throw admins.error;

      const state = unwrap(await db.from('admin_setup_state')
        .select('completed_at')
        .eq('id', true)
        .single());

      return success({
        available: setupSecret.length >= 32 &&
          !state.completed_at &&
          (admins.count || 0) === 0
      });
    }

    requireMethod(event, ['POST']);

    const setupSecret = process.env.INITIAL_ADMIN_SETUP_KEY || '';
    const providedSecret = typeof body.setup_key === 'string'
      ? body.setup_key
      : '';

    const { timingSafeEqual } = await import('node:crypto');

    const expected = Buffer.from(setupSecret);
    const supplied = Buffer.from(providedSecret);

    if (
      expected.length < 32 ||
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    ) {
      throw new HttpError(
        403,
        'The administrator setup secret is incorrect or unavailable.'
      );
    }

    const email = requiredText(body.email, 'Email', 254).toLowerCase();
    const username = requiredText(body.username, 'Username', 80);
    const fullName = requiredText(body.full_name, 'Name', 160);
    const password = requiredText(body.password, 'Password', 1024);

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^[A-Za-z0-9_.-]{3,80}$/.test(username)
    ) {
      throw new HttpError(400, 'Enter a valid email address and username.');
    }

    if (
      password.length < 12 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password) ||
      !/[^A-Za-z0-9]/.test(password)
    ) {
      throw new HttpError(
        400,
        'Password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.'
      );
    }

    const created = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        full_name: fullName
      }
    });

    if (created.error) {
      if (/already registered|already been registered/i.test(created.error.message)) {
        throw new HttpError(409, 'That email address is already registered.');
      }

      throw created.error;
    }

    const promoted = unwrap(await db.rpc('bootstrap_first_admin', {
      p_user_id: created.data.user.id
    }));

    if (!promoted) {
      const cleanup = await db.auth.admin.deleteUser(created.data.user.id);

      if (cleanup.error) {
        console.error(
          'Unused first-admin account cleanup failed:',
          cleanup.error.code || cleanup.error.name
        );
      }

      throw new HttpError(409, 'Administrator setup has already been completed.');
    }

    return success({ created: true }, 201);
  }

  if (resource === 'auth/me' && method === 'GET') {
    const user = await currentUser(event, false);
    return success({ user, csrf: null });
  }

  if (resource === 'auth/login' && method === 'POST') {
    const username = requiredText(body.username, 'Username or email', 254);
    const password = requiredText(body.password, 'Password', 1024);

    let email = username;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
      const profile = unwrap(await db.from('admin_profiles')
        .select('email')
        .eq('username', username)
        .maybeSingle());

      if (!profile?.email) {
        throw new HttpError(401, 'Invalid username/email or password.');
      }

      email = profile.email;
    }

    const { data, error } = await auth.signInWithPassword({
      email,
      password
    });

    if (error || !data.user || !data.session) {
      throw new HttpError(401, 'Invalid username/email or password.');
    }

    const profile = unwrap(await db.from('admin_profiles')
      .select('id,legacy_admin_id,full_name,username,email,role,active,created_at')
      .eq('id', data.user.id)
      .maybeSingle());

    if (!profile || !profile.active) {
      throw new HttpError(
        403,
        'This administrator account is awaiting approval or has been disabled.'
      );
    }

    return success({
      user: publicProfile(profile),
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at
    });
  }

  if (resource === 'auth/logout' && method === 'POST') {
    await currentUser(event, true);
    const token = bearerToken(event);
    const { error } = await db.auth.admin.signOut(token, 'local');
    if (error) {
      throw new HttpError(503, 'Your session could not be revoked. Please try again.');
    }
    return success({ logged_out: true });
  }

  if (resource === 'auth/register' && method === 'POST') {
    const email = requiredText(body.email, 'Email', 254).toLowerCase();
    const password = requiredText(body.password, 'Password', 1024);
    const username = requiredText(body.username, 'Username', 80);
    const fullName = optionalText(body.full_name, 'Name', 160);

    if (!/^[A-Za-z0-9_.-]{3,80}$/.test(username)) {
      throw new HttpError(
        400,
        'Username must be 3–80 characters using letters, numbers, dots, underscores, or hyphens.'
      );
    }

    if (
      password.length < 12 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password) ||
      !/[^A-Za-z0-9]/.test(password)
    ) {
      throw new HttpError(
        400,
        'Password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.'
      );
    }

    const { data, error } = await auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          ...(fullName ? { full_name: fullName } : {})
        },
        emailRedirectTo: authRedirectUrl()
      }
    });

    if (error) {
      if (
        error.status === 422 ||
        /already registered|already been registered/i.test(error.message)
      ) {
        throw new HttpError(409, 'That email address is already registered.');
      }

      throw new HttpError(400, error.message);
    }

    return success({
      challenge_token: email,
      resend_after: 60,
      pending_approval: true,
      email_confirmation_required: !data.session,
      message: 'Check your email to confirm the address. An administrator must approve your account before access is enabled.'
    }, 201);
  }

  if (resource === 'auth/resend-code' && method === 'POST') {
    const email = requiredText(
      body.email ?? body.challenge_token,
      'Email',
      254
    ).toLowerCase();

    const purpose = body.purpose === 'recovery' ? 'recovery' : 'signup';

    const result = purpose === 'recovery'
      ? await auth.resetPasswordForEmail(email, {
          redirectTo: authRedirectUrl()
        })
      : await auth.resend({
          type: 'signup',
          email
        });

    if (result.error) {
      throw new HttpError(503, 'A new verification email could not be sent.');
    }

    return success({ resend_after: 60 });
  }

  if (resource === 'auth/verify-code' && method === 'POST') {
    const email = requiredText(
      body.email ?? body.challenge_token,
      'Email',
      254
    ).toLowerCase();

    const token = requiredText(body.code, 'Verification code', 10);
    const purpose = body.purpose === 'recovery' ? 'recovery' : 'signup';

    const { data, error } = await auth.verifyOtp({
      email,
      token,
      type: purpose === 'recovery' ? 'recovery' : 'signup'
    });

    if (error || !data.user) {
      throw new HttpError(400, 'The verification code is invalid or has expired.');
    }

    if (purpose === 'recovery') {
      const password = requiredText(body.password, 'Password', 1024);

      if (
        password.length < 12 ||
        !/[A-Z]/.test(password) ||
        !/[a-z]/.test(password) ||
        !/[0-9]/.test(password) ||
        !/[^A-Za-z0-9]/.test(password)
      ) {
        throw new HttpError(
          400,
          'Password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.'
        );
      }

      const updated = await db.auth.admin.updateUserById(
        data.user.id,
        { password }
      );

      if (updated.error) throw updated.error;

      return success({ password_reset: true });
    }

    return success({ pending_approval: true });
  }

  if (resource === 'auth/verify-link' && method === 'POST') {
    const accessToken = requiredText(
      body.access_token,
      'Verification token',
      4096
    );

    const { data, error } = await getPublicClient().auth.getUser(accessToken);

    if (error || !data.user) {
      throw new HttpError(
        400,
        'This email verification link is invalid or has expired.'
      );
    }

    return success({ pending_approval: true });
  }

  if (resource === 'auth/reset-link' && method === 'POST') {
    const accessToken = requiredText(
      body.access_token,
      'Recovery token',
      4096
    );

    const password = requiredText(body.password, 'Password', 1024);

    if (
      password.length < 12 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password) ||
      !/[^A-Za-z0-9]/.test(password)
    ) {
      throw new HttpError(
        400,
        'Password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.'
      );
    }

    const { data, error } = await getPublicClient().auth.getUser(accessToken);

    if (error || !data.user) {
      throw new HttpError(
        400,
        'This password recovery link is invalid or has expired.'
      );
    }

    const updated = await db.auth.admin.updateUserById(
      data.user.id,
      { password }
    );

    if (updated.error) throw updated.error;

    return success({ password_reset: true });
  }

  if (resource === 'auth/recover' && method === 'POST') {
    const email = requiredText(body.email, 'Email', 254).toLowerCase();

    const { error } = await auth.resetPasswordForEmail(email, {
      redirectTo: authRedirectUrl()
    });

    if (error) {
      throw new HttpError(503, 'Password recovery is temporarily unavailable.');
    }

    return success({
      challenge_token: email,
      resend_after: 60,
      message: 'If an active account matches that email, a recovery code and link have been sent.'
    });
  }

  if (resource === 'auth/google-config' && method === 'GET') {
    return success({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      configured: Boolean(process.env.GOOGLE_CLIENT_ID)
    });
  }

  if (resource === 'auth/google' && method === 'POST') {
    const credential = requiredText(
      body.credential,
      'Google credential',
      8192
    );

    const { data, error } = await auth.signInWithIdToken({
      provider: 'google',
      token: credential
    });

    if (error || !data.user || !data.session) {
      throw new HttpError(401, 'Google sign-in could not be verified.');
    }

    const profile = unwrap(await db.from('admin_profiles')
      .select('id,legacy_admin_id,full_name,username,email,role,active,created_at')
      .eq('id', data.user.id)
      .maybeSingle());

    if (!profile || !profile.active) {
      return success({ pending_approval: true, registered: true });
    }

    return success({
      user: publicProfile(profile),
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at
    });
  }

  if (resource === 'auth/profile' && method === 'GET') {
    const user = await currentUser(event, true);

    const profile = unwrap(await db.from('admin_profiles')
      .select('id,full_name,username,email,role')
      .eq('id', user.auth_id)
      .single());

    return success(profile);
  }

  if (resource === 'auth/profile' && method === 'PUT') {
    const user = await currentUser(event, true);

    const fullName = requiredText(body.full_name, 'Name', 160);
    const username = requiredText(body.username, 'Username', 80);
    const email = requiredText(body.email, 'Email', 254).toLowerCase();

    if (!/^[A-Za-z0-9_.-]{3,80}$/.test(username)) {
      throw new HttpError(400, 'Username is invalid.');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, 'Enter a valid email address.');
    }

    const changedEmail = email !== user.email;

    const usernameOwner = unwrap(await db.from('admin_profiles')
      .select('id')
      .eq('username', username)
      .neq('id', user.auth_id)
      .maybeSingle());

    if (usernameOwner) {
      throw new HttpError(409, 'That username is already in use.');
    }

    if (changedEmail) {
      const { error } = await db.auth.admin.updateUserById(
        user.auth_id,
        { email }
      );

      if (error) {
        if (
          error.status === 422 ||
          /already.*(registered|use)|duplicate/i.test(error.message)
        ) {
          throw new HttpError(409, 'That email address is already in use.');
        }

        throw new HttpError(
          503,
          'A confirmation email for the new address could not be sent.'
        );
      }
    }

    const profileUpdate = await db.from('admin_profiles')
      .update({
        full_name: fullName,
        username
      })
      .eq('id', user.auth_id)
      .select('id')
      .single();

    if (profileUpdate.error?.code === '23505') {
      throw new HttpError(409, 'That username is already in use.');
    }

    unwrap(profileUpdate);

    unwrap(await db.from('audit_logs').insert({
      admin_legacy_id: Number.isSafeInteger(Number(user.id))
        ? Number(user.id)
        : null,
      action: 'update',
      entity_type: 'admin_profile',
      entity_id: Number.isSafeInteger(Number(user.id))
        ? Number(user.id)
        : null
    }));

    return success({
      id: user.id,
      full_name: fullName,
      username,
      email,
      role: user.role,
      email_change_pending: changedEmail
    });
  }

  if (resource === 'auth/password' && method === 'POST') {
    const user = await currentUser(event, true);

    const currentPassword = requiredText(
      body.current_password,
      'Current password',
      1024
    );

    const password = requiredText(body.password, 'Password', 1024);

    if (
      password.length < 12 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password) ||
      !/[^A-Za-z0-9]/.test(password)
    ) {
      throw new HttpError(
        400,
        'Password must be at least 12 characters and include uppercase, lowercase, a number, and a symbol.'
      );
    }

    const { error: verifyError } = await getPublicClient().auth.signInWithPassword({
      email: user.email,
      password: currentPassword
    });

    if (verifyError) {
      throw new HttpError(403, 'Current password is incorrect.');
    }

    const { error } = await db.auth.admin.updateUserById(
      user.auth_id,
      { password }
    );

    if (error) throw error;

    unwrap(await db.from('audit_logs').insert({
      admin_legacy_id: Number.isSafeInteger(Number(user.id))
        ? Number(user.id)
        : null,
      action: 'change_password',
      entity_type: 'admin_account',
      entity_id: Number.isSafeInteger(Number(user.id))
        ? Number(user.id)
        : null
    }));

    return success({ changed: true });
  }

  throw new HttpError(404, 'Authentication endpoint not found.');
}

async function publicResource(event, resource, method, query) {
  requireMethod(event, ['GET']);

  const db = adminDatabase();

  if (resource === 'categories') {
    return success(
      unwrap(await db.from('categories')
        .select('id,name,slug')
        .order('sort_order')
        .order('name')) || []
    );
  }

  if (resource === 'directory') {
    return success(await getDirectory());
  }

  if (resource === 'map') {
    return success(await getMap(false));
  }

  if (resource === 'routes/available') {
    return success(await getRoutes(true));
  }

  if (resource === 'routes') {
    await currentUser(event, true, 'viewer');
    return success(await getRoutes(false));
  }

  if (resource === 'announcements') {
    const isAdmin = query.admin === '1';

    if (isAdmin) {
      await currentUser(event, true, 'editor');
    }

    let request = db.from('announcements')
      .select('id,title,body,status,featured,publish_at,event_start,event_end,location_id,image_path,created_at,location:locations(name)')
      .order('created_at', { ascending: false });

    if (!isAdmin) {
      request = request
        .eq('status', 'published')
        .or(`publish_at.is.null,publish_at.lte.${new Date().toISOString()}`);
    }

    return success(
      (unwrap(await request) || []).map(normalizeAnnouncement)
    );
  }

  if (resource === 'floorplans') {
    const isAdmin = Boolean(bearerToken(event));

    if (isAdmin) {
      await currentUser(event, true, 'viewer');
    }

    let request = db.from('floor_plans')
      .select('id,building_id,floor_number,original_name,mime_type,file_size,created_at,verified,stored_name,building:locations!floor_plans_building_id_fkey(active)')
      .order('building_id')
      .order('floor_number');

    if (!isAdmin) {
      request = request.eq('verified', true);
    }

    return success(
      (unwrap(await request) || [])
        .filter(plan => isAdmin || plan.building?.active)
        .map(plan => ({
          ...plan,
          file_url: mediaUrl(`floor-plans/${plan.stored_name}`)
        }))
    );
  }

  if (resource === 'locations') {
    const user = await currentUser(event, false, 'viewer');

    let request = db.from('locations')
      .select('*')
      .order('name');

    if (!user) {
      request = request.eq('active', true);
    }

    return success(
      (unwrap(await request) || []).map(row => ({
        ...row,
        image_path: row.image_path ? mediaUrl(row.image_path) : null
      }))
    );
  }

  if (resource === 'rooms') {
    const user = await currentUser(event, false, 'viewer');

    let request = db.from('rooms')
      .select('*, building:locations!rooms_building_id_fkey(name,active)')
      .order('floor_number')
      .order('room_number');

    if (!user) {
      request = request.eq('active', true);
    }

    return success(
      (unwrap(await request) || [])
        .filter(row => user || row.building?.active)
        .map(row => ({
          ...row,
          image_path: row.image_path ? mediaUrl(row.image_path) : null,
          building_name: row.building?.name || null
        }))
    );
  }

  if (resource === 'map/admin') {
    await currentUser(event, true, 'viewer');
    return success(await getMap(true));
  }

  throw new HttpError(404, 'API resource not found.');
}

export const handler = async event => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': process.env.APP_URL || '',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      },
      body: ''
    };
  }

  try {
    const query = event.queryStringParameters || {};

    const resource = String(query.resource || '')
      .replace(/^\/+|\/+$/g, '');

    if (resource === 'media') {
      if (event.httpMethod !== 'GET') {
        throw new HttpError(405, 'Method not allowed.');
      }

      return await mediaHandler(event);
    }

    if (resource === 'client-config' && event.httpMethod === 'GET') {
      return success(publicSupabaseConfig());
    }

    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(event.httpMethod)
      ? requestBody(event)
      : {};

    if (resource.startsWith('auth/') || resource === 'admin/bootstrap') {
      return await authResource(
        event,
        resource,
        event.httpMethod,
        body
      );
    }

    if (resource === 'uploads' && event.httpMethod === 'POST') {
      return await uploadMetadata(event, body);
    }

    if (resource === 'facility-photos') {
      return await facilityPhotos(
        event,
        event.httpMethod,
        body,
        query
      );
    }

    if (resource === 'floorplans' && event.httpMethod === 'DELETE') {
      return await deleteFloorplan(event, body, query);
    }

    if (event.httpMethod !== 'GET' || resource.startsWith('admin/')) {
      return await mutateResource(
        event,
        resource,
        event.httpMethod,
        body,
        query
      );
    }

    return await publicResource(
      event,
      resource,
      event.httpMethod,
      query
    );
  } catch (error) {
    return errorResponse(error);
  }
};
