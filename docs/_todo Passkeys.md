Implementing Passkeys (the consumer name for FIDO2/WebAuthn) is significantly different from your current token-based system. While your 64-character token is a "shared secret" (both you and the server know it), a Passkey uses Asymmetric Cryptography (Public/Private key pairs).
The server never sees your "secret." It only sees a public key and a cryptographic signature that proves you have the private key (which is locked behind your Face ID).
1. How Passkeys Work in the Browser
When you use Face ID to log in, the "Handshake" looks like this:
1. Challenge: Lumin sends a random bunch of bytes to your browser.
2. Consent: The browser asks for Face ID.
3. Signing: Once authenticated, the secure enclave on your iPhone/Mac signs that challenge with your Private Key.
4. Verification: The browser sends the signature back to Lumin. Lumin uses your Public Key (stored in D1) to verify the signature. If it matches, you are logged in.
2. Integration into Lumin (The "Archivist" Way)
Since you are using Hono, you don't want to write the low-level binary parsing (CBOR/COSE) yourself. It's a headache. Instead, you can use a library like @simplewebauthn/server which is Bun-compatible and handles the heavy lifting.
Database Changes
You need a new table to store your Public Keys. One user can have multiple Passkeys (e.g., your iPhone, your Mac, and a YubiKey).
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,           -- Credential ID
  user_id INTEGER,               -- Links to your 'users' table
  public_key BLOB,               -- The public key used for verification
  counter INTEGER,               -- Security counter to prevent replay attacks
  device_type TEXT,              -- 'mobile', 'desktop', etc.
  FOREIGN KEY(user_id) REFERENCES users(id)
);

3. Comparison: Token vs. Passkey
Feature	Your Current Token	Passkey (WebAuthn)
Storage	Hash in D1, Plain in Browser	Public Key in D1, Private Key in Hardware
Login Flow	Paste Token (Once)	Face ID / Touch ID (Every time)
Security	Vulnerable to Phishing	Phishing-resistant
Portability	Copy/Paste anywhere	Tied to your iCloud/Google Keychain
4. The "Hybrid" Architecture for Lumin
Since you love the "Copy Login Link" feature (which relies on your token), I wouldn't replace it. Instead, treat Passkeys as a "Credential Upgrade."
1. Register: Log in with your 64-char token, then go to "Settings" and click "Register Passkey."
2. Authenticate: On future visits, instead of pasting a token, you just click "Login with Face ID."
3. Recovery: Your 64-char token (stored in KeePassXC) remains your "Master Key" if you ever lose access to your Passkey-enabled devices.
5. Implementation Steps for your Design Doc
To feed this into Copilot, you’ll need to add these requirements to the Archivist document:
• Libraries: Add @simplewebauthn/server (backend) and @simplewebauthn/browser (frontend).
• Endpoints: * GET /api/auth/register-options: Generates the challenge for a new Passkey. • POST /api/auth/register-verify: Saves the public key to D1. • GET /api/auth/login-options: Generates the challenge for login. • POST /api/auth/login-verify: Verifies the signature and issues the session cookie.
Does adding Face ID support make the "Lumin" project feel more like a professional-grade tool, or does the complexity of managing binary Public Keys feel like a departure from your "minimalist" goals?