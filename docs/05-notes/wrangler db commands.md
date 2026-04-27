# Insert new RSS into the table
echo "Y" | bun wrangler d1 execute d11-db --remote --command "INSERT OR IGNORE INTO rss_feeds (url, name) VALUES ('FEED_URL', 'Feed Name');"

echo "Y" | bun wrangler d1 execute d11-db --remote --command "INSERT OR IGNORE INTO rss_feeds (url, name) VALUES ('https://sixcolors.com/?member-feed=e380681ec30273adcc9dcf562262dd', 'Six Colors');"



# List current feeds
echo "Y" | bun wrangler d1 execute d11-db --remote --command "SELECT id, name, url, is_active, last_fetched_at FROM rss_feeds;"


# List current api tokens

echo "Y" | bun wrangler d1 execute d11-db --remote --command "SELECT * FROM api_tokens;"

