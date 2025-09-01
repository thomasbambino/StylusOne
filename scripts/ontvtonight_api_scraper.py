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

class OnTVTonightAPIScraper:
    def __init__(self, username, password):
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Referer': 'https://www.ontvtonight.com/',
        })
        self.authenticated = False
        
    def login(self):
        """Login to OnTVTonight account"""
        print(f"Logging into OnTVTonight with account: {self.username}")
        
        # Get login page first to get any tokens
        login_url = "https://www.ontvtonight.com/user/login/"
        response = self.session.get(login_url, timeout=30)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Look for login form
        login_form = soup.find('form')
        if not login_form:
            print("❌ Could not find login form")
            return False
        
        form_action = login_form.get('action', '/user/dologin')
        if not form_action.startswith('http'):
            form_action = 'https://www.ontvtonight.com' + form_action
        
        # Extract form data
        form_data = {}
        for input_field in login_form.find_all('input'):
            name = input_field.get('name')
            value = input_field.get('value', '')
            if name:
                form_data[name] = value
        
        # Set credentials
        form_data['email'] = self.username
        form_data['password'] = self.password
        
        print(f"Submitting login form to: {form_action}")
        login_response = self.session.post(form_action, data=form_data, timeout=30, allow_redirects=True)
        
        # Check if login was successful
        if 'logout' in login_response.text.lower() or 'profile' in login_response.text.lower():
            print("✅ Login successful!")
            self.authenticated = True
            return True
        elif 'login' in login_response.url.lower():
            print("❌ Login failed - redirected back to login page")
            return False
        else:
            print("✅ Login appears successful")
            self.authenticated = True
            return True
    
    def discover_api_endpoints(self):
        """Try to discover API endpoints used by OnTVTonight"""
        print("🔍 Discovering API endpoints...")
        
        # First, visit the main guide page to see what requests it makes
        guide_url = "https://www.ontvtonight.com/guide/?region=10199"
        response = self.session.get(guide_url, timeout=30)
        
        # Look for JavaScript files that might contain API calls
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Extract any JavaScript files
        js_files = []
        for script in soup.find_all('script', src=True):
            src = script.get('src')
            if src and ('guide' in src or 'tv' in src or 'api' in src):
                js_files.append(src)
        
        print(f"Found {len(js_files)} relevant JS files:")
        for js_file in js_files[:5]:  # Show first 5
            print(f"  {js_file}")
        
        # Try common API patterns
        api_patterns = [
            # Common patterns for TV guide APIs
            "/api/guide",
            "/api/tv-guide", 
            "/api/listings",
            "/guide/api",
            "/tv/api",
            "/api/channels",
            "/api/programs",
            "/guide/data",
            "/data/guide",
            "/ajax/guide",
            "/xhr/guide",
        ]
        
        working_endpoints = []
        
        for pattern in api_patterns:
            try:
                test_url = f"https://www.ontvtonight.com{pattern}"
                
                # Try with common parameters
                params = {
                    'region': '10199',
                    'date': datetime.now().strftime('%Y-%m-%d'),
                    'period': 'Afternoon'
                }
                
                response = self.session.get(test_url, params=params, timeout=10)
                
                if response.status_code == 200:
                    content_type = response.headers.get('content-type', '')
                    if 'json' in content_type:
                        try:
                            data = response.json()
                            if data and (isinstance(data, dict) or isinstance(data, list)):
                                working_endpoints.append({
                                    'url': test_url,
                                    'params': params,
                                    'data': data
                                })
                                print(f"✅ Found working API: {test_url}")
                                print(f"  Data sample: {str(data)[:100]}...")
                        except json.JSONDecodeError:
                            pass
                    elif len(response.text) > 100:  # Substantial response
                        working_endpoints.append({
                            'url': test_url,
                            'params': params,
                            'data': response.text[:200] + "..."
                        })
                        print(f"⚠️  Found endpoint (non-JSON): {test_url}")
                        
            except Exception as e:
                continue
        
        return working_endpoints
    
    def try_guide_extraction_methods(self):
        """Try various methods to extract guide data"""
        print("🔍 Trying different guide extraction methods...")
        
        methods = [
            self.method_direct_guide_page,
            self.method_mobile_api,
            self.method_xhr_requests,
            self.method_search_in_html
        ]
        
        for i, method in enumerate(methods, 1):
            print(f"\n--- Method {i}: {method.__name__} ---")
            try:
                result = method()
                if result:
                    print(f"✅ Method {i} found data!")
                    return result
                else:
                    print(f"❌ Method {i} found no data")
            except Exception as e:
                print(f"❌ Method {i} failed: {e}")
        
        return None
    
    def method_direct_guide_page(self):
        """Method 1: Parse guide page HTML directly"""
        url = "https://www.ontvtonight.com/guide/?region=10199&TVperiod=Afternoon&date=2025-08-29"
        response = self.session.get(url, timeout=30)
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Look for any text that resembles TV programs
        text = soup.get_text()
        
        # Look for common TV show patterns
        tv_patterns = [
            r'(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s+([A-Z][^0-9\n]{5,50})',  # Time + Show title
            r'(NBC|ABC|CBS|FOX|PBS)\s+([A-Z][^0-9\n]{5,50})',        # Network + Show
            r'(KGTV|KFMB|KNSD|KSWB|KPBS)\s+([A-Z][^0-9\n]{5,50})', # Call sign + Show
        ]
        
        programs = []
        for pattern in tv_patterns:
            matches = re.findall(pattern, text, re.MULTILINE | re.IGNORECASE)
            for match in matches[:5]:  # Limit results
                programs.append({
                    'time_or_channel': match[0],
                    'title': match[1].strip(),
                    'method': 'direct_html'
                })
        
        return programs if programs else None
    
    def method_mobile_api(self):
        """Method 2: Try mobile/responsive APIs"""
        mobile_headers = self.session.headers.copy()
        mobile_headers.update({
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1'
        })
        
        url = "https://www.ontvtonight.com/guide/"
        params = {
            'region': '10199',
            'mobile': '1',
            'format': 'json',
            'date': datetime.now().strftime('%Y-%m-%d')
        }
        
        response = self.session.get(url, params=params, headers=mobile_headers, timeout=30)
        
        try:
            data = response.json()
            return data if data else None
        except:
            # Look for JSON in the response text
            json_matches = re.findall(r'\{[^}]*"channel"[^}]*\}', response.text)
            if json_matches:
                programs = []
                for match in json_matches:
                    try:
                        program_data = json.loads(match)
                        programs.append(program_data)
                    except:
                        continue
                return programs if programs else None
        
        return None
    
    def method_xhr_requests(self):
        """Method 3: Simulate XHR requests"""
        xhr_headers = self.session.headers.copy()
        xhr_headers.update({
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/javascript, */*; q=0.01'
        })
        
        # Common XHR endpoints
        xhr_endpoints = [
            '/guide/load',
            '/api/load',
            '/data/load',
            '/xhr/listings'
        ]
        
        for endpoint in xhr_endpoints:
            try:
                url = f"https://www.ontvtonight.com{endpoint}"
                data = {
                    'region': '10199',
                    'date': datetime.now().strftime('%Y-%m-%d'),
                    'period': 'afternoon'
                }
                
                response = self.session.post(url, data=data, headers=xhr_headers, timeout=15)
                if response.status_code == 200:
                    try:
                        json_data = response.json()
                        if json_data:
                            return json_data
                    except:
                        if len(response.text) > 50:
                            return {'html_response': response.text[:500]}
            except:
                continue
        
        return None
    
    def method_search_in_html(self):
        """Method 4: Search for embedded data in HTML"""
        url = "https://www.ontvtonight.com/guide/?region=10199&date=2025-08-29"
        response = self.session.get(url, timeout=30)
        
        # Look for various data patterns
        patterns_to_search = [
            r'window\.__INITIAL_STATE__\s*=\s*({.+?});',
            r'window\.guideData\s*=\s*({.+?});',
            r'var\s+tvGuide\s*=\s*({.+?});',
            r'data-guide=["\']({.+?})["\']',
            r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>([^<]+)</script>'
        ]
        
        found_data = []
        
        for pattern in patterns_to_search:
            matches = re.findall(pattern, response.text, re.DOTALL)
            for match in matches:
                try:
                    if isinstance(match, tuple):
                        match = match[0] if match[0] else match[1]
                    
                    data = json.loads(match)
                    found_data.append(data)
                except:
                    continue
        
        return found_data if found_data else None

def main():
    parser = argparse.ArgumentParser(description='OnTVTonight API Discovery & Scraper')
    parser.add_argument('-u', '--username', required=True, help='OnTVTonight username/email')
    parser.add_argument('-p', '--password', required=True, help='OnTVTonight password')
    parser.add_argument('-o', '--output', required=True, help='Output file path')
    parser.add_argument('--discover', action='store_true', help='Only discover APIs, dont scrape')
    
    args = parser.parse_args()
    
    try:
        scraper = OnTVTonightAPIScraper(args.username, args.password)
        
        # Login to the account
        if not scraper.login():
            print("Failed to login to OnTVTonight")
            sys.exit(1)
        
        if args.discover:
            # Just discover API endpoints
            endpoints = scraper.discover_api_endpoints()
            print(f"\nFound {len(endpoints)} working endpoints:")
            for endpoint in endpoints:
                print(f"  {endpoint['url']}")
                print(f"    Sample data: {str(endpoint['data'])[:100]}")
        else:
            # Try to extract guide data
            guide_data = scraper.try_guide_extraction_methods()
            
            if guide_data:
                print(f"\n✅ Successfully extracted guide data!")
                
                # Save raw data
                with open(args.output, 'w') as f:
                    json.dump(guide_data, f, indent=2, default=str)
                
                print(f"Raw guide data saved to: {args.output}")
                print(f"Data sample: {str(guide_data)[:200]}...")
            else:
                print("\n❌ No guide data could be extracted")
                
                # Create minimal fallback
                fallback_data = {
                    'error': 'No data extracted',
                    'timestamp': datetime.now().isoformat(),
                    'message': 'OnTVTonight scraping failed - site may have changed structure'
                }
                
                with open(args.output, 'w') as f:
                    json.dump(fallback_data, f, indent=2)
        
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()