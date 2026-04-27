# create a blog page
- provide a blog edit page
- provide a bookmark button to add to blog
- flow to human review before publish

## Blog Page features
- list of blog posts
- each post has title, description, tags, url, created_at
- filter by tag, search by keyword, sort by date or title
- pagination for older posts
- full integrated search across all fields (title, description, tags) with relevance ranking
- AI-generated summary for each post (optional)
- AI-generated tags for each post (optional)
- ability to mark posts as draft or published

## Add and Edit Blog Post features
- form to create or edit a blog post with fields for title, description, url, tags
- tag input with autocomplete suggestions based on existing tags
- AI-generated tag suggestions based on title and description
- AI-generated summary suggestion based on title and description
- option to save as draft or publish immediately
- ability to upload images and include them in the post content
- preview mode to see how the post will look when published

## Smart RSS
- generate RSS feed for published blog posts
- subscribe to keyword-based RSS feeds (e.g. all posts tagged "AI", or all posts mentioning "Lumin")


## What is JSX?
- JSX is a syntax extension for JavaScript that allows you to write HTML-like code within your JavaScript files. 
- would this make formatting a blog post easier?
- could we use JSX to create a rich text editor for writing blog posts, with support for formatting, images, links, etc.?

## AI-generated summaries and tags
- use AI to generate a summary of each blog post based on its content

## Image support
- allow users to upload images to include in their blog posts
- store images in Cloudflare R2 and serve them via Cloudflare Images for optimized delivery
- provide an easy interface for inserting images into blog posts, with options for captions, alt text, and alignment

