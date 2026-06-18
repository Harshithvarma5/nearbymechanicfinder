import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    User, Wrench, Phone, ArrowRight, Loader2,
    ShieldCheck, KeyRound, RefreshCcw, Shield,
    Lock, UserCircle2, Eye, EyeOff, Truck, Check
} from 'lucide-react';
import { requestOtp, verifyOtp, getMechanicByPhone, adminLogin } from '../services/api';

const LoginPage = ({ theme, showToast }) => {
    const navigate = useNavigate();
    const [role, setRole] = useState('user'); // 'user' | 'mechanic' | 'admin'

    // ── OTP flow state (user + mechanic) ─────────────────────────────────
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [otpStep, setOtpStep] = useState(false);
    const [timer, setTimer] = useState(0);

    // ── Admin credential state ────────────────────────────────────────────
    const [adminUsername, setAdminUsername] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const [loading, setLoading] = useState(false);

    // Reset form when switching roles
    useEffect(() => {
        setPhone('');
        setOtp('');
        setOtpStep(false);
        setTimer(0);
        setAdminUsername('');
        setAdminPassword('');
        setShowPassword(false);
    }, [role]);

    // OTP countdown
    useEffect(() => {
        if (timer <= 0) return;
        const interval = setInterval(() => setTimer(t => t - 1), 1000);
        return () => clearInterval(interval);
    }, [timer]);

    // ── OTP: Send ────────────────────────────────────────────────────────
    const handleSendOtp = async (e) => {
        e.preventDefault();
        if (phone.length !== 10) {
            showToast('Please enter a valid 10-digit phone number', 'error');
            return;
        }
        setLoading(true);
        try {
            localStorage.removeItem('token');
            const response = await requestOtp(phone, role);
            setOtpStep(true);
            setTimer(30);
            showToast('OTP sent successfully!', 'success');
            if (response.otp_debug) {
                console.log(`%c 🛡️ AUTH DEBUG: OTP for ${phone} is: ${response.otp_debug}`, 'color: #2563eb; font-weight: bold; font-size: 14px;');
                showToast(`Demo Mode: OTP is ${response.otp_debug}`, 'info');
            }
        } catch (err) {
            const detail = err.response?.data?.detail;
            const msg = Array.isArray(detail) ? detail[0].msg : (detail || 'Failed to send OTP. Try again.');
            showToast(msg, 'error');
        } finally {
            setLoading(false);
        }
    };

    // ── OTP: Verify ──────────────────────────────────────────────────────
    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        if (otp.length < 6) {
            showToast('Please enter the 6-digit code', 'error');
            return;
        }
        setLoading(true);
        try {
            const response = await verifyOtp(phone, otp, role);
            
            // Store the JWT 
            if (response.access_token) {
                localStorage.setItem('token', response.access_token);
            }
            
            const authRole = response.role;
            localStorage.setItem('userPhone', phone);
            localStorage.setItem('userRole', authRole);

            if (authRole === 'mechanic') {
                const mechanic = await getMechanicByPhone(phone);
                localStorage.setItem('mechanicPhone', phone);
                showToast(`Welcome back, ${mechanic.shopName}!`, 'success');
                navigate('/dashboard');
            } else if (authRole === 'admin') {
                localStorage.setItem('adminPhone', phone);
                showToast('Welcome, Admin!', 'success');
                navigate('/admin');
            } else if (authRole === 'tow_truck') {
                showToast('Welcome, Partner!', 'success');
                navigate('/tow-dashboard');
            } else {
                showToast('Logged in successfully', 'success');
                navigate('/');
            }
        } catch (err) {
            const detail = err.response?.data?.detail;
            const msg = Array.isArray(detail) ? detail[0].msg : (detail || 'Invalid OTP. Please try again.');
            showToast(msg, 'error');
        } finally {
            setLoading(false);
        }
    };

    // ── Admin: Password Login ────────────────────────────────────────────
    const handleAdminLogin = async (e) => {
        e.preventDefault();
        if (!adminUsername.trim() || !adminPassword.trim()) {
            showToast('Please enter your admin username and password', 'error');
            return;
        }
        setLoading(true);
        try {
            const response = await adminLogin(adminUsername.trim(), adminPassword);
            
            if (response.access_token) {
                localStorage.setItem('token', response.access_token);
            }
            localStorage.setItem('adminPhone', adminUsername.trim());
            localStorage.setItem('userRole', 'admin');
            
            showToast('Welcome, Admin!', 'success');
            navigate('/admin');
        } catch (err) {
            const detail = err.response?.data?.detail;
            const msg = Array.isArray(detail) ? detail[0].msg : (detail || 'Invalid admin credentials.');
            showToast(msg, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleBackToPhone = () => {
        setOtpStep(false);
        setOtp('');
    };

    // ── Role labels ───────────────────────────────────────────────────────
    const roles = [
        { key: 'user',      icon: User,    label: 'I need Help'  },
        { key: 'mechanic',  icon: Wrench,  label: "I'm a Mechanic" },
        { key: 'tow_truck', icon: Truck,   label: 'Tow Truck Driver' },
        { key: 'admin',     icon: Shield,  label: 'Admin'         },
    ];

    return (
        <div className={`login-page-container ${theme}`}>
            <div className="mesh-bg" />
            <div className="login-card premium-glass">

                <div className="login-header">
                    <div className="brand-logo">
                        <Wrench size={32} color="var(--primary)" />
                    </div>
                    <h1>Nearby Mechanic</h1>
                    <p>Professional Help, Anytime, Anywhere</p>
                </div>

                {/* Role Selector */}
                <div className="role-selector">
                    {roles.map(({ key, icon: Icon, label }) => (
                        <button
                            key={key}
                            className={`role-btn ${role === key ? 'active' : ''}`}
                            onClick={() => setRole(key)}
                        >
                            <Icon size={20} />
                            <span>{label}</span>
                        </button>
                    ))}
                </div>

                {/* ── Admin Form (username + password) ── */}
                {role === 'admin' && (
                    <div className="admin-login-form-section">
                        <div className="admin-cred-badge">
                            <Shield size={14} />
                            <span>Admin credentials required</span>
                        </div>
                        <form onSubmit={handleAdminLogin} className="login-form">
                            <div className="input-group">
                                <label>Admin Username</label>
                                <div className="input-wrapper">
                                    <UserCircle2 size={18} className="input-icon" />
                                    <input
                                        type="text"
                                        placeholder="Enter admin username"
                                        value={adminUsername}
                                        onChange={e => setAdminUsername(e.target.value)}
                                        required
                                        disabled={loading}
                                        autoComplete="username"
                                    />
                                </div>
                            </div>
                            <div className="input-group">
                                <label>Password</label>
                                <div className="input-wrapper">
                                    <Lock size={18} className="input-icon" />
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        placeholder="Enter admin password"
                                        value={adminPassword}
                                        onChange={e => setAdminPassword(e.target.value)}
                                        required
                                        disabled={loading}
                                        autoComplete="current-password"
                                    />
                                    <button
                                        type="button"
                                        className="password-toggle-btn"
                                        onClick={() => setShowPassword(p => !p)}
                                        tabIndex={-1}
                                    >
                                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>
                            <button type="submit" className="login-submit-btn" disabled={loading}>
                                {loading ? <Loader2 className="spin" /> : (
                                    <><Shield size={18} /> Sign In as Admin</>
                                )}
                            </button>
                        </form>
                    </div>
                )}

                {/* ── User / Mechanic: Phone + OTP ── */}
                {role !== 'admin' && !otpStep && (
                    <form onSubmit={handleSendOtp} className="login-form">
                        <div className="input-group">
                            <label>
                                Phone Number
                                {phone.length === 10 && <span className="status-check-badge"><Check size={10} /></span>}
                            </label>
                            <div className="input-wrapper glow-input">
                                <Phone size={18} className="input-icon" />
                                <input
                                    type="tel"
                                    placeholder="Enter your 10-digit number"
                                    value={phone}
                                    onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                    required
                                    disabled={loading}
                                />
                            </div>
                        </div>
                        <button type="submit" className="login-submit-btn" disabled={loading}>
                            {loading ? <Loader2 className="spin" /> : (
                                <>Get OTP <ArrowRight size={18} /></>
                            )}
                        </button>
                    </form>
                )}

                {role !== 'admin' && otpStep && (
                    <div className="otp-step-container">
                        <div className="otp-instruction">
                            <h3>Verify Your Phone</h3>
                            <p>We've sent a 6-digit code to <strong>{phone}</strong></p>
                            <button className="back-link-btn" onClick={handleBackToPhone}>Change Number</button>
                        </div>
                        <form onSubmit={handleVerifyOtp} className="login-form">
                            <div className="input-group">
                                <label>Enter 6-Digit Code</label>
                                <div className="input-wrapper">
                                    <KeyRound size={18} className="input-icon" />
                                    <input
                                        type="text"
                                        placeholder="000000"
                                        value={otp}
                                        onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                        required
                                        autoFocus
                                        className="otp-input-field"
                                        disabled={loading}
                                    />
                                </div>
                            </div>
                            <button type="submit" className="login-submit-btn" disabled={loading}>
                                {loading ? <Loader2 className="spin" /> : (
                                    <>Verify &amp; Login <ShieldCheck size={18} /></>
                                )}
                            </button>
                        </form>
                        <div className="resend-container">
                            {timer > 0 ? (
                                <p className="timer-text">Resend code in <span>0:{timer < 10 ? `0${timer}` : timer}</span></p>
                            ) : (
                                <button className="resend-btn" onClick={handleSendOtp} disabled={loading}>
                                    <RefreshCcw size={14} /> Resend OTP
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {(role === 'mechanic' || role === 'tow_truck') && !otpStep && (
                    <p className="register-hint">
                        Not registered yet? <span onClick={() => navigate(role === 'mechanic' ? '/register-mechanic' : '/tow-dashboard')}>Join as a Partner</span>
                    </p>
                )}

                <div className="login-footer">
                    {role === 'admin'
                        ? <><Shield size={14} /> <span>Admin Secure Login</span></>
                        : <><ShieldCheck size={14} /> <span>Secure Login via OTP</span></>
                    }
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
