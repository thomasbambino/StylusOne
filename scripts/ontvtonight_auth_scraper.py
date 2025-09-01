#!/usr/bin/env python3

import requests
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
import sys
import argparse
import time
import re
from urllib.parse import urlencode, urlparse
from bs4 import BeautifulSoup

class OnTVTonightScraper:
    def __init__(self, username, password):
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        })
        
    def login(self):
        """Login to OnTVTonight account"""
        print(f"Logging into OnTVTonight with account: {self.username}")
        
        # Get login page first
        login_url = "https://www.ontvtonight.com/user/login/"
        response = self.session.get(login_url, timeout=30)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Look for login form and CSRF tokens
        login_form = soup.find('form', action=re.compile(r'login', re.I))
        if not login_form:
            # Try to find any form with username/email field
            login_form = soup.find('form', lambda x: x and soup.find('input', {'name': re.compile(r'(username|email)', re.I)}))
        
        if login_form:
            form_action = login_form.get('action', '/login')
            if not form_action.startswith('http'):
                form_action = 'https://www.ontvtonight.com' + form_action
            
            # Extract form data
            form_data = {}
            for input_field in login_form.find_all('input'):
                name = input_field.get('name')
                value = input_field.get('value', '')
                if name:
                    form_data[name] = value
            
            # Set username and password
            username_field = None
            password_field = None
            
            for field_name in form_data.keys():
                if re.match(r'(username|email|user)', field_name, re.I):
                    username_field = field_name
                elif re.match(r'(password|pass)', field_name, re.I):
                    password_field = field_name
            
            if username_field and password_field:
                form_data[username_field] = self.username
                form_data[password_field] = self.password
                
                print(f"Submitting login form to: {form_action}")
                login_response = self.session.post(form_action, data=form_data, timeout=30)
                
                # Check if login was successful
                if 'logout' in login_response.text.lower() or 'profile' in login_response.text.lower():
                    print("✅ Login successful!")
                    return True
                elif 'login' in login_response.url.lower():
                    print("❌ Login failed - redirected back to login page")
                    return False
                else:
                    print("✅ Login appears successful (no redirect to login)")
                    return True
            else:
                print("❌ Could not find username/password fields in login form")
                return False
        else:
            print("❌ Could not find login form on the page")
            return False
    
    def get_tv_guide_data(self, region="10199", date=None):
        """Get TV guide data for San Diego region"""
        if not date:
            date = datetime.now().strftime("%Y-%m-%d")
        
        print(f"Fetching TV guide for region {region} on {date}...")
        
        # Try different time periods
        time_periods = ["Morning", "Afternoon", "Evening", "Late%20Night"]
        all_programs = {}
        
        for period in time_periods:
            try:
                url = f"https://www.ontvtonight.com/guide/?region={region}&TVperiod={period}&date={date}"
                print(f"  Fetching {period.replace('%20', ' ')} listings...")
                
                response = self.session.get(url, timeout=30)
                response.raise_for_status()
                
                # Parse the HTML
                soup = BeautifulSoup(response.text, 'html.parser')
                
                # Look for TV listings in various formats
                programs = self.extract_programs_from_page(soup, period.replace('%20', ' '))
                
                if programs:
                    all_programs[period] = programs
                    print(f"    Found {len(programs)} programs")
                else:
                    print(f"    No programs found in {period}")
                
                time.sleep(1)  # Be respectful to the server
                
            except Exception as e:
                print(f"  Error fetching {period}: {e}")
                continue
        
        return all_programs
    
    def extract_programs_from_page(self, soup, period):
        """Extract program information from the HTML page"""
        programs = []
        
        # Method 1: Look for structured data in script tags
        scripts = soup.find_all('script', type='application/ld+json')
        for script in scripts:
            try:
                data = json.loads(script.string)
                if isinstance(data, dict) and 'BroadcastEvent' in str(data):
                    programs.extend(self.parse_structured_data(data))
                elif isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and 'BroadcastEvent' in str(item):
                            programs.extend(self.parse_structured_data(item))
            except:
                continue
        
        # Method 2: Look for common TV guide HTML patterns
        # Look for tables with TV listings
        tables = soup.find_all('table', class_=re.compile(r'(guide|listing|tv)', re.I))
        for table in tables:
            programs.extend(self.parse_table_listings(table))
        
        # Look for divs with TV listings
        listing_divs = soup.find_all('div', class_=re.compile(r'(channel|program|listing|guide|show)', re.I))
        for div in listing_divs:
            programs.extend(self.parse_div_listings(div))
        
        # Method 3: Look for data attributes
        data_elements = soup.find_all(attrs={"data-channel": True})
        data_elements.extend(soup.find_all(attrs={"data-program": True}))
        data_elements.extend(soup.find_all(attrs={"data-show": True}))
        
        for elem in data_elements:
            program_data = self.parse_data_attributes(elem)
            if program_data:
                programs.append(program_data)
        
        # Remove duplicates
        seen = set()
        unique_programs = []
        for prog in programs:
            key = (prog.get('channel', ''), prog.get('time', ''), prog.get('title', ''))
            if key not in seen:
                seen.add(key)
                unique_programs.append(prog)
        
        return unique_programs
    
    def parse_structured_data(self, data):
        """Parse JSON-LD structured data"""
        programs = []
        # Implementation depends on the actual structure
        # This is a placeholder for structured data parsing
        return programs
    
    def parse_table_listings(self, table):
        """Parse TV listings from table elements"""
        programs = []
        rows = table.find_all('tr')
        
        for row in rows:
            cells = row.find_all(['td', 'th'])
            if len(cells) >= 2:  # Need at least time and program
                program_data = {}
                
                # Try to extract time, channel, and program info
                for i, cell in enumerate(cells):
                    text = cell.get_text(strip=True)
                    
                    # Look for time patterns
                    time_match = re.search(r'(\d{1,2}:\d{2}(?:\s*[AP]M)?)', text, re.I)
                    if time_match and not program_data.get('time'):
                        program_data['time'] = time_match.group(1)
                    
                    # Look for channel patterns
                    channel_match = re.search(r'(K[A-Z]{3,4}|Channel\s*\d+|\d+\.\d+)', text, re.I)
                    if channel_match and not program_data.get('channel'):
                        program_data['channel'] = channel_match.group(1)
                    
                    # Everything else might be program title
                    if text and not any(re.search(pattern, text) for pattern in [r'\d{1,2}:\d{2}', r'K[A-Z]{3,4}', r'Channel']):
                        if not program_data.get('title') or len(text) > len(program_data.get('title', '')):
                            program_data['title'] = text
                
                if program_data.get('title') and (program_data.get('time') or program_data.get('channel')):
                    programs.append(program_data)
        
        return programs
    
    def parse_div_listings(self, div):
        """Parse TV listings from div elements"""
        programs = []
        
        # Look for common patterns in div-based listings
        text = div.get_text(strip=True)
        
        # Simple pattern matching for common formats
        # "8:00 PM Show Title on NBC"
        pattern1 = re.search(r'(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s+(.+?)\s+on\s+([A-Z]{2,4})', text, re.I)
        if pattern1:
            programs.append({
                'time': pattern1.group(1),
                'title': pattern1.group(2),
                'channel': pattern1.group(3)
            })
        
        return programs
    
    def parse_data_attributes(self, elem):
        """Parse data from HTML data attributes"""
        data_attrs = {k: v for k, v in elem.attrs.items() if k.startswith('data-')}
        
        if data_attrs:
            program_data = {}
            
            # Map data attributes to program fields
            for attr, value in data_attrs.items():
                if 'channel' in attr:
                    program_data['channel'] = value
                elif 'program' in attr or 'show' in attr or 'title' in attr:
                    program_data['title'] = value
                elif 'time' in attr or 'start' in attr:
                    program_data['time'] = value
            
            if program_data.get('title'):
                return program_data
        
        return None
    
    def create_xmltv_from_data(self, programs_data):
        """Convert OnTVTonight data to XMLTV format"""
        
        root = ET.Element("tv")
        root.set("source-info-name", "OnTVTonight San Diego")
        root.set("generator-info-name", "HomelabDashboard")
        root.set("generator-info-url", "https://www.ontvtonight.com/")
        
        # San Diego OTA channels mapping
        channel_mappings = {
            'KGTV': {'id': '10.1', 'name': 'ABC San Diego'},
            'KFMB': {'id': '8.1', 'name': 'CBS San Diego'},
            'KNSD': {'id': '39.1', 'name': 'NBC San Diego'},
            'KSWB': {'id': '69.1', 'name': 'FOX San Diego'},
            'KPBS': {'id': '15.1', 'name': 'PBS San Diego'},
            'KUSI': {'id': '51.1', 'name': 'KUSI Independent'},
            'ABC': {'id': '10.1', 'name': 'ABC San Diego'},
            'CBS': {'id': '8.1', 'name': 'CBS San Diego'},
            'NBC': {'id': '39.1', 'name': 'NBC San Diego'},
            'FOX': {'id': '69.1', 'name': 'FOX San Diego'},
            'PBS': {'id': '15.1', 'name': 'PBS San Diego'},
        }
        
        # Add channels
        added_channels = set()
        for call_sign, info in channel_mappings.items():
            if info['id'] not in added_channels:
                channel = ET.SubElement(root, "channel")
                channel.set("id", info['id'])
                
                display = ET.SubElement(channel, "display-name")
                display.text = info['name']
                
                display2 = ET.SubElement(channel, "display-name") 
                display2.text = call_sign
                
                added_channels.add(info['id'])
        
        # Process programs data
        program_count = 0
        for period, programs in programs_data.items():
            print(f"Processing {len(programs)} programs from {period}")
            
            for program in programs:
                title = program.get('title', '').strip()
                channel_name = program.get('channel', '').strip()
                time_str = program.get('time', '').strip()
                
                if not title or not channel_name:
                    continue
                
                # Map channel name to our channel ID
                channel_id = None
                for call_sign, info in channel_mappings.items():
                    if call_sign.upper() in channel_name.upper() or channel_name.upper() in call_sign.upper():
                        channel_id = info['id']
                        break
                
                if not channel_id:
                    continue
                
                # Parse time
                try:
                    now = datetime.now()
                    
                    # Simple time parsing - can be improved
                    if re.match(r'\d{1,2}:\d{2}', time_str):
                        hour_min = time_str.split(':')
                        hour = int(hour_min[0])
                        minute = int(hour_min[1].split()[0])  # Remove AM/PM
                        
                        # Handle AM/PM
                        if 'PM' in time_str.upper() and hour != 12:
                            hour += 12
                        elif 'AM' in time_str.upper() and hour == 12:
                            hour = 0
                        
                        start_time = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                        end_time = start_time + timedelta(hours=1)  # Default 1 hour duration
                    else:
                        continue
                    
                    programme = ET.SubElement(root, "programme")
                    programme.set("channel", channel_id)
                    programme.set("start", start_time.strftime("%Y%m%d%H%M%S %z"))
                    programme.set("stop", end_time.strftime("%Y%m%d%H%M%S %z"))
                    
                    title_elem = ET.SubElement(programme, "title")
                    title_elem.set("lang", "en")
                    title_elem.text = title
                    
                    program_count += 1
                    
                except Exception as e:
                    print(f"Error parsing program: {e}")
                    continue
        
        print(f"Created XMLTV with {program_count} programs")
        return root

def main():
    parser = argparse.ArgumentParser(description='OnTVTonight Authenticated Scraper')
    parser.add_argument('-u', '--username', required=True, help='OnTVTonight username/email')
    parser.add_argument('-p', '--password', required=True, help='OnTVTonight password')
    parser.add_argument('-r', '--region', default='10199', help='Region code (default: 10199 for San Diego)')
    parser.add_argument('-d', '--date', help='Date in YYYY-MM-DD format (default: today)')
    parser.add_argument('-o', '--output', required=True, help='Output XMLTV file path')
    
    args = parser.parse_args()
    
    try:
        scraper = OnTVTonightScraper(args.username, args.password)
        
        # Login to the account
        if not scraper.login():
            print("Failed to login to OnTVTonight")
            sys.exit(1)
        
        # Get TV guide data
        programs_data = scraper.get_tv_guide_data(region=args.region, date=args.date)
        
        if not programs_data:
            print("No TV guide data found")
            sys.exit(1)
        
        # Convert to XMLTV
        root = scraper.create_xmltv_from_data(programs_data)
        
        # Write XMLTV file
        tree = ET.ElementTree(root)
        ET.indent(tree, space="  ", level=0)
        
        print(f"Writing XMLTV data to {args.output}")
        tree.write(args.output, encoding='utf-8', xml_declaration=True)
        
        # Count channels and programs
        channels = root.findall('channel')
        programs = root.findall('programme')
        
        print(f"Generated {len(channels)} channels and {len(programs)} programs")
        print("OnTVTonight authenticated scraping completed!")
        
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()