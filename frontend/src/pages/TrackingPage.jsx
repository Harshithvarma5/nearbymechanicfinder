import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRequestById } from '../services/api';
import { Clock, MapPin, Phone, CheckCircle, Loader2, User, Wrench, ShieldCheck, ArrowLeft, MessageSquare, Navigation, AlertCircle, Truck } from 'lucide-react';
import Navbar from '../components/Navbar';
import ChatBox from '../components/ChatBox';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

// Custom Leaflet icons for tracking
const mechanicIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/1048/1048329.png',
    iconSize: [45, 45],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22],
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    shadowSize: [41, 41],
    shadowAnchor: [12, 41]
});

const towIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/2555/2555013.png',
    iconSize: [45, 45],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22],
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    shadowSize: [41, 41],
    shadowAnchor: [12, 41]
});

const defaultIcon = new L.Icon({
    iconUrl: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    shadowSize: [41, 41],
    shadowAnchor: [12, 41]
});

// Component to handle dynamic map panning/re-centering for tracking
const ChangeMapView = ({ center }) => {
    const map = useMap();
    useEffect(() => {
        if (center && center[0] && center[1]) {
            map.setView(center, map.getZoom());
        }
    }, [center, map]);
    return null;
};

const TrackingPage = ({ theme, toggleTheme, showToast }) => {
    const { requestId } = useParams();
    const navigate = useNavigate();
    const [request, setRequest] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchStatus = async () => {
        try {
            const data = await getRequestById(requestId);
            if (!data) {
                setError("Request not found in our database.");
            } else {
                setRequest(data);
            }
            setLoading(false);
        } catch (err) {
            console.error("Tracking Error:", err);
            setError("Could not load tracking details. Please check your connection.");
            setLoading(false);
        }
    };

    useEffect(() => {
        // Initial load
        fetchStatus();
        
        // Connect to active WebSocket room for instant map tracking
        const wsUrl = import.meta.env.VITE_API_BASE_URL 
            ? import.meta.env.VITE_API_BASE_URL.replace('http', 'ws')
            : 'ws://localhost:8000';
            
        const socket = new WebSocket(`${wsUrl}/ws/requests/${requestId}`);

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'location_update') {
                    // Update ONLY the map coordinates instantly
                    setRequest(prev => {
                        if (!prev) return prev;
                        if (data.is_tow) {
                            return { ...prev, towLat: data.lat, towLng: data.lng };
                        }
                        return { ...prev, mechanicLat: data.lat, mechanicLng: data.lng };
                    });
                } else if (data.type === 'status_update') {
                    // Update full status instantly
                    setRequest(prev => {
                        if (!prev) return prev;
                        return { ...prev, status: data.status };
                    });
                    // Refresh data to get joined provider info
                    fetchStatus();
                }
            } catch (err) {
                console.error("WS Map Tracking Error:", err);
            }
        };

        // Decelerate heavy HTTP polling to 30 seconds as pure fallback
        const interval = setInterval(fetchStatus, 30000); 
        
        return () => {
            clearInterval(interval);
            socket.close();
        };
    }, [requestId]);

    if (loading) {
        return (
            <div className={`app-container ${theme}`}>
                <Navbar theme={theme} toggleTheme={toggleTheme} />
                <div className="loading-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
                    <Loader2 className="spin" size={48} color="var(--primary)" />
                    <p style={{ marginTop: '1rem', color: 'var(--text-light)' }}>Initializing live tracking...</p>
                </div>
            </div>
        );
    }

    if (error || !request) {
        return (
            <div className={`app-container ${theme}`}>
                <Navbar theme={theme} toggleTheme={toggleTheme} />
                <div className="error-container" style={{ textAlign: 'center', padding: '10rem 2rem' }}>
                    <AlertCircle size={48} color="red" style={{ marginBottom: '1rem' }} />
                    <h2 style={{ color: 'var(--text-color)' }}>Tracking Unavailable</h2>
                    <p style={{ color: 'var(--text-light)', marginBottom: '2rem' }}>{error || "We couldn't find this request. It might have been deleted."}</p>
                    <button className="btn btn-primary" onClick={() => navigate('/')}>Back to Home</button>
                </div>
            </div>
        );
    }

    const { status = 'pending', mechanic, eta, issue } = request;

    const isTowRequest = status.startsWith('tow_');
    const steps = isTowRequest ? [
        { key: 'tow_pending', label: 'Tow Requested', icon: <Truck size={20} /> },
        { key: 'tow_accepted', label: 'Tow Truck on the Way', icon: <Truck size={20} /> },
        { key: 'completed', label: 'Tow Completed', icon: <CheckCircle size={20} /> }
    ] : [
        { key: 'pending', label: 'Requested', icon: <Clock size={20} /> },
        { key: 'accepted', label: 'Mechanic on the Way', icon: <Wrench size={20} /> },
        { key: 'completed', label: 'Work Finished', icon: <CheckCircle size={20} /> }
    ];

    const currentStepIndex = Math.max(0, steps.findIndex(s => s.key === status));

    return (
        <div className={`app-container ${theme}`}>
            <Navbar theme={theme} toggleTheme={toggleTheme} />
            <div className="tracking-layout">
                <main className="tracking-content" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
                    <button className="back-link" onClick={() => navigate('/')} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', color: 'var(--text-light)', cursor: 'pointer', marginBottom: '1.5rem', fontWeight: '600' }}>
                        <ArrowLeft size={16} /> Back to Search
                    </button>

                    <div className="tracking-card" style={{ background: 'var(--card-bg)', borderRadius: '24px', padding: '2rem', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-lg)' }}>
                        <section className="tracking-header" style={{ marginBottom: '2rem' }}>
                            <div className="status-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <span className={`status-pill ${status}`} style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '800', background: status === 'accepted' ? '#f97316' : status === 'completed' ? '#22c55e' : '#64748b', color: 'white' }}>
                                    {status.toUpperCase()}
                                </span>
                                <span className="request-id" style={{ color: 'var(--text-light)', fontSize: '0.8rem' }}>Job ID: #{requestId.slice(-6)}</span>
                            </div>
                            <h2 style={{ fontSize: '1.75rem', marginBottom: '1rem', color: 'var(--text-color)' }}>
                                {status === 'pending' || status === 'tow_pending' ? 'Looking for Help...' : 
                                 (status === 'accepted' || status === 'tow_accepted') ? 'Help is En Route' : 'Service Completed'}
                            </h2>
                            <div className="tracking-summary" style={{ background: 'var(--bg-color)', padding: '1.25rem', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
                                <p className="issue-text" style={{ margin: 0, fontWeight: '500' }}><strong>Problem:</strong> {issue}</p>
                                {request.vehicleModel && (
                                    <p className="vehicle-text" style={{ margin: '8px 0 0 0', fontSize: '0.9rem', color: 'var(--text-light)' }}>
                                        <Wrench size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> 
                                        <strong>Vehicle:</strong> {request.vehicleYear} {request.vehicleModel} ({request.engineType})
                                    </p>
                                )}
                            </div>
                        </section>

                        <section className="tracking-stepper" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2.5rem', position: 'relative' }}>
                            {steps.map((step, index) => (
                                <div key={step.key} className={`step-item ${index <= currentStepIndex ? 'completed' : ''} ${index === currentStepIndex ? 'active' : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', zIndex: 1 }}>
                                    <div className="step-icon" style={{ width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: index <= currentStepIndex ? 'var(--primary)' : 'var(--border-color)', color: 'white', transition: 'all 0.3s' }}>
                                        {index < currentStepIndex ? <CheckCircle size={20} /> : step.icon}
                                    </div>
                                    <span className="step-label" style={{ marginTop: '8px', fontSize: '0.75rem', fontWeight: index <= currentStepIndex ? '700' : '500', color: index <= currentStepIndex ? 'var(--text-color)' : 'var(--text-light)' }}>{step.label}</span>
                                    {index < steps.length - 1 && (
                                        <div className="step-line" style={{ position: 'absolute', top: '20px', left: 'calc(50% + 20px)', width: 'calc(100% - 40px)', height: '2px', background: index < currentStepIndex ? 'var(--primary)' : 'var(--border-color)', zIndex: -1 }}></div>
                                    )}
                                </div>
                            ))}
                        </section>

                        {(status === 'accepted' || status === 'tow_accepted') && request.lat && request.lng && (
                            <div className="tracking-map-container" style={{ width: '100%', height: '300px', marginBottom: '2rem', borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                <MapContainer
                                    center={[request.lat, request.lng]}
                                    zoom={14}
                                    style={{ width: '100%', height: '100%' }}
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
                                    
                                    {/* Programmatic panning when user location/breakdown updates */}
                                    <ChangeMapView center={[request.lat, request.lng]} />
                                    
                                    <Marker position={[request.lat, request.lng]} icon={defaultIcon} />
                                    {request.mechanicLat && request.mechanicLng && (
                                        <Marker 
                                            position={[request.mechanicLat, request.mechanicLng]}
                                            icon={mechanicIcon}
                                        />
                                    )}
                                    {request.towLat && request.towLng && (
                                        <Marker 
                                            position={[request.towLat, request.towLng]}
                                            icon={towIcon}
                                        />
                                    )}
                                </MapContainer>
                            </div>
                        )}

                        {status === 'accepted' && (
                            <section className="arrival-info" style={{ marginBottom: '2rem', background: 'linear-gradient(135deg, var(--primary), #4f46e5)', padding: '1.5rem', borderRadius: '20px', color: 'white', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div className="eta-badge" style={{ background: 'rgba(255,255,255,0.2)', padding: '12px', borderRadius: '12px' }}>
                                    <Clock size={32} />
                                </div>
                                <div className="eta-text">
                                    <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.9 }}>Estimated Arrival</p>
                                    <h3 style={{ margin: 0, fontSize: '1.5rem' }}>{eta || 'Coming Soon'}</h3>
                                </div>
                            </section>
                        )}

                        {mechanic || request.tow_truck ? (
                            <section className="mechanic-info-card" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '2rem' }}>
                                <h3 style={{ marginBottom: '1.5rem', fontSize: '1.1rem' }}>Your {isTowRequest ? 'Tow Driver' : 'Mechanic'} Details</h3>
                                <div className="mech-profile" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '2rem' }}>
                                    <div className="mech-avatar" style={{ width: '64px', height: '64px', borderRadius: '20px', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {isTowRequest ? <Truck size={32} /> : <User size={32} />}
                                    </div>
                                    <div className="mech-details" style={{ flex: 1 }}>
                                        <h4 style={{ margin: 0, fontSize: '1.25rem' }}>{(mechanic?.shopName || request.tow_truck?.companyName) || (isTowRequest ? 'Expert Tow Driver' : 'Expert Mechanic')}</h4>
                                        <p style={{ margin: '4px 0', color: 'var(--text-light)', fontSize: '0.9rem' }}>
                                            {(mechanic?.name || request.tow_truck?.name)} • <Star size={12} /> {(mechanic?.rating || '5.0')}
                                        </p>
                                        <button className="btn btn-primary" onClick={() => window.open(`tel:${mechanic?.phone || request.tow_truck?.phone}`, '_self')} style={{ marginTop: '12px', fontSize: '0.8rem', padding: '8px 16px' }}>
                                            <Phone size={14} style={{ marginRight: '6px' }} /> Call {isTowRequest ? 'Driver' : 'Mechanic'}
                                        </button>
                                    </div>
                                </div>
                                <ChatBox 
                                    requestId={requestId}
                                    senderPhone={request.userPhone}
                                    receiverName={(mechanic?.name || request.tow_truck?.name) || (isTowRequest ? 'Tow Driver' : 'Mechanic')}
                                    isMechanic={false}
                                  />
                            </section>
                        ) : status === 'pending' || status === 'tow_pending' ? (
                            <div className="waiting-animation" style={{ textAlign: 'center', padding: '2rem 0' }}>
                                <div className="pulse-container" style={{ position: 'relative', width: '80px', height: '80px', margin: '0 auto 1.5rem' }}>
                                    <div className="pulse" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: '50%', background: 'var(--primary)', opacity: 0.2, animation: 'pulse 2s infinite' }}></div>
                                    <div className="pulse" style={{ position: 'absolute', top: 10, left: 10, right: 10, bottom: 10, borderRadius: '50%', background: 'var(--primary)', opacity: 0.3, animation: 'pulse 2s infinite 0.5s' }}></div>
                                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'var(--primary)' }}>
                                        <MapPin size={32} />
                                    </div>
                                </div>
                                <p style={{ color: 'var(--text-light)', fontWeight: '500' }}>Finding the best mechanic for you...</p>
                            </div>
                        ) : null}
                    </div>
                </main>
            </div>
        </div>
    );
};

// Sub-components
const Star = ({ size = 12 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="gold" stroke="gold" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
);

export default TrackingPage;
