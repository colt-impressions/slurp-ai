const fs = require('fs');
const path = require('path');

// Base URL from your previous attempts
const baseUrl = 'https://impressionsoregon-psv.myprintdesk.net/PrintSmith/HtmlHelp/';

// Parse TOC from the provided text
const tocText = fs.readFileSync('printsmith_toc.txt', 'utf-8');
const tocEntries = tocText.split('\n').filter(line => line.trim() !== '');

// Parse the actual URL patterns from the CSV
let actualPatterns = [];
try {
  const csvData = fs.readFileSync('Samples/PSV/Unique_Help_File_URLs.csv', 'utf-8');
  actualPatterns = csvData.split('\n')
    .filter(line => line.trim() !== '' && !line.includes('Relative URL'))
    .map(line => line.trim());
  
  console.log(`Loaded ${actualPatterns.length} actual URL patterns from CSV`);
} catch (error) {
  console.error('Error loading CSV patterns:', error.message);
}

// Create sets to avoid duplicate URLs
const urlSet = new Set();

// Extract sections and topics from actual URLs
const sections = new Set();
const sectionToTopics = {};

// Process actual URL patterns to extract structure
actualPatterns.forEach(pattern => {
  // Remove the leading "../"
  const path = pattern.startsWith('../') ? pattern.substring(3) : pattern;
  
  // Split into path segments
  const segments = path.split('/');
  
  // Extract section (first part)
  if (segments.length > 0) {
    const section = segments[0];
    sections.add(section);
    
    // Initialize section topics array if not exists
    if (!sectionToTopics[section]) {
      sectionToTopics[section] = [];
    }
    
    // Add topic if there's one (last segment)
    if (segments.length > 1) {
      // Extract basename without extension
      const lastSegment = segments[segments.length - 1];
      const topic = lastSegment.replace(/ - Copy\.htm$/, '').replace(/\.htm$/, '');
      sectionToTopics[section].push(topic);
    }
  }
});

console.log(`Extracted ${sections.size} unique sections`);

// Generate URLs from actual patterns
function addBaseUrl(relativePath) {
  // Convert relative path (../Section/Topic.htm) to full URL
  // Remove leading ../ if present
  const cleanPath = relativePath.startsWith('../') ? relativePath.substring(3) : relativePath;
  return new URL(cleanPath, baseUrl).toString();
}

// Add actual patterns first
actualPatterns.forEach(pattern => {
  urlSet.add(addBaseUrl(pattern));
});

// Function to generate URLs based on the patterns we've observed
function generateUrlsFromToc() {
  // Extract section and topic info from TOC
  const tocSections = [];
  let currentSection = null;
  
  tocEntries.forEach(entry => {
    // If no indentation and not a duplicate of previous entry, treat as section
    if (!entry.startsWith(' ') && entry !== currentSection) {
      currentSection = entry;
      tocSections.push({
        name: entry,
        topics: []
      });
    } else if (currentSection && tocSections.length > 0) {
      // It's a topic under the current section
      tocSections[tocSections.length - 1].topics.push(entry.trim());
    }
  });
  
  // Generate URLs from TOC structure
  tocSections.forEach(section => {
    // Normalize section name
    const normalizedSection = section.name
      .replace(/\s+/g, '_')
      .replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, '');
    
    // Add section-level URLs
    [
      `${normalizedSection}/${normalizedSection} - Copy.htm`,
      `${normalizedSection}/${normalizedSection}.htm`
    ].forEach(url => urlSet.add(addBaseUrl(url)));
    
    // Add topic-level URLs
    section.topics.forEach(topic => {
      const normalizedTopic = topic
        .replace(/\s+/g, '_')
        .replace(/[&\/\\#,+()$~%.'":*?<>{}]/g, '');
      
      // Add with various patterns we've observed
      [
        `${normalizedSection}/${normalizedTopic} - Copy.htm`,
        `${normalizedSection}/${normalizedTopic}.htm`,
        // Some sections have subsections
        `${normalizedSection}/${normalizedTopic}/${normalizedTopic} - Copy.htm`,
        `${normalizedSection}/${normalizedTopic}/${normalizedTopic}.htm`
      ].forEach(url => urlSet.add(addBaseUrl(url)));
    });
  });
}

// Generate additional URLs based on observed patterns
function generateAdditionalUrls() {
  // Process each section and its topics
  sections.forEach(section => {
    // Try to extract subsections
    const subsections = new Set();
    
    // Look for subsections in actual patterns
    actualPatterns.forEach(pattern => {
      if (pattern.startsWith(`../${section}/`)) {
        const parts = pattern.split('/');
        if (parts.length >= 3) {
          subsections.add(parts[2].split('/')[0]); // Get subsection name
        }
      }
    });
    
    // Get topics for this section
    const topics = sectionToTopics[section] || [];
    
    // Add section-level URLs
    [
      `${section}/${section} - Copy.htm`,
      `${section}/${section}.htm`
    ].forEach(url => urlSet.add(addBaseUrl(url)));
    
    // If we have subsections, use them
    if (subsections.size > 0) {
      subsections.forEach(subsection => {
        // Add subsection URLs
        [
          `${section}/${subsection}/${subsection} - Copy.htm`,
          `${section}/${subsection}/${subsection}.htm`
        ].forEach(url => urlSet.add(addBaseUrl(url)));
        
        // Add topics under subsections
        topics.forEach(topic => {
          [
            `${section}/${subsection}/${topic} - Copy.htm`,
            `${section}/${subsection}/${topic}.htm`
          ].forEach(url => urlSet.add(addBaseUrl(url)));
        });
      });
    } else {
      // No subsections, just add topics directly under section
      topics.forEach(topic => {
        [
          `${section}/${topic} - Copy.htm`,
          `${section}/${topic}.htm`
        ].forEach(url => urlSet.add(addBaseUrl(url)));
      });
    }
  });
  
  // Add specific patterns for special cases
  // SyncMaster paths don't use "- Copy"
  const syncMasterPaths = [
    'Admin/PrintSmith_Vision_SyncMaster/Export_Data.htm',
    'Admin/PrintSmith_Vision_SyncMaster/Import_Data.htm',
    'Admin/PrintSmith_Vision_SyncMaster/Information_About_Exported_Imported_Data.htm',
    'Admin/PrintSmith_Vision_SyncMaster/SyncMaster_Overview.htm'
  ];
  
  syncMasterPaths.forEach(p => urlSet.add(addBaseUrl(p)));
  
  // Preferences paths
  const preferencesPaths = [
    'Preferences/Integration.htm',
    'Preferences/JDF_Folder_Setup.htm',
    'Preferences/Multi_Owner_Interface.htm',
    'Preferences/Settings/Account_Preferences.htm',
    'Preferences/Settings/E-Mail_Preferences.htm',
    'Preferences/Settings/Estimator_Preferences.htm',
    'Preferences/Settings/Point_of_Sale_(POS)_Preferences.htm',
    'Preferences/Settings/System_Preferences.htm'
  ];
  
  preferencesPaths.forEach(p => urlSet.add(addBaseUrl(p)));
  
  // Templates paths
  const templatePaths = [
    'Templates/Email_Template.htm',
    'Templates/Template_Category.htm',
    'Templates/Web_Product_Templates.htm'
  ];
  
  templatePaths.forEach(p => urlSet.add(addBaseUrl(p)));
  
  // WIP Mode
  urlSet.add(addBaseUrl('Work_in_Progress_(WIP)/WIP_Mode.htm'));
}

// Add urls from TOC
generateUrlsFromToc();

// Add URLs from pattern analysis
generateAdditionalUrls();

// Convert Set to Array
const urlList = Array.from(urlSet);

// Save to a JSON file for the scraper to consume
fs.writeFileSync(
  'printsmith_urls_improved.json', 
  JSON.stringify(urlList, null, 2)
);

console.log(`Generated ${urlList.length} potential URLs`);

// For validation - also save the actual URLs separately
const actualUrls = actualPatterns.map(pattern => addBaseUrl(pattern));
fs.writeFileSync(
  'actual_urls.json',
  JSON.stringify(actualUrls, null, 2)
);
console.log(`Saved ${actualUrls.length} actual URLs for validation`);