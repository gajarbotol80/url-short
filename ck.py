import requests
import random
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from tls_client import Session
import re
from tqdm import tqdm

# --- Configuration ---
# Moved hardcoded URLs here for easier management
PROXY_URL = 'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt'
TARGET_VIDEO_API_URL = "https://www.tiktok.com/api/comment/list/?aweme_id={video_id}&count=1&cursor=0"
# How long to wait for proxy and request timeouts
TIMEOUT_SECONDS = 10

# List of common user agents for rotation
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0 Safari/537.36',
]

# --- Core Functions ---

def fetch_proxies(url):
    """
    Fetches raw proxies from a URL.
    """
    print("⬇️  Fetching proxy list...")
    try:
        response = requests.get(url, timeout=TIMEOUT_SECONDS)
        response.raise_for_status()
        proxies = [line.strip() for line in response.text.splitlines() if line.strip() and not line.startswith('#')]
        print(f"✅ Found {len(proxies)} proxies to check.")
        return proxies
    except requests.exceptions.RequestException as e:
        print(f"❌ Error fetching proxies: {e}")
        return []

def check_proxy(proxy):
    """
    Checks if a single proxy is working by trying to connect to Google.
    Returns the formatted proxy string if successful, otherwise None.
    """
    proxy_url = f"http://{proxy}"
    try:
        # Check if the proxy can connect to a reliable service.
        response = requests.get("https://www.google.com", proxies={'http': proxy_url, 'https': proxy_url}, timeout=TIMEOUT_SECONDS)
        if response.status_code == 200:
            return proxy_url
    except (requests.exceptions.ProxyError, requests.exceptions.Timeout, requests.exceptions.ConnectionError):
        # These errors are expected for dead proxies, so we just ignore them.
        pass
    return None

def get_working_proxies(proxies_to_check):
    """
    Uses a thread pool to check a list of proxies concurrently.
    Returns a list of working proxies.
    """
    print("📡 Checking which proxies are live... (This may take a moment)")
    working_proxies = []
    with ThreadPoolExecutor(max_workers=50) as executor:
        # Use tqdm to show a progress bar for proxy checking
        future_to_proxy = {executor.submit(check_proxy, proxy): proxy for proxy in proxies_to_check}
        for future in tqdm(as_completed(future_to_proxy), total=len(proxies_to_check), desc="Checking Proxies"):
            result = future.result()
            if result:
                working_proxies.append(result)
    
    print(f"👍 Found {len(working_proxies)} working proxies.")
    return working_proxies

def create_session(proxy=None):
    """
    Creates and configures a TLS client session.
    """
    session = Session(client_identifier="chrome_120")
    session.headers.update({
        'User-Agent': random.choice(USER_AGENTS),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'Referer': 'https://www.tiktok.com/',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"'
    })
    if proxy:
        session.proxies = {'http': proxy, 'https': proxy}
    return session

def extract_video_id(url):
    """
    Extracts the video ID from a TikTok URL.
    """
    match = re.search(r'video/(\d+)', url)
    return match.group(1) if match else None

def send_view_task(video_id, proxy):
    """
    A single task to send one view using a specific proxy.
    Returns True on success, False on failure.
    """
    session = create_session(proxy)
    url = TARGET_VIDEO_API_URL.format(video_id=video_id)
    try:
        response = session.get(url, timeout=TIMEOUT_SECONDS)
        return response.status_code == 200 and 'aweme_id' in response.text
    except Exception:
        return False

# --- Main Execution ---

def main():
    """
    Main function to run the bot.
    """
    print("="*40)
    print("=== TikTok Free Views Bot (Upgraded) ===")
    print("WARNING: Use for educational purposes only.")
    print("="*40)
    
    # 1. Fetch and validate proxies
    raw_proxies = fetch_proxies(PROXY_URL)
    if not raw_proxies:
        return
    
    working_proxies = get_working_proxies(raw_proxies)
    if not working_proxies:
        print("❌ No working proxies found. Cannot continue.")
        return

    # 2. Get user input
    video_input = input("Enter TikTok video URL: ").strip()
    video_id = extract_video_id(video_input)
    if not video_id:
        print("❌ Invalid URL. Example: https://www.tiktok.com/@user/video/12345...")
        return
        
    try:
        target_views = int(input("Enter target views (e.g., 1000): "))
    except ValueError:
        target_views = 1000
        print(f"⚠️ Invalid number. Defaulting to {target_views} views.")
    
    # 3. Send views using the new task-based concurrency model
    num_threads = min(100, len(working_proxies))
    views_sent_count = 0
    
    print(f"\n🚀 Starting to send {target_views} views with {num_threads} threads...")
    
    with ThreadPoolExecutor(max_workers=num_threads) as executor:
        with tqdm(total=target_views, desc="Sending Views", unit=" view") as pbar:
            futures = []
            while pbar.n < target_views:
                # If we've submitted enough tasks already, wait for some to complete
                if len(futures) >= num_threads * 2:
                    for future in as_completed(futures):
                        futures.remove(future)
                        if future.result():
                            pbar.update(1)
                        if pbar.n >= target_views:
                            break
                
                # Submit new tasks
                proxy = random.choice(working_proxies)
                futures.append(executor.submit(send_view_task, video_id, proxy))

            # Wait for any remaining tasks to finish
            for future in as_completed(futures):
                if pbar.n >= target_views:
                    break
                if future.result():
                    pbar.update(1)

    views_sent_count = pbar.n
    print(f"\n🎉 Boost complete! Successfully sent {views_sent_count} views.")
    print("It may take 5-30 minutes for the view count to update on TikTok.")

if __name__ == "__main__":
    main()
