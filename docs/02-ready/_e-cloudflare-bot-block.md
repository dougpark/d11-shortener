# Cloudflare Turnstile (The "Anti-Bot" Wall)

Instead of those annoying "Click the traffic lights" CAPTCHAs, Cloudflare has Turnstile. It’s a smart, non-intrusive challenge that verifies a real human is using the browser without making them do any work.

How it works: You embed a small script on your d11-lumin registration page. When the user clicks "Register," Turnstile sends a token to your Worker.

The Benefit: It blocks 99% of automated scripts and bot registrations instantly.

Implementation: Your Hono/Bun backend just needs to verify the token with a quick fetch to Cloudflare’s API before inserting the new user into D1.