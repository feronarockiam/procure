// Reports: the server works out every figure (GET /api/analytics); this page only asks for a period and draws the answer.
// Charts are plain SVG (no library), and every name goes through escapeHtml.

let report = null;
let metric = 'enquiries';
let loadSeq = 0;

const el = (id) => document.getElementById(id);
const dayInput = (date) => { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ── Formatting ───────────────────────────────────────────────────────────────

// Indian style: ₹1,25,000 → ₹1.25 L, ₹2,50,00,000 → ₹2.5 Cr
function money(n) {
    const v = Number(n) || 0;
    const trim = (x) => String(Math.round(x * 100) / 100);
    if (v >= 1e7) return `₹${trim(v / 1e7)} Cr`;
    if (v >= 1e5) return `₹${trim(v / 1e5)} L`;
    return `₹${v.toLocaleString('en-IN')}`;
}
function duration(hours) {
    if (hours === null || hours === undefined) return '—';
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
    if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
    return `${Math.round((hours / 24) * 10) / 10} days`;
}
const percent = (n) => (n === null || n === undefined ? '—' : `${n}%`);
const shortDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// ── Chart ────────────────────────────────────────────────────────────────────

// The top of the chart: a round number, and for counts a whole number every step (never "3.8 enquiries")
function niceMax(value, whole) {
    if (whole) return Math.max(1, Math.ceil(value / 4)) * 4;
    if (value <= 4) return 4;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * magnitude) return step * magnitude;
    return 10 * magnitude;
}

// Drawn at the width it will be shown at, so the text stays a readable size however wide the screen is
function barChart(series, key, width) {
    const W = width, H = 230, left = key === 'quotedValue' ? 62 : 36, right = 8, top = 10, bottom = 26;
    const plotW = W - left - right, plotH = H - top - bottom;
    const max = niceMax(Math.max(0, ...series.map(d => d[key])), key !== 'quotedValue');
    const slot = plotW / series.length;
    const barW = Math.max(2, Math.min(28, slot * 0.7));
    const fmt = (v) => (key === 'quotedValue' ? money(v) : String(v));
    const every = Math.ceil(series.length / Math.max(3, Math.floor(plotW / 80))); // a label about every 80px
    const ticks = [0, 1, 2, 3, 4].map(i => (max / 4) * i);
    const total = series.reduce((n, d) => n + d[key], 0);

    const grid = ticks.map(v => {
        const y = top + plotH - (v / max) * plotH;
        return `<line class="axis" x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" ${v === 0 ? '' : 'stroke-dasharray="3 4"'}/><text x="${left - 6}" y="${y + 4}" text-anchor="end">${escapeHtml(key === 'quotedValue' ? money(v) : Math.round(v * 10) / 10)}</text>`;
    }).join('');
    const bars = series.map((d, i) => {
        const h = (d[key] / max) * plotH;
        const x = left + i * slot + (slot - barW) / 2;
        return `<rect class="bar" x="${x}" y="${top + plotH - h}" width="${barW}" height="${Math.max(h, d[key] > 0 ? 2 : 0)}" rx="3"><title>${escapeHtml(shortDay(d.date))}: ${escapeHtml(fmt(d[key]))}</title></rect>`;
    }).join('');
    const labels = series.map((d, i) => (i % every === 0 ? `<text x="${left + i * slot + slot / 2}" y="${H - 8}" text-anchor="middle">${escapeHtml(shortDay(d.date))}</text>` : '')).join('');
    return `<svg class="rp-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(`${metricLabel()} per day, ${fmt(total)} in total`)}">${grid}${bars}${labels}</svg>`;
}
const metricLabel = () => ({ enquiries: 'Enquiries raised', items: 'Items raised', quotedValue: 'Quoted value' })[metric];

// ── Sections ─────────────────────────────────────────────────────────────────

function kpiHtml(d) {
    const t = d.totals;
    const cards = [
        ['Enquiries raised', t.enquiries.toLocaleString('en-IN'), `${t.items.toLocaleString('en-IN')} items · ${t.openEnquiries} still open`],
        ['Quoted value', money(t.quotedValue), 'Selling price × quantity, every priced item'],
        ['Won value', money(t.wonValue), `${t.completedItems} item${t.completedItems === 1 ? '' : 's'} sent as quotations`],
        ['Win rate', percent(t.winRate), t.winRate === null ? 'Nothing decided yet' : `${t.completedItems} won · ${t.lostItems} lost`],
        ['Average deal', money(t.avgDealValue), 'Per item sent'],
        ['Start to finish', duration(d.turnaround.endToEnd.avgHours), d.turnaround.endToEnd.n ? `Average, from ${d.turnaround.endToEnd.n} finished item${d.turnaround.endToEnd.n === 1 ? '' : 's'}` : 'No finished items with times yet'],
    ];
    return `<div class="rp-kpis">${cards.map(([label, value, note]) => `<div class="rp-kpi"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div><div class="note">${escapeHtml(note)}</div></div>`).join('')}</div>`;
}

const chartWidth = () => Math.max(300, Math.floor(el('reportBody').clientWidth - 52)); // the card's padding and border

function volumeHtml(d) {
    const tab = (key, label) => `<button type="button" data-metric="${key}" class="${metric === key ? 'active' : ''}" aria-pressed="${metric === key}">${label}</button>`;
    const empty = d.series.every(day => day[metric] === 0);
    return `<div class="rp-card wide">
        <div class="rp-tabs" role="group" aria-label="Chart shows">${tab('enquiries', 'Enquiries')}${tab('items', 'Items')}${tab('quotedValue', 'Value')}</div>
        <h3>${escapeHtml(metricLabel())} each day</h3><p class="sub">Hover a bar for the exact figure.</p>
        ${empty ? '<div class="rp-empty">Nothing was raised in this period.</div>' : barChart(d.series, metric, chartWidth())}
    </div>`;
}

function funnelHtml(d) {
    const base = d.funnel[0].count || 0;
    const rows = d.funnel.map((step, i) => {
        const pct = base ? Math.round((step.count / base) * 100) : 0;
        const drop = i > 0 && d.funnel[i - 1].count ? d.funnel[i - 1].count - step.count : 0;
        return `<div class="rp-funnel-row"><span>${escapeHtml(step.label)}</span>
            <div class="track" role="img" aria-label="${escapeHtml(`${step.label}: ${step.count} (${pct}%)`)}"><div class="fill" style="width:${pct}%"></div></div>
            <span class="num">${step.count.toLocaleString('en-IN')} <small>${i === 0 ? '' : `${pct}%`}${drop > 0 ? ` · −${drop}` : ''}</small></span></div>`;
    }).join('');
    return `<div class="rp-card"><h3>Where items get to</h3><p class="sub">Each step shows how many items reached it, and how many dropped off since the step before.</p>${base ? rows : '<div class="rp-empty">No items in this period.</div>'}</div>`;
}

function stepsHtml(d) {
    const steps = [
        ['Raised → given to purchase', d.turnaround.toAssign], ['Given → vendor price in', d.turnaround.toQuote],
        ['Vendor price → selling price', d.turnaround.toPrice], ['Selling price → quotation sent', d.turnaround.toSend],
    ];
    return `<div class="rp-card"><h3>How long each step takes</h3><p class="sub">Average, with the middle value (median) so one slow item doesn't mislead. Only items with recorded times count.</p>
        <div class="rp-steps">${steps.map(([label, s]) => `<div class="rp-step"><div class="t">${escapeHtml(label)}</div><div class="v">${escapeHtml(duration(s.avgHours))}</div><div class="m">${s.n ? `median ${escapeHtml(duration(s.medianHours))} · ${s.n} item${s.n === 1 ? '' : 's'}` : 'no data yet'}</div></div>`).join('')}</div></div>`;
}

function tableHtml(title, sub, columns, rows) {
    return `<div class="rp-card"><h3>${escapeHtml(title)}</h3><p class="sub">${escapeHtml(sub)}</p>${rows.length
        ? `<table class="rp-table"><thead><tr>${columns.map((c, i) => `<th class="${i ? 'n' : ''}">${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((cell, i) => (i === 0 ? `<td class="name" title="${escapeHtml(cell)}">${escapeHtml(cell)}</td>` : `<td class="n">${cell}</td>`)).join('')}</tr>`).join('')}</tbody></table>`
        : '<div class="rp-empty">Nothing to show for this period.</div>'}</div>`;
}

function render() {
    const d = report;
    const note = `${shortDay(d.range.from.slice(0, 10))} – ${shortDay(d.range.to.slice(0, 10))} · ${d.totals.enquiries} enquir${d.totals.enquiries === 1 ? 'y' : 'ies'} raised`;
    el('rangeNote').textContent = note;
    drawnAt = chartWidth();
    const meter = (value) => `<span class="rp-meter" aria-hidden="true"><i style="width:${Math.min(100, value || 0)}%"></i></span>${escapeHtml(percent(value))}`;
    el('reportBody').innerHTML = `
        ${d.partial ? '<div class="rp-banner" role="status">This period has more enquiries than a report can hold, so the figures cover the most recent ones. Choose a shorter period for exact numbers.</div>' : ''}
        ${kpiHtml(d)}
        <div class="rp-grid">${volumeHtml(d)}</div>
        <div class="rp-grid">${funnelHtml(d)}${stepsHtml(d)}</div>
        <div class="rp-grid">
            ${tableHtml('Purchase team', 'Items handed to each person, how many they have priced, and how quickly.', ['Person', 'Given', 'Priced', 'Avg time'], d.purchasePeople.map(p => [p.name, p.assigned, p.quoted, escapeHtml(duration(p.avgHoursToQuote))]))}
            ${tableHtml('Sales team', 'Enquiries raised and the value of what they have priced.', ['Person', 'Enquiries', 'Priced', 'Value'], d.salesPeople.map(p => [p.name, p.enquiries, `${p.priced}/${p.items}`, escapeHtml(money(p.value))]))}
            ${tableHtml('Top customers', 'By number of enquiries.', ['Customer', 'Enquiries', 'Value'], d.customers.map(c => [c.name, c.enquiries, escapeHtml(money(c.value))]))}
            ${tableHtml('Most requested materials', 'By number of requests.', ['Material', 'Requests', 'Total quantity'], d.materials.map(m => [m.name, m.requests, `${m.quantity.toLocaleString('en-IN')} ${escapeHtml(m.unit)}`]))}
            ${tableHtml('Vendors', 'Prices given, and how often theirs was the one chosen.', ['Vendor', 'Prices', 'Chosen'], d.vendors.map(v => [v.name, v.quotes, meter(v.winRate)]))}
            ${tableHtml('Why enquiries were closed', 'The reasons people gave.', ['Reason', 'Enquiries'], d.closeReasons.map(r => [r.reason, r.count]))}
        </div>`;
    el('reportBody').querySelectorAll('[data-metric]').forEach(b => b.addEventListener('click', () => { metric = b.dataset.metric; render(); }));
}

// ── Loading ──────────────────────────────────────────────────────────────────

async function load() {
    const from = el('fromDate').value, to = el('toDate').value;
    if (!from || !to) return;
    const seq = ++loadSeq;
    el('reportBody').innerHTML = skeletonHtml(4);
    try {
        const data = await apiCall(`/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { silent: true });
        if (seq !== loadSeq || !data) return; // a newer choice has already replaced this one
        report = data;
        render();
    } catch (error) {
        if (seq !== loadSeq) return;
        showLoadError(el('reportBody'), error.message, load);
    }
}

function setPreset(days) {
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    el('fromDate').value = dayInput(start);
    el('toDate').value = dayInput(end);
    document.querySelectorAll('.rp-presets button').forEach(b => b.classList.toggle('active', Number(b.dataset.days) === days));
    load();
}

function downloadReport() {
    if (!report) { showToast('The report is still loading', 'error'); return; }
    const d = report, rows = [];
    const add = (section, name, figure, value) => rows.push([section, name, figure, value]);
    Object.entries({ 'Enquiries raised': d.totals.enquiries, 'Items raised': d.totals.items, 'Open enquiries': d.totals.openEnquiries, 'Items sent': d.totals.completedItems, 'Items lost': d.totals.lostItems,
        'Quoted value (₹)': d.totals.quotedValue, 'Won value (₹)': d.totals.wonValue, 'Average deal (₹)': d.totals.avgDealValue, 'Win rate (%)': d.totals.winRate ?? '' }).forEach(([k, v]) => add('Totals', '', k, v));
    d.funnel.forEach(f => add('Where items get to', f.label, 'Items', f.count));
    Object.entries({ 'Raised → given': d.turnaround.toAssign, 'Given → vendor price': d.turnaround.toQuote, 'Vendor price → selling price': d.turnaround.toPrice, 'Selling price → sent': d.turnaround.toSend, 'Start to finish': d.turnaround.endToEnd })
        .forEach(([k, s]) => { add('Time per step (hours)', k, 'Average', s.avgHours ?? ''); add('Time per step (hours)', k, 'Median', s.medianHours ?? ''); add('Time per step (hours)', k, 'Items', s.n); });
    d.purchasePeople.forEach(p => { add('Purchase team', p.name, 'Given', p.assigned); add('Purchase team', p.name, 'Priced', p.quoted); add('Purchase team', p.name, 'Avg hours to price', p.avgHoursToQuote ?? ''); });
    d.salesPeople.forEach(p => { add('Sales team', p.name, 'Enquiries', p.enquiries); add('Sales team', p.name, 'Items priced', p.priced); add('Sales team', p.name, 'Value (₹)', p.value); });
    d.customers.forEach(c => { add('Top customers', c.name, 'Enquiries', c.enquiries); add('Top customers', c.name, 'Value (₹)', c.value); });
    d.materials.forEach(m => { add('Materials', m.name, 'Requests', m.requests); add('Materials', m.name, `Quantity (${m.unit})`, m.quantity); });
    d.vendors.forEach(v => { add('Vendors', v.name, 'Prices given', v.quotes); add('Vendors', v.name, 'Chosen', v.won); });
    d.series.forEach(day => add('Per day', day.date, 'Enquiries / items / value', `${day.enquiries} / ${day.items} / ${day.quotedValue}`));
    downloadCsv(`report-${el('fromDate').value}-to-${el('toDate').value}`, ['Section', 'Name', 'Figure', 'Value'], rows);
    showToast(`Downloaded ${rows.length} rows`);
}

// redraw when the window is resized enough to matter
let drawnAt = 0;
window.addEventListener('resize', debounce(() => { if (report && Math.abs(chartWidth() - drawnAt) > 40) render(); }, 200));

document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) return;
    if (!requirePageAccess('/analytics.html')) return;
    initSidebar();
    document.querySelectorAll('.rp-presets button').forEach(b => b.addEventListener('click', () => setPreset(Number(b.dataset.days))));
    ['fromDate', 'toDate'].forEach(id => el(id).addEventListener('change', () => {
        document.querySelectorAll('.rp-presets button').forEach(b => b.classList.remove('active'));
        load();
    }));
    el('downloadBtn').addEventListener('click', downloadReport);
    setPreset(30);
});
