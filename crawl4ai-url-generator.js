/**
 * Crawl4AI Documentation URL Generator
 * -----------------------------------
 * Recursively crawls https://docs.crawl4ai.com/ to generate a comprehensive list of documentation URLs.
 * Saves output to crawl4ai_urls.json
 * 
 * Configurable via environment variables:
 *   SEED_URL (default: https://docs.crawl4ai.com/)
 *   OUTPUT_FILE (default: crawl4ai_urls.json)
 *   MAX_DEPTH (default: 3)
 *   CONCURRENCY (default: 5)
 *   BLACKLIST_REGEX (default: /\.(pdf|zip|png|jpg|jpeg|gif|svg|mp4|mp3|exe|dmg)$/i)
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

const SEED_URL = process.env.SEED_URL || 'https://docs.crawl4ai.com/';
const OUTPUT_FILE = process.env.OUTPUT_FILE || 'crawl4ai_urls.json';
const MAX_DEPTH = parseInt(process.env.MAX_DEPTH || '3', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10);
const BLACKLIST_REGEX = new RegExp(process.env.BLACKLIST_REGEX || /\.(pdf|zip|png|jpg|jpeg|gif|svg|mp4|mp3|exe|dmg)$/i);

const visited = new Set();
const urlQueue = [];
const discoveredUrls = new Set();

function normalizeUrl(url, baseUrl) {
  try {
    const absoluteUrl = new URL(url, baseUrl).toString();
    // Remove URL fragment
    return absoluteUrl.split('#')[0];
  } catch {
    return null;
  }
}

async function fetchPage(url) {
  try {
    const response = await axios.get(url, { timeout: 15000 });
    return response.data;
  } catch (err) {
    console.warn(`Fetch failed for ${url}: ${err.message}`);
    return null;
  }
}

function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const normalized = normalizeUrl(href, baseUrl);
    if (!normalized) return;

    // Enforce base path
    if (!normalized.startsWith(SEED_URL)) return;

    // Blacklist patterns
    if (BLACKLIST_REGEX.test(normalized)) return;

    links.add(normalized);
  });

  return Array.from(links);
}

function shouldVisit(url) {
  if (visited.has(url)) return false;
  if (!url.startsWith(SEED_URL)) return false;
  if (BLACKLIST_REGEX.test(url)) return false;
  return true;
}

async function crawl() {
  urlQueue.push({ url: SEED_URL, depth: 0 });
  visited.add(SEED_URL);
  discoveredUrls.add(SEED_URL);

  while (urlQueue.length > 0) {
    const batch = urlQueue.splice(0, CONCURRENCY);
    await Promise.all(batch.map(async ({ url, depth }) => {
      console.log(`Crawling [depth ${depth}]: ${url}`);
      const html = await fetchPage(url);
      if (!html) return;

      if (depth >= MAX_DEPTH) return;

      const links = extractLinks(html, url);
      for (const link of links) {
        if (shouldVisit(link)) {
          visited.add(link);
          discoveredUrls.add(link);
          urlQueue.push({ url: link, depth: depth + 1 });
        }
      }
    }));
  }
}

function saveUrls() {
  const sorted = Array.from(discoveredUrls).sort();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(sorted, null, 2));
  console.log(`Saved ${sorted.length} URLs to ${OUTPUT_FILE}`);
}

(async () => {
  console.log(`Starting Crawl4AI URL generation from ${SEED_URL}`);
  console.log(`Max depth: ${MAX_DEPTH}, concurrency: ${CONCURRENCY}`);
  await crawl();
  saveUrls();
})();