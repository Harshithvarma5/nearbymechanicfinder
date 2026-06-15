import { Star, Phone, MapPin, Navigation, LocateFixed, BadgeCheck } from 'lucide-react';
import { calculateDistance } from '../utils/distance';

const MechanicCard = ({ mechanic, isSelected, onClick, userLocation }) => {
    const { name, shopName, phone, rating, isOpen, address, source, lat, lng } = mechanic;

    const isOsm = source === 'osm';
    const distance = userLocation ? calculateDistance(userLocation.lat, userLocation.lng, lat, lng) : null;

    const handleCall = (e) => {
        e.stopPropagation();
        if (phone) {
            window.open(`tel:${phone}`, "_self");
        } else {
            alert("Phone number not available for this location.");
        }
    };

    const handleDirections = (e) => {
        e.stopPropagation();
        const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
        window.open(url, "_blank");
    };

    const availabilityStatus = mechanic.availability || 'available';
    const statusMap = {
        available: { label: 'Open Now', color: 'status-open' },
        busy: { label: 'Busy', color: 'status-busy' },
        closed: { label: 'Closed', color: 'status-closed' }
    };
    
    const statusInfo = statusMap[availabilityStatus];

    return (
        <div className={`mechanic-card ${isSelected ? 'selected' : ''} ${isOsm ? 'osm-card' : ''}`} onClick={onClick}>
            <div className="card-header">
                <div style={{ flex: 1 }}>
                    <h3 className="shop-name">
                        {shopName}
                        {mechanic.isVerified && (
                            <BadgeCheck size={18} className="verified-badge-icon" color="#0ea5e9" style={{ marginLeft: '6px', verticalAlign: 'text-bottom' }} title="Verified Mechanic" />
                        )}
                    </h3>
                    {name && <p className="mechanic-name">Mechanic: {name}</p>}
                </div>
                <div className="status-indicators">
                    <span className={`status-badge ${statusInfo.color}`}>
                        {statusInfo.label}
                    </span>
                    {isOsm && <span className="osm-badge">OSM Place</span>}
                </div>
            </div>

            <div className="card-details">
                <div className="rating-row">
                    <Star className="star-icon" />
                    <span className="rating-text">{rating.toFixed(1)}</span>
                </div>

                {distance !== null && (
                    <div className="distance-row">
                        <LocateFixed size={14} className="distance-icon" />
                        <span className="distance-text">{distance < 1 ? `${(distance * 1000).toFixed(0)} m` : `${distance.toFixed(1)} km`} away</span>
                    </div>
                )}
            </div>

            <div className="address-row">
                <MapPin size={16} />
                <span>{address}</span>
            </div>

            <div className="phone-row">
                <Phone size={16} />
                <span>{phone}</span>
            </div>

            <div className="action-buttons">
                <button 
                    className="btn btn-primary" 
                    onClick={handleCall}
                >
                    <Phone size={16} />
                    Call
                </button>
                <button 
                    className="btn btn-secondary" 
                    onClick={handleDirections}
                >
                    <Navigation size={16} />
                    Directions
                </button>
            </div>
        </div>
    );
};

export default MechanicCard;
