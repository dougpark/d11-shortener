# Use Ai to interpret handwriting text and sketch
- similar process for tags and summary but for handwriting
- extra step to do text recognition
- 3rd step to recreate a pdf of text and sketch

## Implementation Goals
- create authenticated route for AI to get a list of new items
- db columns for AI results, ai_text, ai_image, r2_uri
- authenticated route so AI can update db from remote service

## AI Service running on ubuntu AIStation
- prefer Docker-Compose implementation
- schedule every 30 minutes to look for new list
- process tags and summary
- process handwriting and sketch
- send results up to Lumin server api


