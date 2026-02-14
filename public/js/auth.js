// API Base URL
const API_URL = '/api';

// Token management
function saveToken(token) {
    localStorage.setItem('auth_token', token);
}

function getToken() {
    return localStorage.getItem('auth_token');
}

function removeToken() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
}

// User management
function saveUser(user) {
    localStorage.setItem('user', JSON.stringify(user));
}

function getUser() {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
}

// API call helper
async function apiCall(endpoint, options = {}) {
    const token = getToken();

    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` })
        }
    };

    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    };

    try {
        const response = await fetch(`${API_URL}${endpoint}`, mergedOptions);

        // Handle unauthorized
        if (response.status === 401 || response.status === 403) {
            removeToken();
            window.location.href = '/';
            return null;
        }

        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            console.error('Non-JSON response received:', text);
            throw new Error(`Server returned non-JSON response: ${text.substring(0, 100)}...`);
        }

        if (!response.ok) {
            throw new Error(data.error || 'API request failed');
        }

        return data;
    } catch (error) {
        console.error('API call error:', error);
        throw error;
    }
}

// Logout
async function logout() {
    try {
        await apiCall('/auth/logout', { method: 'POST' });
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        removeToken();
        window.location.href = '/';
    }
}

// Check authentication
function checkAuth() {
    const token = getToken();
    if (!token) {
        window.location.href = '/';
        return null;
    }
    return getUser();
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Format currency
function formatCurrency(amount) {
    if (!amount) return '-';
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
}

// Status badge
function getStatusBadge(status) {
    const badges = {
        pending: '<span class="badge badge-pending">Pending</span>',
        assigned: '<span class="badge badge-assigned">Assigned</span>',
        vendor_quoted: '<span class="badge badge-vendor-quoted">Quoted</span>',
        sales_priced: '<span class="badge badge-sales-priced">Priced</span>',
        completed: '<span class="badge badge-completed">Completed</span>',
        unsuccessful: '<span class="badge badge-unsuccessful">Unsuccessful</span>'
    };
    return badges[status] || status;
}

// Show toast notification (simple)
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
    position: fixed;
    top: 2rem;
    right: 2rem;
    background: ${type === 'success' ? 'var(--success)' : 'var(--danger)'};
    color: white;
    padding: 1rem 1.5rem;
    border-radius: 0.5rem;
    box-shadow: var(--shadow-xl);
    z-index: 10000;
    animation: slideDown 0.3s ease-out;
  `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
