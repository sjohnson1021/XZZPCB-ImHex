/* part_data_parser.js - Optimized
 * Parser for part/pad data based on ImHex pattern structure
 * Handles the complex nested structure with headers, sub-blocks, and pin types
 * Optimized for performance with reduced DataView operations
 */

const XY_SCALE = 1; // 10000 if scaling needed
let isThruHole_part;

class PartDataParser {
    constructor() {
        this.dataView = null;
        this.offset = 0;
        this.cur_block_size = 0;
        this.pin_block_size = 0;
        this.textDecoder = new TextDecoder('utf-8'); // Reuse decoder
    }

    // Initialize parser with decrypted ArrayBuffer
    init(arrayBuffer) {
        this.dataView = new DataView(arrayBuffer);
        this.offset = 0;
        this.cur_block_size = 0;
        this.pin_block_size = 0;
    }

    // Optimized string reading
    readString(length) {
        if (length === 0) return '';

        const stringBytes = new Uint8Array(
            this.dataView.buffer,
            this.dataView.byteOffset + this.offset,
            length
        );
        this.offset += length;
        return this.textDecoder.decode(stringBytes);
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

        // Sub-block handlers for better performance
        const subBlockHandlers = {
            0x01: () => this.parseSubType01(),
            0x05: () => this.parseSubType05(),
            0x06: () => this.parseSubType06(),
            0x09: () => this.parseSubType09()
        };

        while (this.offset + this.pin_block_size < this.dataView.byteLength) {
            if (this.offset >= this.dataView.byteLength) break;

            const subTypeIdentifier = this.dataView.getUint8(this.offset);
            this.offset += 1;

            const handler = subBlockHandlers[subTypeIdentifier];
            if (handler) {
                const subBlock = handler();
                if (subBlock) {
                    result.sub_blocks.push(subBlock);
                }
            } else {
                console.warn(`Unknown sub-type identifier: 0x${subTypeIdentifier.toString(16)} at offset ${this.offset}`);
                break;
            }
        }

        return result;
    }

    // Parse header structure with reduced DataView calls
    parseHeader() {
        const dv = this.dataView;
        let offset = this.offset;

        const header = {
            part_size: dv.getUint32(offset, true)
        };
        offset += 8; // Skip part_size + padding

        header.part_x = dv.getUint32(offset, true); offset += 4;
        header.part_y = dv.getUint32(offset, true); offset += 4;
        header.part_rotation = dv.getUint32(offset, true); offset += 4;
        header.visibility = dv.getUint8(offset); offset += 2; // Skip padding
        header.part_group_name_size = dv.getUint32(offset, true); offset += 4;

        this.offset = offset;

        // Read part group name if present
        header.part_group_name = header.part_group_name_size > 0
            ? this.readString(header.part_group_name_size)
            : '';

        return header;
    }

    // Parse sub-type 01 (Arc maybe) - optimized
    parseSubType01() {
        const dv = this.dataView;
        let offset = this.offset;

        const blockSize = dv.getUint32(offset, true); offset += 4;
        const layer = dv.getUint32(offset, true); offset += 4;
        const x1 = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const y1 = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const radius = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const angle_start = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const angle_end = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const scale = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const unknown_arc = dv.getUint32(offset, true) / XY_SCALE; offset += 4;

        this.offset = offset;

        return {
            type: 'sub_type_01',
            sub_type_identifier_01: 0x01,
            block_size: blockSize,
            layer, x1, y1, radius, angle_start, angle_end, scale, unknown_arc
        };
    }

    // Parse sub-type 05 (Line Segment) - optimized
    parseSubType05() {
        const dv = this.dataView;
        let offset = this.offset;

        const blockSize = dv.getUint32(offset, true); offset += 4;
        const layer = dv.getUint32(offset, true); offset += 4;
        const x1 = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const y1 = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const x2 = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const y2 = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const scale = dv.getUint32(offset, true) / XY_SCALE; offset += 4;

        this.offset = offset + 4; // Skip padding

        return {
            type: 'sub_type_05',
            sub_type_identifier_05: 0x05,
            block_size: blockSize,
            layer, x1, y1, x2, y2, scale
        };
    }

    // Parse sub-type 06 (Labels/Part Names) - optimized
    parseSubType06() {
        const dv = this.dataView;
        let offset = this.offset;

        const blockSize = dv.getUint32(offset, true); offset += 4;
        const layer = dv.getUint32(offset, true); offset += 4;
        const x = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const y = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const fontSize = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const fontScale = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const fontRotation = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const visibility = dv.getUint8(offset); offset += 2; // Skip padding
        const labelSize = dv.getUint32(offset, true); offset += 4;

        this.offset = offset;

        const label = labelSize > 0 ? this.readString(labelSize) : '';

        return {
            type: 'sub_type_06',
            sub_type_identifier_06: 0x06,
            block_size: blockSize,
            layer, x, y,
            font_size: fontSize,
            font_scale: fontScale,
            font_rotation: fontRotation,
            visibility,
            label_size: labelSize,
            label
        };
    }

    // Parse sub-type 09 (Pins) - heavily optimized
    parseSubType09() {
        const blockSize = this.dataView.getUint32(this.offset, true);
        this.offset += 4;

        const pins = [];
        const dv = this.dataView;

        // Continue reading pins until we reach the end of the block
        while (this.offset + blockSize <= this.cur_block_size) {
            let offset = this.offset;

            // Read pin data in bulk
            const un1 = dv.getUint32(offset, true); offset += 4;
            const x = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
            const y = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
            const inner_diameter = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
            const isThruHole_pin = (inner_diameter !== 0);
            isThruHole_part = isThruHole_pin;

            const pinRotation = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
            const pinNameSize = dv.getUint32(offset, true); offset += 4;

            this.offset = offset;

            // Read pin name
            const pinName = pinNameSize > 0 ? this.readString(pinNameSize) : '';

            offset = this.offset;
            const width = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
            const height = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
            const shape = dv.getUint8(offset); offset += 24; // Skip shape + repeated blocks
            const netIndex = dv.getUint32(offset, true); offset += 4;

            this.offset = offset + 13; // Skip padding

            pins.push({
                un1, x, y, inner_diameter,
                rotation: pinRotation,
                name_size: pinNameSize,
                name: pinName,
                height, width, shape,
                net_index: netIndex,
                isThruHole_pin
            });
        }

        return {
            type: 'sub_type_09',
            sub_type_identifier_09: 0x09,
            block_size: blockSize,
            pins
        };
    }

    // Pin sub-type parsers (simplified since they're not heavily used)
    parsePinSubType() {
        if (this.offset >= this.dataView.byteLength) return null;

        const pinType = this.dataView.getUint8(this.offset);
        this.offset += 1;

        const pinSubTypeHandlers = {
            0x00: () => this.parsePinSubType00(),
            0x01: () => this.parsePinSubType01(),
            0x02: () => this.parsePinSubType02(),
            0x03: () => this.parsePinSubType03()
        };

        const handler = pinSubTypeHandlers[pinType];
        return handler ? handler() : null;
    }

    parsePinSubType00() {
        const dv = this.dataView;
        let offset = this.offset;

        const netIndex = dv.getUint32(offset, true); offset += 4;
        const diodeReadingSize = dv.getUint32(offset, true); offset += 4;

        this.offset = offset;
        const diodeReading = diodeReadingSize > 0 ? this.readString(diodeReadingSize) : '';

        return {
            type: 'pin_sub_type_00',
            pin_net_identifier: 0x00,
            net_index: netIndex,
            diode_reading_size: diodeReadingSize,
            diode_reading: diodeReading
        };
    }

    parsePinSubType01() {
        const int1 = this.dataView.getUint32(this.offset, true);
        this.offset += 4;

        const result = {
            type: 'pin_sub_type_01',
            pin_unknown_01_identifier: 0x01,
            int1
        };

        if (int1 > 0) {
            result.int2 = this.dataView.getUint32(this.offset, true);
            this.offset += 4;
        }

        return result;
    }

    parsePinSubType02() {
        const int1 = this.dataView.getUint32(this.offset, true);
        this.offset += 4;

        const result = {
            type: 'pin_sub_type_02',
            pin_unknown_02_identifier: 0x02,
            int1
        };

        if (int1 > 0) {
            result.int2 = this.dataView.getUint32(this.offset, true);
            this.offset += 4;
        }

        return result;
    }

    parsePinSubType03() {
        const int1 = this.dataView.getUint32(this.offset, true);
        this.offset += 4;

        const result = {
            type: 'pin_sub_type_03',
            pin_unknown_03_identifier: 0x03,
            int1
        };

        if (int1 > 0) {
            result.int2 = this.dataView.getUint32(this.offset, true);
            this.offset += 4;
        }

        return result;
    }
}

// Export for both ES Modules and CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PartDataParser;
}

// Add ES Module export
export { PartDataParser };