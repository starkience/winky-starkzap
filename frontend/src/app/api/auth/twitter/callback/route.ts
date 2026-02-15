/**
 * GET /api/auth/twitter/callback
 *
 * Handles the OAuth 2.0 callback from Twitter.
 * Exchanges the authorization code for an access token,
 * fetches the user's profile, and redirects back to the app
 * with the profile data stored in a cookie.
 */

import { NextRequest, NextResponse } from 'next/server';

const TWITTER_CLIENT_ID = (process.env.TWITTER_CLIENT_ID || '').trim();
const TWITTER_CLIENT_SECRET = (process.env.TWITTER_CLIENT_SECRET || '').trim();

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://wink-on-starknet.com').trim();
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  const appUrl = getAppUrl();

  // Handle denied/error
  if (error) {
    console.error('[Twitter Callback] OAuth error:', error);
    return NextResponse.redirect(`${appUrl}?twitter_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}?twitter_error=missing_params`);
  }

  // Retrieve code_verifier and CSRF token from cookies
  const codeVerifier = request.cookies.get('twitter_code_verifier')?.value;
  const storedCsrf = request.cookies.get('twitter_csrf')?.value;

  if (!codeVerifier) {
    return NextResponse.redirect(`${appUrl}?twitter_error=session_expired`);
  }

  // Validate CSRF
  try {
    const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    if (storedCsrf && stateData.csrf !== storedCsrf) {
      return NextResponse.redirect(`${appUrl}?twitter_error=csrf_mismatch`);
    }
  } catch {
    return NextResponse.redirect(`${appUrl}?twitter_error=invalid_state`);
  }

  // Decode wallet from state
  let wallet = '';
  try {
    const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    wallet = stateData.wallet || '';
  } catch {
    // wallet stays empty
  }

  const redirectUri = `${appUrl}/api/auth/twitter/callback`;

  // Exchange code for access token
  const basicAuth = Buffer.from(`${TWITTER_CLIENT_ID}:${TWITTER_CLIENT_SECRET}`).toString('base64');

  let accessToken: string;
  try {
    const tokenResponse = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      console.error('[Twitter Callback] Token exchange failed:', errBody);
      return NextResponse.redirect(`${appUrl}?twitter_error=token_exchange_failed`);
    }

    const tokenData = await tokenResponse.json();
    accessToken = tokenData.access_token;
  } catch (err) {
    console.error('[Twitter Callback] Token exchange error:', err);
    return NextResponse.redirect(`${appUrl}?twitter_error=token_exchange_error`);
  }

  // Fetch user profile
  try {
    const profileResponse = await fetch(
      'https://api.twitter.com/2/users/me?user.fields=profile_image_url,username,name',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!profileResponse.ok) {
      const errBody = await profileResponse.text();
      console.error('[Twitter Callback] Profile fetch failed:', errBody);
      return NextResponse.redirect(`${appUrl}?twitter_error=profile_fetch_failed`);
    }

    const profileData = await profileResponse.json();
    const user = profileData.data;

    console.log('[Twitter Callback] User profile:', JSON.stringify(user));

    // Use the profile image as-is from Twitter (don't transform the URL)
    // For a larger version, remove the _normal suffix to get the original
    const rawImageUrl: string = user.profile_image_url || '';
    const profileImageUrl = rawImageUrl.replace('_normal', '');

    // Build the twitter profile object
    const twitterProfile = {
      id: user.id,
      username: user.username,
      name: user.name,
      profileImageUrl,
      wallet,
    };

    // Persist wallet→twitter mapping in Edge Config so other users see it
    if (wallet) {
      const normalizedWallet = wallet.replace(/^0x0*/i, '0x').toLowerCase();
      const ecId = (process.env.EDGE_CONFIG_ID || '').trim();
      const ecToken = (process.env.VERCEL_API_TOKEN || '').trim();
      const teamId = (process.env.VERCEL_TEAM_ID || '').trim();

      if (ecId && ecToken) {
        const key = `tw_${normalizedWallet.replace('0x', '')}`;
        const teamParam = teamId ? `?teamId=${teamId}` : '';
        try {
          const ecRes = await fetch(
            `https://api.vercel.com/v1/edge-config/${ecId}/items${teamParam}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${ecToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                items: [{ operation: 'upsert', key, value: { username: user.username, name: user.name, profileImageUrl } }],
              }),
            },
          );
          if (ecRes.ok) {
            console.log('[Twitter Callback] Saved profile to Edge Config for', normalizedWallet);
          } else {
            const errText = await ecRes.text();
            console.error('[Twitter Callback] Edge Config save failed:', errText);
          }
        } catch (ecErr) {
          console.error('[Twitter Callback] Edge Config save error (non-fatal):', ecErr);
        }
      }
    }

    // Store in a cookie so the client can read it
    const profileJson = JSON.stringify(twitterProfile);
    const response = NextResponse.redirect(`${appUrl}?twitter_connected=true`);

    response.cookies.set('twitter_profile', profileJson, {
      httpOnly: false, // Client JS needs to read this
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });

    // Clean up OAuth cookies
    response.cookies.delete('twitter_code_verifier');
    response.cookies.delete('twitter_csrf');

    return response;
  } catch (err) {
    console.error('[Twitter Callback] Profile fetch error:', err);
    return NextResponse.redirect(`${appUrl}?twitter_error=profile_fetch_error`);
  }
}
