const fs = require('fs');
const path = require('path');

// Base URL from your previous attempts
const baseUrl = 'https://impressionsoregon-psv.myprintdesk.net/PrintSmith/HtmlHelp/';

// Parse TOC from the provided text
const tocText = fs.readFileSync('printsmith_toc.txt', 'utf-8');
const tocEntries = tocText.split('\n').filter(line => line.trim() !== '');

// Create sets to avoid duplicate URLs
const urlSet = new Set();

// URL transformation rules based on observed patterns
function generateUrlVariations(title) {
  const normalized = title.trim()
    .replace(/\s+/g, '_')           // Replace spaces with underscores
    .replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, ''); // Remove special chars
  
  // Create variations with different patterns
  return [
    // Primary variations
    `${normalized}.htm`,
    `${normalized}.html`,
    `${normalized}/index.htm`,
    
    // Variations with Copy in the name (observed in sample)
    `${normalized}%20-%20Copy.htm`,
    `${normalized}_-_Copy.htm`,
    
    // Folder-based organization
    `${normalized}/main.htm`,
    
    // Section-based organization
    `sections/${normalized}.htm`,
    
    // Variations with different casing
    `${normalized.toLowerCase()}.htm`,
    `${normalized.toUpperCase()}.htm`,
    
    // Add topics folder pattern
    `topics/${normalized}.htm`,
    
    // Add variation with spaces instead of underscores
    `${title.trim().replace(/\s+/g, '%20')}.htm`,
  ];
}

// Another approach: Generate URLs based on section/topic hierarchy
function generateHierarchicalUrls(entries) {
  const urls = [];
  let currentSection = '';
  
  entries.forEach(entry => {
    // If the line has no indentation, consider it a section
    if (!entry.startsWith(' ')) {
      currentSection = entry.trim()
        .replace(/\s+/g, '_')
        .replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, '');
      
      // Add section URLs
      urls.push(`${currentSection}/index.htm`);
      urls.push(`${currentSection}.htm`);
    } else {
      // It's a subsection/topic
      const topic = entry.trim()
        .replace(/\s+/g, '_')
        .replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, '');
      
      if (currentSection) {
        // Add hierarchical URLs
        urls.push(`${currentSection}/${topic}.htm`);
        urls.push(`${currentSection}/${topic}/index.htm`);
      }
      
      // Also add standalone topic URL
      urls.push(`${topic}.htm`);
    }
  });
  
  return urls;
}

// Generate URLs for each TOC entry
tocEntries.forEach(entry => {
  const variations = generateUrlVariations(entry);
  variations.forEach(urlPath => {
    urlSet.add(new URL(urlPath, baseUrl).toString());
  });
});

// Also generate hierarchical URLs
const hierarchicalUrls = generateHierarchicalUrls(tocEntries);
hierarchicalUrls.forEach(urlPath => {
  urlSet.add(new URL(urlPath, baseUrl).toString());
});

// Convert Set to Array
const urlList = Array.from(urlSet);

// Save to a JSON file for the scraper to consume
fs.writeFileSync(
  'printsmith_urls.json', 
  JSON.stringify(urlList, null, 2)
);

console.log(`Generated ${urlList.length} potential URLs`);