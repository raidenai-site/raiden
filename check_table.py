import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

supabase = create_client(url, key)

try:
    print("Checking 'users' table schema...")
    res = supabase.table("users").select("*").limit(1).execute()
    if res.data:
        keys = list(res.data[0].keys())
        print(f"✅ Found columns: {keys}")
        if 'customer_id' in keys:
            print("✅ customer_id column exists")
        else:
            print("❌ customer_id column MISSING!")
    else:
        print("⚠️ Table is empty, cannot verify columns. Please create a dummy user or wait for cleanup.")
except Exception as e:
    print(f"❌ Error checking 'users': {e}")
