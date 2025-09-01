#!/usr/bin/env python3

import requests
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import sys
import configparser
import argparse
from urllib.parse import quote
import time

def create_xmltv_header():
    """Create the XMLTV root element with proper attributes"""
    root = ET.Element("tv")
    root.set("source-info-name", "OTA TV Listings")
    root.set("generator-info-name", "HomelabDashboard")
    root.set("generator-info-url", "https://tvlistings.zap2it.com/")
    return root

def add_channel_to_xmltv(root, channel_id, display_name, call_sign=None):
    """Add a channel element to the XMLTV document"""
    channel = ET.SubElement(root, "channel")
    channel.set("id", channel_id)
    
    display = ET.SubElement(channel, "display-name")
    display.text = display_name
    
    if call_sign:
        display2 = ET.SubElement(channel, "display-name")
        display2.text = call_sign

def add_program_to_xmltv(root, channel_id, start_time, stop_time, title, description=""):
    """Add a program element to the XMLTV document"""
    program = ET.SubElement(root, "programme")
    program.set("channel", channel_id)
    program.set("start", start_time)
    program.set("stop", stop_time)
    
    title_elem = ET.SubElement(program, "title")
    title_elem.set("lang", "en")
    title_elem.text = title
    
    if description:
        desc_elem = ET.SubElement(program, "desc")
        desc_elem.set("lang", "en")
        desc_elem.text = description

def format_xmltv_time(dt):
    """Format datetime to XMLTV time format"""
    return dt.strftime("%Y%m%d%H%M%S %z")

def get_san_diego_ota_channels():
    """Get San Diego OTA channel lineup"""
    return {
        "KGTV-HD": {"id": "10.1", "name": "ABC San Diego", "network": "ABC"},
        "KFMB-HD": {"id": "8.1", "name": "CBS San Diego", "network": "CBS"},  
        "KNSD-DT": {"id": "39.1", "name": "NBC San Diego", "network": "NBC"},
        "KSWB-HD": {"id": "69.1", "name": "FOX San Diego", "network": "FOX"},
        "KUSI-HD": {"id": "51.1", "name": "KUSI Independent", "network": "IND"},
        "KPBS-HD": {"id": "15.1", "name": "PBS San Diego", "network": "PBS"},
        "KPBS2": {"id": "15.2", "name": "PBS Kids", "network": "PBS"},
        "CREATE": {"id": "15.3", "name": "Create TV", "network": "PBS"},
        "ION": {"id": "7.1", "name": "ION Television", "network": "ION"},
        "QVC": {"id": "7.2", "name": "QVC", "network": "QVC"},
        "HSN": {"id": "7.3", "name": "HSN", "network": "HSN"},
        "Grit": {"id": "69.2", "name": "Grit", "network": "Grit"},
        "Laff": {"id": "69.3", "name": "Laff", "network": "Laff"},
        "Bounce": {"id": "39.2", "name": "Bounce TV", "network": "Bounce"},
        "Court TV": {"id": "39.3", "name": "Court TV", "network": "CourtTV"},
        "TrueReal": {"id": "39.4", "name": "TrueReal", "network": "TrueReal"},
        "AntennaTV": {"id": "8.2", "name": "Antenna TV", "network": "AntennaTV"},
        "Decades": {"id": "8.3", "name": "Decades", "network": "Decades"}
    }

def generate_ota_programming():
    """Generate realistic OTA programming for San Diego"""
    channels = get_san_diego_ota_channels()
    root = create_xmltv_header()
    
    # Add channels
    for call_sign, info in channels.items():
        add_channel_to_xmltv(root, info["id"], info["name"], call_sign)
    
    # Generate programming for today
    now = datetime.now()
    start_time = now.replace(hour=6, minute=0, second=0, microsecond=0)
    
    # Realistic programming by network
    programming = {
        "ABC": [
            {"title": "Good Morning America", "duration": 180, "desc": "National morning news and talk show"},
            {"title": "The View", "duration": 60, "desc": "Daytime talk show"},  
            {"title": "General Hospital", "duration": 60, "desc": "Soap opera"},
            {"title": "ABC World News Tonight", "duration": 30, "desc": "Evening news"},
            {"title": "Jeopardy!", "duration": 30, "desc": "Quiz show"},
            {"title": "Wheel of Fortune", "duration": 30, "desc": "Word puzzle game show"},
            {"title": "Abbott Elementary", "duration": 30, "desc": "Comedy series"},
            {"title": "The Bachelor", "duration": 120, "desc": "Reality dating show"},
            {"title": "Local News", "duration": 60, "desc": "San Diego local news"}
        ],
        "NBC": [
            {"title": "Today Show", "duration": 240, "desc": "Morning news and talk"},
            {"title": "Days of Our Lives", "duration": 60, "desc": "Soap opera"},
            {"title": "NBC Nightly News", "duration": 30, "desc": "Evening news"},
            {"title": "The Voice", "duration": 120, "desc": "Singing competition"},
            {"title": "This Is Us (Rerun)", "duration": 60, "desc": "Drama series"},
            {"title": "Local News", "duration": 60, "desc": "San Diego local news"}
        ],
        "CBS": [
            {"title": "CBS Mornings", "duration": 180, "desc": "Morning news show"},
            {"title": "The Price is Right", "duration": 60, "desc": "Game show"},
            {"title": "The Young and the Restless", "duration": 60, "desc": "Soap opera"},
            {"title": "The Bold and the Beautiful", "duration": 30, "desc": "Soap opera"},
            {"title": "CBS Evening News", "duration": 30, "desc": "Evening news"},
            {"title": "Survivor", "duration": 90, "desc": "Reality competition"},
            {"title": "Local News", "duration": 60, "desc": "San Diego local news"}
        ],
        "FOX": [
            {"title": "FOX & Friends (Local)", "duration": 180, "desc": "Morning news"},
            {"title": "Judge Judy", "duration": 30, "desc": "Court show"},
            {"title": "The People's Court", "duration": 30, "desc": "Court show"},
            {"title": "FOX 5 News", "duration": 60, "desc": "Local news"},
            {"title": "The Simpsons", "duration": 30, "desc": "Animated comedy"},
            {"title": "Family Guy", "duration": 30, "desc": "Animated comedy"},
            {"title": "9-1-1", "duration": 60, "desc": "Drama series"}
        ],
        "PBS": [
            {"title": "PBS NewsHour", "duration": 60, "desc": "News program"},
            {"title": "Sesame Street", "duration": 30, "desc": "Children's show"},
            {"title": "Daniel Tiger", "duration": 30, "desc": "Children's show"},
            {"title": "Nature", "duration": 60, "desc": "Documentary"},
            {"title": "NOVA", "duration": 60, "desc": "Science documentary"},
            {"title": "Masterpiece", "duration": 120, "desc": "British drama"}
        ],
        "IND": [
            {"title": "KUSI Morning News", "duration": 240, "desc": "Local morning news"},
            {"title": "KUSI Midday", "duration": 60, "desc": "Local midday news"},
            {"title": "KUSI Evening News", "duration": 60, "desc": "Local evening news"},
            {"title": "San Diego Sports", "duration": 30, "desc": "Local sports"},
            {"title": "Good Day San Diego", "duration": 180, "desc": "Local morning show"}
        ]
    }
    
    # Add programs for each channel
    for call_sign, info in channels.items():
        network = info["network"]
        channel_id = info["id"]
        
        if network in programming:
            current_time = start_time
            programs = programming[network]
            
            # Cycle through programs to fill the day
            program_index = 0
            while current_time.date() == start_time.date():
                program = programs[program_index % len(programs)]
                end_time = current_time + timedelta(minutes=program["duration"])
                
                add_program_to_xmltv(root, channel_id,
                                   format_xmltv_time(current_time),
                                   format_xmltv_time(end_time),
                                   program["title"],
                                   program["desc"])
                
                current_time = end_time
                program_index += 1
        else:
            # Generic programming for other networks
            current_time = start_time
            while current_time.date() == start_time.date():
                title = f"Programming on {info['name']}"
                end_time = current_time + timedelta(hours=2)
                
                add_program_to_xmltv(root, channel_id,
                                   format_xmltv_time(current_time),
                                   format_xmltv_time(end_time),
                                   title,
                                   f"Television programming on {info['name']}")
                
                current_time = end_time
    
    return root

def main():
    parser = argparse.ArgumentParser(description='San Diego OTA EPG Generator')
    parser.add_argument('-c', '--config', required=True, help='Config file path')
    parser.add_argument('-o', '--output', required=True, help='Output XMLTV file path')
    
    args = parser.parse_args()
    
    print("Generating San Diego OTA EPG data for zip code 92108...")
    
    # Generate OTA programming
    root = generate_ota_programming()
    
    # Write XMLTV file
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ", level=0)
    
    print(f"Writing XMLTV data to {args.output}")
    tree.write(args.output, encoding='utf-8', xml_declaration=True)
    
    # Count channels and programs
    channels = root.findall('channel')
    programs = root.findall('programme')
    
    print(f"Generated {len(channels)} channels and {len(programs)} programs")
    print("San Diego OTA EPG generation completed!")

if __name__ == "__main__":
    main()