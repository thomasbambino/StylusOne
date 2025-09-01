#!/usr/bin/env python3

import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import sys
import argparse
import time
import re

def create_empty_san_diego_guide():
    """Create empty San Diego OTA channel guide with only channel definitions, no program data"""
    
    root = ET.Element("tv")
    root.set("source-info-name", "San Diego OTA Guide")
    root.set("generator-info-name", "HomelabDashboard")
    root.set("generator-info-url", "https://epgshare01.online/epgshare01/")
    
    # San Diego OTA channels that may be available  
    channels = {
        # Major Network Affiliates
        '10.1': {'name': 'ABC San Diego', 'call': 'KGTV'},
        '8.1': {'name': 'CBS San Diego', 'call': 'KFMB'},
        '39.1': {'name': 'NBC San Diego', 'call': 'KNSD'},
        '69.1': {'name': 'FOX San Diego', 'call': 'KSWB'},
        '15.1': {'name': 'PBS San Diego', 'call': 'KPBS'},
        '51.1': {'name': 'KUSI Independent', 'call': 'KUSI'},
        
        # Digital Subchannels - CBS (KFMB)
        '8.2': {'name': 'Antenna TV', 'call': 'KFMB-DT2'},
        '8.3': {'name': 'Decades', 'call': 'KFMB-DT3'},
        
        # Digital Subchannels - PBS (KPBS)  
        '15.2': {'name': 'PBS Kids', 'call': 'KPBS2'},
        '15.3': {'name': 'Create TV', 'call': 'KPBS3'},
        
        # Digital Subchannels - NBC (KNSD)
        '39.2': {'name': 'Bounce TV', 'call': 'KNSD-DT2'},
        '39.3': {'name': 'Court TV', 'call': 'KNSD-DT3'},
        
        # Digital Subchannels - FOX (KSWB)
        '69.2': {'name': 'Grit', 'call': 'KSWB-DT2'},
        '69.3': {'name': 'Laff', 'call': 'KSWB-DT3'},
        
        # Additional OTA Channels
        '45.1': {'name': 'The CW', 'call': 'KFMB-TV2'},
    }
    
    # Add channels to XMLTV (channels only, no programming)
    for channel_id, info in channels.items():
        channel = ET.SubElement(root, "channel")
        channel.set("id", channel_id)
        
        display = ET.SubElement(channel, "display-name")
        display.text = info['name']
        
        display2 = ET.SubElement(channel, "display-name")
        display2.text = info['call']
    
    return root

def main():
    parser = argparse.ArgumentParser(description='Empty San Diego OTA Channel Guide')
    parser.add_argument('-c', '--config', help='Config file path (optional)')
    parser.add_argument('-o', '--output', required=True, help='Output XMLTV file path')
    
    args = parser.parse_args()
    
    print("Creating empty San Diego OTA channel guide (real data only)...")
    
    try:
        # Create channels only, no program data
        root = create_empty_san_diego_guide()
        
        # Write XMLTV file
        tree = ET.ElementTree(root)
        ET.indent(tree, space="  ", level=0)
        
        print(f"Writing channel definitions to {args.output}")
        tree.write(args.output, encoding='utf-8', xml_declaration=True)
        
        # Count channels
        channels = root.findall('channel')
        programs = root.findall('programme')
        
        print(f"Created {len(channels)} channel definitions with {len(programs)} programs")
        print("Channels will show blank until real EPG data is available from EPGShare")
        
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()