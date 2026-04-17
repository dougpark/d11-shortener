// src/utils/auth.ts — token hashing and verification helpers
//
// Tokens are SHA-256 hex digests of a random secret the user holds.
// We never store the plain token — only the hash — so a DB breach
// doesn't expose usable credentials.

/** Hash a plain Bearer token with SHA-256 → hex string. */
export async function hashToken(plainToken: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(plainToken)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

/** Generate a cryptographically random token (32 bytes → 64 hex chars). */
export function generateToken(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

/** Extract the Bearer token from an Authorization header, or return null. */
export function extractBearer(authHeader: string | null | undefined): string | null {
    if (!authHeader) return null
    const match = authHeader.match(/^Bearer\s+(.+)$/i)
    return match ? match[1].trim() : null
}
