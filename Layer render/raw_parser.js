/* raw_parser.js - Optimized
 * Parser for raw PCB files based on the ImHex pattern structure
 * Handles binary data directly instead of pre-processed JSON
 * Optimized for performance with progress reporting capabilities
 */

import { PartDataParser } from './part_data_parser.js';

const XY_SCALE = 1; // 10000 if scaling needed
const MASTER_KEY = "DCFC12AC00000000";

class RawPCBParser {
    constructor(progressCallback = null) {
        this.dataView = null;
        this.offset = 0;
        this.mainDataBlocksSize = 0;
        this.progressCallback = progressCallback;

        // Pre-compile hex key for performance
        this.keyBytes = this.hexToBytes(MASTER_KEY);
    }

    // Optimized hex to bytes conversion
    hexToBytes(hexString) {
        const len = hexString.length;
        const bytes = new Uint8Array(len / 2);
        for (let i = 0; i < len; i += 2) {
            bytes[i / 2] = parseInt(hexString.substr(i, 2), 16);
        }
        return bytes;
    }

    // Optimized DES decryption
    decryptWithDES(encryptedData) {
        if (typeof CryptoJS === 'undefined') {
            throw new Error('CryptoJS is not available. Please include the CryptoJS library.');
        }

        // Helper: Uint8Array -> CryptoJS WordArray (big-endian words)
        const u8ToWordArray = (u8) => {
            const words = [];
            const len = u8.length;
            for (let i = 0; i < len; i++) {
                words[i >>> 2] |= u8[i] << (24 - (i % 4) * 8);
            }
            return CryptoJS.lib.WordArray.create(words, len);
        };

        // Helper: CryptoJS WordArray -> Uint8Array
        const wordArrayToU8 = (wordArray) => {
            const { words, sigBytes } = wordArray;
            const u8 = new Uint8Array(sigBytes);
            for (let i = 0; i < sigBytes; i++) {
                u8[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
            }
            return u8;
        };

        const keyWA = CryptoJS.lib.WordArray.create(this.keyBytes);
        const cipherWA = u8ToWordArray(encryptedData);

        const decryptedWA = CryptoJS.DES.decrypt({ ciphertext: cipherWA }, keyWA, {
            mode: CryptoJS.mode.ECB,
            padding: CryptoJS.pad.Pkcs7,
        });

        return wordArrayToU8(decryptedWA);
    }

    // Report progress if callback provided
    reportProgress(current, total, stage = '') {
        if (this.progressCallback) {
            const percent = Math.round((current / total) * 100);
            this.progressCallback({ percent, current, total, stage });
        }
    }

    // Parse file header structure
    parseFileHeader() {
        const dv = this.dataView;

        // Log first bytes for debugging
        if (console.log) {
            let bytesStr = "";
            const logLen = Math.min(0x50, dv.byteLength);
            for (let i = 0; i < logLen; i++) {
                bytesStr += dv.getUint8(i).toString(16).padStart(2, '0');
                if (i < logLen - 1) bytesStr += " ";
            }
            console.log(bytesStr);
        }

        this.mainDataBlocksSize = dv.getUint32(0x40, true);
        this.offset = 0x44;

        this.reportProgress(1, 10, 'Reading file header');
    }

    // Optimized sequence finding
    findSequence(array, sequence) {
        const seqLen = sequence.length;
        const arrayLen = array.byteLength;

        outer: for (let i = 0; i <= arrayLen - seqLen; i++) {
            for (let j = 0; j < seqLen; j++) {
                if (array.getUint8(i + j) !== sequence[j]) {
                    continue outer;
                }
            }
            return i;
        }
        return -1;
    }

    // Optimized string reading with caching
    readString(length) {
        if (length === 0) return '';

        const stringBytes = new Uint8Array(
            this.dataView.buffer,
            this.dataView.byteOffset + this.offset,
            length
        );
        this.offset += length;

        // Use TextDecoder for better performance on larger strings
        return new TextDecoder('utf-8').decode(stringBytes);
    }

    // Parse main data blocks with progress reporting
    parseMainDataBlocks() {
        const blocks = [];
        const startOffset = this.offset;
        const endOffset = startOffset + this.mainDataBlocksSize;
        const totalSize = this.mainDataBlocksSize;
        let processedSize = 0;

        this.reportProgress(2, 10, 'Parsing data blocks');

        // Block type handlers for better performance
        const blockHandlers = {
            0x01: () => this.parseType01(),
            0x02: () => this.parseType02(),
            0x03: () => this.parseType03(),
            0x04: () => { this.offset += 1; return null; },
            0x05: () => this.parseType05(),
            0x06: () => this.parseType06(),
            0x07: () => this.parseType07(),
            0x08: () => { this.offset += 1; return null; },
            0x09: () => this.parseType09()
        };

        let blockCount = 0;
        while (this.offset < endOffset && this.offset < this.dataView.byteLength) {
            // Check for padding
            if (this.dataView.getUint32(this.offset, true) === 0) {
                this.offset += 4;
                continue;
            }

            const blockType = this.dataView.getUint8(this.offset);
            this.offset += 1;

            const handler = blockHandlers[blockType];
            const block = handler ? handler() : null;

            if (block) {
                blocks.push(block);
            } else if (!handler) {
                console.warn(`Unknown block type: 0x${blockType.toString(16)} at offset ${this.offset}`);
            }

            // Report progress every 100 blocks
            if (++blockCount % 100 === 0) {
                processedSize = this.offset - startOffset;
                this.reportProgress(
                    2 + (processedSize / totalSize) * 6,
                    10,
                    `Parsed ${blockCount} blocks`
                );
            }
        }

        this.reportProgress(8, 10, `Completed parsing ${blocks.length} blocks`);
        return blocks;
    }

    // Optimized type parsers with reduced DataView calls
    parseType01() {
        const dv = this.dataView;
        let offset = this.offset;

        const blockSize = dv.getUint32(offset, true); offset += 4;
        const layer = dv.getUint32(offset, true); offset += 4;
        const x1 = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const y1 = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const r = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const angleStart = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const angleEnd = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const scale = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const netIndex = dv.getInt32(offset, true); offset += 4;

        this.offset = offset;

        return {
            ARC: {
                layer, x1, y1, r,
                angle_start: angleStart,
                angle_end: angleEnd,
                scale, net_index: netIndex
            }
        };
    }

    parseType02() {
        const dv = this.dataView;
        let offset = this.offset;

        const blockSize = dv.getUint32(offset, true); offset += 4;
        const x = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const y = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const outerRadius = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const innerRadius = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const layerAIndex = dv.getUint32(offset, true); offset += 4;
        const layerBIndex = dv.getUint32(offset, true); offset += 4;
        const netIndex = dv.getUint32(offset, true); offset += 4;
        const viaTextLength = dv.getUint32(offset, true); offset += 4;

        this.offset = offset;
        const viaText = this.readString(viaTextLength);

        return {
            VIA: {
                x, y,
                outer_radius: outerRadius,
                inner_radius: innerRadius,
                layer_a_index: layerAIndex,
                layer_b_index: layerBIndex,
                net_index: netIndex,
                via_text: viaText
            }
        };
    }

    parseType03() {
        const blockSize = this.dataView.getUint32(this.offset, true);
        this.offset += 4 + blockSize;
        return null; // Skip block
    }

    parseType05() {
        const dv = this.dataView;
        let offset = this.offset;

        const blockSize = dv.getUint32(offset, true); offset += 4;
        const layer = dv.getUint32(offset, true); offset += 4;
        const x1 = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const y1 = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const x2 = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const y2 = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const scale = dv.getInt32(offset, true) / XY_SCALE; offset += 4;
        const traceNetIndex = dv.getUint32(offset, true); offset += 4;

        this.offset = offset;

        return {
            SEGMENT: {
                layer, x1, y1, x2, y2, scale,
                net_index: traceNetIndex
            }
        };
    }

    parseType06() {
        const dv = this.dataView;
        let offset = this.offset;

        const blockSize = dv.getUint32(offset, true); offset += 4;
        const unknown1 = dv.getUint32(offset, true); offset += 4;
        const posX = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const posY = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const textSize = dv.getUint32(offset, true) / XY_SCALE; offset += 4;
        const divider = dv.getUint32(offset, true); offset += 4;
        const empty = dv.getUint32(offset, true); offset += 4;
        const one = dv.getUint16(offset, true); offset += 2;
        const textLength = dv.getUint32(offset, true); offset += 4;

        this.offset = offset;
        const text = this.readString(textLength);

        return {
            TEXT: {
                unknown_1: unknown1, pos_x: posX, pos_y: posY,
                text_size: textSize, divider, empty, one,
                text_length: textLength, text
            }
        };
    }

    parseType07() {
        const blockSize = this.dataView.getUint32(this.offset, true);
        this.offset += 4;

        const encryptedData = new Uint8Array(
            this.dataView.buffer,
            this.dataView.byteOffset + this.offset,
            blockSize
        );
        this.offset += blockSize;

        let decryptedData;
        try {
            decryptedData = this.decryptWithDES(encryptedData);
        } catch (error) {
            console.error('Decryption failed:', error);
            decryptedData = encryptedData;
        }

        let parsedData = null;
        try {
            const partDataParser = new PartDataParser();
            parsedData = partDataParser.parse(decryptedData.buffer, blockSize);
        } catch (error) {
            console.error('PartData parsing failed:', error);
        }

        return {
            DATA: {
                block_size: blockSize,
                encrypted_data: Array.from(encryptedData),
                decrypted_data: Array.from(decryptedData),
                parsed_data: parsedData
            }
        };
    }

    parseType09() {
        const blockSize = this.dataView.getUint32(this.offset, true);
        this.offset += 4 + blockSize;
        return null; // Skip block
    }

    // Main parsing method with progress reporting
    parse(arrayBuffer) {
        this.dataView = new DataView(arrayBuffer);
        this.offset = 0;

        this.reportProgress(0, 10, 'Initializing parser');

        // XOR decryption logic
        if (this.dataView.getUint8(0x10) !== 0x00) {
            this.reportProgress(0.5, 10, 'Applying XOR decryption');

            const sequence = [0x76, 0x36, 0x76, 0x36, 0x35, 0x35, 0x35, 0x76, 0x36, 0x76, 0x36];
            const sequenceIndex = this.findSequence(this.dataView, sequence);

            const xoredDataLength = sequenceIndex !== -1 ? sequenceIndex : this.dataView.byteLength;
            const xorKey = this.dataView.getUint8(0x10);

            // Optimized XOR loop
            for (let i = 0; i < xoredDataLength; i++) {
                this.dataView.setUint8(i, this.dataView.getUint8(i) ^ xorKey);
            }
        }

        this.parseFileHeader();
        const blocks = this.parseMainDataBlocks();

        this.reportProgress(10, 20, 'Parsing complete');

        return {
            main_data_block: blocks
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RawPCBParser;
}
window.RawPCBParser = RawPCBParser;
export { RawPCBParser };