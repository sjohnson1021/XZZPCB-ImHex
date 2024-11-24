import requests
from bs4 import BeautifulSoup
import os
import csv

# CSV made from https://www.herongyang.com/GB2312/GB2312-to-Unicode-Map-Level-1-Characters.html                
            
def translate_bytes(input_bytes):
    # Create a dictionary to map byte pairs to GB2312 characters
    gb2312_lookup = {}
    with open('GB2312_Characters.csv', mode='r', encoding='utf-8') as csv_file:
        csv_reader = csv.reader(csv_file)
        next(csv_reader)  # Skip header
        for row in csv_reader:
            gb2312_lookup[row[2]] = row[1]  # Map utf_bytes to gb_char

    output_chars = []
    i = 0
    while i < len(input_bytes):
        byte = input_bytes[i]
        byte_int = int(byte, 16)
        if 0 <= byte_int <= 127:  # ASCII range
            output_chars.append(chr(byte_int))
            i += 1
        else:
            if i + 1 < len(input_bytes):
                byte_pair = input_bytes[i:i+2]
                byte_pair_str = ''.join(byte_pair)  # Convert to hex string
                if byte_pair_str in gb2312_lookup:
                    output_chars.append(gb2312_lookup[byte_pair_str])
                i += 2
            else:
                # Handle the case where there's a single byte left
                output_chars.append('?')  # Placeholder for unrecognized byte
                i += 1

    return ''.join(output_chars)

# Can be used to translate bytes without converting to utf-8 first
def translate_bytes_no_utf8(input_bytes):
    # Create a dictionary to map byte pairs to GB2312 characters
    gb2312_lookup = {}
    with open('GB2312_Characters.csv', mode='r', encoding='utf-8') as csv_file:
        csv_reader = csv.reader(csv_file)
        next(csv_reader)  # Skip header
        for row in csv_reader:
            gb2312_lookup[row[2]] = row[1]  # Map utf_bytes to gb_char

    output_chars = []
    i = 0
    while i < len(input_bytes):
        if i + 1 < len(input_bytes):
            byte_pair = input_bytes[i:i+2]
            byte_pair_str = ''.join(byte_pair)  # Convert to hex string
            if byte_pair_str in gb2312_lookup:
                output_chars.append(gb2312_lookup[byte_pair_str])
            i += 2
        else:
            # Handle the case where there's a single byte left
            output_chars.append('?')  # Placeholder for unrecognized byte
            i += 1

    return ''.join(output_chars)

user_input = input("Enter bytes separated by spaces: ")
byte_list = [byte for byte in user_input.split()]
translated_output = translate_bytes(byte_list)
print("Translated output:", translated_output)
