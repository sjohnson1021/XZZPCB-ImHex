#pragma pattern_limit 6000000

#include <std/mem.pat>
#include <std/string.pat>

u32 end_pos; // Temp value used for image & net blocks
u32 xored_data_length;
if (std::mem::read_unsigned(0x10, 1) != 0x00) {
    std::print("Not de-xored!");
    xored_data_length = std::mem::find_sequence(0, 0x76, 0x36, 0x76, 0x36, 0x35, 0x35, 0x35, 0x76, 0x36, 0x76, 0x36, 0x3D, 0x3D, 0x3D, 0xD7, 0xE8, 0xD6, 0xB5, 0x0A);
    if (xored_data_length == 4294967295) {
        xored_data_length = std::mem::size();
    }
    std::print("In data processor import the .hexnode and use {} as the size interger", xored_data_length);
    return;
};

/**
File header

Blocks identified by a u8
0x01 -> Arcs
0x02 -> Vias
0x03 -> Seen but known yet
0x04 -> Not seen
0x05 -> Line segments
0x06 -> Text
0x07 -> PART & PADS
0x08 -> Not seen
0x09 -> Test pads/Drill holes12

Image block size (Can be 0)
Images
Nets
v6v6555v6v6=== (If not included, no diode)
Diode Readings
*/


u32 main_data_blocks_size @ 0x40;

struct file_header_s {
    char filetype_signature[11];
    padding[21];
    u32 header_addresses_size;
    u32 image_block_start; // Relative to 0x20
    u32 net_block_start; // Relative to 0x20
    padding[20];
    u32 main_data_blocks_size;
};

/**
Layers:
    1->16   Trace Layers (Used in order excluding last which always uses 16, ie 1,2,3,4,16)
    17      Silkscreen
    18->27  Unknown
    28      Board edges 
*/

// Arcs
struct type_01 {
    u8 type_identifier_01;
    u32 block_size; // non-inclusive of type+size
    u32 layer;
    u32 x1;
    u32 y1;
    s32 r;
    s32 angle_start;
    s32 angle_end;
    s32 scale;
    s32 unknown_arc; // Havent seen not 0
};

// Vias
struct type_02 {
    u8 type_identifier_02;
    u32 block_size_type_02; // non-inclusive of type+size
    s32 x;
    s32 y;
    s32 layer_a_radius;
    s32 layer_b_radius;
    u32 layer_a_index;
    u32 layer_b_index;
    u32 net_index;
    u32 via_text_length; // Is only 0 or 1, if 1 there is an extra u8
    char via_text[via_text_length];
};

// Seen but unknown purpose
struct type_03 {
    u8 type_identifier_03;
    u32 block_size_type_03;
    u32 unknown; // Maybe net index? havent seen not 17
    u32 centre_x;
    u32 centre_y;
    u32 bl_corner_x; // Bottom left
    u32 bl_corner_y;
    u32 tr_corner_x; // Top right
    u32 tr_corner_y;
    u32 unknown2; // Havent seen not 0
    u32 unknown3; // Havent seen not 0
};

// Not seen
struct type_04 {
    u8 type_identifier_04;
};

// Line Segment
struct type_05 {
    u8 type_identifier_05;
    u32 block_size; // non-inclusive of type+size
    u32 layer;
    s32 x1;
    s32 y1;
    s32 x2;
    s32 y2;
    s32 scale;
    u32 trace_net_index;
};

// Text
struct type_06 {
    u8 type_identifier_06;
    u32 block_size; // non-inclusive of type+size
    u32 unknown_1;
    u32 pos_x;
    u32 pos_y;
    u32 text_size;
    u32 divider;
    u32 empty;
    u16 one;
    u32 text_length;
    char text[text_length];
};

// Part/pads
struct type_07 {
    u8 type_identifier_07;
    u32 block_size;
    u8 data[block_size];
};

// Not seen
struct type_08 {
    u8 type_identifier_08;
};

// Test pad/drill hole
struct type_09 {
    u8 type_identifier_09;
    u32 block_size;
    u32 pad_number;
    u32 x_origin;
    u32 y_origin;
    u32 inner_diameter; // 0 if filled in
    u32 unknown1;
    u32 name_length;
    char name[name_length];
    u32 outer_width_1;
    u32 outer_height_1;
    u8 flag1;
    u32 outer_width_2;
    u32 outer_height_2;
    u8 flag2;
    u32 outer_width_3;
    u32 outer_height_3;
    u8 flag3;
    u32 unknown2;
    u8 flag4;
    u32 net_index;
}; 

struct main_data_block {
    if (std::mem::eof()) {
        break;
    }
    if ($ >= main_data_blocks_size + 0x44) { // Main data block over
        break;
    }
    
    if (std::mem::read_unsigned($, 4) == 0) {
        padding[4];
    } else if ($[$]  == 0x01) {
        type_01 ARC;
    } else if ($[$] == 0x02) {
        type_02 VIA;
    } else if ($[$] == 0x03) {
        type_03 type03; // Still unknown purpose
    } else if ($[$] == 0x04) {
        type_04 type04;
        std::error("Block type 0x04 found, no handling for this");
    } else if ($[$] == 0x05) {
        type_05 SEGMENT;
    } else if ($[$] == 0x06) {
        type_06 TEXT;    
    } else if ($[$] == 0x07) {
        type_07 DATA;
    } else if ($[$] == 0x08) {
        type_08 type08;
        std::error("Block type 0x08 found, no handling for this");
    } else if ($[$] == 0x09) {
        type_09 TEST_PAD;
    } else {
        break;
    }    
};

// Images
struct single_image {
    u8 type;
    u8 index; // incrementing from 0
    u8 flag;
    u32 size_x;
    u32 size_y;
    u32 name_length;
    char name[name_length];
};

struct images_block {
    u32 block_size;
    end_pos = $ + block_size;
    single_image image[while($ < end_pos)];
};
 
// Nets
struct single_net {
    u32 size; // inclusive
    u32 index; // incrementing from 1
    char name[size-8];
};

struct net_block {
    u32 block_size;
    end_pos = $ + block_size;
    single_net net[while($ != end_pos)];
}; 

// v6v6555v6v6===
struct diode_header_v6v655 {
    u8 byte[18];
};

// Diode readings
struct diode_type_1 {
    u8 type_identifier_0A;
    if (std::mem::eof()) {
        return;
    }
    padding[1];
    char volt_reading[while(std::mem::read_unsigned($, 1) != 0x3D)];
    padding[1];
    char net[while(std::mem::read_unsigned($, 1) != 0x28)];
    padding[1];
    char pin_number[while(std::mem::read_unsigned($, 1) != 0x29)];
    padding[1];
};

struct diode_type_2 {
    
    u16 type_identifier_0D0A;
    if (std::mem::eof()) {
        return;
    }
    if (std::mem::read_unsigned($, 1) == 0x0D) {
        return;
    }
    char net_name[while(std::mem::read_unsigned($, 1) != 0x3D)];
    padding[1];
    char volt_reading[while(std::mem::read_unsigned($, 1) != 0x0D)];
};

struct diode_type_3 {
    u16 type_identifier_0D0A;
    if (std::mem::eof()) {
        return;
    }
    char net_name[while(std::mem::read_unsigned($, 1) != 0x3D)];
    padding[1];
    char volt_reading[while(std::mem::read_unsigned($, 1) != 0x0D)];
};

struct diode_readings {
    if ($[$] == 0x0A) {
        // Type 1
        diode_type_1 diode[while(!std::mem::eof())];
        return;
    } else if ($[$] != 0x0D) { 
        // Type 2
        u8 unknown[2];
        diode_type_2 diode[while(!std::mem::eof())];        
        return;
    } else if ($[$] == 0x0D) {
        // Type 3
        diode_type_3 diode[while(!std::mem::eof())];        
        return;
    }
    if (std::mem::eof()) {
        return;
    }
};  

///////////////////////////////////

file_header_s header @ 0;
main_data_block outline[60000] @ $; // Highest I've seen is ~56k
images_block images @ $;
net_block nets @ $;
if (std::mem::eof()) { // To handle files without diode readings
    return; 
}
diode_header_v6v655 diode_header_v6v655 @ $;
diode_readings diode_readings @ $;