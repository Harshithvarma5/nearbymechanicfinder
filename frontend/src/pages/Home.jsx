import React, { useState, useEffect, useCallback } from 'react';
import MapView from '../components/MapView';
import MechanicCard from '../components/MechanicCard';
import Navbar from '../components/Navbar';
import Skeleton from '../components/Skeleton';
import { getMechanics, getNearbyMechanics, getOsmMechanics, getActiveRequest, createSosRequest } from '../services/api';
import RequestHelpModal from '../components/RequestHelpModal';
import MyGarageModal from '../components/MyGarageModal';
import { AlertTriangle, Clock, ArrowRight, Siren } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

const Home = ({ theme, toggleTheme, showToast }) => {
    const [mechanics, setMechanics] = useState([]);
    const [filteredMechanics, setFilteredMechanics] = useState([]);
    const [selectedMechanicId, setSelectedMechanicId] = useState(null);
    const [userLocation, setUserLocation] = useState(null);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showOnlyOpen, setShowOnlyOpen] = useState(false);
    const [minRating, setMinRating] = useState(0);
    const [showGarageModal, setShowGarageModal] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeRequest, setActiveRequest] = useState(null);
    const [sosBroadcasting, setSosBroadcasting] = useState(false);
    const navigate = useNavigate();

    const fetchMechanics = useCallback(async (location = null) => {
        setLoading(true);
        setError(null);
        try {
            if (location) {
                // Fetch from both MongoDB and OpenStreetMap (Overpass)
                const results = await Promise.allSettled([
                    getNearbyMechanics(location.lat, location.lng, 15),
                    getOsmMechanics(location.lat, location.lng, 5000)
                ]);
                
                const dbResult = results[0];
                const osmResult = results[1];
                
                let combined = [];
                let hasSuccess = false;

                if (dbResult.status === 'fulfilled' && Array.isArray(dbResult.value)) {
                    combined = [...combined, ...dbResult.value];
                    hasSuccess = true;
                } else if (dbResult.status === 'fulfilled') {
                    console.warn("MongoDB fetch returned non-array:", dbResult.value);
                } else {
                    console.error("MongoDB fetch failed:", dbResult.reason);
                }

                if (osmResult.status === 'fulfilled' && Array.isArray(osmResult.value)) {
                    combined = [...combined, ...osmResult.value];
                    hasSuccess = true;
                } else if (osmResult.status === 'fulfilled') {
                    console.warn("OSM fetch returned non-array:", osmResult.value);
                } else {
                    console.warn("OSM fetch failed:", osmResult.reason);
                }
                
                setMechanics(combined);
                setFilteredMechanics(combined);

                if (!hasSuccess) {
                    setError("Could not load any mechanic data. Check your connection.");
                }
            } else {
                // Fetch all from DB
                const data = await getMechanics();
                const safeData = Array.isArray(data) ? data : [];
                setMechanics(safeData);
                setFilteredMechanics(safeData);
            }
        } catch (err) {
            console.error("Critical failure in fetchMechanics", err);
            setError("An unexpected error occurred while loading data.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const handleLocationSuccess = (position) => {
            const { latitude, longitude } = position.coords;
            const currentLoc = { lat: latitude, lng: longitude };
            console.log("Location success:", latitude, longitude);
            setUserLocation(currentLoc);
            fetchMechanics(currentLoc);
        };

        const handleLocationError = (error) => {
            console.warn("Geolocation Error:", error.message);
            console.log("Location failed, loading default mechanics");
            setError("Location access denied or unavailable. Showing all mechanics.");
            fetchMechanics(null); // Fallback to all mechanics
        };

        if ("navigator" in window && "geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition(
                handleLocationSuccess,
                handleLocationError,
                { 
                    enableHighAccuracy: false, // Set to false for faster acquisition
                    timeout: 5000,             // 5 seconds timeout
                    maximumAge: 60000          // Use cached location if less than 60 seconds old
                }
            );
        } else {
            handleLocationError(new Error("Geolocation not supported by this browser."));
        }

        // Check for active requests if user phone is in localStorage
        const savedPhone = localStorage.getItem('userPhone');
        if (savedPhone) {
            getActiveRequest(savedPhone).then(req => {
                if (req) setActiveRequest(req);
            }).catch(err => console.error("Active request check failed", err));
        }
    }, []);

    // Filtering logic
    useEffect(() => {
        let result = [...mechanics];

        // Search filter
        if (searchQuery) {
            result = result.filter(m => 
                (m.shopName && m.shopName.toLowerCase().includes(searchQuery.toLowerCase())) ||
                (m.name && m.name.toLowerCase().includes(searchQuery.toLowerCase()))
            );
        }

        // Open now filter
        if (showOnlyOpen) {
            result = result.filter(m => {
                // If it's a DB mechanic, check availability
                if (m.availability) return m.availability === 'available';
                // If it's an OSM mechanic, check isOpen
                return m.isOpen;
            });
        }

        if (minRating > 0) {
            result = result.filter(m => m.rating >= minRating);
        }

        // Highlight verified mechanics by pushing them to the top of the list
        result.sort((a, b) => {
            if (a.isVerified && !b.isVerified) return -1;
            if (!a.isVerified && b.isVerified) return 1;
            
            // Secondary sort by rating
            const ratingA = a.rating || 0;
            const ratingB = b.rating || 0;
            return ratingB - ratingA;
        });

        setFilteredMechanics(result);
    }, [mechanics, searchQuery, showOnlyOpen, minRating]);

    const handleMarkerClick = (mechanic) => {
        const id = mechanic._id || mechanic.id;
        setSelectedMechanicId(id);
        const cardElement = document.getElementById(`mechanic-${id}`);
        if (cardElement) {
            cardElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    };

    return (
        <div className="app-container">
            <Navbar theme={theme} toggleTheme={toggleTheme} onOpenGarage={() => setShowGarageModal(true)} />
            <main className="main-content">
                <aside className="sidebar">
                    <div className="sidebar-header">
                        <input
                            type="text"
                            className="search-input"
                            placeholder="Search by shop or mechanic name..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <div className="filter-row">
                            <label className="filter-label">
                                <input
                                    type="checkbox"
                                    checked={showOnlyOpen}
                                    onChange={(e) => setShowOnlyOpen(e.target.checked)}
                                />
                                Open Now
                            </label>
                            
                            <label className="filter-label">
                                Min Rating:
                                <select 
                                    style={{ marginLeft: '0.5rem', padding: '0.2rem' }}
                                    value={minRating} 
                                    onChange={(e) => setMinRating(Number(e.target.value))}
                                >
                                    <option value="0">All</option>
                                    <option value="3">3+ Stars</option>
                                    <option value="4">4+ Stars</option>
                                    <option value="4.5">4.5+ Stars</option>
                                </select>
                            </label>
                        </div>

                        <button 
                            className="btn btn-emergency"
                            onClick={() => setShowHelpModal(true)}
                            style={{ 
                                marginTop: '1rem', 
                                width: '100%',
                                background: 'var(--danger)',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.5rem',
                                padding: '0.75rem',
                                borderRadius: '8px',
                                border: 'none',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                transition: 'var(--transition)'
                            }}
                        >
                            <AlertTriangle size={20} />
                            Need Emergency Help?
                        </button>

                        {/* SOS Broadcast Button */}
                        <button
                            className="btn"
                            disabled={sosBroadcasting}
                            onClick={async () => {
                                if (!userLocation) { showToast('Location required for SOS!', 'error'); return; }
                                if (!window.confirm('🚨 SOS will INSTANTLY alert ALL online mechanics nearby. Continue?')) return;
                                setSosBroadcasting(true);
                                try {
                                    const phone = localStorage.getItem('userPhone') || 'SOS_USER';
                                    const res = await createSosRequest({
                                        userPhone: phone,
                                        issue: 'SOS EMERGENCY - Immediate assistance required!',
                                        lat: userLocation.lat,
                                        lng: userLocation.lng,
                                        status: 'pending'
                                    });
                                    showToast('🚨 SOS Broadcast sent! Nearby mechanics are being alerted.', 'success');
                                    if (res.id) navigate(`/tracking/${res.id}`);
                                } catch (err) {
                                    showToast(err.response?.data?.detail || 'SOS failed', 'error');
                                } finally {
                                    setSosBroadcasting(false);
                                }
                            }}
                            style={{
                                marginTop: '0.5rem',
                                width: '100%',
                                background: sosBroadcasting ? '#7f1d1d' : 'linear-gradient(135deg, #dc2626, #991b1b)',
                                color: 'white',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.5rem',
                                padding: '0.85rem',
                                borderRadius: '8px',
                                border: '2px solid #fca5a5',
                                fontWeight: '800',
                                fontSize: '1rem',
                                cursor: 'pointer',
                                letterSpacing: '0.5px',
                                animation: sosBroadcasting ? 'none' : 'sos-pulse 1.5s infinite'
                            }}
                        >
                            {sosBroadcasting ? '📡 Broadcasting...' : <><Siren size={20} /> SOS — Alert ALL Mechanics</>}
                        </button>
                    </div>

                    <div className="mechanic-list">
                        {loading && (
                            <div style={{ padding: '0.5rem' }}>
                                <Skeleton count={4} />
                            </div>
                        )}
                        {!loading && error && (
                            <div style={{color: 'red', textAlign: 'center', padding: '1rem'}}>
                                {error}
                            </div>
                        )}
                        {!loading && filteredMechanics.length === 0 && !error && (
                            <div className="empty-state">
                                <p>No mechanics found matching your criteria.</p>
                            </div>
                        )}
                        {!loading && filteredMechanics.map((mech, index) => {
                            const id = mech._id || mech.id;
                            const uniqueKey = `${mech.source || 'db'}-${id || 'idx'}-${index}`;
                            return (
                                <div id={`mechanic-${id}`} key={uniqueKey}>
                                    <MechanicCard
                                        mechanic={mech}
                                        isSelected={selectedMechanicId === id}
                                        onClick={() => setSelectedMechanicId(id)}
                                        userLocation={userLocation}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </aside>

                <div className="map-container">
                    <MapView 
                        userLocation={userLocation} 
                        mechanics={filteredMechanics}
                        selectedMechanicId={selectedMechanicId}
                        onMarkerClick={handleMarkerClick}
                    />
                </div>
            </main>

            {activeRequest && (
                <div className="active-request-banner">
                    <div className="banner-content">
                        <Clock className="spin-slow" size={20} />
                        <div className="banner-text">
                            <strong>Active Request Found:</strong> {activeRequest.issue.substring(0, 40)}...
                        </div>
                        <Link to={`/tracking/${activeRequest._id}`} className="banner-link">
                            Track Now <ArrowRight size={16} />
                        </Link>
                    </div>
                </div>
            )}

            {showHelpModal && (
                <RequestHelpModal 
                    userLocation={userLocation}
                    onClose={() => setShowHelpModal(false)}
                    onSuccess={() => showToast("Request broadcasted successfully! Nearby mechanics will contact you soon.", "success")}
                    showToast={showToast}
                />
            )}

            {showGarageModal && (
                <MyGarageModal 
                    onClose={() => setShowGarageModal(false)} 
                    showToast={showToast} 
                />
            )}
        </div>
    );
};

export default Home;
