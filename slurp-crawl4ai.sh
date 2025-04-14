#!/bin/bash

# Crawl4AI Documentation Slurp Script

echo "Starting Crawl4AI documentation scrape..."

node cli.js https://docs.crawl4ai.com/ \
  --enforceBasePath true \
  --exclude '["Was this helpful\\?", "On this page", "Cookie", "Privacy", "Terms", "Sign in", "Sign up", "Next", "Previous", "Back to top"]'

echo "Scrape complete."

# If compilation is a separate step, run it here using cli.js options or a dedicated command.
# For now, review the scraped output in the output directory or file.

echo "Crawl4AI documentation scraping finished."