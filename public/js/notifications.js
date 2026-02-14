document.addEventListener('DOMContentLoaded', () => {
    loadNotifications();
    // Poll every 30 seconds
    setInterval(loadNotifications, 30000);
});

async function loadNotifications() {
    try {
        const notifications = await apiCall('/notifications');
        renderNotifications(notifications);
    } catch (error) {
        console.error('Failed to load notifications');
    }
}

function renderNotifications(notifications) {
    const badge = document.getElementById('notificationBadge');
    const list = document.getElementById('notificationList');

    if (!badge || !list) return;

    const unreadCount = notifications.filter(n => !n.isRead).length;

    if (unreadCount > 0) {
        badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }

    // Update header button
    const headerBtn = document.querySelector('.notification-header button');
    if (headerBtn) {
        headerBtn.innerHTML = '<i class="ph ph-checks"></i> Mark all read';
        headerBtn.className = 'btn-mark-read';
        headerBtn.onclick = markAllRead;
    }

    if (notifications.length === 0) {
        list.innerHTML = '<div class="p-8 text-center text-muted" style="font-size: 0.875rem;">No notifications yet</div>';
        return;
    }

    list.innerHTML = notifications.map(n => `
        <div class="notification-item ${n.isRead ? 'read' : 'unread'}" onclick="handleNotificationClick('${n._id}', '${n.link}', '${n.message.replace(/'/g, "\\'")}')">
            <div class="flex gap-4">
                <div class="notification-icon ${n.type}" style="width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--bg-hover); color: var(--${n.type || 'primary'});">
                    <i class="ph ph-${getIconForType(n.type)}" style="font-size: 1.25rem;"></i>
                </div>
                <div style="flex: 1;">
                    <div class="notification-message">${n.message}</div>
                    <div class="notification-time" style="font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.3rem;">
                        <i class="ph ph-clock"></i> ${formatTimeAgo(n.createdAt)}
                    </div>
                </div>
                ${!n.isRead ? '<div class="unread-dot" style="width: 8px; height: 8px; background: var(--primary); border-radius: 50%; margin-top: 0.5rem;"></div>' : ''}
            </div>
        </div>
    `).join('');
}

function getIconForType(type) {
    switch (type) {
        case 'success': return 'check-circle';
        case 'warning': return 'warning';
        case 'error': return 'x-circle';
        default: return 'info';
    }
}

function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return date.toLocaleDateString();
}

async function handleNotificationClick(id, link, message) {
    try {
        await apiCall(`/notifications/${id}/read`, { method: 'PUT' });
        
        // Prepare target link with fallback for enquiryId
        let targetLink = link;
        if (targetLink && targetLink !== 'undefined' && targetLink !== 'null') {
            // Fallback: If link doesn't have enquiryId, try to extract it from message (FOR OLD NOTIFICATIONS)
            if (!targetLink.includes('enquiryId=') && message) {
                const idMatch = message.match(/[0-9a-fA-F]{24}/); // Match Mongo ID
                if (idMatch) {
                    const separator = targetLink.includes('?') ? '&' : '?';
                    targetLink += `${separator}enquiryId=${idMatch[0]}`;
                }
            }

            const currentPath = window.location.pathname;
            const linkUrl = new URL(targetLink, window.location.origin);
            
            // Check if we are already on the same dashboard
            const isSamePage = currentPath === linkUrl.pathname || 
                             (currentPath === '/' && linkUrl.pathname === '/index.html') ||
                             (currentPath.endsWith(linkUrl.pathname));

            if (isSamePage) {
                // Smooth internal navigation
                history.pushState(null, '', targetLink);
                if (typeof window.handleUrlParameters === 'function') {
                    window.handleUrlParameters();
                    // Close dropdown
                    const dropdown = document.getElementById('notificationDropdown');
                    if (dropdown) dropdown.style.display = 'none';
                    // Refresh count
                    loadNotifications();
                    return;
                }
            }
            
            // Fallback to full reload for different pages or if handler missing
            window.location.href = targetLink;
        } else {
            loadNotifications(); // Refresh to clear unread status
        }
    } catch (error) {
        console.error('Notification click error:', error);
        if (link) window.location.href = link;
    }
}

async function markAllRead() {
    await apiCall('/notifications/read-all', { method: 'PUT' });
    loadNotifications();
}

function toggleNotifications() {
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const wrapper = document.querySelector('.notification-wrapper');
    const dropdown = document.getElementById('notificationDropdown');
    if (wrapper && !wrapper.contains(e.target) && dropdown && dropdown.style.display === 'block') {
        dropdown.style.display = 'none';
    }
});
