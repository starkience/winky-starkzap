import { NextRequest, NextResponse } from 'next/server';

const AVNU_URL = (process.env.PAYMASTER_URL || 'https://starknet.paymaster.avnu.fi').replace(/\/+$/, '');
const API_KEY = (process.env.PAYMASTER_API_KEY || '').trim();

async function proxyPaymaster(request: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    const subPath = params.path?.join('/') || '';
    const targetUrl = subPath ? `${AVNU_URL}/${subPath}` : AVNU_URL;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['x-paymaster-api-key'] = API_KEY;

    const fetchOpts: RequestInit = { method: request.method, headers };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const body = await request.text();
      if (body) fetchOpts.body = body;
    }

    const upstream = await fetch(targetUrl, fetchOpts);
    const text = await upstream.text();

    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Paymaster proxy error:', error?.message);
    return NextResponse.json(
      { error: error?.message || 'Paymaster proxy failed' },
      { status: 502 },
    );
  }
}

export const GET = proxyPaymaster;
export const POST = proxyPaymaster;
