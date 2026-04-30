# list user table
bunx wrangler d1 execute d11-db --remote --command="SELECT id, slug_prefix, full_name, email, created_at FROM users"

# Count bookmarks
bunx wrangler d1 execute d11-db --remote --command="SELECT COUNT(*) FROM bookmarks"

# Count RSS items
bunx wrangler d1 execute d11-db --remote --command="SELECT COUNT(*) FROM rss_items"

# Count API tokens
bunx wrangler d1 execute d11-db --remote --command="SELECT COUNT(*) FROM api_tokens"

# Count users
bunx wrangler d1 execute d11-db --remote --command="SELECT COUNT(*) FROM users"

# Count RSS feeds
bunx wrangler d1 execute d11-db --remote --command="SELECT COUNT(*) FROM rss_feeds"

# Count with breakdown
bunx wrangler d1 execute d11-db --remote --command="SELECT 'bookmarks' as table, COUNT(*) FROM bookmarks UNION ALL SELECT 'rss_items', COUNT(*) FROM rss_items UNION ALL SELECT 'api_tokens', COUNT(*) FROM api_tokens UNION ALL SELECT 'users', COUNT(*) FROM users"

# Get statistics with multiple metrics
bunx wrangler d1 execute d11-db --remote --command="SELECT COUNT(*) as count, 'bookmarks' as table_name FROM bookmarks UNION ALL SELECT COUNT(*), 'rss_items' FROM rss_items UNION ALL SELECT COUNT(*), 'api_tokens' FROM api_tokens UNION ALL SELECT COUNT(*), 'users' FROM users ORDER BY table_name"






# Insert new RSS into the table
echo "Y" | bun wrangler d1 execute d11-db --remote --command "INSERT OR IGNORE INTO rss_feeds (url, name) VALUES ('FEED_URL', 'Feed Name');"

echo "Y" | bun wrangler d1 execute d11-db --remote --command "INSERT OR IGNORE INTO rss_feeds (url, name) VALUES ('https://sixcolors.com/?member-feed=e380681ec30273adcc9dcf562262dd', 'Six Colors');"



# List current feeds
echo "Y" | bun wrangler d1 execute d11-db --remote --command "SELECT id, name, url, is_active, last_fetched_at FROM rss_feeds;"


# List current api tokens

echo "Y" | bun wrangler d1 execute d11-db --remote --command "SELECT * FROM api_tokens;"

