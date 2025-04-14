#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

// Configuration
const CONFIG = {
  baseUrl: 'https://help.xmpie.com/uStore/Latest/Help/en/',
  seedCsvPath: 'Samples/uStore/uStore_Help_Doc_HREFs.csv',
  outputJsonPath: 'xmpie_urls.json',
  concurrency: 5,
  timeout: 30000,
  retryCount: 3,
  retryDelay: 1000,
  verbose: true
};

/**
 * HTML Fetcher - Retrieves HTML content from documentation pages
 */
class HtmlFetcher {
  constructor(options = {}) {
    this.timeout = options.timeout || CONFIG.timeout;
    this.retries = options.retryCount || CONFIG.retryCount;
    this.retryDelay = options.retryDelay || CONFIG.retryDelay;
    this.cache = new Map();
    this.verbose = options.verbose || CONFIG.verbose;
  }

  /**
   * Fetch HTML content from a URL with retries and caching
   * @param {string} url - The URL to fetch
   * @returns {Promise<string>} - The HTML content
   */
  async fetch(url) {
    // Check cache first
    if (this.cache.has(url)) {
      if (this.verbose) console.log(`Using cached content for ${url}`);
      return this.cache.get(url);
    }

    // Implement retry logic
    let retries = 0;
    let lastError = null;

    while (retries <= this.retries) {
      try {
        if (retries > 0) {
          // Wait before retrying
          const delay = this.retryDelay * Math.pow(2, retries - 1);
          if (this.verbose) console.log(`Retry ${retries}/${this.retries} for ${url} after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Make the request
        const response = await axios.get(url, {
          timeout: this.timeout,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
          }
        });

        // Cache the content
        const html = response.data;
        this.cache.set(url, html);
        
        if (this.verbose) console.log(`Successfully fetched ${url} (${html.length} bytes)`);
        
        return html;
      } catch (error) {
        lastError = error;
        retries++;
        
        if (this.verbose) {
          console.log(`Error fetching ${url}: ${error.message}`);
        }
      }
    }

    // If we get here, all retries failed
    throw new Error(`Failed to fetch ${url} after ${this.retries} retries: ${lastError.message}`);
  }
}

/**
 * Link Extractor - Extracts links from HTML content
 */
class LinkExtractor {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl;
    this.verbose = options.verbose || CONFIG.verbose;
  }

  /**
   * Extract and normalize links from HTML content
   * @param {string} html - HTML content
   * @param {string} sourceUrl - The URL of the page being processed
   * @returns {Array<string>} - Array of normalized URLs
   */
  extract(html, sourceUrl) {
    const $ = cheerio.load(html);
    const links = new Set();
    
    if (this.verbose) console.log(`Extracting links from ${sourceUrl}`);
    
    // Find all links in the HTML
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      
      // Skip empty or javascript: links
      if (!href || href === '#' || href.startsWith('javascript:')) {
        return;
      }
      
      try {
        // Normalize the URL
        const url = new URL(href, sourceUrl);
        
        // Filter links to ensure they're within the same domain and path
        if (this.shouldIncludeUrl(url, sourceUrl)) {
          links.add(url.toString());
        }
      } catch (error) {
        if (this.verbose) console.log(`Error processing link ${href}: ${error.message}`);
      }
    });
    
    if (this.verbose) console.log(`Found ${links.size} unique links from ${sourceUrl}`);
    
    return Array.from(links);
  }
  
  /**
   * Check if a URL should be included in results
   * @param {URL} url - URL object to check
   * @param {string} sourceUrl - The URL of the page being processed
   * @returns {boolean} - Whether the URL should be included
   */
  shouldIncludeUrl(url, sourceUrl) {
    // Check if it's from the same domain
    const baseUrlObj = new URL(this.baseUrl);
    if (url.hostname !== baseUrlObj.hostname) {
      return false;
    }
    
    // Check if it's a documentation page (.htm extension)
    if (!url.pathname.endsWith('.htm')) {
      return false;
    }
    
    // Check if it's within the base path
    if (!url.pathname.startsWith('/uStore/Latest/Help/en/')) {
      return false;
    }
    
    // Exclude certain patterns
    const excludePatterns = [
      '/print/', 
      '/logout/', 
      '/login/', 
      '/search/'
    ];
    
    for (const pattern of excludePatterns) {
      if (url.pathname.includes(pattern)) {
        return false;
      }
    }
    
    return true;
  }
}

/**
 * URL Pattern Analyzer - Analyzes URL patterns to understand documentation structure
 */
class UrlPatternAnalyzer {
  constructor(options = {}) {
    this.verbose = options.verbose || CONFIG.verbose;
    this.sections = new Set();
    this.sectionToTopics = {};
    this.subsections = new Set();
    this.urlPatterns = [];
  }

  /**
   * Analyze a set of URLs to extract patterns and structure
   * @param {Array<string>} urls - Array of URLs to analyze
   */
  analyze(urls) {
    if (this.verbose) console.log(`Analyzing ${urls.length} URLs for patterns`);
    
    for (const url of urls) {
      try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        
        // Skip non-documentation paths
        if (!pathname.endsWith('.htm')) continue;
        
        // Remove base path prefix to get relative path
        let relPath = pathname.replace('/uStore/Latest/Help/en/', '');
        
        // Parse path segments
        const segments = relPath.split('/').filter(Boolean);
        
        if (segments.length > 0) {
          // Extract section (first segment)
          const section = segments[0];
          this.sections.add(section);
          
          // Initialize section topics array if it doesn't exist
          if (!this.sectionToTopics[section]) {
            this.sectionToTopics[section] = [];
          }
          
          // Extract subsection if available
          if (segments.length > 2) {
            const subsection = segments[1];
            this.subsections.add(`${section}/${subsection}`);
          }
          
          // Extract topic (last segment without extension)
          if (segments.length > 1) {
            const lastSegment = segments[segments.length - 1];
            const topic = lastSegment.replace(/\.htm$/, '');
            this.sectionToTopics[section].push(topic);
          }
          
          // Extract TocPath value from query params
          const tocPath = urlObj.searchParams.get('TocPath');
          if (tocPath) {
            // Parse the TocPath to get breadcrumb hierarchy
            const breadcrumb = decodeURIComponent(tocPath).split('|');
            this.urlPatterns.push({
              url,
              relPath,
              breadcrumb
            });
          }
        }
      } catch (error) {
        if (this.verbose) console.log(`Error analyzing URL ${url}: ${error.message}`);
      }
    }
    
    if (this.verbose) {
      console.log(`Extracted ${this.sections.size} unique sections`);
      console.log(`Extracted ${this.subsections.size} unique subsections`);
      console.log(`Extracted ${this.urlPatterns.length} URL patterns with breadcrumbs`);
    }
  }
  
  /**
   * Get structured information about the analyzed URLs
   * @returns {Object} - Structure of sections and topics
   */
  getStructure() {
    return {
      sections: Array.from(this.sections),
      subsections: Array.from(this.subsections),
      sectionToTopics: this.sectionToTopics,
      patterns: this.urlPatterns
    };
  }
}

/**
 * URL Generator - Generates candidate URLs based on patterns
 */
class UrlGenerator {
  constructor(baseUrl, patternAnalyzer, options = {}) {
    this.baseUrl = baseUrl;
    this.patternAnalyzer = patternAnalyzer;
    this.verbose = options.verbose || CONFIG.verbose;
  }

  /**
   * Generate candidate URLs based on analyzed patterns
   * @returns {Array<string>} - Array of candidate URLs
   */
  generate() {
    const urlSet = new Set();
    const structure = this.patternAnalyzer.getStructure();
    
    if (this.verbose) console.log('Generating candidate URLs based on patterns');
    
    // Add URLs from known sections/topics
    for (const section of structure.sections) {
      const topics = structure.sectionToTopics[section] || [];
      
      // Add section index URL
      urlSet.add(new URL(`${section}/${section}.htm`, this.baseUrl).toString());
      
      // Add topic URLs directly under section
      for (const topic of topics) {
        urlSet.add(new URL(`${section}/${topic}.htm`, this.baseUrl).toString());
      }
    }
    
    // Try to generate URLs for subsections
    for (const subsectionPath of structure.subsections) {
      const [section, subsection] = subsectionPath.split('/');
      
      // Add subsection index URL
      urlSet.add(new URL(`${section}/${subsection}/${subsection}.htm`, this.baseUrl).toString());
      
      // If we have breadcrumb information, use it to generate more URLs
      const subsectionPatterns = structure.patterns.filter(
        p => p.relPath.startsWith(`${section}/${subsection}/`)
      );
      
      for (const pattern of subsectionPatterns) {
        // Extract the deepest breadcrumb level
        if (pattern.breadcrumb && pattern.breadcrumb.length > 2) {
          const lastLevel = pattern.breadcrumb[pattern.breadcrumb.length - 1].trim();
          const normalizedLastLevel = lastLevel
            .replace(/\s+/g, '_')
            .replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, '');
          
          // Generate a URL based on the breadcrumb
          urlSet.add(new URL(`${section}/${subsection}/${normalizedLastLevel}.htm`, this.baseUrl).toString());
        }
      }
    }
    
    // Add URLs from patterns with breadcrumbs
    for (const pattern of structure.patterns) {
      urlSet.add(pattern.url);
      
      // Try to extract breadcrumb information to generate more URLs
      if (pattern.breadcrumb && pattern.breadcrumb.length > 1) {
        // Get the current path without extension
        const pathWithoutExt = pattern.relPath.replace(/\.htm$/, '');
        
        // Try some variations of the current URL
        const variations = [
          `${pathWithoutExt}.htm`,
          `${pathWithoutExt}_intro.htm`,
          `${pathWithoutExt}_overview.htm`
        ];
        
        for (const variation of variations) {
          urlSet.add(new URL(variation, this.baseUrl).toString());
        }
      }
    }
    
    if (this.verbose) console.log(`Generated ${urlSet.size} candidate URLs`);
    
    return Array.from(urlSet);
  }
}

/**
 * URL Validator - Validates URLs to ensure they exist
 */
class UrlValidator {
  constructor(options = {}) {
    this.concurrency = options.concurrency || CONFIG.concurrency;
    this.timeout = options.timeout || CONFIG.timeout;
    this.retryCount = options.retryCount || CONFIG.retryCount;
    this.verbose = options.verbose || CONFIG.verbose;
  }

  /**
   * Validate a list of URLs to check if they exist
   * @param {Array<string>} urls - URLs to validate
   * @returns {Promise<Array<string>>} - Valid URLs
   */
  async validate(urls) {
    if (this.verbose) console.log(`Validating ${urls.length} URLs`);
    
    const validUrls = [];
    const batchSize = this.concurrency;
    
    // Process URLs in batches to control concurrency
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      
      if (this.verbose) console.log(`Validating batch ${i/batchSize + 1}/${Math.ceil(urls.length/batchSize)} (${batch.length} URLs)`);
      
      // Process batch in parallel
      const results = await Promise.all(
        batch.map(url => this.validateUrl(url))
      );
      
      // Collect valid URLs
      for (let j = 0; j < batch.length; j++) {
        if (results[j]) {
          validUrls.push(batch[j]);
        }
      }
    }
    
    if (this.verbose) console.log(`Found ${validUrls.length} valid URLs out of ${urls.length} candidates`);
    
    return validUrls;
  }
  
  /**
   * Validate a single URL to check if it exists
   * @param {string} url - URL to validate
   * @returns {Promise<boolean>} - Whether the URL is valid
   */
  async validateUrl(url) {
    let retries = 0;
    
    while (retries <= this.retryCount) {
      try {
        if (retries > 0) {
          // Wait before retrying
          const delay = 1000 * Math.pow(2, retries - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        // Use HEAD request to efficiently check if URL exists
        await axios.head(url, {
          timeout: this.timeout,
          validateStatus: status => status < 400, // Accept any non-error status
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        
        return true;
      } catch (error) {
        retries++;
        
        // If it's a 404 or similar client error, don't retry
        if (error.response && error.response.status >= 400 && error.response.status < 500) {
          if (this.verbose) console.log(`URL ${url} returned ${error.response.status} - considered invalid`);
          return false;
        }
        
        // For server errors or network issues, retry
        if (this.verbose && retries <= this.retryCount) {
          console.log(`Error validating ${url}: ${error.message}. Retrying ${retries}/${this.retryCount}`);
        }
      }
    }
    
    // If all retries failed, consider URL invalid
    if (this.verbose) console.log(`URL ${url} failed validation after ${this.retryCount} retries`);
    return false;
  }
}

/**
 * Main function to run the URL generator
 */
async function main() {
  console.log('XMPie uStore URL Generator');
  console.log(`Base URL: ${CONFIG.baseUrl}`);
  
  try {
    // Step 1: Load seed URLs from CSV
    console.log(`Loading seed URLs from ${CONFIG.seedCsvPath}`);
    let seedUrls = [];
    
    try {
      const csvContent = await fs.readFile(CONFIG.seedCsvPath, 'utf-8');
      const lines = csvContent.split('\n')
        .filter(line => line.trim() !== '' && !line.includes('Help Doc HREF'));
      
      // Convert relative paths from CSV to absolute URLs
      seedUrls = lines.map(line => {
        const trimmedLine = line.trim();
        
        // Make sure we have the base URL + the relative path from CSV
        try {
          return new URL(trimmedLine, CONFIG.baseUrl).toString();
        } catch (error) {
          console.error(`Error creating URL from ${trimmedLine}: ${error.message}`);
          return null;
        }
      }).filter(url => url !== null);
      
      console.log(`Loaded ${seedUrls.length} seed URLs from CSV`);
      
      if (CONFIG.verbose) {
        console.log('First 5 seed URLs:');
        seedUrls.slice(0, 5).forEach(url => console.log(` - ${url}`));
      }
    } catch (error) {
      console.error(`Error loading seed URLs: ${error.message}`);
      seedUrls = [CONFIG.baseUrl]; // Fallback to just the base URL
    }
    
    // Step 2: Initialize components
    const fetcher = new HtmlFetcher({ verbose: CONFIG.verbose });
    const extractor = new LinkExtractor(CONFIG.baseUrl, { verbose: CONFIG.verbose });
    const analyzer = new UrlPatternAnalyzer({ verbose: CONFIG.verbose });
    
    // Step 3: Process seed URLs to find more links
    const discoveredUrls = new Set(seedUrls);
    const processedUrls = new Set();
    
    // Process URLs up to a certain depth
    const maxDepth = 2;
    let currentDepth = 0;
    
    while (currentDepth < maxDepth) {
      console.log(`Processing URLs at depth ${currentDepth + 1}/${maxDepth}`);
      
      const urlsToProcess = Array.from(discoveredUrls).filter(url => !processedUrls.has(url));
      console.log(`Found ${urlsToProcess.length} new URLs to process`);
      
      if (urlsToProcess.length === 0) break;
      
      // Limit the number of URLs to process at each depth for efficiency
      const urlsToProcessLimit = 10;
      const limitedUrls = urlsToProcess.slice(0, urlsToProcessLimit);
      
      for (const url of limitedUrls) {
        try {
          // Fetch and extract links
          const html = await fetcher.fetch(url);
          const links = extractor.extract(html, url);
          
          // Add new links to the discovered set
          links.forEach(link => discoveredUrls.add(link));
          
          // Mark as processed
          processedUrls.add(url);
        } catch (error) {
          console.error(`Error processing ${url}: ${error.message}`);
          processedUrls.add(url); // Mark as processed even if it failed
        }
      }
      
      currentDepth++;
    }
    
    // Step 4: Analyze discovered URLs
    const allUrls = Array.from(discoveredUrls);
    analyzer.analyze(allUrls);
    
    // Step 5: Generate candidate URLs
    const generator = new UrlGenerator(CONFIG.baseUrl, analyzer, { verbose: CONFIG.verbose });
    const candidateUrls = generator.generate();
    
    // Step 6: Validate URLs (optional - can be time-consuming)
    // Uncomment to enable validation
    /*
    console.log('Validating URLs (this may take some time)...');
    const validator = new UrlValidator({ verbose: CONFIG.verbose });
    const validUrls = await validator.validate(candidateUrls);
    */
    
    // Skip validation for now and use all candidate URLs
    const validUrls = candidateUrls;
    
    // Step 7: Save output
    await fs.writeJson(CONFIG.outputJsonPath, validUrls, { spaces: 2 });
    console.log(`Saved ${validUrls.length} URLs to ${CONFIG.outputJsonPath}`);
    
    // Also save structure info for reference
    await fs.writeJson('xmpie_structure.json', analyzer.getStructure(), { spaces: 2 });
    console.log('Saved structure info to xmpie_structure.json');
    
    console.log('URL generation complete!');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});