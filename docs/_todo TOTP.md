Implementing TOTP (Time-based One-Time Password) in your Lumin stack is actually very lightweight. Because you are already using Hono and Bun, you don't even need a bulky library—you can handle the math using the native Web Crypto API which is built into Cloudflare Workers and Bun.
Here is the implementation blueprint for your "Archivist" fresh start.
1. Database Schema Update
In your schema.sql, you need to store the "Shared Secret" per user. This secret must be encrypted or at least kept very secure.
-- Migration: Add 2FA support
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT 0;

2. The Logic: Generating and Verifying
You can create a utility file src/utils/totp.ts. Instead of a heavy dependency, use the native crypto.subtle available in your Worker environment.
// A simplified view of the math behind the 6-digit code
export async function verifyTOTP(secret: string, code: string) {
  // 1. Convert base32 secret to a buffer
  // 2. Calculate the 30-second time step: Math.floor(Date.now() / 30000)
  // 3. Perform HMAC-SHA1(secret, timeStep)
  // 4. Truncate result to 6 digits and compare to 'code'
  
  // Note: For your Bun/Hono setup, use a lightweight helper like 'otpauth'
  // bun add otpauth
}

3. The Registration Flow (One-Time Setup)
When you (the user) want to enable 2FA for your handle:
1. Generate a Secret: Your server creates a random 32-character string.
2. Generate QR Code: The server provides a URI like: otpauth://totp/Lumin:dp?secret=JBSWY3DPEHPK3PXP&issuer=Lumin
3. Scan: You scan this with Microsoft Authenticator.
4. Confirm: You type the 6-digit code back into Lumin to "lock it in."
4. Updated Login Workflow
Since you already have the "Browser Save" trick for your 64-char token, the 2FA becomes a second step only when a new session is established.
1. Step 1: Paste your 64-char token (as you do now).
2. Step 2: If totp_enabled is true, Hono returns a "2FA Required" page instead of a session cookie.
3. Step 3: You enter the 6 digits from your phone.
4. Step 4: Success—the session cookie is issued.
Why this is perfect for your Japan Trip
• Zero Latency: Since the code is generated locally on your iPhone, it doesn't matter if you have a spotty data connection in a Tokyo subway.
• High Security: Even if someone finds your 64-char token (your "digital key"), they still can't get into your Archivist without your physical phone.
• Easy Recovery: Because you're a home-labber, you can save your "Base32 Secret" in your KeePassXC vault. If you lose your iPhone, you just paste that secret into a new app and you're back in.
Should I include a "TOTP Setup" section in the design document for Copilot, or do you want to stick to the standard token-auth for the initial re-build?