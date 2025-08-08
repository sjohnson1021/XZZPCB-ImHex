const fs = require('fs');
const RawPCBParser = require('./raw_parser_node.js');

// Test function
function testParser(filename) {
  try {
    console.log(`Testing parser with file: ${filename}`);
    
    // Read the file
    const buffer = fs.readFileSync(filename);
    console.log(`File size: ${buffer.length} bytes`);
    
    // Create parser and parse the file
    const parser = new RawPCBParser();
    const result = parser.parse(buffer);
    
    // Display results
    console.log('\n=== PARSING RESULTS ===');
    console.log(`Total blocks found: ${result.main_data_block.length}`);
    
    // Count different block types
    const blockTypes = {};
    result.main_data_block.forEach(block => {
      const type = Object.keys(block)[0];
      blockTypes[type] = (blockTypes[type] || 0) + 1;
    });
    
    console.log('\nBlock types found:');
    Object.entries(blockTypes).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    
    // Show sample DATA blocks (type 0x07)
    const dataBlocks = result.main_data_block.filter(block => block.DATA);
    if (dataBlocks.length > 0) {
      console.log(`\nFound ${dataBlocks.length} DATA blocks (type 0x07):`);
      dataBlocks.forEach((block, index) => {
        const data = block.DATA;
        console.log(`  Block ${index + 1}: ${data.block_size} bytes`);
        console.log(`    Encrypted data length: ${data.encrypted_data.length}`);
        console.log(`    Decrypted data length: ${data.decrypted_data.length}`);
        
        // Show first few bytes of decrypted data
        const firstBytes = data.decrypted_data.slice(0, 16);
        console.log(`    First 16 bytes: [${firstBytes.join(', ')}]`);
        
        // Check if decrypted data looks like text
        const textSample = data.decrypted_data.slice(0, 50)
          .map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')
          .join('');
        console.log(`    Text sample: "${textSample}"`);
        console.log('');
      });
    }
    
    // Save results to JSON file
    const outputFilename = filename.replace(/\.[^/.]+$/, '') + '_parsed.json';
    fs.writeFileSync(outputFilename, JSON.stringify(result, null, 2));
    console.log(`\nResults saved to: ${outputFilename}`);
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

// Check if filename is provided
if (process.argv.length < 3) {
  console.log('Usage: node test_parser.js <filename>');
  console.log('Example: node test_parser.js myfile.pcb');
  process.exit(1);
}

const filename = process.argv[2];
testParser(filename);
