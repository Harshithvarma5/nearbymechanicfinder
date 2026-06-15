import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 10000 // 10 seconds
});

// Attach JWT token to every request if it exists
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

export const getMechanics = async () => {
    const response = await api.get('/mechanics');
    return response.data;
};

export const getNearbyMechanics = async (lat, lng, radius_km = 10) => {
    const response = await api.get('/mechanics/nearby', {
        params: { lat, lng, radius_km },
    });
    return response.data;
};

export const getOsmMechanics = async (lat, lng, radius = 5000) => {
    const response = await api.get('/places/nearby-mechanics', {
        params: { lat, lng, radius },
    });
    return response.data;
};

export const registerMechanic = async (mechanicData) => {
    const response = await api.post('/mechanics/register', mechanicData);
    return response.data;
};

export const getMechanicByPhone = async (phone) => {
    const response = await api.get(`/mechanics/by-phone/${phone}`);
    return response.data;
};

export const updateMechanicStatus = async (phone, status) => {
    const response = await api.put(`/mechanics/${phone}/availability?status=${status}`);
    return response.data;
};

// Service Requests
export const createServiceRequest = async (requestData) => {
    const response = await api.post('/requests', requestData);
    return response.data;
};

export const getServiceRequests = async (status = "pending", mechanicPhone = null) => {
    const response = await api.get('/requests', {
        params: { status, mechanicPhone }
    });
    return response.data;
};

export const updateRequestStatus = async (requestId, status, mechanicPhone = null, eta = null) => {
    const response = await api.put(`/requests/${requestId}/status`, null, {
        params: { status, mechanicPhone, eta }
    });
    return response.data;
};

export const getRequestById = async (id) => {
    const response = await api.get(`/requests/${id}`);
    return response.data;
};

export const getActiveRequest = async (phone) => {
    const response = await api.get(`/requests/user/${phone}/active`);
    return response.data;
};

// Messaging
export const sendMessage = async (requestId, messageData) => {
    const response = await api.post(`/requests/${requestId}/messages`, messageData);
    return response.data;
};

export const getMessages = async (requestId) => {
    const response = await api.get(`/requests/${requestId}/messages`);
    return response.data;
};

export const updateMechanicLocation = async (requestId, lat, lng) => {
    const response = await api.put(`/requests/${requestId}/mechanic-location`, null, {
        params: { lat, lng }
    });
    return response.data;
};

// Authentication & OTP
export const requestOtp = async (phone, role) => {
    const response = await api.post('/auth/request-otp', null, {
        params: { phone, role }
    });
    return response.data;
};

export const verifyOtp = async (phone, otp, role) => {
    const response = await api.post('/auth/verify-otp', null, {
        params: { phone, otp, role }
    });
    return response.data;
};

export const adminLogin = async (username, password) => {
    const response = await api.post('/auth/admin-login', { username, password });
    return response.data;
};

// Admin APIs
export const getAdminStats = async () => {
    const response = await api.get('/admin/stats');
    return response.data;
};

export const adminListMechanics = async () => {
    const response = await api.get('/admin/mechanics');
    return response.data;
};

export const adminVerifyMechanic = async (phone, verified) => {
    const response = await api.put(`/admin/mechanics/${phone}/verify`, null, {
        params: { verified }
    });
    return response.data;
};

// --- Tow Truck Endpoints ---
export const registerTowTruck = async (towData) => {
    const response = await api.post('/auth/tow-register', towData);
    return response.data;
};

export const getTowRequests = async () => {
    const response = await api.get('/tow/requests');
    return response.data;
};

export const escalateToTow = async (requestId) => {
    const response = await api.put(`/requests/${requestId}/escalate-to-tow`);
    return response.data;
};

export const acceptTowRequest = async (requestId) => {
    const response = await api.put(`/requests/${requestId}/tow-accept`);
    return response.data;
};

export const updateTowLocation = async (requestId, lat, lng) => {
    const response = await api.put(`/requests/${requestId}/tow-location`, null, {
        params: { lat, lng }
    });
    return response.data;
};

export const aiDiagnoseAudio = async (audioBase64) => {
    const response = await api.post('/requests/ai-diagnose', null, {
        params: { audio_base64: audioBase64 }
    });
    return response.data;
};

export const createSosRequest = async (requestData) => {
    const response = await api.post('/requests/sos', requestData);
    return response.data;
};

export const adminListRequests = async (status = null) => {
    const response = await api.get('/admin/requests', {
        params: status ? { status } : {}
    });
    return response.data;
};

// --- Admin KYC Endpoints ---
export const getPendingKycMechanics = async () => {
    const response = await api.get('/admin/mechanics/pending-kyc');
    return response.data;
};

export const approveMechanicKyc = async (phone) => {
    const response = await api.put(`/admin/mechanics/${phone}/approve-kyc`);
    return response.data;
};

export const rejectMechanicKyc = async (phone, reason) => {
    const response = await api.put(`/admin/mechanics/${phone}/reject-kyc`, { reason });
    return response.data;
};

export const uploadMechanicKyc = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/mechanic/kyc/upload', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    });
    return response.data;
};

// --- Digital Garage API ---
export const addVehicle = async (vehicleData) => {
    const response = await api.post('/users/vehicles', vehicleData);
    return response.data;
};

export const getUserVehicles = async () => {
    const response = await api.get('/users/vehicles');
    return response.data;
};

export const deleteVehicle = async (vehicleId) => {
    const response = await api.delete(`/users/vehicles/${vehicleId}`);
    return response.data;
};

// --- Vendors & Parts API ---
export const addVendor = async (vendorData) => {
    const response = await api.post('/admin/vendors', vendorData);
    return response.data;
};

export const getVendors = async () => {
    const response = await api.get('/admin/vendors');
    return response.data;
};

export const addPartToVendor = async (vendorId, partData) => {
    const response = await api.post(`/admin/vendors/${vendorId}/parts`, partData);
    return response.data;
};

export const getVendorParts = async (vendorId) => {
    const response = await api.get(`/admin/vendors/${vendorId}/parts`);
    return response.data;
};

export const searchParts = async (query, lat, lng, radiusKm = 15) => {
    const response = await api.get('/parts/search', {
        params: { q: query, lat, lng, radius_km: radiusKm }
    });
    return response.data;
};
