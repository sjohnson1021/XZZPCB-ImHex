# Credit to @MuertoGB for cracking the main DES decryption key

from Crypto.Cipher import DES
from Crypto.Util.Padding import unpad
import binascii
import struct
import sys
import os
import argparse

# Hardcoded DES key in hexadecimal format
MASTER_KEY = "DCFC12AC00000000"


def hex_to_bytes(hex_string):
    return binascii.unhexlify(hex_string)


def decrypt_with_des(encrypted_data):
    key = hex_to_bytes(MASTER_KEY)
    des = DES.new(key, DES.MODE_ECB)
    print("Encrypted data:", " ".join(f"{b:02x}" for b in encrypted_data))
    decrypted_data = des.decrypt(encrypted_data)

    # Unpad the data if it's padded with PKCS7
    try:
        decrypted_data = unpad(decrypted_data, DES.block_size)
    except ValueError:
        # If unpadding fails, no padding was used
        pass

    return decrypted_data


def de_xor_data(data):
    data = bytearray(data)
    key = data[0x10]
    search_pattern = bytes(
        [
            0x76,
            0x36,
            0x76,
            0x36,
            0x35,
            0x35,
            0x35,
            0x76,
            0x36,
            0x76,
            0x36,
            0x3D,
            0x3D,
            0x3D,
            0xD7,
            0xE8,
            0xD6,
            0xB5,
            0x0A,
        ]
    )
    position = data.find(search_pattern)
    if position == -1:
        return bytearray(a ^ key for a in data)
    else:
        print(f"Diode reading header found at position: {position}")
        return bytearray(a ^ key for a in data[:position]) + data[position:]


def extract_encrypted_blocks(data):
    print("Extracting encrypted blocks...")
    data = bytearray(data)
    encrypted_blocks = []
    labels = []

    if data[0x10] != 0x00:
        print("XORing data...")
        data = de_xor_data(data)

    current_pointer = 0x40
    main_data_blocks_size = struct.unpack(
        "<I", data[current_pointer : current_pointer + 4]
    )[0]
    current_pointer += 4

    while current_pointer < 0x44 + main_data_blocks_size:
        block_type = data[current_pointer : current_pointer + 1]
        current_pointer += 1
        block_size = struct.unpack("<I", data[current_pointer : current_pointer + 4])[0]
        current_pointer += 4
        if block_type == b"\x07":
            encrypted_blocks.append(
                data[current_pointer : current_pointer + block_size]
            )
            current_pointer += block_size
        else:
            current_pointer += block_size
    return encrypted_blocks


def decrypt_file(data):
    print("Decrypting file...")
    data = bytearray(data)

    if data[0x10] != 0x00:
        print("XORing data...")
        data = de_xor_data(data)

    current_pointer = 0x40
    main_data_blocks_size = struct.unpack(
        "<I", data[current_pointer : current_pointer + 4]
    )[0]
    current_pointer += 4

    while current_pointer < 0x44 + main_data_blocks_size:
        block_type = data[current_pointer : current_pointer + 1]
        current_pointer += 1
        block_size = struct.unpack("<I", data[current_pointer : current_pointer + 4])[0]
        current_pointer += 4
        if block_type == b"\x07":
            decrypted_data = decrypt_with_des(
                data[current_pointer : current_pointer + block_size]
            )
            data = (
                data[:current_pointer]
                + decrypted_data
                + data[current_pointer + block_size :]
            )
            current_pointer += block_size
        else:
            current_pointer += block_size

    return data


def main(input_file, mode):
    # Read the encrypted data from the input file
    with open(input_file, "rb") as f:
        encrypted_data = f.read()

    if mode == "-e":
        output_file = os.path.basename(input_file).replace(".pcb", "")
        output_directory = os.path.join(
            os.path.dirname(input_file), f"{output_file}_decrypted_blocks"
        )
        if not os.path.exists(output_directory):
            os.makedirs(output_directory)

        encrypted_blocks = extract_encrypted_blocks(encrypted_data)
        for index, block in enumerate(encrypted_blocks):
            decrypted_data = decrypt_with_des(block)

            pointer = 22
            pointer += struct.unpack("<I", decrypted_data[pointer : pointer + 4])[0]
            pointer += 4
            pointer += 31
            label_len = struct.unpack("<I", decrypted_data[pointer : pointer + 4])[0]
            pointer += 4
            label = decrypted_data[pointer : pointer + label_len]
            label = label.decode("utf-8")

            with open(
                os.path.join(
                    output_directory,
                    f"{label}_{output_file}_block_{index}.decrypted.dat",
                ),
                "wb",
            ) as f:
                f.write(decrypted_data)
    if mode == "-d":
        output_file = input_file.replace(".pcb", ".decrypted.pcb")
        decrypted_data = decrypt_file(encrypted_data)
        with open(output_file, "wb") as f:
            f.write(decrypted_data)

    print(f"Decryption successful!")


def parse_arguments():
    parser = argparse.ArgumentParser(description="Decrypt PCB files.")
    parser.add_argument(
        "-e",
        action="store_true",
        help="Extract and decrypt blocks from the input file.",
    )
    parser.add_argument(
        "-d", action="store_true", help="Decrypt the entire input file."
    )
    parser.add_argument(
        "-f", "--file", required=True, help="Path to the input PCB file."
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_arguments()
    if args.e or args.d:
        main(args.file, "-e" if args.e else "-d")
    else:
        print(
            "Invalid mode. Use -e to decrypt and extract blocks, or -d to decrypt and make decrypted .pcb."
        )
        print("Usage: python XZZ_PCB_Decrypt.py <-e|-d> -f <input file>")
        sys.exit(1)
