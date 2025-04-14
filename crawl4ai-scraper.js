/**
 * Crawl4AI Documentation Scraper
 * ------------------------------
 * Loads URLs from crawl4ai_urls.json and scrapes them using DocumentationScraperCustom.js
 * Saves markdown files in slurp_docs/crawl4ai/
 * 
 * Configurable via environment variables:
 *   URL_LIST_FILE (default: crawl4ai_urls.json)
 *   OUTPUT_DIR (default: slurp_docs/crawl4ai)
 *   BASE_URL (default: https://docs.crawl4ai.com/)
 *   CONCURRENCY (default: 5)
 *   EXCLUDE_SELECTORS (comma-separated CSS selectors to exclude)
 */

const path = require('path');
const fs = require('fs-extra');
const DocsToMarkdown = require('./src/DocumentationScraperCustom');

const URL_LIST_FILE = process.env.URL_LIST_FILE || 'crawl4ai_urls.json';
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'slurp_docs/crawl4ai';
const BASE_URL = process.env.BASE_URL || 'https://docs.crawl4ai.com/';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10);
const EXCLUDE_SELECTORS = process.env.EXCLUDE_SELECTORS ? process.env.EXCLUDE_SELECTORS.split(',') : [];

async function main() {
  console.log('--- Crawl4AI Documentation Scraper ---');
  console.log(`URL list file: ${URL_LIST_FILE}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Exclude selectors: ${EXCLUDE_SELECTORS.join(', ') || '(none)'}`);

  await fs.ensureDir(OUTPUT_DIR);

  const scraper = new DocsToMarkdown({
    baseUrl: BASE_URL,
    outputDir: OUTPUT_DIR,
    concurrency: CONCURRENCY,
    excludeSelectors: EXCLUDE_SELECTORS,
    enforceBasePath: true,
    urlListPath: URL_LIST_FILE,
    verboseLogging: true
  });

  const loaded = await scraper.loadUrlList(URL_LIST_FILE);
  if (!loaded) {
    console.error('Failed to load URL list. Exiting.');
    process.exit(1);
  }

  scraper.on('progress', (info) => {
    console.log(`[${info.status}] ${info.url}`);
  });

  scraper.on('init', (info) => {
    console.log(`Starting scrape of ${info.baseUrl} (max pages: ${info.maxPages || 'unlimited'})`);
  });

  scraper.on('done', (stats) => {
    console.log(`Scraping complete. Processed: ${stats.processed}, Failed: ${stats.failed}`);
  });

  try {
    await scraper.start();
  } catch (err) {
    console.error('Scraping failed:', err);
  }
}

main();