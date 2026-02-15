/**
 * GET /api/auth/twitter
 *
 * Initiates the Twitter OAuth 2.0 Authorization Code flow with PKCE.
 * Expects ?wallet=0x... query param to bind the Twitter profile to a wallet address.
 * Redirects the user to Twitter for authorization.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const TWITTER_CLIENT_ID = (process.env.TWITTER_CLIENT_ID || '').trim();

function getAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://wink-on-starknet.com').trim();
}

function base64URLEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateCodeVerifier(): string {
  return base64URLEncode(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return base64URLEncode(crypto.createHash('sha256').update(verifier).digest());
}

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get('wallet') || '';

  if (!TWITTER_CLIENT_ID) {
    return NextResponse.json({ error: 'Twitter not configured' }, { status: 500 });
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Encode wallet address in state (along with a random CSRF token)
  const csrfToken = crypto.randomBytes(16).toString('hex');
  const state = Buffer.from(JSON.stringify({ wallet, csrf: csrfToken })).toString('base64url');

  const redirectUri = `${getAppUrl()}/api/auth/twitter/callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: TWITTER_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'users.read tweet.read',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `https://x.com/i/oauth2/authorize?${params.toString()}`;

  // Store code_verifier and CSRF token in cookies for the callback
  const response = NextResponse.redirect(authUrl);

  response.cookies.set('twitter_code_verifier', codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  response.cookies.set('twitter_csrf', csrfToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  return response;
}
