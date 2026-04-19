
# Project Manifest: Production Environment

### Core Tech Stack
• Runtime & Package Manager: Bun.js (Use bun commands for installing, testing, and running).
- Hono
• Infrastructure: Cloudflare Workers. Use wrangler for deployment and local development.
• Database: D1 (SQLite). Focus on SQL-native queries or lightweight ORMs compatible with Cloudflare D1.
• Styling: Tailwind CSS. Utilize the custom tailwind.config.js (Gemini-Modern aesthetic) provided previously.

### Architectural Standards
• Module System: ES Modules (ESM) only. Use import/export syntax. No require.
• Organization: Keep logic modular. Separate concerns into: 
• /src/index.js (Worker entry point) 
• /src/db/ (Database schemas and migrations) 
• /src/components/ (UI components) 
• /src/utils/ (Helper functions)
• Environment Variables: Access via the env object in the Worker fetch handler.

### UI Design Rules (Gemini-Modern)
Refer to these tokens for all generated frontend code:
• Primary Accent: #4285F4 (bg-gemini-blue)
• Background: #FFFFFF (bg-gemini-surface)
• Rounding: Full pills for buttons (rounded-full), 24px for cards (rounded-gemini-lg).
• Typography: Center-aligned hero content, Inter/Roboto font, high whitespace density.

### Developer Instructions for AI
When generating code for this project:

1. Write for Bun: Use Bun-specific APIs where applicable (e.g., Bun.password or high-performance fetch).

2. Worker-Ready: Ensure all code is compatible with the Cloudflare Workers runtime (no Node.js-only modules like fs or path).

3. Tailwind-First: Do not write custom CSS files. Use utility classes.

4. SQL Integration: When writing database logic, provide the wrangler d1 commands for creating tables and the JavaScript code for executing queries against env.DB.

5. Concise Modules: Keep files small and focused. Export individual functions rather than large monolithic objects.



