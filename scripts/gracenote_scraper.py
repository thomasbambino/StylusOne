#!/usr/bin/env python3

import requests
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import sys
import configparser
import argparse
from urllib.parse import urlparse, parse_qs
import re
import time
from bs4 import BeautifulSoup

class GracenoteScraper:
    def __init__(self, zip_code='92108'):
        self.zip_code = zip_code
        self.session = requests.Session()
        
        # Set realistic headers to avoid blocking
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none'
        })

    def get_tv_listings(self):
        """Get TV listings from Gracenote"""
        try:
            print(f"Fetching TV listings for zip code {self.zip_code}...")
            
            # First, try the main listings page
            base_url = "https://tvlistings.gracenote.com/"
            
            # Add delay to be respectful
            time.sleep(2)
            
            response = self.session.get(base_url, timeout=30)
            print(f"Base page response: {response.status_code}")
            
            if response.status_code == 200:
                # Look for JavaScript that loads the listings
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # Look for data endpoints or configuration
                scripts = soup.find_all('script')
                for script in scripts:
                    if script.string and ('api' in script.string.lower() or 'lineup' in script.string.lower()):
                        print(f"Found potential API script: {script.string[:200]}...")
                
                # Try to find the grid page with affiliate ID
                grid_url = f"https://tvlistings.gracenote.com/grid-affiliates.html?aid=orbebb&zipcode={self.zip_code}"
                print(f"Trying grid URL: {grid_url}")
                
                time.sleep(2)
                grid_response = self.session.get(grid_url, timeout=30)
                print(f"Grid response: {grid_response.status_code}")
                
                if grid_response.status_code == 200:
                    return self.parse_grid_page(grid_response.text)
                
            return None
            
        except Exception as e:
            print(f"Error fetching TV listings: {e}")
            return None

    def parse_grid_page(self, html_content):
        """Parse the grid page to extract listings"""
        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Look for the TV grid data
            listings = []
            
            # Common patterns for TV listing data
            grid_elements = soup.find_all(['div', 'td', 'span'], class_=re.compile(r'(program|listing|show|channel)', re.I))
            
            for element in grid_elements[:10]:  # Limit to first 10 for debugging
                text = element.get_text(strip=True)
                if text and len(text) > 5:  # Only meaningful text
                    print(f"Found element: {text}")
            
            # Look for JSON data embedded in the page
            scripts = soup.find_all('script')
            for script in scripts:
                if script.string:
                    # Look for JSON-like data
                    if 'programs' in script.string or 'listings' in script.string or 'channels' in script.string:
                        print(f"Found data script: {script.string[:500]}...")
                        
                        # Try to extract JSON
                        json_match = re.search(r'(\{.*\})', script.string, re.DOTALL)
                        if json_match:
                            try:
                                data = json.loads(json_match.group(1))
                                return data
                            except json.JSONDecodeError:
                                pass
            
            return {'channels': [], 'programs': []}
            
        except Exception as e:
            print(f"Error parsing grid page: {e}")
            return None

    def try_api_endpoints(self):
        """Try various API endpoints that might work"""
        endpoints_to_try = [
            f"https://tvlistings.gracenote.com/api/grid?zipcode={self.zip_code}",
            f"https://tvlistings.gracenote.com/api/listings?zip={self.zip_code}",
            f"https://tvlistings.gracenote.com/gapzap_webapi/api/airings?lineupId=USA-OTA-{self.zip_code}",
            f"https://tvlistings.gracenote.com/data/listings/{self.zip_code}",
        ]
        
        for endpoint in endpoints_to_try:
            try:
                print(f"Trying endpoint: {endpoint}")
                time.sleep(1)
                
                response = self.session.get(endpoint, timeout=15)
                print(f"Response: {response.status_code}")
                
                if response.status_code == 200:
                    try:
                        data = response.json()
                        if data and (isinstance(data, dict) or isinstance(data, list)):
                            print(f"Success! Found data at: {endpoint}")
                            return data
                    except json.JSONDecodeError:
                        # Maybe it's HTML with data
                        if len(response.text) > 100:
                            print(f"Got HTML response from: {endpoint}")
                            return self.parse_grid_page(response.text)
                
            except Exception as e:
                print(f"Error with endpoint {endpoint}: {e}")
                continue
        
        return None

def create_xmltv_header():
    """Create the XMLTV root element with proper attributes"""
    root = ET.Element("tv")
    root.set("source-info-name", "Gracenote TV Listings")
    root.set("generator-info-name", "HomelabDashboard")
    root.set("generator-info-url", "https://tvlistings.gracenote.com/")
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

def convert_gracenote_data_to_xmltv(gracenote_data):
    """Convert Gracenote data to XMLTV format"""
    root = create_xmltv_header()
    
    if not gracenote_data:
        print("No data from Gracenote, creating empty XMLTV")
        return root
    
    # Process the data based on its structure
    if isinstance(gracenote_data, dict):
        if 'channels' in gracenote_data:
            for channel in gracenote_data['channels']:
                channel_id = channel.get('id', channel.get('number', 'unknown'))
                channel_name = channel.get('name', channel.get('callsign', 'Unknown'))
                add_channel_to_xmltv(root, str(channel_id), channel_name)
        
        if 'programs' in gracenote_data or 'listings' in gracenote_data:
            programs = gracenote_data.get('programs', gracenote_data.get('listings', []))
            for program in programs:
                channel_id = str(program.get('channel_id', program.get('channelId', 'unknown')))
                title = program.get('title', program.get('name', 'Unknown Program'))
                
                # Handle time formats
                start_time = program.get('start_time', program.get('startTime'))
                end_time = program.get('end_time', program.get('endTime'))
                
                if start_time and end_time:
                    # Convert to datetime if needed
                    if isinstance(start_time, str):
                        try:
                            start_dt = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                            end_dt = datetime.fromisoformat(end_time.replace('Z', '+00:00'))
                            
                            add_program_to_xmltv(root, channel_id,
                                                format_xmltv_time(start_dt),
                                                format_xmltv_time(end_dt),
                                                title,
                                                program.get('description', ''))
                        except:
                            pass
    
    return root

def main():
    parser = argparse.ArgumentParser(description='Gracenote TV Listings Scraper')
    parser.add_argument('-c', '--config', required=True, help='Config file path')
    parser.add_argument('-o', '--output', required=True, help='Output XMLTV file path')
    
    args = parser.parse_args()
    
    # Load config
    config = configparser.ConfigParser()
    config.read(args.config)
    zip_code = config.get('prefs', 'zipCode', fallback='92108')
    
    print(f"Starting Gracenote scraping for zip code {zip_code}")
    
    scraper = GracenoteScraper(zip_code)
    
    # Try multiple approaches
    data = scraper.get_tv_listings()
    if not data:
        print("Grid scraping failed, trying API endpoints...")
        data = scraper.try_api_endpoints()
    
    if data:
        print("Successfully retrieved real TV listing data!")
        print(f"Data type: {type(data)}")
        if isinstance(data, dict):
            print(f"Data keys: {list(data.keys())}")
    else:
        print("Could not retrieve real data from Gracenote")
    
    # Convert to XMLTV
    root = convert_gracenote_data_to_xmltv(data)
    
    # Write XMLTV file
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ", level=0)
    
    print(f"Writing XMLTV data to {args.output}")
    tree.write(args.output, encoding='utf-8', xml_declaration=True)
    
    print("Gracenote scraping completed!")

if __name__ == "__main__":
    main()