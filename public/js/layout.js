/**
 * layout.js - Handles common layout enhancements like the glass header
 * and personalized greetings.
 */

document.addEventListener('DOMContentLoaded', () => {
    updateGreeting();
    setupHeaderScroll();
});

function updateGreeting() {
    const user = getUser();
    if (!user) return;

    // Update Name
    const nameElements = document.querySelectorAll('#userName');
    nameElements.forEach(el => {
        el.textContent = user.name.split(' ')[0]; // First name only for friendlier look
    });

    // Determine Time of Day
    const hour = new Date().getHours();
    let timeGreeting = 'Good Morning';
    let icon = '☀️';

    if (hour >= 12 && hour < 17) {
        timeGreeting = 'Good Afternoon';
        icon = '🌤️';
    } else if (hour >= 17) {
        timeGreeting = 'Good Evening';
        icon = '🌙';
    }

    // Update Greeting Text
    const greetingTitle = document.getElementById('dynamicGreeting');
    if (greetingTitle) {
        greetingTitle.innerHTML = `${timeGreeting}, <span class="greeting-highlight">${user.name.split(' ')[0]}</span> ${icon}`;
    }

    // Contextual Subtitles (Randomized for freshness)
    const subtitles = [
        "Ready to make some progress today?",
        "Everything is looking good on the dashboard.",
        "Let's get productive!",
        "Check your notifications for recent updates.",
        "Your dashboard is up to date."
    ];

    // Different subtitles based on role could be added here
    const subtitleEl = document.getElementById('greetingSubtitle');
    if (subtitleEl) {
        // Pick a random subtitle for variety
        const randomSubtitle = subtitles[Math.floor(Math.random() * subtitles.length)];
        subtitleEl.textContent = randomSubtitle;
    }
}

function setupHeaderScroll() {
    const header = document.querySelector('.glass-header');
    if (!header) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 10) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });
}

/**
 * Mobile Navigation Functions
 */
function toggleMobileMenu() {
    const drawer = document.getElementById('mobileNavDrawer');
    const overlay = document.getElementById('mobileNavOverlay');

    if (!drawer || !overlay) return;

    const isActive = drawer.classList.contains('active');

    if (isActive) {
        // Close menu
        drawer.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    } else {
        // Open menu
        drawer.classList.add('active');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scroll
    }
}

/**
 * Utility function to check if viewport is mobile
 */
function isMobile() {
    return window.innerWidth <= 768;
}

/**
 * Utility function to check if viewport is tablet
 */
function isTablet() {
    return window.innerWidth > 768 && window.innerWidth <= 1024;
}

// Close mobile menu on Esc key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const drawer = document.getElementById('mobileNavDrawer');
        if (drawer && drawer.classList.contains('active')) {
            toggleMobileMenu();
        }
    }
});

// Close mobile menu when resizing to desktop
window.addEventListener('resize', () => {
    const drawer = document.getElementById('mobileNavDrawer');
    if (drawer && drawer.classList.contains('active') && !isMobile()) {
        toggleMobileMenu();
    }
});
