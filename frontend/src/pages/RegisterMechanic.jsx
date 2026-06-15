import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { registerMechanic } from '../services/api';
import Navbar from '../components/Navbar';
import { Wrench, Phone, MapPin, CheckCircle } from 'lucide-react';
import MapView from '../components/MapView';

const RegisterMechanic = ({ theme, toggleTheme, showToast }) => {
    const navigate = useNavigate();

    const [formData, setFormData] = useState({
        name: '',
        shopName: '',
        phone: '',
        address: '',
        services: '',
        lat: '',
        lng: ''
    });
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState(null);
    
    // OSM Nominatim Geocoding state
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [geocodingLoading, setGeocodingLoading] = useState(false);
    
    const debounceTimeout = useRef(null);
    const autocompleteRef = useRef(null);

    const handleAddressChange = (e) => {
        const value = e.target.value;
        setFormData(prev => ({
            ...prev,
            address: value
        }));

        if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
        }

        if (value.trim().length < 3) {
            setSuggestions([]);
            return;
        }

        debounceTimeout.current = setTimeout(async () => {
            setGeocodingLoading(true);
            try {
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&limit=5&addressdetails=1`
                );
                const data = await response.json();
                setSuggestions(data || []);
                setShowSuggestions(true);
            } catch (err) {
                console.error("OSM Nominatim Geocoding error:", err);
            } finally {
                setGeocodingLoading(false);
            }
        }, 600);
    };

    const handleSelectSuggestion = (place) => {
        setFormData(prev => ({
            ...prev,
            address: place.display_name,
            lat: parseFloat(place.lat).toFixed(6),
            lng: parseFloat(place.lon).toFixed(6)
        }));
        setShowSuggestions(false);
        setSuggestions([]);
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (autocompleteRef.current && !autocompleteRef.current.contains(event.target)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            if (debounceTimeout.current) {
                clearTimeout(debounceTimeout.current);
            }
        };
    }, []);

    const detectLocation = () => {
        if (navigator.geolocation) {
            setLoading(true);
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setFormData(prev => ({
                        ...prev,
                        lat: position.coords.latitude.toString(),
                        lng: position.coords.longitude.toString()
                    }));
                    setLoading(false);
                },
                (err) => {
                    console.error("Geolocation error", err);
                    setError("Could not detect location. Please enable location permissions.");
                    setLoading(false);
                }
            );
        } else {
            setError("Geolocation is not supported by your browser.");
        }
    };

    const handleMapClick = (coords) => {
        setFormData(prev => ({
            ...prev,
            lat: coords.lat.toFixed(6),
            lng: coords.lng.toFixed(6)
        }));
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        
        // Validation for phone: 10 digits only
        if (name === 'phone') {
            const onlyNums = value.replace(/[^0-9]/g, '');
            if (onlyNums.length <= 10) {
                setFormData(prev => ({ ...prev, [name]: onlyNums }));
            }
            return;
        }

        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            // Process services into an array
            const servicesArray = formData.services.split(',').map(s => s.trim()).filter(s => s !== '');
            
            const payload = {
                ...formData,
                services: servicesArray,
                lat: parseFloat(formData.lat),
                lng: parseFloat(formData.lng)
            };

            await registerMechanic(payload);
            setSuccess(true);
            showToast("Registration successful! Welcome to the network.", "success");
            setTimeout(() => {
                navigate('/');
            }, 3000);
        } catch (err) {
            console.error("Registration failed", err);
            const msg = err.response?.data?.detail || "Failed to register mechanic shop. Please try again.";
            setError(msg);
            showToast(msg, "error");
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="app-container">
                <Navbar theme={theme} toggleTheme={toggleTheme} />
                <div className="registration-success-container">
                    <CheckCircle className="success-icon" size={64} />
                    <h2>Mechanic registered successfully!</h2>
                    <p>Your shop will now appear on the map for users in need.</p>
                    <p>Redirecting you to the home page...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="app-container">
            <Navbar theme={theme} toggleTheme={toggleTheme} />
            <div className="registration-container">
                <div className="registration-card">
                    <div className="registration-header">
                        <Wrench size={32} className="brand-icon" />
                        <h1>Register Your Shop</h1>
                        <p>Join our network and help people near you.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="registration-form">
                        <div className="form-group">
                            <label htmlFor="name">Mechanic Name</label>
                            <input
                                type="text"
                                id="name"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                required
                                placeholder="Enter your full name"
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="shopName">Shop Name</label>
                            <input
                                type="text"
                                id="shopName"
                                name="shopName"
                                value={formData.shopName}
                                onChange={handleChange}
                                required
                                placeholder="e.g. Ravi's Bike Clinic"
                            />
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="phone">Phone Number</label>
                                <div className="input-with-icon">
                                    <Phone size={16} />
                                    <input
                                        type="tel"
                                        id="phone"
                                        name="phone"
                                        value={formData.phone}
                                        onChange={handleChange}
                                        required
                                        placeholder="9876543210"
                                        maxLength="10"
                                        pattern="[0-9]{10}"
                                        inputMode="numeric"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="form-group" ref={autocompleteRef} style={{ position: 'relative' }}>
                            <label htmlFor="address">Full Address (Search Autocomplete)</label>
                            <div className="input-with-icon">
                                <MapPin size={16} />
                                <input
                                    type="text"
                                    id="address"
                                    name="address"
                                    value={formData.address}
                                    onChange={handleAddressChange}
                                    required
                                    placeholder="Type your shop address to search..."
                                    style={{ width: '100%' }}
                                    onFocus={() => setShowSuggestions(true)}
                                />
                            </div>
                            
                            {geocodingLoading && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', marginTop: '4px', paddingLeft: '8px' }}>
                                    Searching address...
                                </div>
                            )}

                            {showSuggestions && suggestions.length > 0 && (
                                <ul style={{
                                    position: 'absolute',
                                    width: '100%',
                                    backgroundColor: 'var(--card-bg)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '8px',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                    zIndex: 100,
                                    marginTop: '4px',
                                    listStyle: 'none',
                                    padding: 0,
                                    maxHeight: '200px',
                                    overflowY: 'auto'
                                }}>
                                    {suggestions.map((place) => (
                                        <li 
                                            key={place.place_id} 
                                            onClick={() => handleSelectSuggestion(place)}
                                            style={{
                                                padding: '10px 14px',
                                                cursor: 'pointer',
                                                borderBottom: '1px solid var(--border-color)',
                                                fontSize: '0.85rem',
                                                color: 'var(--text-color)',
                                                transition: 'background-color 0.2s'
                                            }}
                                            onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(220, 38, 38, 0.1)'}
                                            onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                                        >
                                            {place.display_name}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div className="form-group">
                            <label htmlFor="services">Services offered (comma separated)</label>
                            <input
                                type="text"
                                id="services"
                                name="services"
                                value={formData.services}
                                onChange={handleChange}
                                placeholder="Oil Change, Engine Repair, Puncture"
                            />
                        </div>

                        <div className="form-group">
                            <label>Shop Location on Map</label>
                            <p className="form-help">Click on the map to set your shop's exact location or use the detect button.</p>
                            <div className="registration-map-wrapper">
                                <MapView 
                                    isPicker={true}
                                    onMapClick={handleMapClick}
                                    pendingLocation={formData.lat && formData.lng ? { lat: parseFloat(formData.lat), lng: parseFloat(formData.lng) } : null}
                                    theme={theme}
                                />
                                <button 
                                    type="button" 
                                    className="detect-btn" 
                                    onClick={detectLocation}
                                    title="Detect my current location"
                                >
                                    <MapPin size={20} />
                                    Detect My Location
                                </button>
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="lat">Latitude</label>
                                <input
                                    type="number"
                                    step="any"
                                    id="lat"
                                    name="lat"
                                    value={formData.lat}
                                    onChange={handleChange}
                                    required
                                    placeholder="17.385"
                                />
                            </div>
                            <div className="form-group">
                                <label htmlFor="lng">Longitude</label>
                                <input
                                    type="number"
                                    step="any"
                                    id="lng"
                                    name="lng"
                                    value={formData.lng}
                                    onChange={handleChange}
                                    required
                                    placeholder="78.486"
                                />
                            </div>
                        </div>

                        {error && <div className="error-message">{error}</div>}

                        <button 
                            type="submit" 
                            className="btn btn-primary submit-btn"
                            disabled={loading}
                        >
                            {loading ? "Registering..." : "Register Shop"}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default RegisterMechanic;
