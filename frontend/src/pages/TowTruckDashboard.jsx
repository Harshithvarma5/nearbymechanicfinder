import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getTowRequests, acceptTowRequest, requestOtp, verifyOtp, registerTowTruck, updateTowLocation } from '../services/api';
import { Truck, Phone, MapPin, Clock, CheckCircle, Loader2, AlertCircle, LogIn, Crosshair, Check } from 'lucide-react';
import Navbar from '../components/Navbar';

const TowTruckDashboard = ({ theme, toggleTheme, showToast }) => {
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [requests, setRequests] = useState([]);
    const [loadingRequests, setLoadingRequests] = useState(false);
    const [mode, setMode] = useState('login'); // 'login' | 'register'
    const [regForm, setRegForm] = useState({ name: '', companyName: '', phone: '', address: '', lat: '', lng: '' });
    
    // OSM Nominatim Autocomplete search state
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [geocodingLoading, setGeocodingLoading] = useState(false);
    
    const debounceTimeout = useRef(null);
    const autocompleteRef = useRef(null);

    const handleAddressChange = (e) => {
        const value = e.target.value;
        setRegForm(prev => ({ ...prev, address: value }));

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
        setRegForm(prev => ({
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
                    setRegForm(prev => ({
                        ...prev,
                        lat: position.coords.latitude.toFixed(6),
                        lng: position.coords.longitude.toFixed(6)
                    }));
                    setLoading(false);
                    showToast('Location detected!', 'success');
                },
                (err) => {
                    console.error("Geolocation error", err);
                    showToast("Could not detect location. Please permit location access.", "error");
                    setLoading(false);
                }
            );
        }
    };

    // Auto-login from localStorage
    useEffect(() => {
        const token = localStorage.getItem('token');
        const userPhone = localStorage.getItem('userPhone');
        const role = localStorage.getItem('userRole');
        if (token && userPhone && role === 'tow_truck') {
            setIsLoggedIn(true);
            setPhone(userPhone);
        }
    }, []);

    const fetchRequests = useCallback(async () => {
        setLoadingRequests(true);
        try {
            const data = await getTowRequests();
            setRequests(data || []);
        } catch (err) {
            console.error('Failed to fetch tow requests', err);
        } finally {
            setLoadingRequests(false);
        }
    }, []);

    useEffect(() => {
        if (isLoggedIn) {
            fetchRequests();
            const interval = setInterval(fetchRequests, 8000); // Poll every 8s
            return () => clearInterval(interval);
        }
    }, [isLoggedIn, fetchRequests]);

    // Live Location Broadcasting
    useEffect(() => {
        if (!isLoggedIn || !phone) return;

        let watchId = null;
        const acceptedRequests = requests.filter(r => r.status === 'tow_accepted');

        if (acceptedRequests.length > 0) {
            console.log("🚛 DEBUG: Starting tow location broadcast...");
            watchId = navigator.geolocation.watchPosition(
                (pos) => {
                    const { latitude, longitude } = pos.coords;
                    acceptedRequests.forEach(req => {
                        updateTowLocation(req._id, latitude, longitude)
                            .catch(err => console.error("Tow Broadcast failed:", err));
                    });
                },
                (err) => console.error("Tow Geolocation Error:", err),
                { enableHighAccuracy: true, distanceFilter: 10 }
            );
        }

        return () => {
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        };
    }, [isLoggedIn, requests, phone]);

    const handleSendOtp = async () => {
        if (!phone || phone.length !== 10) { 
            showToast('Please enter a valid 10-digit phone number', 'error'); 
            return; 
        }
        setLoading(true);
        try {
            const response = await requestOtp(phone, 'tow_truck');
            setOtpSent(true);
            showToast('OTP sent successfully!', 'success');
            if (response.otp_debug) {
                showToast(`Demo Mode: OTP is ${response.otp_debug}`, 'info');
            }
        } catch (err) {
            showToast(err.response?.data?.detail || 'Failed to send OTP', 'error');
        } finally { setLoading(false); }
    };

    const handleVerifyOtp = async () => {
        if (!otp) { showToast('Enter OTP', 'error'); return; }
        setLoading(true);
        try {
            const data = await verifyOtp(phone, otp, 'tow_truck');
            localStorage.setItem('token', data.access_token);
            localStorage.setItem('userPhone', phone);
            localStorage.setItem('userRole', 'tow_truck');
            setIsLoggedIn(true);
            showToast('Logged in successfully!', 'success');
        } catch (err) {
            showToast(err.response?.data?.detail || 'Invalid OTP', 'error');
        } finally { setLoading(false); }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await registerTowTruck({ ...regForm, lat: parseFloat(regForm.lat), lng: parseFloat(regForm.lng) });
            showToast('Registered! You can now login.', 'success');
            setMode('login');
            setPhone(regForm.phone);
        } catch (err) {
            showToast(err.response?.data?.detail || 'Registration failed', 'error');
        } finally { setLoading(false); }
    };

    const handleAccept = async (requestId) => {
        try {
            await acceptTowRequest(requestId);
            showToast('🚛 Tow request claimed! Navigate to the user.', 'success');
            fetchRequests();
        } catch (err) {
            showToast(err.response?.data?.detail || 'Already claimed by another driver!', 'error');
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('userPhone');
        localStorage.removeItem('userRole');
        setIsLoggedIn(false);
        setPhone('');
        setOtp('');
        setOtpSent(false);
    };

    // ── Render: Login/Register Form ──────────────────────────────────────────
    if (!isLoggedIn) {
        return (
            <div className={`app-container scrollable ${theme}`}>
                <div className="mesh-bg" />
                <Navbar theme={theme} toggleTheme={toggleTheme} />
                <div className="tow-reg-container">
                    <div className="tow-reg-card premium-glass">

                        <div className="tow-reg-header">
                            <Truck size={60} color="var(--primary)" style={{ marginBottom: '1rem' }} />
                            <h2>Tow Truck Portal</h2>
                            <p style={{ color: 'var(--text-light)' }}>Join the largest emergency haulage network</p>
                        </div>

                        <div style={{ display: 'flex', background: 'rgba(var(--bg-rgb), 0.1)', padding: '6px', borderRadius: '14px', marginBottom: '2.5rem' }}>
                            <button onClick={() => setMode('login')} className={`btn ${mode === 'login' ? 'btn-primary' : ''}`} style={{ flex: 1, border: 'none', background: mode === 'login' ? 'var(--primary)' : 'transparent', color: mode === 'login' ? 'white' : 'var(--text-color)', borderRadius: '10px', height: '40px', fontWeight: 600 }}>Login</button>
                            <button onClick={() => setMode('register')} className={`btn ${mode === 'register' ? 'btn-primary' : ''}`} style={{ flex: 1, border: 'none', background: mode === 'register' ? 'var(--primary)' : 'transparent', color: mode === 'register' ? 'white' : 'var(--text-color)', borderRadius: '10px', height: '40px', fontWeight: 600 }}>Register</button>
                        </div>

                        {mode === 'login' ? (
                            <div className="registration-form-grid">
                                <div className="form-field glow-input">
                                    <label>
                                        <Phone size={14} /> Registered Phone Number
                                        {phone.length === 10 && <span className="status-check-badge"><Check size={10} /></span>}
                                    </label>
                                    <input 
                                        type="tel" 
                                        placeholder="e.g. 9876543210" 
                                        value={phone} 
                                        onChange={e => setPhone(e.target.value.replace(/\D/g,'').slice(0,10))} 
                                        className="admin-input" 
                                    />
                                </div>
                                {!otpSent ? (
                                    <button className="submit-btn-premium" onClick={handleSendOtp} disabled={loading}>
                                        {loading ? <Loader2 size={20} className="spin" /> : <LogIn size={20} />} Get OTP to Login
                                    </button>
                                ) : (
                                    <>
                                        <div className="form-field">
                                            <label><CheckCircle size={14} /> Enter 6-Digit OTP</label>
                                            <input type="text" placeholder="000000" value={otp} onChange={e => setOtp(e.target.value)} className="admin-input" maxLength={6} />
                                        </div>
                                        <button className="submit-btn-premium" onClick={handleVerifyOtp} disabled={loading}>
                                            {loading ? <Loader2 size={20} className="spin" /> : <CheckCircle size={20} />} Verify & Access Portal
                                        </button>
                                    </>
                                )}
                            </div>
                        ) : (
                            <form onSubmit={handleRegister} className="registration-form-grid">
                                <div className="form-field">
                                    <label>Driver Full Name</label>
                                    <input type="text" placeholder="Enter your name" value={regForm.name} onChange={e => setRegForm({...regForm, name: e.target.value})} className="admin-input" required />
                                </div>
                                <div className="form-field">
                                    <label>Company Name</label>
                                    <input type="text" placeholder="e.g. QuickTow Services" value={regForm.companyName} onChange={e => setRegForm({...regForm, companyName: e.target.value})} className="admin-input" required />
                                </div>
                                <div className="form-field glow-input">
                                    <label>
                                        Phone Number (OTP Verification)
                                        {regForm.phone.length === 10 && <span className="status-check-badge"><Check size={10} /></span>}
                                    </label>
                                    <input type="tel" placeholder="10-digit number" value={regForm.phone} onChange={e => setRegForm({...regForm, phone: e.target.value.replace(/\D/g,'').slice(0,10)})} className="admin-input" required />
                                </div>
                                
                                <div className="form-field" ref={autocompleteRef} style={{ position: 'relative' }}>
                                    <label>Business Address</label>
                                    <input 
                                        type="text" 
                                        placeholder="Search or type address..." 
                                        value={regForm.address} 
                                        onChange={handleAddressChange} 
                                        className="admin-input" 
                                        required 
                                        onFocus={() => setShowSuggestions(true)}
                                    />
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

                                <div className="coordinates-premium-box">
                                    <div className="tow-coordinates-header">
                                        <label style={{ color: 'var(--primary)', margin: 0 }}>GPS Coordinates</label>
                                        <button type="button" onClick={detectLocation} className="detect-trigger">
                                            <Crosshair size={14} /> Use My Current GPS
                                        </button>
                                    </div>
                                    <div className="coordinates-grid">
                                        <div className="form-field">
                                            <input type="number" step="any" placeholder="Latitude" value={regForm.lat} onChange={e => setRegForm({...regForm, lat: e.target.value})} className="admin-input" required />
                                        </div>
                                        <div className="form-field">
                                            <input type="number" step="any" placeholder="Longitude" value={regForm.lng} onChange={e => setRegForm({...regForm, lng: e.target.value})} className="admin-input" required />
                                        </div>
                                    </div>
                                </div>

                                <button type="submit" className="submit-btn-premium" disabled={loading}>
                                    {loading ? <Loader2 size={22} className="spin" /> : <Truck size={22} />} Register & Join Network
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ── Render: Main Dashboard ────────────────────────────────────────────────
    return (
        <div className={`app-container ${theme}`}>
            <div className="mesh-bg" />
            <Navbar theme={theme} toggleTheme={toggleTheme} />
            <div className="dashboard-layout">
                <header className="dashboard-header">
                    <div className="header-info">
                        <h1><Truck size={24} /> Tow Truck Dispatch</h1>
                        <p>Phone: <strong>{phone}</strong></p>
                    </div>
                    <div className="header-actions">
                        <button className="admin-refresh-btn" onClick={fetchRequests} disabled={loadingRequests}>
                            {loadingRequests ? <Loader2 size={16} className="spin" /> : '⟳'} Refresh
                        </button>
                        <button className="btn btn-secondary" onClick={handleLogout}>Logout</button>
                    </div>
                </header>

                <main className="dashboard-content">
                    <section className="requests-section">
                        <h2 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            🚨 Emergency Tow Requests
                            <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', borderRadius: '20px', padding: '2px 10px', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                                {requests.length} pending
                            </span>
                        </h2>

                        {loadingRequests && requests.length === 0 ? (
                            <div className="loader-container"><Loader2 size={40} className="spin" /></div>
                        ) : requests.length === 0 ? (
                            <div className="empty-dashboard">
                                <CheckCircle size={48} />
                                <p>No emergency tow requests right now.</p>
                                <small style={{ color: 'var(--text-light)' }}>Auto-refreshes every 8 seconds</small>
                            </div>
                        ) : (
                            <div className="requests-grid">
                                {requests.map(req => (
                                    <div key={req._id} className="request-card" style={{ border: '2px solid #ef4444', boxShadow: '0 0 20px rgba(239,68,68,0.1)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                            <span style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', borderRadius: '6px', padding: '4px 10px', fontSize: '0.8rem', fontWeight: '700', letterSpacing: '0.5px' }}>
                                                🚨 TOW NEEDED
                                            </span>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
                                                {new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>

                                        <h3 style={{ margin: '0 0 1rem', lineHeight: 1.4 }}>{req.issue}</h3>

                                        <div className="request-info" style={{ marginBottom: '1rem' }}>
                                            <div className="info-item"><Phone size={14} /><span>{req.userPhone}</span></div>
                                            <div className="info-item location-link"
                                                onClick={() => window.open(`https://www.google.com/maps?q=${req.lat},${req.lng}`, '_blank')}
                                                style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: '600' }}>
                                                <MapPin size={14} /><span>Navigate to Breakdown → ({req.lat?.toFixed(3)}, {req.lng?.toFixed(3)})</span>
                                            </div>
                                            {req.vehicleModel && (
                                                <div className="info-item"><Truck size={14} /><span>{req.vehicleYear} {req.vehicleModel}</span></div>
                                            )}
                                        </div>

                                        <button className="btn btn-primary accept-btn"
                                            onClick={() => handleAccept(req._id)}
                                            style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)', width: '100%' }}>
                                            🚛 Claim This Tow Request
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </main>
            </div>
        </div>
    );
};

export default TowTruckDashboard;
