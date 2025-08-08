#pragma pattern_limit 100000000
#pragma array_limit 10000000
#include <std/mem.pat>
#include <std/string.pat>

struct root_folder {
    char name[while($[$] != 0x00)];
    padding[1];
    u32 type;
    padding[12];
    //u32 unknown2;
    //u32 unknown3;
    //u32 unknown4;
    u32 depth;
};

struct filesystem {
    char name[while($[$] != 0x00)];
    padding[1];
    if (std::mem::read_unsigned($,4,0) == 0x02) {
        std::print("Woah type 2 at {}", std::string::to_string($));
    }
    if (std::mem::read_unsigned($,4,0) >= 0x07) {
        std::print("Woah new type at {}", std::string::to_string($));
    }
    u32 type;
    padding[12];
    //u32 unknown2;
    //u32 unknown3;
    //u32 unknown4;
    u32 depth;
};

/*
type:
1 -> folder
2 -> unused
3 -> .tvw / .pcb
4 -> .pdf
5 -> .zip
6 -> weblink
*/

filesystem folder_0_header @ $;
filesystem folder_0[while(!std::mem::eof() && $[$] != 0x7B)] @ $;
filesystem folder_1_header @ $;
filesystem folder_1[while(!std::mem::eof() && $[$] != 0x7B)] @ $;
filesystem folder_2_header @ $;
filesystem folder_2[while(!std::mem::eof() && $[$] != 0x7B)] @ $;
filesystem folder_3_header @ $;
filesystem folder_3[while(!std::mem::eof() && $[$] != 0x7B)] @ $;
filesystem folder_4_header @ $;
filesystem folder_4[while(!std::mem::eof() && $[$] != 0x7B)] @ $;
filesystem folder_5_header @ $;
//filesystem folder_5[while(!std::mem::eof() && $[$] != 0x7B)] @ $;