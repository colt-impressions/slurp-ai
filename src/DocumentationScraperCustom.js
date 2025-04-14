const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const TurndownService = require('turndown');
const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');
const EventEmitter = require('events');
const { extract } = require('@extractus/article-extractor');
const { resolvePath } = require('./utils/pathUtils');
const { cleanupMarkdown: sharedCleanupMarkdown } = require('./utils/markdownUtils');
// Handle potential default export for p-queue (CommonJS/ESM compatibility)
let PQueueImport = require('p-queue');
if (PQueueImport && typeof PQueueImport === 'object' && PQueueImport.default) {
  PQueueImport = PQueueImport.default;
}
const PQueue = PQueueImport;

/**
 * DocsToMarkdown - A class to scrape documentation sites and convert to markdown
 * Extends EventEmitter to emit progress events
 * 
 * CUSTOM VERSION: Enhanced with additional configuration options for deep paths
 * and PrintSmith-specific documentation handling
 */
class DocsToMarkdown extends EventEmitter {
  /**
   * Create a new DocScraper
   * @param {Object} options - Configuration options
   * @param {string} options.baseUrl - The base URL of the documentation site
   * @param {string} options.outputDir - Directory to save markdown files
   * @param {string[]} options.allowedDomains - Domains that are allowed to be scraped (defaults to domain of baseUrl)
   * @param {number} options.maxPages - Maximum number of pages to scrape (0 for unlimited)
   * @param {boolean} options.useHeadless - Whether to use headless browser for JavaScript-rendered content
   * @param {string[]} options.excludeSelectors - CSS selectors to exclude from content
   * @param {number} options.concurrency - Number of pages to process concurrently (default: 5)
   * @param {number} options.retryCount - Number of times to retry failed requests (default: 3)
   * @param {number} options.retryDelay - Delay between retries in ms (default: 1000)
   */
  constructor(options) {
    super();
    this.baseUrl = options.baseUrl;
    this.basePath = options.basePath || process.env.SLURP_BASE_PATH || process.cwd();
    this.outputDir = resolvePath(options.outputDir || process.env.SLURP_PARTIALS_DIR || 'slurp_partials', this.basePath);
    this.libraryInfo = options.libraryInfo || {};
    this.visitedUrls = new Set();
    this.queuedUrls = new Set();
    this.inProgressUrls = new Set();
    this.baseUrlObj = new URL(options.baseUrl);
    this.allowedDomains = options.allowedDomains || [this.baseUrlObj.hostname];
    
    this.maxPages = options.maxPages !== undefined ? 
      options.maxPages : 
      (parseInt(process.env.SLURP_MAX_PAGES_PER_SITE, 10) || 0);
    
    this.useHeadless = options.useHeadless !== undefined ?
      options.useHeadless :
      (process.env.SLURP_USE_HEADLESS !== 'false');
    
    this.baseUrlPath = this.baseUrlObj.pathname;
    this.enforceBasePath = options.enforceBasePath !== undefined ?
      options.enforceBasePath :
      (process.env.SLURP_ENFORCE_BASE_PATH !== 'false');
      
    // ENHANCEMENT: Custom documentation patterns
    this.docPatterns = [
      // Default patterns
      '/api/', 
      '/reference/', 
      '/guide/', 
      '/tutorial/', 
      '/example/', 
      '/doc/'
    ];
    
    // Add custom doc patterns from environment
    if (process.env.SLURP_DOC_PATTERNS) {
      const customPatterns = process.env.SLURP_DOC_PATTERNS.split(',');
      this.docPatterns.push(...customPatterns);
    }
    
    // ENHANCEMENT: Configurable max path depth - increased for PrintSmith docs
    this.maxPathDepth = parseInt(process.env.SLURP_MAX_PATH_DEPTH, 10) || 10;
    
    // ENHANCEMENT: Added verbose logging for URL processing
    this.verboseLogging = options.verboseLogging ||
      process.env.SLURP_VERBOSE_LOGGING === 'true' || false;
    // ENHANCEMENT: Configurable max path depth - increased for PrintSmith docs
    this.maxPathDepth = parseInt(process.env.SLURP_MAX_PATH_DEPTH, 10) || 10;
    
    // ENHANCEMENT: Added verbose logging for URL processing
    this.verboseLogging = options.verboseLogging ||
      process.env.SLURP_VERBOSE_LOGGING === 'true' || false;
    
    
    // ENHANCEMENT: Support for URL list
    this.urlListPath = options.urlListPath || null;
    this.urlListProcessed = false;
    
    // ENHANCEMENT: JavaScript wait time
    this.jsWaitTime = parseInt(process.env.SLURP_WAIT_FOR_JAVASCRIPT, 10) || 0;
    
    this.urlBlacklist = options.urlBlacklist || [
      // Common non-documentation pages
      '/blog/', 
      '/news/',
      '/forum/',
      '/community/',
      '/download/',
      '/about/',
      '/contact/',
      '/terms/',
      '/privacy/',
      '/login/',
      '/register/',
      '/pricing/',
      '/careers/',
      '/jobs/',
      '/team/',
      
      // Social media and external services
      '/twitter/',
      '/facebook/',
      '/linkedin/',
      '/youtube/',
      '/github.com/',
      '/discord/',
      '/slack/',
      
      // E-commerce/marketing
      '/store/',
      '/shop/',
      '/buy/',
      '/purchase/',
      '/cart/',
      '/checkout/',
      '/subscribe/',
      
      // User account related
      '/account/',
      '/profile/',
      '/dashboard/',
      '/settings/',
      '/preferences/',
      
      // Support/feedback
      '/support/',
      '/help-center/',
      '/faq/',
      '/ticket/',
      '/feedback/',
      '/survey/',
      
      // Events/webinars
      '/events/',
      '/webinar/',
      '/conference/',
      '/meetup/',
      '/workshop/',
      
      // Miscellaneous
      '/search/',
      '/print/',
      '/share/',
      '/comment/',
      '/vote/',
      '/stats/',
      '/analytics/',
      '/feed/',
      '/sitemap/',
      '/archive/'
    ];
    
    // ENHANCEMENT: Added 'key' and 'ref' to queryParamsToKeep for PrintSmith docs
    const defaultQueryParams = [
      // Version related
      'version',
      'v',
      'ver',
      
      // Language/localization
      'lang',
      'locale',
      'language',
      
      // Content display
      'theme',
      'view',
      'format',
      
      // API specific
      'api-version',
      'endpoint',
      'namespace',
      
      // Documentation specific
      'section',
      'chapter',
      'topic',
      'module',
      'component',
      'function',
      'method',
      'class',
      'example',
      
      // PrintSmith specific
      'key',
      'ref'
    ];
    
    this.excludeSelectors = [
      'script',
      'style',
      'noscript',
      'iframe',
      'object',
      'embed'
    ];

    if (options.excludeSelectors && Array.isArray(options.excludeSelectors)) {
      this.excludeSelectors.push(...options.excludeSelectors);
    }

    const envQueryParams = process.env.SLURP_PRESERVE_QUERY_PARAMS ? 
      process.env.SLURP_PRESERVE_QUERY_PARAMS.split(',') : null;
    
    this.queryParamsToKeep = options.queryParamsToKeep || envQueryParams || defaultQueryParams;
    
    this.concurrency = options.concurrency || 
      parseInt(process.env.SLURP_CONCURRENCY, 10) || 10;
      
    this.retryCount = options.retryCount || 
      parseInt(process.env.SLURP_RETRY_COUNT, 10) || 3;
      
    this.retryDelay = options.retryDelay || 
      parseInt(process.env.SLURP_RETRY_DELAY, 10) || 1000;
    
    this.queue = new PQueue({
      concurrency: this.concurrency,
      autoStart: true
    });
    
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    });
    
    this.configureTurndown();
    
    this.stats = {
      processed: 0,
      failed: 0,
      startTime: null,
      endTime: null
    };
  }

  /**
   * Generate a consistent filename for a given URL
   * @param {string} url - The URL to convert to a filename
   * @returns {string} The filename with .md extension
   */
  getFilenameForUrl(url) {
    const urlObj = new URL(url);
    let filename = urlObj.pathname.replace(/\//g, '_');
    
    if (filename === '' || filename === '_') {
      filename = 'index';
    }
    
    if (!filename.endsWith('.md')) {
      filename += '.md';
    }
    
    return filename;
  }

  /**
   * Clean up markdown content to remove excessive blank lines and fix formatting
   * @param {string} markdown - The markdown content to clean up
   * @returns {string} The cleaned markdown content
   */
  cleanupMarkdown(markdown) {
    let cleaned = sharedCleanupMarkdown(markdown);
    
    if (this.baseUrl && this.baseUrl.includes('modelcontextprotocol.io')) {
      cleaned = this.cleanupMintlifyMarkdown(cleaned);
    }
    
    return cleaned;
  }
  
  /**
   * Special cleanup for Mintlify-based sites like modelcontextprotocol.io
   * @param {string} markdown - The markdown content to clean up
   * @returns {string} The cleaned markdown content
   */
  cleanupMintlifyMarkdown(markdown) {
    return markdown
      .replace(/\[Model Context Protocol home page.*?\]\(index\.md\)/s, '')
      
      .replace(/Search\.\.\.\n\n⌘K\n\nSearch\.\.\.\n\nNavigation/s, '')
      
      .replace(/\[Documentation\n\n\]\(_introduction\.md\)\[SDKs\n\n\]\(_sdk_java_mcp-overview\.md\)\n\n\[Documentation\n\n\]\(_introduction\.md\)\[SDKs\n\n\]\(_sdk_java_mcp-overview\.md\)/s, '')
      
      .replace(/\*\s+\[\n\s+\n\s+GitHub\n\s+\n\s+\]\(https:\/\/github\.com\/modelcontextprotocol\)/s, '')
      
      .replace(/Was this page helpful\?\n\nYesNo/s, '')
      
      .replace(/On this page[\s\S]*$/s, '')
      
      .replace(/\[For Server Developers\]\(_quickstart_server\.md\)/s, '')
      
      .replace(/##\s+\[\s+​\s+\]\(#[^\)]+\)\s+\n+##/g, '##')
      
      .replace(/##\s+\[\s+​\s+\]\(#([^\)]+)\)\s+([^\n]+)/g, '## $2')
      .replace(/###\s+\[\s+​\s+\]\(#([^\)]+)\)\s+([^\n]+)/g, '### $2')
      .replace(/####\s+\[\s+​\s+\]\(#([^\)]+)\)\s+([^\n]+)/g, '#### $2')
      
      .replace(/\[\s+\n+\s+\]\(([^\)]+)\)/g, '')
      
      .replace(/\[\s+\n+\s+([^\n]+)\s+\n+\s+\]\(([^\)]+)\)/g, '[$1]($2)')
      
      .replace(/Navigation\s+\n+Get Started\s+\n+Introduction/s, '')
      
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Configure the Turndown service with custom rules
   */
  configureTurndown() {
    this.turndownService.addRule('codeBlock', {
      filter: ['pre'],
      replacement: function(content, node) {
        const language = node.querySelector('code') ? 
          node.querySelector('code').className.replace('language-', '') : '';
        return `\n\`\`\`${language}\n${content}\n\`\`\`\n`;
      }
    });
    
    this.turndownService.addRule('tables', {
      filter: ['table'],
      replacement: function(content) {
        return '\n\n' + content + '\n\n';
      }
    });
    
    const self = this;
    this.turndownService.addRule('internalLinks', {
      filter: function(node, options) {
        return node.nodeName === 'A' && node.getAttribute('href');
      },
      replacement: function(content, node, options) {
        const href = node.getAttribute('href');
        
        if (!href || href.startsWith('javascript:')) {
          return content;
        }
        
        try {
          const url = new URL(href, self.baseUrl);
          
          if (href.startsWith('#')) {
            return `[${content}](${href})`;
          }
          
          if (self.allowedDomains.includes(url.hostname)) {
            const hash = url.hash;
            
            url.hash = '';
            
            let fullUrl;
            
            if (!url.protocol || url.hostname === '') {
              const baseUrlPath = new URL(self.baseUrl).pathname;
              
              if (href.startsWith('.') || (!href.startsWith('/') && !href.startsWith('http'))) {
                const currentPath = new URL(node.baseURI || self.baseUrl).pathname;
                const currentDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
                
                const resolvedPath = new URL(href, new URL(currentDir, self.baseUrl)).pathname;
                fullUrl = new URL(resolvedPath, self.baseUrl).toString();
              } else {
                fullUrl = new URL(url.toString(), self.baseUrl).toString();
              }
            } else {
              fullUrl = url.toString();
            }
            
            const targetFilename = self.getFilenameForUrl(fullUrl);
            
            return `[${content}](${targetFilename}${hash})`;
          } else {
            return `[${content}](${href})`;
          }
        } catch (error) {
          console.error(`Error processing link ${href}:`, error.message);
          return `[${content}](${href})`;
        }
      }
    });
    
    this.turndownService.addRule('images', {
      filter: 'img',
      replacement: function(content, node) {
        const alt = node.getAttribute('alt') || '';
        const src = node.getAttribute('src') || '';
        
        
        return `![${alt}](${src})`;
      }
    });
  }

  /**
   * Get the total number of pages in all states (visited, in progress, queued)
   * @returns {number} Total pages count
   */
  getTotalPageCount() {
    return this.visitedUrls.size + this.inProgressUrls.size + this.queuedUrls.size;
  }

  /**
   * Check if we've reached the maximum number of pages
   * @returns {boolean} True if the maximum has been reached
   */
  hasReachedMaxPages() {
    return this.maxPages > 0 && this.getTotalPageCount() >= this.maxPages;
  }

  /**
   * Start the scraping process
   */
  /**
   * Load a list of URLs from a JSON file
   * @param {string} urlListPath - Path to the JSON file containing URLs
   * @returns {Promise<boolean>} Success status
   */
  async loadUrlList(urlListPath) {
    try {
      console.log(`Loading URL list from ${urlListPath}`);
      const data = await fs.readFile(urlListPath, 'utf-8');
      const urlList = JSON.parse(data);
      console.log(`Loaded ${urlList.length} URLs from list`);
      
      // ENHANCED: Add debug info
      if (this.verboseLogging) {
        console.log(`First 5 URLs in list: ${urlList.slice(0, 5).join('\n')}`);
      }
      
      // Add all URLs to queue - Using direct addToQueue for more immediate control
      let addedCount = 0;
      for (const url of urlList) {
        // Direct addition to queue rather than just marking as queued
        this.queuedUrls.add(url);
        addedCount++;
      }
      
      console.log(`Added ${addedCount} URLs to the queue`);
      this.urlListProcessed = true;
      return true;
    } catch (error) {
      console.error(`Error loading URL list: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Add a URL to the queue with checking
   * @param {string} url - URL to add
   * @returns {boolean} Whether the URL was added
   */
  addUrlToQueue(url) {
    if (this.visitedUrls.has(url) || this.inProgressUrls.has(url) || this.queuedUrls.has(url)) {
      return false;
    }
    
    if (this.hasReachedMaxPages()) {
      return false;
    }
    
    this.queuedUrls.add(url);
    return true;
  }

  /**
   * Start the scraping process
   * @param {string} [urlListPath] - Optional path to URL list
   */
  async start() {
    this.stats.startTime = new Date();
    console.log(`Starting scrape of ${this.baseUrl} with concurrency ${this.concurrency}`);
    
    this.emit('init', {
      baseUrl: this.baseUrl,
      maxPages: this.maxPages
    });
    
    await fs.ensureDir(this.outputDir);
    
    // Initialize browser
    let browser = null;
    if (this.useHeadless) {
      browser = await puppeteer.launch({ headless: 'new' });
    }
    
    // ENHANCED: Better URL list processing with more debugging
    if (this.urlListPath) {
      console.log(`Using URL list from: ${this.urlListPath}`);
      const listLoaded = await this.loadUrlList(this.urlListPath);
      
      if (listLoaded) {
        console.log(`Successfully loaded URL list, processing ${this.queuedUrls.size} URLs`);
        
        // Process all queued URLs - use a copy to avoid modification issues during iteration
        const urlsToProcess = [...this.queuedUrls];
        
        if (this.verboseLogging) {
          console.log(`First 5 URLs to process: ${urlsToProcess.slice(0, 5).join('\n')}`);
        }
        
        // Clear the queue before adding to avoid duplicates
        this.queuedUrls.clear();
        
        // Process each URL and add to queue
        for (const url of urlsToProcess) {
          this.addToQueue(url, browser);
        }
      } else {
        console.error(`Failed to load URL list from ${this.urlListPath}`);
        this.addToQueue(this.baseUrl, browser);
      }
    } else {
      // No URL list provided, just use the base URL
      this.addToQueue(this.baseUrl, browser);
    }
    
    await this.queue.onIdle();
    
    if (browser) {
      await browser.close();
    }
    
    this.stats.endTime = new Date();
    const duration = (this.stats.endTime - this.stats.startTime) / 1000;
    
    const stats = {
      processed: this.stats.processed,
      failed: this.stats.failed,
      duration: duration,
      pagesPerSecond: (this.stats.processed / duration).toFixed(2)
    };
    
    this.emit('complete', stats);
    
    console.log(`Scraping complete in ${duration.toFixed(2)} seconds.`);
    console.log(`Processed: ${this.stats.processed} pages`);
    console.log(`Failed: ${this.stats.failed} pages`);
    console.log(`Pages per second: ${(this.stats.processed / duration).toFixed(2)}`);
    
    return stats;
  }

  /**
   * Add a URL to the processing queue
   * @param {string} url - The URL to process
   * @param {Browser} browser - Puppeteer browser instance
   * @returns {boolean} Whether the URL was added to the queue
   */
  addToQueue(url, browser) {
    if (this.visitedUrls.has(url) || this.inProgressUrls.has(url) || this.queuedUrls.has(url)) {
      return false;
    }
    
    if (this.hasReachedMaxPages()) {
      // Only log this message for the first URL we reject
      if (this.getTotalPageCount() === this.maxPages) {
        //console.log(`Reached maximum of ${this.maxPages} pages, not adding more to queue.`);
      }
      return false;
    }
    
    this.queuedUrls.add(url);
    
    this.queue.add(async () => {
      try {
        this.queuedUrls.delete(url);
        this.inProgressUrls.add(url);
        
        this.emit('progress', {
          type: 'processing',
          url: url,
          processed: this.visitedUrls.size,
          maxPages: this.maxPages || 'unlimited',
          queueSize: this.queue.size,
          inProgress: this.inProgressUrls.size
        });
        
        console.log(`Processing ${url} (${this.visitedUrls.size}/${this.maxPages || 'unlimited'}) - Queue size: ${this.queue.size}`);
        
        if (this.verboseLogging) {
          console.log(`URL details: hostname=${new URL(url).hostname}, pathname=${new URL(url).pathname}, search=${new URL(url).search}`);
        }
        
        if (this.verboseLogging) {
          console.log(`URL details: hostname=${new URL(url).hostname}, pathname=${new URL(url).pathname}, search=${new URL(url).search}`);
        }
        
        let html;
        if (this.useHeadless) {
          const page = await browser.newPage();
          await page.setDefaultNavigationTimeout(30000);
          await page.goto(url, { waitUntil: 'networkidle2' });
          
          // ENHANCEMENT: Added wait time for JavaScript to execute if configured
          if (this.jsWaitTime > 0) {
            console.log(`Waiting ${this.jsWaitTime}ms for JavaScript to execute...`);
            // Use a Promise-based timeout that's compatible with all Puppeteer versions
            await new Promise(resolve => setTimeout(resolve, this.jsWaitTime));
          }
          
          html = await page.content();
          await page.close();
        } else {
          const response = await axios.get(url, {
            timeout: 30000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          });
          html = response.data;
        }
        
        const $ = cheerio.load(html);
        
        const newUrls = this.extractLinks($, url);
        
        if (!this.hasReachedMaxPages()) {
          for (const newUrl of newUrls) {
            this.addToQueue(newUrl, browser);
          }
        }
        
        await this.processPage(url, $);
        
        this.visitedUrls.add(url);
        this.stats.processed++;
        
      } catch (error) {
        console.error(`Error processing ${url}:`, error.message);
        this.stats.failed++;
      } finally {
        this.inProgressUrls.delete(url);
      }
    });
    
    return true;
  }

  /**
   * Process a page - extract content and convert to markdown
   * @param {string} url - The URL of the page 
   * @param {CheerioStatic} $ - Cheerio instance with loaded HTML
   */
  /**
   * Process a page - extract content and convert to markdown
   * Enhanced for PrintSmith documentation
   * @param {string} url - The URL of the page
   * @param {CheerioStatic} $ - Cheerio instance with loaded HTML
   */
  async processPage(url, $) {
    try {
      // Get page title
      const pageTitle = $('title').text().trim();
      
      // Try article extractor first (for better content identification)
      try {
        const article = await extract(url);
        
        if (article && article.content) {
          // Add title if available
          let titleMarkdown = pageTitle ? `# ${pageTitle}\n\n` : '';
          
          let markdown = this.turndownService.turndown(article.content);
          markdown = titleMarkdown + this.cleanupMarkdown(markdown);
          
          await this.saveMarkdown(url, markdown, this.libraryInfo);
          return;
        }
      } catch (extractError) {
        // Continue with fallback if article extraction fails
        console.log(`Article extraction failed for ${url}, using fallback`);
      }
      
      // Enhanced content extraction for PrintSmith documentation
      
      // First, try to find the main content area with specific selectors
      let content = $('.RH-LAYOUT-CENTERPANEL-topic-box, article[data-region="topic"], .topic-content, main, .RH-LAYOUT-HOMEPAGE-TOC-container');
      
      // If main content area not found, fall back to body
      if (!content.length) {
        content = $('body');
      }
      
      // Remove navigation and other non-content elements
      for (const selector of this.excludeSelectors) {
        $(selector, content).remove();
      }
      
      // PrintSmith-specific selectors to remove
      const customSelectors = [
        '.RH-LAYOUT-HOMEPAGE-TITLEBAR-container',
        '.RH-LAYOUT-HOMEPAGE-FOOTER-container',
        '.RH-LAYOUT-HOMEPAGE-SIDEBAR-container',
        '.cookie-widget-holder',
        '#skip-to-content',
        '#menu',
        '.nav',
        '#rh-footer',
        '.RH-LAYOUT-HOMEPAGE-SELECTDETAILS-container',
        '.RH-LAYOUT-HOMEPAGE-TOOLBAR-container',
        '.RH-LAYOUT-HOMEPAGE-HEADERMENU-container'
      ];
      
      for (const selector of customSelectors) {
        $(selector, content).remove();
      }
      
      // Add page title if available
      let titleMarkdown = pageTitle ? `# ${pageTitle}\n\n` : '';
      
      let markdown = this.turndownService.turndown(content.html() || '');
      markdown = titleMarkdown + this.cleanupMarkdown(markdown);
      
      await this.saveMarkdown(url, markdown, this.libraryInfo);
    } catch (error) {
      console.error(`Error processing content for ${url}: ${error.message}`);
    }
  }

  /**
   * Preprocess a URL to determine if it should be added to the queue
   * @param {string} url - The URL to process
   * @param {string} sourceUrl - The URL where this link was found
   * @returns {string|null} - Normalized URL or null if rejected
   */
  preprocessUrl(url, sourceUrl) {
    try {
      // Parse URLs
      const urlObj = new URL(url);
      const sourceUrlObj = new URL(sourceUrl);
      
      urlObj.hash = '';
      
      if (!this.allowedDomains.includes(urlObj.hostname)) {
        // console.log(`Skipping URL ${url} - domain not allowed`);
        return null;
      }
      
      if (this.enforceBasePath && this.baseUrlPath && this.baseUrlPath !== '/') {
        if (!urlObj.pathname.startsWith(this.baseUrlPath)) {
          // console.log(`Skipping URL ${url} - doesn't match base path ${this.baseUrlPath}`);
          return null;
        }
      }
      
      const path = urlObj.pathname.toLowerCase();
      for (const pattern of this.urlBlacklist) {
        if (path.includes(pattern.toLowerCase())) {
          // console.log(`Skipping URL ${url} - matches blacklist pattern ${pattern}`);
          return null;
        }
      }
      
      const fileExtensions = ['.pdf', '.zip', '.tar.gz', '.tgz', '.exe', '.dmg', '.pkg', 
                             '.jpg', '.jpeg', '.png', '.gif', '.svg', '.mp4', '.webm', '.mp3', '.wav'];
      for (const ext of fileExtensions) {
        if (path.endsWith(ext)) {
          // console.log(`Skipping URL ${url} - non-documentation file extension ${ext}`);
          return null;
        }
      }
      
      if (urlObj.search) {
        const params = new URLSearchParams(urlObj.search);
        const newParams = new URLSearchParams();
        
        for (const param of this.queryParamsToKeep) {
          if (params.has(param)) {
            newParams.set(param, params.get(param));
          }
        }
        
        urlObj.search = newParams.toString();
      }
      
      if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
        urlObj.pathname = urlObj.pathname.slice(0, -1);
      }
      
      const paginationParams = ['page', 'p', 'pg', 'start', 'offset'];
      const sortingParams = ['sort', 'order', 'sortBy', 'orderBy', 'direction'];
      
      // it might be duplicate content - check if we should keep it
      let hasPaginationOrSorting = false;
      let hasContentParams = false;
      
      if (urlObj.search) {
        const params = new URLSearchParams(urlObj.search);
        
        for (const param of [...paginationParams, ...sortingParams]) {
          if (params.has(param)) {
            hasPaginationOrSorting = true;
            break;
          }
        }
        
        for (const param of this.queryParamsToKeep) {
          if (params.has(param)) {
            hasContentParams = true;
            break;
          }
        }
        
        if (hasPaginationOrSorting && !hasContentParams) {
          const page = params.get('page') || params.get('p') || params.get('pg') || '1';
          if (page !== '1') {
            // console.log(`Skipping URL ${url} - pagination without content params`);
            return null;
          }
        }
      }
      
      // ENHANCEMENT: Modified path depth filtering to be more lenient with PrintSmith docs
      // which often have deep paths like Account_Receivable_(AR)/Journal_Entries/
      const pathSegments = urlObj.pathname.split('/').filter(Boolean);
      
      if (this.verboseLogging) {
        console.log(`URL path depth check: ${urlObj.pathname} has ${pathSegments.length} segments (max: ${this.maxPathDepth})`);
      }
      
      // Special handling for PrintSmith docs which often have parentheses in URLs
      const isPrintSmithDoc = urlObj.hostname.includes('myprintdesk') ||
                              urlObj.pathname.includes('PrintSmith') ||
                              urlObj.pathname.includes('(') ||
                              urlObj.pathname.includes(')');
                              
      if (isPrintSmithDoc) {
        // Always allow PrintSmith URLs regardless of depth
        if (this.verboseLogging) {
          console.log(`PrintSmith doc detected, allowing regardless of depth: ${url}`);
        }
      }
      else if (pathSegments.length > this.maxPathDepth) {
        let isDocPath = false;
        
        // Check against all our doc patterns (default + custom)
        for (const pattern of this.docPatterns) {
          if (urlObj.pathname.includes(pattern)) {
            isDocPath = true;
            break;
          }
        }
        
        if (!isDocPath) {
          if (this.verboseLogging) {
            console.log(`Skipping URL ${url} - too deep (${pathSegments.length} segments) and not a documentation path`);
          }
          return null;
        }
      }
      
      return urlObj.toString();
    } catch (error) {
      console.error(`Error preprocessing URL ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Extract links from the page for further crawling
   * @param {CheerioStatic} $ - Cheerio instance
   * @param {string} baseUrl - Base URL for resolving relative links
   * @returns {string[]} Array of new URLs to process
   */
  extractLinks($, baseUrl) {
    const newUrls = [];
    const links = $('a[href]');
    
    links.each((i, el) => {
      let href = $(el).attr('href');
      
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
        return;
      }
      
      try {
        const url = new URL(href, baseUrl);
        
        const normalizedUrl = this.preprocessUrl(url.toString(), baseUrl);
        
        if (!normalizedUrl) {
          return;
        }
        
        if (!this.visitedUrls.has(normalizedUrl) && 
            !this.inProgressUrls.has(normalizedUrl) && 
            !this.queuedUrls.has(normalizedUrl)) {
          newUrls.push(normalizedUrl);
        }
       } catch (error) {
         if (error instanceof TypeError && error.message.includes('Invalid URL')) {
           // Log less severe warning for invalid URLs found in source HTML
           console.warn(`Skipping invalid link found on page: ${href}`);
         } else {
           // Log other errors as actual errors
           console.error(`Error processing link ${href}:`, error.message);
         }
      }
    });
    
    return newUrls;
  }

  /**
   * Save markdown content to file
   * @param {string} url - The URL of the page
   * @param {string} markdown - The markdown content
   * @param {Object} options - Additional options
   * @param {string} options.library - Name of the library (e.g., 'flask')
   * @param {string} options.version - Version of the library (e.g., '2.0.1')
   * @param {boolean} options.exactVersionMatch - Whether the version is an exact match
   */
  async saveMarkdown(url, markdown, options = {}) {
    const filename = this.getFilenameForUrl(url);
    
    let outputDir = resolvePath(this.outputDir, this.basePath);
    
    if (options.library) {
      outputDir = path.join(outputDir, options.library);
      
      if (options.version) {
        outputDir = path.join(outputDir, options.version);
      }
    }
    
    await fs.ensureDir(outputDir);
    
    const content = `---
url: ${url}
scrapeDate: ${new Date().toISOString()}
${options.library ? `library: ${options.library}` : ''}
${options.version ? `version: ${options.version}` : ''}
${options.exactVersionMatch !== undefined ? `exactVersionMatch: ${options.exactVersionMatch}` : ''}
---

${markdown}`;
    
    const outputPath = path.join(outputDir, filename);
    await fs.writeFile(outputPath, content);
    
    this.emit('progress', {
      type: 'saved',
      url: url,
      outputPath: outputPath,
      processed: this.visitedUrls.size,
      total: this.maxPages > 0 ? this.maxPages : this.getTotalPageCount(),
      progress: this.maxPages > 0 ? 
        Math.floor((this.visitedUrls.size / this.maxPages) * 100) : 
        Math.floor((this.visitedUrls.size / this.getTotalPageCount()) * 100)
    });
    
    console.log(`Saved ${url} to ${outputPath}`);
  }
}

module.exports = DocsToMarkdown;