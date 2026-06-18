from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class MechanicModel(BaseModel):
    name: str = Field(...)
    shopName: str = Field(...)
    lat: Optional[float] = None
    lng: Optional[float] = None
    location: Optional[dict] = None
    phone: str = Field(...)
    rating: float = Field(0.0)
    isOpen: bool = Field(True)
    address: str = Field(...)
    services: List[str] = Field(default_factory=list)
    availability: str = Field("available") # available, busy, closed
    images: List[str] = Field(default_factory=list)
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    isVerified: bool = Field(False)
    kyc_status: str = Field("not_submitted") # not_submitted, pending, approved, rejected
    kyc_document_url: Optional[str] = None
    kyc_submitted_at: Optional[datetime] = None
    kyc_reviewed_at: Optional[datetime] = None
    kyc_rejection_reason: Optional[str] = None

    class Config:
        populate_by_name = True
        json_schema_extra = {
            "example": {
                "name": "Ravi",
                "shopName": "Ravi Bike Garage",
                "lat": 17.385,
                "lng": 78.4867,
                "phone": "9876543210",
                "rating": 4.5,
                "isOpen": True,
                "address": "Banjara Hills, Hyderabad",
                "services": ["Oil Change", "Brake Repair"],
                "createdAt": "2024-03-15T10:00:00Z",
                "isVerified": False
            }
        }

class ServiceRequestModel(BaseModel):
    userPhone: str
    issue: str
    vehicleId: Optional[str] = None # Link breakdown to a digital garage vehicle
    vehicleModel: Optional[str] = None
    vehicleYear: Optional[str] = None
    engineType: Optional[str] = None
    voiceData: Optional[str] = None # Base64 encoded audio
    lat: float
    lng: float
    status: str = "pending" # pending, accepted, completed
    mechanicPhone: Optional[str] = None
    mechanicLat: Optional[float] = None
    mechanicLng: Optional[float] = None
    towLat: Optional[float] = None
    towLng: Optional[float] = None
    eta: Optional[str] = None
    requires_tow: bool = Field(False)
    tow_driver_phone: Optional[str] = None
    createdAt: datetime = Field(default_factory=datetime.now)

class TowTruckModel(BaseModel):
    name: str = Field(...)
    companyName: str = Field(...)
    phone: str = Field(...)
    address: str = Field(...)
    lat: Optional[float] = None
    lng: Optional[float] = None
    location: Optional[dict] = None
    availability: str = Field("available") # available, busy, off_duty
    isVerified: bool = Field(False)
    createdAt: datetime = Field(default_factory=datetime.utcnow)

class TowTruckCreate(BaseModel):
    name: str
    companyName: str
    phone: str
    address: str
    lat: float
    lng: float

class MechanicCreate(BaseModel):
    name: str
    shopName: str
    phone: str
    address: str
    services: List[str] = []
    lat: float
    lng: float

class OtpRequest(BaseModel):
    phone: str
    role: str

class OtpVerify(BaseModel):
    phone: str
    otp: str
    role: str

class MessageModel(BaseModel):
    sender: str  # 'user' or 'mechanic'
    text: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

# --- Vehicle Management & Spare Parts Models ---

class VehicleModel(BaseModel):
    make: str
    model: str
    year: str
    licensePlate: str
    lastServiceDate: Optional[str] = None
    nextServiceDate: Optional[str] = None

class VendorModel(BaseModel):
    shopName: str
    phone: str
    address: str
    lat: float
    lng: float

class PartModel(BaseModel):
    vendorId: str
    partName: str
    partNumber: Optional[str] = None
    price: float
    inStock: bool = True
