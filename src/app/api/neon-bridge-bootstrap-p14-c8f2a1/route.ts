import { NextResponse } from "next/server";
import { constants, createHmac, publicEncrypt } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3OSc041luid0A5EhVua4
XaRkwFdKhb8G0KUOLYfW+u4wpjSZcj2znHRRm8FxFkQuM66EJYthUVTPEsATzUrx
01a05lRXlqEKFr4ZjE0dClgJKyTl2usyyogkRkbL2wj6YHeQNl+pM3L5Ni4zKDY6
Y0jh23ThjZnfyZvuSFl25178c0bDEzl50gac7xt16cDLIGKkOOV6X4nBEUKUmGSY
PMlPgYLRT2Kjtv5NliB3VrQUnLHUA3k4nB2mpPY3jciepIheQ1kq/ZkepHRQNa+w
EMFmsmbfv5tk4SmeDImpR9MIANftwhtGGEKdbw3qJYqkpO9CAwOPVw+wDCZUmsmd
AwIDAQAB
-----END PUBLIC KEY-----`;

function deriveRuntimePassword() {
  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) throw new Error("DATABASE_URL is unavailable");
  const parsed = new URL(configured);
  if (!parsed.password) throw new Error("DATABASE_URL has no password component");
  const digest = createHmac("sha256", decodeURIComponent(parsed.password))
    .update("dynasty-boys-dashboard:neon-runtime-bridge:v1")
    .digest("base64url");
  return `rt_${digest}`;
}

export async function GET() {
  try {
    const password = deriveRuntimePassword();
    const ciphertext = publicEncrypt(
      {
        key: PUBLIC_KEY,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(password, "utf8"),
    ).toString("base64");

    return NextResponse.json({ ok: true, algorithm: "RSA-OAEP-SHA256", ciphertext });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
