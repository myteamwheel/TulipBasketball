import { NextResponse } from 'next/server';
import { createHmac, publicEncrypt, constants } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxdOAPzs1xTkpQ+L242G3
Nh3LFXmkEsqqFq1RI2nLhWmiDfY3DdS+pqo71cKn84YJWi7F6SYx2hFE9BV1ma9X
l9StKNCYE23mDhnAubHlncbnScs5avAMBau6s9Wzr0q1+KJBtv2puJULs2NtHp+y
fQXB9+XjMBi2Tik6Z+iBG0HxSKR0da0nFpJ/Go8K+lx2pBjDQGnNLlN7GgWSNBCE
CAHwR8a5RL7i4wCsMT4/nvUjEch6RTivMoxNs8tZR02SiqxAReg4GCpeTHtssvh7
+Mrl9b/Vswhe5cXK8a7fF0OjXb1blR3puQRW1Gkcv46fFcjK/hb1bsBsboFH9E16
gwIDAQAB
-----END PUBLIC KEY-----`;

function deriveRuntimePassword() {
  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) throw new Error('DATABASE_URL is unavailable');
  const parsed = new URL(configured);
  if (!parsed.password) throw new Error('DATABASE_URL has no password component');
  const digest = createHmac('sha256', decodeURIComponent(parsed.password))
    .update('dynasty-boys-dashboard:neon-runtime-bridge:v1')
    .digest('base64url');
  return `rt_${digest}`;
}

export async function GET() {
  try {
    const password = deriveRuntimePassword();
    const ciphertext = publicEncrypt(
      { key: PUBLIC_KEY, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(password, 'utf8'),
    ).toString('base64');
    return NextResponse.json({ ok: true, algorithm: 'RSA-OAEP-SHA256', ciphertext });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
