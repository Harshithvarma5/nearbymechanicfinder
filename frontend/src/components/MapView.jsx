import React, { useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

// Helper to construct custom Leaflet icons using Google's colored map pins
const createDotIcon = (url) => new L.Icon({
    iconUrl: url,
    iconSize: [32, 32],      // Adjusted size for standard map dots
    iconAnchor: [16, 32],    // Point of the icon which corresponds to marker's location
    popupAnchor: [0, -32],   // Point from which the popup should open relative to the anchor
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    shadowSize: [41, 41],
    shadowAnchor: [12, 41]
});

const userIcon = createDotIcon("https://maps.google.com/mapfiles/ms/icons/blue-dot.png");
const pendingIcon = createDotIcon("https://maps.google.com/mapfiles/ms/icons/purple-dot.png");
const redIcon = createDotIcon("https://maps.google.com/mapfiles/ms/icons/red-dot.png");
const greenIcon = createDotIcon("https://maps.google.com/mapfiles/ms/icons/green-dot.png");
const orangeIcon = createDotIcon("https://maps.google.com/mapfiles/ms/icons/orange-dot.png");

const containerStyle = {
  width: '100%',
  height: '100%'
};

// Component to handle dynamic map panning/re-centering
const ChangeMapView = ({ center, zoom }) => {
    const map = useMap();
    useEffect(() => {
        if (center && center[0] && center[1]) {
            map.setView(center, zoom);
        }
    }, [center, zoom, map]);
    return null;
};

// Component to handle map clicks for picker mode
const MapEventsHandler = ({ isPicker, onMapClick }) => {
    useMapEvents({
        click(e) {
            if (isPicker && onMapClick) {
                onMapClick({
                    lat: e.latlng.lat,
                    lng: e.latlng.lng
                });
            }
        }
    });
    return null;
};

const MapView = ({ userLocation, mechanics, selectedMechanicId, onMarkerClick, theme, isPicker, onMapClick, pendingLocation }) => {
    const defaultCenter = {
        lat: 17.3850,
        lng: 78.4867
    };

    const center = pendingLocation || userLocation || defaultCenter;
    const centerLatLng = center && center.lat && center.lng ? [center.lat, center.lng] : [defaultCenter.lat, defaultCenter.lng];
    const zoom = isPicker ? 16 : 13;

    return (
        <MapContainer
            center={centerLatLng}
            zoom={zoom}
            style={containerStyle}
            zoomControl={true}
        >
            <TileLayer
                url={theme === 'dark' 
                    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                }
                attribution={theme === 'dark'
                    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                }
            />

            {/* Programmatically change center/zoom when location updates */}
            <ChangeMapView center={centerLatLng} zoom={zoom} />

            {/* Map click listener for coordinate picker */}
            <MapEventsHandler isPicker={isPicker} onMapClick={onMapClick} />

            {/* User Location Marker */}
            {userLocation && !isPicker && userLocation.lat && userLocation.lng && (
                <Marker
                    position={[userLocation.lat, userLocation.lng]}
                    icon={userIcon}
                    title="You are here"
                />
            )}

            {/* Pending Location Marker (for registration) */}
            {isPicker && pendingLocation && pendingLocation.lat && pendingLocation.lng && (
                <Marker
                    position={[pendingLocation.lat, pendingLocation.lng]}
                    icon={pendingIcon}
                    title="Selected Shop Location"
                />
            )}

            {/* Mechanics Markers */}
            {!isPicker && mechanics.map((mech, index) => {
                const id = mech._id || mech.id;
                const uniqueKey = `marker-${mech.source || 'db'}-${id || 'idx'}-${index}`;
                const isSelected = selectedMechanicId === id;
                const isOsm = mech.source === 'osm';
                
                let icon = orangeIcon;
                if (isSelected) {
                    icon = redIcon;
                } else if (isOsm) {
                    icon = greenIcon;
                }

                if (typeof mech.lat !== 'number' || typeof mech.lng !== 'number') return null;

                return (
                    <Marker
                        key={uniqueKey}
                        position={[mech.lat, mech.lng]}
                        eventHandlers={{
                            click: () => onMarkerClick(mech)
                        }}
                        title={mech.shopName}
                        icon={icon}
                        zIndexOffset={isSelected ? 1000 : 0}
                    />
                );
            })}
        </MapContainer>
    );
};

export default React.memo(MapView);
