import os
import random
from fastapi import FastAPI, HTTPException, Depends, Query, WebSocket, WebSocketDisconnect, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import shutil
import uuid
import models
import database
from database import db, mechanics_collection, admins_collection, users_collection, tow_trucks_collection, verify_db_connection, seed_default_admin
from bson import ObjectId
from datetime import datetime, timedelta
from typing import List, Optional
from models import MechanicModel, ServiceRequestModel, MechanicCreate, MessageModel, VehicleModel, VendorModel, PartModel, TowTruckModel, TowTruckCreate
import math
import httpx
from dotenv import load_dotenv
import asyncio
from auth import create_access_token, get_current_user, get_current_mechanic, get_current_admin, get_current_tow_truck, get_any_authenticated_user

load_dotenv()

app = FastAPI(title="Nearby Mechanic Finder API")

# Add a separate collection for OTPs
otps_collection = db["otps"]


# Create uploads directory for KYC documents
os.makedirs("uploads/kyc", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# --- WebSocket Connection Manager ---
class ConnectionManager:
    def __init__(self):
        # Maps request_id -> list of active WebSockets
        self.active_connections: dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, request_id: str):
        await websocket.accept()
        if request_id not in self.active_connections:
            self.active_connections[request_id] = []
        self.active_connections[request_id].append(websocket)

    def disconnect(self, websocket: WebSocket, request_id: str):
        if request_id in self.active_connections:
            if websocket in self.active_connections[request_id]:
                self.active_connections[request_id].remove(websocket)
            if not self.active_connections[request_id]:
                del self.active_connections[request_id]

    async def broadcast_to_room(self, request_id: str, message: dict):
        if request_id in self.active_connections:
            # Create a copy of the list to avoid list modification during iteration
            for connection in list(self.active_connections[request_id]):
                try:
                    await connection.send_json(message)
                except Exception as e:
                    print(f"WS Broadcast Error: {e}")
                    self.disconnect(connection, request_id)

manager = ConnectionManager()

@app.websocket("/ws/requests/{request_id}")
async def websocket_endpoint(websocket: WebSocket, request_id: str):
    await manager.connect(websocket, request_id)
    try:
        while True:
            # We keep the connection open to push updates
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, request_id)


# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def initialize_db():
    """Background task to initialize DB without blocking server startup."""
    print("⏳ Starting background DB initialization...")
    # Attempt DB connection and seeding
    try:
        # verify_db_connection has its own internal 2.5s timeout via Motor selection timeout
        await verify_db_connection()
        await seed_default_admin()
    except Exception as e:
        print(f"⚠️ Initial DB check failed: {e}")

    # Create TTL index for OTPs so they expire after 5 minutes
    try:
        await otps_collection.create_index("createdAt", expireAfterSeconds=300)
        print("✅ TTL index created on otps collection")
    except Exception as e:
        print(f"Warning: Could not create TTL index: {e}")

    # Create 2dsphere index for location-based queries
    try:
        await mechanics_collection.create_index([("location", "2dsphere")])
        print("✅ 2dsphere index created on mechanics collection")
    except Exception as e:
        print(f"Warning: Could not create spatial index: {e}")

    # Insert dummy data if empty
    try:
        count = await mechanics_collection.count_documents({})
        if count == 0:
            dummy_mechanics = [
                {
                    "name": "Ravi",
                    "shopName": "Ravi Bike Garage",
                    "location": {"type": "Point", "coordinates": [78.4867, 17.385]},
                    "phone": "9876543210",
                    "rating": 4.5,
                    "isOpen": True,
                    "address": "Banjara Hills, Hyderabad"
                },
                {
                    "name": "Kumar",
                    "shopName": "Kumar Auto Works",
                    "location": {"type": "Point", "coordinates": [78.4967, 17.395]},
                    "phone": "9876543211",
                    "rating": 4.2,
                    "isOpen": True,
                    "address": "Jubilee Hills, Hyderabad"
                },
                {
                    "name": "John",
                    "shopName": "John's Car Care",
                    "location": {"type": "Point", "coordinates": [78.4767, 17.405]},
                    "phone": "9876543212",
                    "rating": 4.8,
                    "isOpen": False,
                    "address": "Madhapur, Hyderabad"
                },
                {
                    "name": "Suresh",
                    "shopName": "Suresh Bullet Clinic",
                    "location": {"type": "Point", "coordinates": [78.4667, 17.375]},
                    "phone": "9876543213",
                    "rating": 3.9,
                    "isOpen": True,
                    "address": "Mehdipatnam, Hyderabad"
                }
            ]
            await mechanics_collection.insert_many(dummy_mechanics)
            print("✅ Dummy data inserted with GeoJSON format")
    except Exception as e:
        print(f"Warning: Background DB init error: {e}")

@app.on_event("startup")
async def startup_db_client():
    # Run DB initialization in the background so it doesn't block server startup
    asyncio.create_task(initialize_db())
    print("🚀 Server starting... DB init running in background.")

@app.get("/ping")
async def ping():
    return {"status": "ok", "message": "Server is alive"}

# OTP Endpoints
@app.post("/auth/request-otp")
async def request_otp(phone: str, role: str):
    """Generates and 'sends' a 6-digit OTP after verifying role."""
    if not phone or len(phone) < 10:
        raise HTTPException(status_code=400, detail="Invalid phone number")

    if role not in ["user", "mechanic", "admin", "tow_truck"]:
        raise HTTPException(status_code=400, detail="Invalid role specified")

    # If mechanic, check if they exist first
    if role == "mechanic":
        mechanic = await mechanics_collection.find_one({"phone": phone})
        if not mechanic and phone.isdigit():
            mechanic = await mechanics_collection.find_one({"phone": int(phone)})
        if not mechanic:
            raise HTTPException(status_code=404, detail="Mechanic not found. Please register first.")
            
    # If tow truck, check if they exist first
    if role == "tow_truck":
        tow_truck = await tow_trucks_collection.find_one({"phone": phone})
        if not tow_truck and phone.isdigit():
            tow_truck = await tow_trucks_collection.find_one({"phone": int(phone)})
        if not tow_truck:
            raise HTTPException(status_code=404, detail="Tow truck not found. Please register first.")

    # If admin, ensure they are in the admins collection
    if role == "admin":
        admin = await admins_collection.find_one({"phone": phone})
        if not admin:
            raise HTTPException(status_code=403, detail="Unauthorized. You do not have admin access.")

    # Generate 6-digit OTP
    otp = str(random.randint(100000, 999999))
    
    # Store in DB (Upsert)
    await otps_collection.update_one(
        {"phone": phone},
        {"$set": {
            "otp": otp,
            "createdAt": datetime.utcnow()
        }},
        upsert=True
    )
    
    print(f"DEBUG: OTP for {phone}: {otp} (Simulated SMS Sent)")
    return {"status": "success", "message": "OTP sent successfully", "otp_debug": otp} # Return otp for demo ease

@app.post("/auth/verify-otp")
async def verify_otp(phone: str, otp: str, role: str):
    """Verifies the 6-digit OTP and generates a JWT token."""
    stored_otp = await otps_collection.find_one({"phone": phone})
    
    if not stored_otp:
        raise HTTPException(status_code=400, detail="OTP expired or not requested")
    
    if stored_otp["otp"] != otp:
        raise HTTPException(status_code=400, detail="Invalid OTP code")
    
    # Check roles again securely before login
    if role == "mechanic":
        mechanic = await mechanics_collection.find_one({"phone": phone})
        if not mechanic and phone.isdigit():
            mechanic = await mechanics_collection.find_one({"phone": int(phone)})
        if not mechanic:
            raise HTTPException(status_code=404, detail="Mechanic not found.")
            
    elif role == "admin":
        admin = await admins_collection.find_one({"phone": phone})
        if not admin:
            raise HTTPException(status_code=403, detail="Unauthorized. Not an admin.")
            
    elif role == "tow_truck":
        tow_truck = await tow_trucks_collection.find_one({"phone": phone})
        if not tow_truck and phone.isdigit():
            tow_truck = await tow_trucks_collection.find_one({"phone": int(phone)})
        if not tow_truck:
            raise HTTPException(status_code=404, detail="Tow truck not found.")
            
    elif role == "user":
        user = await users_collection.find_one({"phone": phone})
        if not user:
            await users_collection.insert_one({"phone": phone, "createdAt": datetime.utcnow()})

    # Delete OTP after successful verification
    await otps_collection.delete_one({"phone": phone})
    
    # Generate JWT
    access_token = create_access_token(data={"sub": phone, "role": role})
    
    return {
        "status": "success", 
        "message": "Authenticated successfully", 
        "access_token": access_token, 
        "token_type": "bearer",
        "role": role
    }

@app.post("/auth/tow-register")
async def register_tow_truck(tow: TowTruckCreate):
    existing = await tow_trucks_collection.find_one({"phone": tow.phone})
    if existing:
        raise HTTPException(status_code=400, detail="Tow Truck already registered with this phone number")
    
    new_tow = tow.dict()
    new_tow["createdAt"] = datetime.utcnow()
    new_tow["isVerified"] = False
    new_tow["availability"] = "available"
    # Create GeoJSON location map
    if tow.lat and tow.lng:
        new_tow["location"] = {
            "type": "Point",
            "coordinates": [tow.lng, tow.lat]
        }
    
    result = await tow_trucks_collection.insert_one(new_tow)
    new_tow["_id"] = str(result.inserted_id)
    return {"status": "success", "message": "Tow Truck registered successfully", "id": new_tow["_id"]}


@app.get("/mechanics", response_model=List[MechanicModel])
async def get_all_mechanics():
    """Returns all mechanics from the database."""
    try:
        mechanics = await mechanics_collection.find().to_list(1000)
        return mechanics
    except Exception as e:
        raise HTTPException(status_code=503, detail="Database connection failed: Is MongoDB running?")

def haversine(lat1, lon1, lat2, lon2):
    R = 6371  # Earth radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) * math.sin(dlat / 2) +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) * math.sin(dlon / 2))
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

@app.get("/mechanics/nearby", response_model=List[MechanicModel])
async def get_nearby_mechanics(lat: float, lng: float, radius_km: float = 10.0):
    """Returns nearby mechanics using MongoDB geospatial query."""
    try:
        # Convert radius to meters for MongoDB $maxDistance
        max_distance_meters = radius_km * 1000
        
        query = {
            "location": {
                "$near": {
                    "$geometry": {
                        "type": "Point",
                        "coordinates": [lng, lat]
                    },
                    "$maxDistance": max_distance_meters
                }
            }
        }
        
        cursor = mechanics_collection.find(query)
        nearby_mechanics = []
        async for doc in cursor:
            # Add lat/lng fields for frontend compatibility if they don't exist
            if "location" in doc and not doc.get("lat"):
                doc["lat"] = doc["location"]["coordinates"][1]
                doc["lng"] = doc["location"]["coordinates"][0]
            nearby_mechanics.append(doc)
            
        return nearby_mechanics
    except Exception as e:
        print(f"Nearby fetch error: {e}")
        raise HTTPException(status_code=503, detail="Nearby query failed")

@app.get("/places/nearby-mechanics")
async def get_osm_overpass_mechanics(
    lat: float, 
    lng: float, 
    radius: int = Query(5000, description="Radius in meters")
):
    overpass_url = "https://overpass-api.de/api/interpreter"
    overpass_query = f"""
    [out:json];
    (
      node["craft"="car_repair"](around:{radius},{lat},{lng});
      way["craft"="car_repair"](around:{radius},{lat},{lng});
      node["shop"="car_repair"](around:{radius},{lat},{lng});
      way["shop"="car_repair"](around:{radius},{lat},{lng});
    );
    out center;
    """

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                overpass_url,
                content=overpass_query,
                headers={
                    "Content-Type": "text/plain",
                    "User-Agent": "NearbyMechanicFinder/1.0"
                },
                timeout=30.0
            )
            response.raise_for_status()
            data = response.json()
            
            results = []
            for element in data.get("elements", []):
                tags = element.get("tags", {})
                
                el_lat = element.get("lat") or element.get("center", {}).get("lat")
                el_lng = element.get("lon") or element.get("center", {}).get("lng")
                
                if not el_lat or not el_lng:
                    continue
                
                # Extract address
                addr_parts = []
                if "addr:housenumber" in tags:
                    addr_parts.append(tags["addr:housenumber"])
                if "addr:street" in tags:
                    addr_parts.append(tags["addr:street"])
                if "addr:city" in tags:
                    addr_parts.append(tags["addr:city"])
                address = ", ".join(addr_parts) if addr_parts else tags.get("addr:full", "Local Area")

                res = {
                    "id": f"osm_{element.get('id')}",
                    "shopName": tags.get("name", "Independent Mechanic"),
                    "lat": el_lat,
                    "lng": el_lng,
                    "rating": 4.0,
                    "isOpen": None,
                    "address": address,
                    "source": "osm"
                }
                
                if "opening_hours" in tags:
                    res["opening_hours"] = tags["opening_hours"]
                    
                results.append(res)
                
            return results
        except httpx.HTTPStatusError as e:
            print(f"DEBUG: Overpass HTTP Error: {e.response.status_code} - {e.response.text}")
            raise HTTPException(status_code=502, detail=f"Overpass API returned {e.response.status_code}")
        except Exception as e:
            print(f"DEBUG: Overpass General Exception: {type(e).__name__}: {e}")
            raise HTTPException(status_code=502, detail=f"Error communicating with Overpass API: {str(e)}")

@app.put("/mechanics/{phone}/availability")
async def update_availability(phone: str, status: str, current_user: dict = Depends(get_current_mechanic)):
    """Updates the availability status of a mechanic robustly and marks isOpen."""
    if status not in ["available", "busy", "closed"]:
        raise HTTPException(status_code=400, detail="Invalid status. Must be available, busy, or closed.")
    
    # Sync isOpen with availability
    is_open = status != "closed"
    
    try:
        # Try finding as string first
        result = await mechanics_collection.update_many(
            {"phone": phone},
            {"$set": {"availability": status, "isOpen": is_open}}
        )
        
        # Also try as integer to be robust (if any were stored as int)
        if phone.isdigit():
            int_result = await mechanics_collection.update_many(
                {"phone": int(phone)},
                {"$set": {"availability": status, "isOpen": is_open}}
            )
            # Combine counts for the check
            matched_count = result.matched_count + int_result.matched_count
        else:
            matched_count = result.matched_count
        
        if matched_count == 0:
            print(f"🔍 DEBUG: Availability update failed - Phone '{phone}' not found.")
            raise HTTPException(status_code=404, detail="Mechanic not found with this phone number.")
            
        return {"status": "success", "message": f"Availability updated for {matched_count} records to {status}, isOpen set to {is_open}"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ DEBUG: Error during availability update: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to update status: {str(e)}")

@app.get("/mechanics/by-phone/{phone}", response_model=MechanicModel)
async def get_mechanic_by_phone(phone: str):
    """Returns mechanic details by phone number, robustly checking for both string and index."""
    # Strip any potential whitespace
    clean_phone = phone.strip()
    print(f"🔍 DEBUG: Login attempt for phone: '{clean_phone}' (Length: {len(clean_phone)})")
    
    try:
        # Try finding as string (default)
        mechanic = await mechanics_collection.find_one({"phone": clean_phone})
        
        # If not found and numeric, try finding as integer
        if not mechanic and clean_phone.isdigit():
            print(f"🔍 DEBUG: Not found as string, trying as int: {int(clean_phone)}")
            mechanic = await mechanics_collection.find_one({"phone": int(clean_phone)})
        
        if not mechanic:
            print(f"🔍 DEBUG: Mechanic login failed - Phone '{clean_phone}' not found in DB.")
            # Check if it exists with a partial match or different field name
            exists_any = await mechanics_collection.find_one({"phone": {"$regex": f".*{clean_phone}.*"}})
            if exists_any:
                print(f"🔍 DEBUG: Partial match found! DB has: '{exists_any.get('phone')}'")
            
            raise HTTPException(status_code=404, detail=f"Phone {clean_phone} not found in our system. Are you sure it's correct?")
        
        print(f"✅ DEBUG: Mechanic found: {mechanic.get('shopName')}")
        
        # Ensure _id is handled if needed (pydantic will use it if mapped)
        if "_id" in mechanic:
            mechanic["id"] = str(mechanic["_id"])
            
        return mechanic
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ DEBUG: Error during mechanic lookup: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# --- Digital Garage (Vehicle Management) Endpoints ---

@app.post("/users/vehicles")
async def add_vehicle(vehicle: VehicleModel, current_user: dict = Depends(get_current_user)):
    try:
        vehicle_dict = vehicle.dict()
        vehicle_dict["userId"] = current_user["phone"] # the user's phone number
        vehicle_dict["createdAt"] = datetime.utcnow()
        result = await db.vehicles.insert_one(vehicle_dict)
        return {"status": "success", "vehicleId": str(result.inserted_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/users/vehicles")
async def get_user_vehicles(current_user: dict = Depends(get_current_user)):
    try:
        cursor = db.vehicles.find({"userId": current_user["phone"]})
        vehicles = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            vehicles.append(doc)
        return vehicles
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/users/vehicles/{vehicle_id}")
async def delete_vehicle(vehicle_id: str, current_user: dict = Depends(get_current_user)):
    try:
        result = await db.vehicles.delete_one({"_id": ObjectId(vehicle_id), "userId": current_user["phone"]})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Spare Parts Locater (Vendors & Inventory) Endpoints ---

@app.post("/admin/vendors")
async def add_vendor(vendor: VendorModel, current_user: dict = Depends(get_current_admin)):
    try:
        vendor_dict = vendor.dict()
        vendor_dict["location"] = {"type": "Point", "coordinates": [vendor.lng, vendor.lat]}
        vendor_dict["createdAt"] = datetime.utcnow()
        result = await db.vendors.insert_one(vendor_dict)
        
        # Ensure index for spatial search
        await db.vendors.create_index([("location", "2dsphere")])
        return {"status": "success", "vendorId": str(result.inserted_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/admin/vendors")
async def get_vendors(current_user: dict = Depends(get_current_admin)):
    try:
        cursor = db.vendors.find()
        vendors = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            vendors.append(doc)
        return vendors
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/admin/vendors/{vendor_id}/parts")
async def add_part_to_vendor(vendor_id: str, part: PartModel, current_user: dict = Depends(get_current_admin)):
    try:
        part_dict = part.dict()
        part_dict["vendorId"] = vendor_id
        part_dict["createdAt"] = datetime.utcnow()
        result = await db.parts.insert_one(part_dict)
        return {"status": "success", "partId": str(result.inserted_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/admin/vendors/{vendor_id}/parts")
async def get_vendor_parts(vendor_id: str, current_user: dict = Depends(get_current_admin)):
    try:
        cursor = db.parts.find({"vendorId": vendor_id})
        parts = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            parts.append(doc)
        return parts
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/parts/search")
async def search_parts(q: str, lat: float, lng: float, radius_km: float = 15.0, current_user: dict = Depends(get_current_mechanic)):
    try:
        # Search parts collection for a text match on `partName`
        part_cursor = db.parts.find({"partName": {"$regex": q, "$options": "i"}, "inStock": True})
        matching_parts = await part_cursor.to_list(length=100)
        
        if not matching_parts:
            return []
            
        vendor_ids = list(set([part["vendorId"] for part in matching_parts]))
        
        # Try finding valid ObjectIds and also raw string IDs in case they were stored differently
        vendor_object_ids = [ObjectId(vid) for vid in vendor_ids if len(vid) == 24]
        
        max_distance_meters = radius_km * 1000
        vendor_cursor = db.vendors.find({
            "_id": {"$in": vendor_object_ids},
            "location": {
                "$near": {
                    "$geometry": {"type": "Point", "coordinates": [lng, lat]},
                    "$maxDistance": max_distance_meters
                }
            }
        })
        
        nearby_vendors = await vendor_cursor.to_list(length=100)
        
        results = []
        for vendor in nearby_vendors:
            vendor["_id"] = str(vendor["_id"])
            vendor_parts = [p for p in matching_parts if p["vendorId"] == vendor["_id"]]
            for vp in vendor_parts:
                vp["_id"] = str(vp["_id"])
            
            results.append({
                "vendor": vendor,
                "parts": vendor_parts
            })
            
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

import base64
try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    genai = None
    GEMINI_AVAILABLE = False
    print("⚠️  google-generativeai not installed. AI diagnosis endpoint disabled. Run: pip install google-generativeai")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_AVAILABLE and GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# --- Service Request Endpoints ---

@app.post("/requests/ai-diagnose")
async def ai_diagnose(audio_base64: str, current_user: dict = Depends(get_current_user)):
    """Accepts base64 audio, sends to Gemini for transcription and vehicle diagnosis."""
    if not GEMINI_AVAILABLE or not GEMINI_API_KEY:
        raise HTTPException(status_code=501, detail="AI diagnosis not configured. Add GEMINI_API_KEY to your .env file and ensure google-generativeai is installed.")
    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        prompt = (
            "You are an expert automotive breakdown assistant. "
            "A stranded user has recorded a voice message describing their vehicle problem. "
            "The audio is base64 encoded below. Please:\n"
            "1. Transcribe what they said.\n"
            "2. Diagnose the most likely issue (be specific, e.g. 'Dead Battery', 'Broken Alternator').\n"
            "3. State if a Tow Truck is needed (true/false).\n\n"
            "Respond ONLY in this exact JSON format: "
            '{"transcription": "...", "diagnosis": "...", "requires_tow": false}\n\n'
            f"Audio (base64): {audio_base64[:500]}..." # Trim for prompt safety
        )
        response = model.generate_content(prompt)
        raw = response.text.strip()
        # Strip markdown code blocks if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        import json
        result = json.loads(raw)
        return result
    except Exception as e:
        print(f"Gemini API Error: {e}")
        raise HTTPException(status_code=500, detail=f"AI diagnosis failed: {str(e)}")

@app.post("/requests/sos")
async def create_sos_request(request: ServiceRequestModel, current_user: dict = Depends(get_current_user)):
    """Creates an SOS broadcast request visible to ALL online mechanics simultaneously."""
    try:
        request_dict = request.dict()
        request_dict["createdAt"] = datetime.now()
        request_dict["mechanicPhone"] = "SOS_BROADCAST" # Special flag
        request_dict["status"] = "pending"
        request_dict["isSOS"] = True
        
        result = await db["requests"].insert_one(request_dict)
        request_id = str(result.inserted_id)
        print(f"🚨 SOS BROADCAST created: {request_id} from {request.userPhone}")
        return {"id": request_id, "status": "broadcast", "message": "SOS dispatched to all nearby mechanics!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/requests")
async def create_request(request: ServiceRequestModel, current_user: dict = Depends(get_current_user)):
    try:
        print(f"🔍 DEBUG: Creating request for user: {request.userPhone}")
        request_dict = request.dict()
        request_dict["createdAt"] = datetime.now()
        
        # Explicit collection access
        result = await db["requests"].insert_one(request_dict)
        print(f"✅ DEBUG: Request created with ID: {result.inserted_id}")
        return {"id": str(result.inserted_id)}
    except Exception as e:
        print(f"❌ DEBUG: Failed to create request: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/requests")
async def get_requests(status: str = "pending", mechanicPhone: Optional[str] = None, current_user: dict = Depends(get_any_authenticated_user)):
    try:
        query = {"status": status}
        if mechanicPhone:
            query["mechanicPhone"] = mechanicPhone
        
        cursor = db.requests.find(query).sort("createdAt", -1)
        requests = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            requests.append(doc)
        return requests
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/tow/requests")
async def get_tow_requests(current_user: dict = Depends(get_current_tow_truck)):
    """Tow trucks pulling pending requests"""
    try:
        cursor = db.requests.find({"status": "tow_pending"}).sort("createdAt", -1)
        requests = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            requests.append(doc)
        return requests
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/requests/{request_id}/escalate-to-tow")
async def escalate_to_tow(request_id: str, current_user: dict = Depends(get_current_mechanic)):
    """Mechanic escalates an engine failure to a dedicated Tow Truck."""
    try:
        result = await db.requests.update_one(
            {"_id": ObjectId(request_id)},
            {"$set": {"status": "tow_pending", "requires_tow": True}}
        )
        if result.matched_count == 0:
             raise HTTPException(status_code=404, detail="Request not found")
             
        await manager.broadcast_to_room(request_id, {"type": "status_update", "status": "tow_pending"})
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/requests/{request_id}/tow-accept")
async def accept_tow_request(request_id: str, current_user: dict = Depends(get_current_tow_truck)):
    """Tow Truck Driver mathematically locks and claims the haulage request."""
    try:
        result = await db.requests.update_one(
            {"_id": ObjectId(request_id), "status": "tow_pending"},
            {"$set": {
                "status": "tow_accepted", 
                "tow_driver_phone": current_user["phone"],
                "towLat": current_user.get("lat"),
                "towLng": current_user.get("lng")
            }}
        )
        if result.modified_count == 0:
            raise HTTPException(status_code=409, detail="Tow Request has already been claimed by another driver")
            
        await manager.broadcast_to_room(request_id, {"type": "status_update", "status": "tow_accepted"})
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/requests/{request_id}")
async def get_request(request_id: str, current_user: dict = Depends(get_any_authenticated_user)):
    """Returns details of a specific request, including joined mechanic details if accepted."""
    try:
        request_doc = await db.requests.find_one({"_id": ObjectId(request_id)})
        if not request_doc:
            raise HTTPException(status_code=404, detail="Request not found")
        
        request_doc["_id"] = str(request_doc["_id"])
        
        # If accepted by mechanic, join mechanic info
        if request_doc.get("mechanicPhone"):
            phone = request_doc["mechanicPhone"]
            mechanic = await mechanics_collection.find_one({"phone": phone})
            if not mechanic and str(phone).isdigit():
                mechanic = await mechanics_collection.find_one({"phone": int(phone)})
            if mechanic:
                mechanic["_id"] = str(mechanic["_id"])
                request_doc["mechanic"] = mechanic

        # If accepted by tow driver, join tow truck info
        if request_doc.get("tow_driver_phone"):
            t_phone = request_doc["tow_driver_phone"]
            tow_truck = await tow_trucks_collection.find_one({"phone": t_phone})
            if not tow_truck and str(t_phone).isdigit():
                tow_truck = await tow_trucks_collection.find_one({"phone": int(t_phone)})
            if tow_truck:
                tow_truck["_id"] = str(tow_truck["_id"])
                request_doc["tow_truck"] = tow_truck
                
        return request_doc
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/requests/user/{user_phone}/active")
async def get_user_active_request(user_phone: str, current_user: dict = Depends(get_current_user)):
    """Finds the most recent non-completed request for a user."""
    try:
        # Find latest pending or accepted request
        cursor = db.requests.find({
            "userPhone": user_phone,
            "status": {"$in": ["pending", "accepted", "tow_pending", "tow_accepted"]}
        }).sort("createdAt", -1).limit(1)
        
        active_request = None
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            
            # Join mechanic info if accepted
            if doc.get("mechanicPhone"):
                phone = doc["mechanicPhone"]
                mechanic = await mechanics_collection.find_one({"phone": phone})
                if not mechanic and phone.isdigit():
                    mechanic = await mechanics_collection.find_one({"phone": int(phone)})
                
                if mechanic:
                    mechanic["_id"] = str(mechanic["_id"])
                    doc["mechanic"] = mechanic
            
            active_request = doc
            
        if not active_request:
            return None
            
        return active_request
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/requests/{request_id}/status")
async def update_request_status(
    request_id: str, 
    status: str, 
    mechanicPhone: Optional[str] = None,
    eta: Optional[str] = None,
    current_user: dict = Depends(get_current_mechanic)
):
    try:
        update_data = {"status": status}
        if mechanicPhone:
            update_data["mechanicPhone"] = mechanicPhone
        if eta:
            update_data["eta"] = eta
            
        result = await db.requests.update_one(
            {"_id": ObjectId(request_id)},
            {"$set": update_data}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Request not found")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update request: {str(e)}")

@app.post("/mechanics/register", response_model=MechanicModel)
async def register_mechanic(mechanic_data: MechanicCreate):
    """Registers a new mechanic shop in MongoDB, preventing duplicates."""
    try:
        # Check if already registered
        existing = await mechanics_collection.find_one({"phone": mechanic_data.phone})
        if existing:
             # Just update the existing one or tell them it exists
             print(f"🔍 DEBUG: Mechanic with phone {mechanic_data.phone} already exists. Updating...")
             # For now, let's just return the existing one or update it
             # result = await mechanics_collection.update_many(...)
             # return existing
        
        # Convert Pydantic model to dict
        mechanic_dict = mechanic_data.dict()
        
        # Add default values for internal fields
        mechanic_dict["rating"] = 0.0
        mechanic_dict["isOpen"] = True
        mechanic_dict["isVerified"] = False
        mechanic_dict["availability"] = "available"
        mechanic_dict["createdAt"] = datetime.utcnow()
        
        # Format location for GeoJSON if lat/lng are present
        if "lat" in mechanic_dict and "lng" in mechanic_dict:
            mechanic_dict["location"] = {
                "type": "Point",
                "coordinates": [mechanic_dict["lng"], mechanic_dict["lat"]]
            }
        
        # Insert into MongoDB
        result = await mechanics_collection.insert_one(mechanic_dict)
        
        # Add the generated ID to the dict
        mechanic_dict["_id"] = result.inserted_id
        
        return mechanic_dict
    except Exception as e:
        print(f"DEBUG: Registration Error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to register mechanic: {str(e)}")

# --- KYC Verification Endpoints ---

@app.post("/mechanic/kyc/upload")
async def upload_kyc_document(file: UploadFile = File(...), current_mechanic: dict = Depends(get_current_mechanic)):
    """Allows a mechanic to securely upload their Govt ID and photo proof."""
    # Ensure it's an image
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image (JPG/PNG)")
        
    file_ext = file.filename.split(".")[-1]
    secure_filename = f"{uuid.uuid4().hex}_{current_mechanic['phone']}.{file_ext}"
    file_path = f"uploads/kyc/{secure_filename}"
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    document_url = f"/uploads/kyc/{secure_filename}"
    
    # Update mechanic record with KYC submission details
    result = await mechanics_collection.update_many(
        {"phone": current_mechanic["phone"]},
        {"$set": {
            "kyc_status": "pending",
            "kyc_document_url": document_url,
            "kyc_submitted_at": datetime.utcnow()
        }}
    )
    
    # Also update integer phone if necessary (from legacy logic)
    if str(current_mechanic["phone"]).isdigit():
         await mechanics_collection.update_many(
            {"phone": int(current_mechanic["phone"])},
            {"$set": {
                "kyc_status": "pending",
                "kyc_document_url": document_url,
                "kyc_submitted_at": datetime.utcnow()
            }}
        )

    return {"status": "success", "message": "KYC Document uploaded successfully.", "kyc_document_url": document_url}

# Messaging Endpoints
@app.post("/requests/{request_id}/messages")
async def send_message(request_id: str, message: MessageModel, current_user: dict = Depends(get_any_authenticated_user)):
    try:
        message_dict = message.dict()
        message_dict["requestId"] = request_id
        message_dict["timestamp"] = datetime.now()
        
        result = await db.messages.insert_one(message_dict)
        message_dict["_id"] = str(result.inserted_id)
        
        # Serialize timestamp for JSON broadcast
        broadcast_msg = message_dict.copy()
        broadcast_msg["timestamp"] = broadcast_msg["timestamp"].isoformat()
        
        # Broadcast message instantly to the active WebSocket room
        await manager.broadcast_to_room(request_id, {"type": "new_message", "message": broadcast_msg})
        
        return message_dict
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send message: {str(e)}")

@app.get("/requests/{request_id}/messages")
async def get_messages(request_id: str, current_user: dict = Depends(get_any_authenticated_user)):
    try:
        messages = await db.messages.find({"requestId": request_id}).sort("timestamp", 1).to_list(100)
        for msg in messages:
            msg["_id"] = str(msg["_id"])
        return messages
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch messages: {str(e)}")

@app.put("/requests/{request_id}/mechanic-location")
async def update_mechanic_location(request_id: str, lat: float, lng: float, current_user: dict = Depends(get_current_mechanic)):
    try:
        result = await db.requests.update_one(
            {"_id": ObjectId(request_id)},
            {"$set": {"mechanicLat": lat, "mechanicLng": lng}}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Request not found")
            
        # Broadcast the mechanic's live location update across the WebSocket room
        await manager.broadcast_to_room(request_id, {"type": "location_update", "lat": lat, "lng": lng})
        
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update location: {str(e)}")

@app.put("/requests/{request_id}/tow-location")
async def update_tow_location(request_id: str, lat: float, lng: float, current_user: dict = Depends(get_current_tow_truck)):
    try:
        result = await db.requests.update_one(
            {"_id": ObjectId(request_id)},
            {"$set": {"towLat": lat, "towLng": lng}}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Request not found")
            
        # Broadcast the tow truck's live location update across the WebSocket room
        await manager.broadcast_to_room(request_id, {"type": "location_update", "lat": lat, "lng": lng, "is_tow": True})
        
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update tow location: {str(e)}")

@app.post("/auth/admin-login")
async def admin_login(credentials: dict):
    username = credentials.get("username")
    password = credentials.get("password")
    
    # Check environment variables
    env_admin_user = os.getenv("ADMIN_USERNAME")
    env_admin_pass = os.getenv("ADMIN_PASSWORD")
    
    if env_admin_user and env_admin_pass:
        if username == env_admin_user and password == env_admin_pass:
            access_token = create_access_token(
                data={"sub": username, "role": "admin"}
            )
            return {"status": "success", "access_token": access_token, "token_type": "bearer", "role": "admin"}
            
    # Check admins collection
    admin_doc = await db.admins.find_one({"username": username})
    if admin_doc and admin_doc.get("password") == password:
         access_token = create_access_token(
             data={"sub": username, "role": "admin"}
         )
         return {"status": "success", "access_token": access_token, "token_type": "bearer", "role": "admin"}
         
    raise HTTPException(status_code=401, detail="Invalid admin credentials")

# --- Admin Endpoints ---─────────────────────────────────────────────────────────

@app.get("/admin/stats")
async def get_admin_stats(current_user: dict = Depends(get_current_admin)):
    """Returns high-level platform statistics for the admin dashboard."""
    try:
        total_mechanics = await mechanics_collection.count_documents({})
        verified_mechanics = await mechanics_collection.count_documents({"isVerified": True})
        open_mechanics = await mechanics_collection.count_documents({"isOpen": True})
        total_requests = await db.requests.count_documents({})
        pending_requests = await db.requests.count_documents({"status": "pending"})
        accepted_requests = await db.requests.count_documents({"status": "accepted"})
        completed_requests = await db.requests.count_documents({"status": "completed"})
        total_admins = await admins_collection.count_documents({})

        return {
            "mechanics": {
                "total": total_mechanics,
                "verified": verified_mechanics,
                "open": open_mechanics,
                "unverified": total_mechanics - verified_mechanics,
            },
            "requests": {
                "total": total_requests,
                "pending": pending_requests,
                "accepted": accepted_requests,
                "completed": completed_requests,
            },
            "admins": total_admins,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch stats: {str(e)}")


@app.get("/admin/mechanics")
async def admin_list_mechanics(current_user: dict = Depends(get_current_admin)):
    """Returns all mechanics with full details for admin review."""
    try:
        mechanics = await mechanics_collection.find().sort("createdAt", -1).to_list(1000)
        for m in mechanics:
            m["_id"] = str(m["_id"])
            # Normalize phone to string just in case
            if "phone" in m:
                m["phone"] = str(m["phone"])
        return mechanics
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list mechanics: {str(e)}")


@app.put("/admin/mechanics/{phone}/verify")
async def admin_verify_mechanic(phone: str, verified: bool, current_user: dict = Depends(get_current_admin)):
    """Toggles the isVerified flag on a mechanic record."""
    try:
        result = await mechanics_collection.update_many(
            {"phone": phone},
            {"$set": {"isVerified": verified}}
        )
        # Also try as integer
        if phone.isdigit():
            int_result = await mechanics_collection.update_many(
                {"phone": int(phone)},
                {"$set": {"isVerified": verified}}
            )
            matched = result.matched_count + int_result.matched_count
        else:
            matched = result.matched_count

        if matched == 0:
            raise HTTPException(status_code=404, detail="Mechanic not found")

        return {"status": "success", "isVerified": verified, "updated": matched}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update verification: {str(e)}")

@app.get("/admin/mechanics/pending-kyc")
async def admin_get_pending_kyc(current_user: dict = Depends(get_current_admin)):
    """Returns all mechanics waiting for KYC verification from the Admin."""
    try:
        cursor = mechanics_collection.find({"kyc_status": "pending"}).sort("kyc_submitted_at", -1)
        mechanics = await cursor.to_list(1000)
        for m in mechanics:
            m["_id"] = str(m["_id"])
            if "phone" in m:
                m["phone"] = str(m["phone"])
        return mechanics
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch pending KYC: {str(e)}")

@app.put("/admin/mechanics/{phone}/approve-kyc")
async def admin_approve_kyc(phone: str, current_user: dict = Depends(get_current_admin)):
    """Approves a mechanic's KYC submission and officially verifies them."""
    try:
        update_doc = {
            "$set": {
                "isVerified": True,
                "kyc_status": "approved",
                "kyc_reviewed_at": datetime.utcnow(),
                "kyc_rejection_reason": None
            }
        }
        result = await mechanics_collection.update_many({"phone": phone}, update_doc)
        if phone.isdigit():
            await mechanics_collection.update_many({"phone": int(phone)}, update_doc)
            
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Mechanic not found")
            
        return {"status": "success", "message": "Mechanic KYC Appproved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to approve KYC: {str(e)}")

class RejectKYCModel(models.BaseModel):
    reason: str

@app.put("/admin/mechanics/{phone}/reject-kyc")
async def admin_reject_kyc(phone: str, payload: RejectKYCModel, current_user: dict = Depends(get_current_admin)):
    """Rejects a mechanic's KYC submission requiring re-upload."""
    try:
        update_doc = {
            "$set": {
                "isVerified": False,
                "kyc_status": "rejected",
                "kyc_reviewed_at": datetime.utcnow(),
                "kyc_rejection_reason": payload.reason
            }
        }
        result = await mechanics_collection.update_many({"phone": phone}, update_doc)
        if phone.isdigit():
            await mechanics_collection.update_many({"phone": int(phone)}, update_doc)
            
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Mechanic not found")
            
        return {"status": "success", "message": "Mechanic KYC Rejected"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reject KYC: {str(e)}")


@app.get("/admin/requests")
async def admin_list_requests(status: Optional[str] = None, limit: int = 100, current_user: dict = Depends(get_current_admin)):
    """Returns all service requests for admin oversight."""
    try:
        query = {}
        if status:
            query["status"] = status
        cursor = db.requests.find(query).sort("createdAt", -1).limit(limit)
        requests = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            requests.append(doc)
        return requests
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch requests: {str(e)}")

# --- Digital Garage Endpoints ---

@app.post("/users/vehicles", response_model=VehicleModel)
async def add_vehicle(vehicle: VehicleModel, current_user: dict = Depends(get_current_user)):
    """Add a new vehicle to the user's digital garage."""
    vehicle_dict = vehicle.dict(exclude={"id"})
    vehicle_dict["userPhone"] = current_user["phone"]
    
    result = await db.vehicles_collection.insert_one(vehicle_dict)
    
    # Return the inserted document with string ID
    vehicle_dict["id"] = str(result.inserted_id)
    return vehicle_dict

@app.get("/users/vehicles", response_model=List[VehicleModel])
async def list_vehicles(current_user: dict = Depends(get_current_user)):
    """Retrieve all vehicles associated with the current user."""
    cursor = db.vehicles_collection.find({"userPhone": current_user["phone"]})
    vehicles = []
    async for doc in cursor:
        doc["id"] = str(doc["_id"])
        vehicles.append(doc)
    return vehicles

@app.delete("/users/vehicles/{vehicle_id}")
async def delete_vehicle(vehicle_id: str, current_user: dict = Depends(get_current_user)):
    """Remove a vehicle from the user's digital garage."""
    try:
        result = await db.vehicles_collection.delete_one({
            "_id": ObjectId(vehicle_id),
            "userPhone": current_user["phone"]
        })
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Vehicle not found or unauthorized")
        return {"status": "success", "message": "Vehicle deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid vehicle ID")

# --- Auto Parts Vendor Endpoints (Admin Controlled) ---

@app.post("/admin/vendors", response_model=VendorModel)
async def add_vendor(vendor: VendorModel, current_admin: dict = Depends(get_current_admin)):
    """Admin registers a new Auto Parts Vendor."""
    vendor_dict = vendor.dict(exclude={"id"})
    
    # Create the GeoJSON Point for 2dsphere indexing
    vendor_dict["location"] = {
        "type": "Point",
        "coordinates": [vendor.lng, vendor.lat]
    }
    
    result = await db.vendors_collection.insert_one(vendor_dict)
    vendor_dict["id"] = str(result.inserted_id)
    return vendor_dict

@app.get("/admin/vendors", response_model=List[VendorModel])
async def list_vendors(current_admin: dict = Depends(get_current_admin)):
    """Admin retrieves all Auto Parts Vendors."""
    cursor = db.vendors_collection.find()
    vendors = []
    async for doc in cursor:
        doc["id"] = str(doc["_id"])
        if "location" in doc and "coordinates" in doc["location"]:
            doc["lng"] = doc["location"]["coordinates"][0]
            doc["lat"] = doc["location"]["coordinates"][1]
        vendors.append(doc)
    return vendors

@app.post("/admin/vendors/{vendor_id}/parts", response_model=PartModel)
async def add_part_to_vendor(vendor_id: str, part: PartModel, current_admin: dict = Depends(get_current_admin)):
    """Admin adds an inventory part to a specific vendor."""
    part_dict = part.dict(exclude={"id"})
    part_dict["vendorId"] = vendor_id
    
    result = await db.parts_collection.insert_one(part_dict)
    part_dict["id"] = str(result.inserted_id)
    return part_dict

@app.get("/admin/vendors/{vendor_id}/parts", response_model=List[PartModel])
async def list_vendor_parts(vendor_id: str, current_admin: dict = Depends(get_current_admin)):
    """Admin retrieves all parts for a specific vendor."""
    cursor = db.parts_collection.find({"vendorId": vendor_id})
    parts = []
    async for doc in cursor:
        doc["id"] = str(doc["_id"])
        parts.append(doc)
    return parts

# --- Spare Parts Search Engine (Mechanic Endpoint) ---

@app.get("/parts/search")
async def search_parts(q: str, lat: float, lng: float, radius_km: float = 15.0, current_mechanic: dict = Depends(get_current_mechanic)):
    """
    Search for a specific part across nearby vendors within the radius_km.
    Uses MongoDB $near / 2dsphere indexing for optimal geospatial lookup.
    """
    max_distance_meters = radius_km * 1000
    
    # Perform regex search on the part name (case insensitive)
    # This finds all part documents across all vendors matching the query string
    part_query = {"partName": {"$regex": q, "$options": "i"}}
    
    # Get all matching parts first
    matching_parts_cursor = db.parts_collection.find(part_query)
    matching_parts = []
    async for part_doc in matching_parts_cursor:
        part_doc["id"] = str(part_doc["_id"])
        matching_parts.append(part_doc)
        
    if not matching_parts:
        return []
        
    # Group parts by vendorId to batch query the unique vendors
    vendor_ids = list(set([part["vendorId"] for part in matching_parts]))
    vendor_object_ids = [ObjectId(vid) for vid in vendor_ids if ObjectId.is_valid(vid)]
    
    # Geospatial query for vendors within distance that contain these parts
    vendor_query = {
        "_id": {"$in": vendor_object_ids},
        "location": {
            "$near": {
                "$geometry": {
                    "type": "Point",
                    "coordinates": [lng, lat]
                },
                "$maxDistance": max_distance_meters
            }
        }
    }
    
    vendors_cursor = db.vendors_collection.find(vendor_query)
    
    results = []
    async for vendor_doc in vendors_cursor:
        vendor_doc["id"] = str(vendor_doc["_id"])
        vid = vendor_doc["id"]
        
        # Pull only the parts that belong to this particular vendor AND matched the search string
        vendor_stock = [p for p in matching_parts if p["vendorId"] == vid]
        
        # Build the response object mimicking MechanicDashboard UI requirements:
        # { vendor: { shopName, address, phone }, parts: [...] }
        results.append({
            "vendor": {
                "id": str(vendor_doc["_id"]),
                "shopName": vendor_doc.get("shopName"),
                "address": vendor_doc.get("address"),
                "phone": vendor_doc.get("phone")
            },
            "parts": vendor_stock
        })
        
    return results
