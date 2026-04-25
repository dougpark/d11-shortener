Let me quickly check the current auth setup to give grounded advice.  

Searched for text `session|login_token|auth_token|cookie|Bearer` (`**/src/utils/auth.ts`), 4 results

Searched for text `session|login_token|token|cookie` (`**/src/db/users.ts`), 9 results

Good context to know: the current model is a **single `token_hash` column on the `users` row** — one login token per user, no expiry, used as a Bearer token. The "Copy Login Link" flow is the registration/onboarding mechanism.

---

## Design: Session Token Rotation

### The core problem
Rotating means generating a new token and writing `token_hash` on the user row. The moment that happens, the current session (which the user is actively using) is also invalidated — so the client must receive the new raw token and swap it in *before* the old one is gone.

### Trigger point
A **"Reset Login Token"** option — probably in the user menu alongside the existing "Copy Login Link". It's the nuclear version of Copy Login Link: regenerates rather than just recopy.

### Server-side flow
1. Receive `POST /api/auth/reset-token` authenticated with the current token
2. Generate new raw token + hash
3. `UPDATE users SET token_hash = ? WHERE id = ?`
4. Return `{ token: <raw>, login_url: "https://d11.me/auth?token=..." }`

The old token is now dead. This all happens atomically — no window where both are valid.

### Client-side sequence (the tricky part)
1. Confirm dialog: *"This invalidates your current token on all devices. Save the new one before closing this window."*
2. POST with current token → get new token back
3. **Immediately** swap the stored token in localStorage/memory so subsequent requests use the new one
4. Show the reveal modal (same amber key icon pattern as API token reveal) with the new login URL
5. Trigger browser password save prompt

### Browser password save trigger
The browser only prompts to save when it sees a form submission with recognizable credential fields (`autocomplete="username"` + `autocomplete="new-password"`). The registration flow already does this. For rotation you'd do the same: after receiving the new token, programmatically populate a hidden `<form>` with `username = slug_prefix` and `password = login_url`, then call `.submit()` (or `.requestSubmit()`). The browser intercepts it and offers to update the saved password.

### Edge cases to think through
- **Multiple browser tabs open**: other tabs will 401 on their next API call. Your existing auth handling should already redirect/show a re-login prompt — worth verifying.
- **Mobile app / other clients**: if someone has the token in another browser or a script, it immediately stops working. The confirm dialog copy should make this clear.
- **Admin reset for a user**: an admin flow to force-rotate someone else's token (for account takeover response). This is separate from self-service but the same server logic, just keyed by user_id rather than the authenticated user.

### What you don't need
No `sessions` table, no token versioning, no refresh tokens — the single-token-per-user model is intentional and fine for this use case. Rotation is just "overwrite the one hash."