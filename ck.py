import requests
import random
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from tls_client import Session
import re

# List of common user agents for rotation
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0'
]

def fetch_proxies(url, proxy_type):
    """
    Fetch proxies from the given URL and format them.
    """
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        proxies = [line.strip() for line in response.text.splitlines() if line.strip() and not line.startswith('#')]
        # The format required by tls_client for HTTP proxies is http://user:pass@host:port or http://host:port
        formatted_proxies = [f"{proxy_type}://{proxy}" for proxy in proxies]
        print(f"Fetched {len(formatted_proxies)} {proxy_type} proxies from {url}")
        return formatted_proxies
    except Exception as e:
        print(f"Error fetching {proxy_type} proxies: {e}")
        return []

def get_random_proxy(all_proxies):
    """
    Get a random proxy from the list.
    """
    if not all_proxies:
        return None
    return random.choice(all_proxies)

def create_session(proxy=None):
    """
    Create a TLS client session with random user agent and optional proxy.
    """
    session = Session(client_identifier="chrome_120")  # Mimics Chrome 120
    ua = random.choice(USER_AGENTS)
    session.headers.update({
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
    })
    if proxy:
        # tls_client supports HTTP proxies directly if formatted correctly
        session.proxies = {'http': proxy, 'https': proxy}
    return session

def extract_video_id(url):
    """
    Extract TikTok video ID from URL.
    Example: https://www.tiktok.com/@user/video/1234567890 -> 1234567890
    """
    match = re.search(r'video/(\d+)', url)
    if match:
        return match.group(1)
    return None

def send_view(session, video_id):
    """
    Send a single view to the TikTok video using an undocumented endpoint.
    This simulates a video load/view. Endpoint may change; monitor for updates.
    """
    # Use a lightweight endpoint that increments views
    url = f"https://www.tiktok.com/api/comment/list/?aweme_id={video_id}&count=10&cursor=0"
    headers = {
        'Referer': 'https://www.tiktok.com/',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"'
    }
    session.headers.update(headers)
    
    try:
        response = session.get(url, timeout=10)
        if response.status_code == 200:
            if 'aweme_id' in response.text:
                return True
        return False
    except Exception as e:
        # Mute most errors to avoid spamming the console
        # print(f"Error sending view: {e}")
        return False

def worker(video_id, all_proxies, views_done, lock):
    """
    Worker thread: Send views until target is reached or interrupted.
    """
    while views_done['count'] < views_done['target']:
        proxy = get_random_proxy(all_proxies)
        session = create_session(proxy)
        if send_view(session, video_id):
            with lock:
                # Check again to prevent race condition
                if views_done['count'] < views_done['target']:
                    views_done['count'] += 1
                    print(f"View sent! Total: {views_done['count']}/{views_done['target']}")
        time.sleep(random.uniform(2, 6))  # Random delay to mimic human behavior

def main():
    print("=== TikTok Free Views Bot (HTTP Proxies Only) ===")
    print("WARNING: This violates TikTok TOS. Use on test accounts only. Views may be removed by TikTok.")
    
    # Fetch proxies
    print("Fetching HTTP proxies...")
    http_proxies = fetch_proxies('https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt', 'http')
    
    # Use only the fetched HTTP proxies
    all_proxies = http_proxies
    
    if not all_proxies:
        print("No proxies were fetched. Please check the proxy URL or your internet connection. Exiting.")
        return
    
    # Input
    video_input = input("Enter TikTok video URL: ").strip()
    video_id = extract_video_id(video_input)
    if not video_id:
        print("Invalid TikTok video URL. Please make sure it looks like: https://www.tiktok.com/@user/video/12345... Exiting.")
        return
    
    try:
        target_views = int(input("Enter how many views to send (e.g., 1000): "))
    except ValueError:
        target_views = 1000
        print(f"Invalid number. Defaulting to {target_views} views.")
    
    # Threading setup
    # Limit threads to a reasonable number or the number of available proxies
    num_threads = min(50, len(all_proxies)) 
    views_done = {'count': 0, 'target': target_views}
    lock = threading.Lock()
    
    print(f"Starting {num_threads} threads to send {target_views} views to video ID: {video_id}...")
    
    with ThreadPoolExecutor(max_workers=num_threads) as executor:
        # Create a list of future tasks
        futures = [executor.submit(worker, video_id, all_proxies, views_done, lock) for _ in range(num_threads)]
        
        try:
            # Wait for all threads to complete or for an interruption
            for future in as_completed(futures):
                # You can get results here if the worker returned anything
                future.result()  
        except KeyboardInterrupt:
            print("\nInterrupted by user. Shutting down gracefully...")
            # The 'with' statement will handle shutting down the executor
    
    print(f"\nBoost complete! Sent a total of {views_done['count']} views.")
    print("Note: It may take 5-30 minutes for the views to update on TikTok.")

if __name__ == "__main__":
    main()
