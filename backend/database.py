from motor.motor_asyncio import AsyncIOMotorClient
import os
from datetime import datetime
from dotenv import load_dotenv

# Load .env file
load_dotenv()

# Environment Variable Validation
MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    # Fallback to local default if MONGO_URI is missing, but warn
    print("WARNING: MONGO_URI not found in environment variables. Falling back to localhost.")
    MONGO_URI = "mongodb://localhost:27017"

DB_NAME = os.getenv("DATABASE_NAME", "mechanic_finder")

# Initialize MongoDB client
client = AsyncIOMotorClient(
    MONGO_URI, 
    tlsAllowInvalidCertificates=True,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000
)
db = client[DB_NAME]
mechanics_collection = db["mechanics"]
admins_collection = db["admins"]
users_collection = db["users"]
vehicles_collection = db["vehicles"]
vendors_collection = db["vendors"]
parts_collection = db["parts"]
tow_trucks_collection = db["tow_trucks"]

# Add verification connection
async def verify_db_connection():
    try:
        await client.admin.command('ping')
        print(f"SUCCESS: Successfully connected to MongoDB: {DB_NAME}")
    except Exception as e:
        print(f"ERROR: Could not connect to MongoDB: {e}")

async def seed_default_admin():
    """Ensures at least one default admin exists for testing."""
    default_admin_phone = os.getenv("ADMIN_PHONE", "1234567890")
    existing = await admins_collection.find_one({"phone": default_admin_phone})
    if not existing:
        await admins_collection.insert_one({
            "phone": default_admin_phone,
            "name": "Super Admin",
            "createdAt": datetime.utcnow()
        })
        print(f"SUCCESS: Default admin seeded with phone: {default_admin_phone}")
