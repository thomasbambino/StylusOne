#!/usr/bin/env python3

import requests
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
import sys
import configparser
import argparse
import time

class TVMazeScraper:
    def __init__(self):
        self.base_url = "http://api.tvmaze.com"
        self.session = requests.Session()
        
        # TVMaze doesn't require special headers but let's be polite
        self.session.headers.update({
            'User-Agent': 'HomelabDashboard/1.0 (EPG Scraper)',
            'Accept': 'application/json'
        })

    def get_schedule(self, country='US', date=None):
        """Get TV schedule from TVMaze API"""
        try:
            if date is None:
                date = datetime.now().strftime('%Y-%m-%d')
            
            print(f"Fetching TV schedule for {date} in {country}...")
            
            # TVMaze schedule endpoint
            url = f"{self.base_url}/schedule"
            params = {
                'country': country,
                'date': date
            }
            
            response = self.session.get(url, params=params, timeout=30)
            print(f"TVMaze API response: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"Retrieved {len(data)} scheduled shows")
                return data
            else:
                print(f"Error: {response.status_code} - {response.text}")
                return None
                
        except Exception as e:
            print(f"Error fetching TV schedule: {e}")
            return None

    def get_show_details(self, show_id):
        """Get detailed information about a show"""
        try:
            url = f"{self.base_url}/shows/{show_id}"
            response = self.session.get(url, timeout=15)
            
            if response.status_code == 200:
                return response.json()
            return None
            
        except Exception as e:
            print(f"Error fetching show details for {show_id}: {e}")
            return None

def create_xmltv_header():
    """Create the XMLTV root element with proper attributes"""
    root = ET.Element("tv")
    root.set("source-info-name", "TVMaze API")
    root.set("generator-info-name", "HomelabDashboard")
    root.set("generator-info-url", "http://api.tvmaze.com")
    return root

def add_channel_to_xmltv(root, channel_id, display_name):
    """Add a channel element to the XMLTV document"""
    channel = ET.SubElement(root, "channel")
    channel.set("id", channel_id)
    
    display = ET.SubElement(channel, "display-name")
    display.text = display_name

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

def parse_tvmaze_time(time_str):
    """Parse TVMaze time format to datetime"""
    try:
        # TVMaze uses ISO format like "2025-08-29T19:00:00-07:00"
        return datetime.fromisoformat(time_str)
    except:
        try:
            # Fallback parsing
            return datetime.strptime(time_str, "%Y-%m-%dT%H:%M:%S%z")
        except:
            return None

def convert_tvmaze_to_xmltv(tvmaze_data):
    """Convert TVMaze schedule data to XMLTV format"""
    root = create_xmltv_header()
    
    if not tvmaze_data:
        print("No data from TVMaze, creating empty XMLTV")
        return root
    
    # Extract channels and programs
    channels = {}
    programs = []
    
    for entry in tvmaze_data:
        try:
            # Extract show info
            show = entry.get('show', {})
            show_name = show.get('name', 'Unknown Show')
            
            # Extract network/channel info
            network = show.get('network', {}) or show.get('webChannel', {})
            if not network:
                network = {'name': 'Unknown Network', 'id': 'unknown'}
            
            channel_name = network.get('name', 'Unknown Network')
            channel_id = str(network.get('id', channel_name.lower().replace(' ', '-')))
            
            # Store channel
            channels[channel_id] = channel_name
            
            # Extract timing
            airstamp = entry.get('airstamp')  # ISO format with timezone
            airtime = entry.get('airtime')    # HH:MM format
            runtime = entry.get('runtime', 30)  # Duration in minutes
            
            if airstamp:
                start_dt = parse_tvmaze_time(airstamp)
                if start_dt:
                    end_dt = start_dt + timedelta(minutes=runtime)
                    
                    # Extract episode info
                    episode_name = entry.get('name', '')
                    season = entry.get('season')
                    number = entry.get('number')
                    
                    # Create title
                    title = show_name
                    if episode_name:
                        title += f": {episode_name}"
                    if season and number:
                        title += f" (S{season:02d}E{number:02d})"
                    
                    # Create description
                    description = show.get('summary', '').replace('<p>', '').replace('</p>', '').replace('<b>', '').replace('</b>', '')
                    if entry.get('summary'):
                        description = entry['summary'].replace('<p>', '').replace('</p>', '').replace('<b>', '').replace('</b>', '')
                    
                    programs.append({
                        'channel_id': channel_id,
                        'start_time': format_xmltv_time(start_dt),
                        'end_time': format_xmltv_time(end_dt),
                        'title': title,
                        'description': description
                    })
                    
        except Exception as e:
            print(f"Error processing entry: {e}")
            continue
    
    # Add channels to XMLTV
    for channel_id, channel_name in channels.items():
        add_channel_to_xmltv(root, channel_id, channel_name)
    
    # Add programs to XMLTV
    for program in programs:
        add_program_to_xmltv(root, 
                           program['channel_id'],
                           program['start_time'],
                           program['end_time'],
                           program['title'],
                           program['description'])
    
    print(f"Created XMLTV with {len(channels)} channels and {len(programs)} programs")
    return root

def main():
    parser = argparse.ArgumentParser(description='TVMaze API Scraper')
    parser.add_argument('-c', '--config', required=True, help='Config file path')
    parser.add_argument('-o', '--output', required=True, help='Output XMLTV file path')
    
    args = parser.parse_args()
    
    # Load config
    config = configparser.ConfigParser()
    config.read(args.config)
    
    print("Starting TVMaze API scraping...")
    
    scraper = TVMazeScraper()
    
    # Get today's schedule
    today = datetime.now().strftime('%Y-%m-%d')
    data = scraper.get_schedule(country='US', date=today)
    
    if not data:
        # Try tomorrow's schedule as fallback
        tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        print("Today's schedule failed, trying tomorrow...")
        data = scraper.get_schedule(country='US', date=tomorrow)
    
    if data:
        print("Successfully retrieved TV schedule data from TVMaze!")
        print(f"Found {len(data)} scheduled programs")
        
        # Show sample of what we got
        for i, entry in enumerate(data[:3]):
            show_name = entry.get('show', {}).get('name', 'Unknown')
            network = entry.get('show', {}).get('network', {})
            if network:
                network_name = network.get('name', 'Unknown')
            else:
                network_name = 'Web/Streaming'
            airstamp = entry.get('airstamp', 'Unknown time')
            print(f"Sample {i+1}: {show_name} on {network_name} at {airstamp}")
    else:
        print("Could not retrieve data from TVMaze API")
    
    # Convert to XMLTV
    root = convert_tvmaze_to_xmltv(data)
    
    # Write XMLTV file
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ", level=0)
    
    print(f"Writing XMLTV data to {args.output}")
    tree.write(args.output, encoding='utf-8', xml_declaration=True)
    
    print("TVMaze scraping completed!")

if __name__ == "__main__":
    main()