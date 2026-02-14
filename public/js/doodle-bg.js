/**
 * Precise Procure - Professional Doodle Background Generator
 * Creates a clean, evenly distributed wallpaper pattern with proper coverage
 */

document.addEventListener('DOMContentLoaded', () => {
    // Create container if it doesn't exist
    let container = document.getElementById('doodle-pattern');
    if (!container) {
        container = document.createElement('div');
        container.id = 'doodle-pattern';
        container.className = 'doodle-pattern';
        document.body.prepend(container);
    }

    // Comprehensive procurement icon set
    const icons = [
        // Transport & Logistics
        'ph-truck', 'ph-airplane', 'ph-package', 'ph-cube',
        // Business & Buildings
        'ph-buildings', 'ph-factory', 'ph-warehouse', 'ph-storefront',
        // Finance & Commerce
        'ph-currency-dollar', 'ph-receipt', 'ph-invoice', 'ph-coins',
        // Analytics & Charts
        'ph-chart-bar', 'ph-chart-line', 'ph-trend-up', 'ph-chart-pie',
        // Documents & Files
        'ph-clipboard-text', 'ph-file-text', 'ph-note', 'ph-folder',
        // Tools & Equipment
        'ph-calculator', 'ph-barcode', 'ph-tag', 'ph-calendar',
        // People & Collaboration
        'ph-users', 'ph-handshake', 'ph-user-circle', 'ph-briefcase',
        // Miscellaneous
        'ph-globe', 'ph-clock', 'ph-gear', 'ph-archive'
    ];

    // Grid configuration for complete coverage
    const cellSize = 80; // pixels
    const cols = Math.ceil(window.innerWidth / cellSize) + 2;
    const rows = Math.ceil(window.innerHeight / cellSize) + 2;

    // Generate icons in a grid pattern with slight randomization
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const icon = document.createElement('i');

            // Random icon selection
            const randomIcon = icons[Math.floor(Math.random() * icons.length)];
            icon.className = `ph ${randomIcon} doodle-item`;

            // Base position in grid
            const baseX = col * cellSize;
            const baseY = row * cellSize;

            // Add slight random offset (±20px) for organic feel
            const offsetX = (Math.random() - 0.5) * 40;
            const offsetY = (Math.random() - 0.5) * 40;

            const finalX = baseX + offsetX;
            const finalY = baseY + offsetY;

            // Convert to percentage for responsiveness
            const xPercent = (finalX / window.innerWidth) * 100;
            const yPercent = (finalY / window.innerHeight) * 100;

            // Consistent sizing with slight variation
            const size = 18 + Math.random() * 8; // 18-26px

            // Random rotation for variety
            const rotation = Math.floor(Math.random() * 360);

            // Set styles
            icon.style.left = `${xPercent}%`;
            icon.style.top = `${yPercent}%`;
            icon.style.fontSize = `${size}px`;
            icon.style.transform = `rotate(${rotation}deg)`;

            container.appendChild(icon);
        }
    }
});
