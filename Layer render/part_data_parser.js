/* part_data_parser.js
 * Parser for part/pad data based on ImHex pattern structure
 * Handles the complex nested structure with headers, sub-blocks, and pin types
 */

class PartDataParser {
  constructor() {
    this.dataView = null;
    this.offset = 0;
	this.cur_block_size = 0;
	this.pin_block_size = 0;
  }

  // Initialize parser with decrypted ArrayBuffer
  init(arrayBuffer) {
    this.dataView = new DataView(arrayBuffer);
    this.offset = 0;
	this.cur_block_size = 0;
	this.pin_block_size = 0;
  }

  // Parse the part/pad structure
  parse(arrayBuffer, t07blockSize) {
    this.init(arrayBuffer);
    this.cur_block_size = t07blockSize;
    
    const result = {
      header: this.parseHeader(),
      sub_blocks: []
    };

    // Parse sub-blocks until we reach part_size
    const partSize = result.header.part_size;
    
    const trimmedBuffer = arrayBuffer.slice(0, 4 + partSize);
    this.dataView = new DataView(trimmedBuffer);
    //pin_block_size will be 0 until we reach the pin blocks. This is fine. 
    while (this.offset + this.pin_block_size < this.dataView.byteLength) {
      const subBlock = this.parseSubBlock();
      if (subBlock) {
        result.sub_blocks.push(subBlock);
      } else {
        break; // End of sub-blocks
      }
    }

    return result;
  }

  // Parse header structure
  parseHeader() {
    const header = {
      part_size: this.dataView.getUint32(this.offset, true),
      part_x: 0,
      part_y: 0,
	  part_rotation:0,
      visibility: 0,
      part_group_name_size: 0,
      part_group_name: ''
    };
    this.offset += 4;

    // Skip padding 0x04-0x07
    this.offset += 4;

    header.part_x = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    header.part_y = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    // Read part rotation value
	header.part_rotation = this.dataView.getUint32(this.offset,true);
    this.offset += 4;

    header.visibility = this.dataView.getUint8(this.offset);
    this.offset += 1;

    // Skip padding 0x15
    this.offset += 1;

    header.part_group_name_size = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    // Read part group name
    if (header.part_group_name_size > 0) {
      const nameBytes = new Uint8Array(this.dataView.buffer, this.dataView.byteOffset + this.offset, header.part_group_name_size);
      header.part_group_name = new TextDecoder('utf-8').decode(nameBytes);
      this.offset += header.part_group_name_size;
    }

    return header;
  }

  // Parse sub-blocks
  parseSubBlock() {
    if (this.offset >= this.dataView.byteLength) {
      return null;
    }

    const subTypeIdentifier = this.dataView.getUint8(this.offset);
    this.offset += 1;

    switch (subTypeIdentifier) {
      case 0x01:
        return this.parseSubType01();
      case 0x05:
        return this.parseSubType05();
      case 0x06:
        return this.parseSubType06();
      case 0x09:
        return this.parseSubType09();
      default:
        console.warn(`Unknown sub-type identifier: 0x${subTypeIdentifier.toString(16)} at offset ${this.offset}`);
        return null;
    }
  }

  // Parse sub-type 01 (Arc maybe)
  parseSubType01() {
    const blockSize = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const layer = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const x1 = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const y1 = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    // Skip padding[block_size-12]
    const paddingSize = blockSize - 12;
    this.offset += paddingSize;

    return {
      type: 'sub_type_01',
      sub_type_identifier_01: 0x01,
      block_size: blockSize,
      layer,
      x1,
      y1,
      padding_size: paddingSize
    };
  }

  // Parse sub-type 05 (Line Segment)
  parseSubType05() {
    const blockSize = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const layer = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const x1 = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const y1 = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const x2 = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const y2 = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const scale = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    // Skip padding[4]
    this.offset += 4;

    return {
      type: 'sub_type_05',
      sub_type_identifier_05: 0x05,
      block_size: blockSize,
      layer,
      x1,
      y1,
      x2,
      y2,
      scale
    };
  }

  // Parse sub-type 06 (Labels/Part Names)
  parseSubType06() {
    const blockSize = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const layer = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const x = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const y = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const fontSize = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const fontScale = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    // Skip padding[4]
    this.offset += 4;

    const visibility = this.dataView.getUint8(this.offset);
    this.offset += 1;

    // Skip padding[1]
    this.offset += 1;

    const labelSize = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    // Read label
    let label = '';
    if (labelSize > 0) {
      const labelBytes = new Uint8Array(this.dataView.buffer, this.dataView.byteOffset + this.offset, labelSize);
      label = new TextDecoder('utf-8').decode(labelBytes);
      this.offset += labelSize;
    }

    return {
      type: 'sub_type_06',
      sub_type_identifier_06: 0x06,
      block_size: blockSize,
      layer,
      x,
      y,
      font_size: fontSize,
      font_scale: fontScale,
      visibility,
      label_size: labelSize,
      label
    };
  }

  // Parse sub-type 09 (Pins)
  parseSubType09() {
    const blockSize = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    // num of pins should be X = ((t07_block_size - (localOffset + blockSize))/(blockSize+5))+1
    const blockEnd = this.offset + blockSize;
    const pins = [];
    
  // Continue reading pins until we reach the end of the block
  while (this.offset + blockSize <= this.cur_block_size) {
    const un1 = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const x = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const y = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const un2 = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const pinRotation = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const pinNameSize = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    // Read pin name
    let pinName = '';
    if (pinNameSize > 0) {
      const pinNameBytes = new Uint8Array(this.dataView.buffer, this.dataView.byteOffset + this.offset, pinNameSize);
      pinName = new TextDecoder('utf-8').decode(pinNameBytes);
      this.offset += pinNameSize;
    }

    const width = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const height = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const pin_shape = this.dataView.getUint8(this.offset, true);
    this.offset += 1;

    // Skip the 2 repeated 9-byte blocks and 5-byte outline end block
    this.offset += 23;

    const netIndex = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    pins.push({
      un1,
      x,
      y,
      un2,
      pin_rotation: pinRotation,
      pin_name_size: pinNameSize,
      pin_name: pinName,
      height,
      width,
      pin_shape,
      netIndex
    });
	//End single pin while loop We're at the end of the block, and need to use the block sizes for alignment.
	//There's 8 bytes of padding between pin blocks. (need to verify more consistency throughout files)
    this.offset += 13;		
    }

    return {
      type: 'sub_type_09',
      sub_type_identifier_09: 0x09,
      block_size: blockSize,
      pins
    };
  }

  // Parse pin sub-types
  parsePinSubType() {
    if (this.offset >= this.dataView.byteLength) {
      return null;
    }

    const pinType = this.dataView.getUint8(this.offset);
    this.offset += 1;

    switch (pinType) {
      case 0x00:
        return this.parsePinSubType00();
      case 0x01:
        return this.parsePinSubType01();
      case 0x02:
        return this.parsePinSubType02();
      case 0x03:
        return this.parsePinSubType03();
      default:
        console.warn(`Unknown pin sub-type: 0x${pinType.toString(16)} at offset ${this.offset}`);
        return null;
    }
  }

  // Parse pin sub-type 00 (pin net)
  parsePinSubType00() {
    const netIndex = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const diodeReadingSize = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    let diodeReading = '';
    if (diodeReadingSize > 0) {
      const diodeReadingBytes = new Uint8Array(this.dataView.buffer, this.dataView.byteOffset + this.offset, diodeReadingSize);
      diodeReading = new TextDecoder('utf-8').decode(diodeReadingBytes);
      this.offset += diodeReadingSize;
    }

    return {
      type: 'pin_sub_type_00',
      pin_net_identifier: 0x00,
      net_index: netIndex,
      diode_reading_size: diodeReadingSize,
      diode_reading: diodeReading
    };
  }

  // Parse pin sub-type 01
  parsePinSubType01() {
    const int1 = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const result = {
      type: 'pin_sub_type_01',
      pin_unknown_01_identifier: 0x01,
      int1
    };

    if (int1 > 0) {
      const int2 = this.dataView.getUint32(this.offset, true);
      this.offset += 4;
      result.int2 = int2;
    }

    return result;
  }

  // Parse pin sub-type 02
  parsePinSubType02() {
    const int1 = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const result = {
      type: 'pin_sub_type_02',
      pin_unknown_02_identifier: 0x02,
      int1
    };

    if (int1 > 0) {
      const int2 = this.dataView.getUint32(this.offset, true);
      this.offset += 4;
      result.int2 = int2;
    }

    return result;
  }

  // Parse pin sub-type 03
  parsePinSubType03() {
    const int1 = this.dataView.getUint32(this.offset, true);
    this.offset += 4;

    const result = {
      type: 'pin_sub_type_03',
      pin_unknown_03_identifier: 0x03,
      int1
    };

    if (int1 > 0) {
      const int2 = this.dataView.getUint32(this.offset, true);
      this.offset += 4;
      result.int2 = int2;
    }

    return result;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PartDataParser;
}
