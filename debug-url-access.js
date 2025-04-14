// Debug script to test direct access to PrintSmith documentation URLs
const axios = require('axios');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;

// URLs to test
const urlsToTest = [
  // A URL we know works
  'https://impressionsoregon-psv.myprintdesk.net/PrintSmith/HtmlHelp/Copyright_-_Copy.htm',
  
  // A URL that should work according to CSV but doesn't seem to
  'https://impressionsoregon-psv.myprintdesk.net/PrintSmith/HtmlHelp/Account_Receivable_(AR)/Journal_Entries/Journal_Entries%20-%20Copy.htm'
];

async function testDirectAccess(url, index) {
  console.log(`\n-----------------------------------`);
  console.log(`Testing URL ${index + 1}: ${url} via axios...`);
  
  try {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    console.log('SUCCESS with axios!');
    console.log('Status:', response.status);
    console.log('Content Length:', response.data.length);
    console.log('First 200 chars:', response.data.substring(0, 200));

    // Save the content for inspection
    const filename = `direct-axios-result-${index + 1}.html`;
    await fs.writeFile(filename, response.data);
    console.log(`Saved content to ${filename}`);
  } catch (error) {
    console.error('AXIOS ERROR:', error.message);
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Headers:', JSON.stringify(error.response.headers, null, 2));
    }
  }
}

async function testPuppeteerAccess(url, index) {
  console.log(`\nTesting URL ${index + 1}: ${url} via Puppeteer...`);
  try {
    const browser = await puppeteer.launch({ 
      headless: 'new',
      // Add these options for better debugging
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000); // Longer timeout
    
    console.log('Navigating to URL...');
    
    // Set up console log capture
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    
    // Monitor for response status
    page.on('response', response => {
      console.log(`Response: ${response.url()} - Status: ${response.status()}`);
    });
    
    // Go to the URL with network idle wait
    await page.goto(url, { waitUntil: 'networkidle2' });
    
    console.log('Waiting 5 seconds for JavaScript...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const html = await page.content();
    console.log('SUCCESS with Puppeteer!');
    console.log('Content Length:', html.length);
    console.log('First 200 chars:', html.substring(0, 200));
    
    // Save content for inspection
    const htmlFilename = `puppeteer-result-${index + 1}.html`;
    await fs.writeFile(htmlFilename, html);
    console.log(`Saved content to ${htmlFilename}`);

    // Take a screenshot
    const screenshotFilename = `page-screenshot-${index + 1}.png`;
    await page.screenshot({ path: screenshotFilename });
    console.log(`Saved screenshot to ${screenshotFilename}`);
    
    await browser.close();
  } catch (error) {
    console.error('PUPPETEER ERROR:', error.message);
  }
}

// Run tests for each URL
(async () => {
  for (let i = 0; i < urlsToTest.length; i++) {
    const url = urlsToTest[i];
    
    try {
      await testDirectAccess(url, i);
    } catch (error) {
      console.error(`Error in direct access test for URL ${i + 1}:`, error.message);
    }
    
    try {
      await testPuppeteerAccess(url, i);
    } catch (error) {
      console.error(`Error in Puppeteer test for URL ${i + 1}:`, error.message);
    }
    
    // Add some separation between URL tests
    console.log('\n==============================================\n');
  }
  
  console.log('All tests completed!');
})();