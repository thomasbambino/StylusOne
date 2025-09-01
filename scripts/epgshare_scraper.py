#!/usr/bin/env python3

import requests
import gzip
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import sys
import argparse
from urllib.parse import urljoin
import configparser

def fetch_epgshare_data(base_url="https://epgshare01.online/epgshare01/"):
    """Fetch EPG data from EPGShare site"""
    
    # Try different US EPG files
    epg_files = [
        "epg_ripper_US_LOCALS2.xml.gz",
        "epg_ripper_US1.xml.gz", 
        "epg_ripper_US_LOCALS.xml.gz"
    ]
    
    for epg_file in epg_files:
        try:
            url = urljoin(base_url, epg_file)
            print(f"Fetching EPG data from {url}...")
            
            response = requests.get(url, timeout=30, stream=True)
            response.raise_for_status()
            
            # Handle gzip decompression
            if epg_file.endswith('.gz'):
                print("Decompressing gzip data...")
                content = gzip.decompress(response.content)
            else:
                content = response.content
            
            print(f"Successfully downloaded {len(content)} bytes")
            return content.decode('utf-8', errors='ignore')
            
        except Exception as e:
            print(f"Failed to fetch {epg_file}: {e}")
            continue
    
    raise Exception("Could not fetch any EPG data from EPGShare")

def filter_san_diego_channels(xmltv_content):
    """Filter XMLTV content for San Diego OTA channels"""
    
    # San Diego OTA channels we're looking for - map EPG names to HDHomeRun channel IDs
    san_diego_channels = {
        # EPG has KGTV-HD, KGTV, ABC (KGTV) San Diego, CA
        'KGTV': {'id': '10.1', 'name': 'ABC San Diego', 'network': 'ABC'},
        # EPG has KFMB-HD, KFMB, CBS (KFMB) San Diego, CA  
        'KFMB': {'id': '8.1', 'name': 'CBS San Diego', 'network': 'CBS'},
        # EPG has KNSD-DT, KNSD, NBC (KNSD) San Diego, CA
        'KNSD': {'id': '39.1', 'name': 'NBC San Diego', 'network': 'NBC'},
        # EPG has KSWB-HD, KSWB, FOX (KSWB) San Diego, CA
        'KSWB': {'id': '69.1', 'name': 'FOX San Diego', 'network': 'FOX'},
        # EPG has KPBS-HD, KPBS, PBS (KPBS) San Diego, CA
        'KPBS': {'id': '15.1', 'name': 'PBS San Diego', 'network': 'PBS'},
        # EPG has KUSI, KUSI - San Diego, CA
        'KUSI': {'id': '51.1', 'name': 'KUSI Independent', 'network': 'IND'}
    }
    
    try:
        root = ET.fromstring(xmltv_content)
        
        # Create new XMLTV document for San Diego channels
        new_root = ET.Element("tv")
        new_root.set("source-info-name", "EPGShare San Diego")
        new_root.set("generator-info-name", "HomelabDashboard")
        
        found_channels = set()
        found_programs = 0
        
        # Filter channels
        for channel in root.findall('channel'):
            channel_id = channel.get('id', '')
            
            # Get display name to check for San Diego channels
            display_names = [elem.text or '' for elem in channel.findall('display-name')]
            display_text = ' '.join(display_names).upper()
            
            # Check if this is a San Diego channel by call sign or display name
            for call_sign, info in san_diego_channels.items():
                if (call_sign in channel_id.upper() or 
                    call_sign in display_text or 
                    f"{call_sign}-HD" in display_text or 
                    f"{call_sign}-DT" in display_text or
                    f"({call_sign})" in display_text):
                    # Update channel ID to match our format
                    channel.set('id', info['id'])
                    new_root.append(channel)
                    found_channels.add(call_sign)
                    print(f"Found channel: {call_sign} ({display_text[:50]}) -> {info['id']}")
                    break
        
        # Filter programs for found channels
        for programme in root.findall('programme'):
            channel_id = programme.get('channel', '').upper()
            
            # Check if program belongs to a San Diego channel
            for call_sign, info in san_diego_channels.items():
                if (call_sign in channel_id or 
                    f"{call_sign}-HD" in channel_id or 
                    f"{call_sign}-DT" in channel_id):
                    # Update channel reference to match our format
                    programme.set('channel', info['id'])
                    new_root.append(programme)
                    found_programs += 1
                    break
        
        print(f"Filtered data: {len(found_channels)} channels, {found_programs} programs")
        
        if len(found_channels) > 0:
            return ET.tostring(new_root, encoding='unicode')
        else:
            print("No San Diego channels found in EPG data")
            return None
            
    except ET.ParseError as e:
        print(f"XML parsing error: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description='EPGShare San Diego OTA Scraper')
    parser.add_argument('-c', '--config', help='Config file path (optional)')
    parser.add_argument('-o', '--output', required=True, help='Output XMLTV file path')
    
    args = parser.parse_args()
    
    print("Fetching real EPG data from EPGShare...")
    
    try:
        # Fetch EPG data from EPGShare
        xmltv_content = fetch_epgshare_data()
        
        # Filter for San Diego channels
        filtered_content = filter_san_diego_channels(xmltv_content)
        
        if filtered_content:
            # Write filtered XMLTV file
            print(f"Writing San Diego EPG data to {args.output}")
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write('<?xml version="1.0" encoding="utf-8"?>\n')
                f.write(filtered_content)
            
            print("EPGShare San Diego data extraction completed!")
        else:
            print("No San Diego channel data found - generating fallback data")
            
            # Create minimal fallback data
            fallback_xml = '''<?xml version="1.0" encoding="utf-8"?>
<tv source-info-name="EPGShare San Diego Fallback" generator-info-name="HomelabDashboard">
  <channel id="10.1">
    <display-name>ABC San Diego</display-name>
  </channel>
  <channel id="8.1">
    <display-name>CBS San Diego</display-name>
  </channel>
  <channel id="39.1">
    <display-name>NBC San Diego</display-name>
  </channel>
  <channel id="69.1">
    <display-name>FOX San Diego</display-name>
  </channel>
  <programme channel="10.1" start="''' + datetime.now().strftime("%Y%m%d%H%M%S %z") + '''" stop="''' + (datetime.now() + timedelta(hours=1)).strftime("%Y%m%d%H%M%S %z") + '''">
    <title lang="en">EPG Data Loading...</title>
    <desc lang="en">Real EPG data is being loaded from EPGShare</desc>
  </programme>
</tv>'''
            
            with open(args.output, 'w', encoding='utf-8') as f:
                f.write(fallback_xml)
            
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()