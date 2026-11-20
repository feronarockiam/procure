// Pick several items (from any number of enquiries) and give them to one person in a single step.
// Used by the Sourcing queue ("Claim selected") and the Sales lists ("Assign selected to…").
//
//   BulkAssign.init({ people, canClaim, canAssign, afterChange })   once per page
//   BulkAssign.checkbox(enquiryId, itemId)                          put in a row (draws nothing if the person may do neither)
//   BulkAssign.allBox(containerId)                                  a "select all in here" box for a group
//   BulkAssign.sync()                                               after a list is redrawn
//
// The server decides what is allowed (POST /api/enquiries/assign-items); this only collects the choice.
const BulkAssign = (() => {
    const picked = new Map(); // itemId -> enquiryId
    let cfg = { people: () => [], canClaim: () => false, canAssign: () => false, afterChange: async () => {} };
    let busy = false;

    const el = (id) => document.getElementById(id);
    const mayPick = () => cfg.canClaim() || cfg.canAssign();
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    function ensureBar() {
        if (el('bulkBar')) return;
        const bar = document.createElement('div');
        bar.id = 'bulkBar';
        bar.className = 'bulk-bar';
        bar.hidden = true;
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', 'Selected items');
        bar.innerHTML = `
            <span class="bulk-count" aria-live="polite"><b id="bulkCount">0</b> selected</span>
            <button type="button" class="btn btn-primary btn-sm" id="bulkClaim"><i class="ph ph-hand"></i> Claim for me</button>
            <span class="bulk-assign" id="bulkAssignGroup">
                <select id="bulkPerson" aria-label="Give the selected items to"></select>
                <button type="button" class="btn btn-primary btn-sm" id="bulkAssign"><i class="ph ph-user-plus"></i> Assign</button>
            </span>
            <button type="button" class="btn btn-secondary btn-sm" id="bulkClear">Clear</button>`;
        document.body.appendChild(bar);
        el('bulkClaim').addEventListener('click', () => submit(getUser().id));
        el('bulkAssign').addEventListener('click', () => {
            const person = el('bulkPerson').value;
            if (!person) { showToast('Choose who should get these items', 'error'); el('bulkPerson').focus(); return; }
            submit(person);
        });
        el('bulkClear').addEventListener('click', clear);
    }

    function render() {
        const bar = el('bulkBar');
        if (!bar) return;
        const n = picked.size;
        bar.hidden = n === 0;
        document.body.classList.toggle('has-bulk-bar', n > 0);
        if (n === 0) return;
        el('bulkCount').textContent = n;
        el('bulkClaim').style.display = cfg.canClaim() ? '' : 'none';
        const showAssign = cfg.canAssign();
        el('bulkAssignGroup').style.display = showAssign ? '' : 'none';
        if (showAssign) {
            const select = el('bulkPerson');
            const keep = select.value;
            select.innerHTML = '<option value="">Assign to…</option>' +
                cfg.people().map(p => `<option value="${escapeHtml(p._id)}">${escapeHtml(p.name)}</option>`).join('');
            select.value = keep;
        }
        el('bulkClaim').disabled = el('bulkAssign').disabled = busy;
    }

    // keep the "select all" boxes in step with the item boxes they cover
    function refreshAllBoxes() {
        document.querySelectorAll('.bulk-pick-all').forEach(box => {
            const scope = el(box.dataset.scope);
            const boxes = scope ? [...scope.querySelectorAll('.bulk-pick')] : [];
            const on = boxes.filter(b => b.checked).length;
            box.checked = boxes.length > 0 && on === boxes.length;
            box.indeterminate = on > 0 && on < boxes.length;
        });
    }

    function toggle(box) {
        if (box.checked) picked.set(box.dataset.item, box.dataset.enquiry); else picked.delete(box.dataset.item);
        refreshAllBoxes();
        render();
    }

    function toggleScope(allBox) {
        const scope = el(allBox.dataset.scope);
        if (!scope) return;
        scope.querySelectorAll('.bulk-pick').forEach(box => {
            box.checked = allBox.checked;
            if (box.checked) picked.set(box.dataset.item, box.dataset.enquiry); else picked.delete(box.dataset.item);
        });
        refreshAllBoxes();
        render();
    }

    function clear() {
        picked.clear();
        document.querySelectorAll('.bulk-pick, .bulk-pick-all').forEach(box => { box.checked = false; box.indeterminate = false; });
        render();
    }

    // After a list is redrawn: forget anything no longer on screen (it moved on, or a filter hid it), tick what is still picked
    function sync() {
        const onScreen = new Set([...document.querySelectorAll('.bulk-pick')].map(b => b.dataset.item));
        for (const id of [...picked.keys()]) if (!onScreen.has(id)) picked.delete(id);
        refreshAllBoxes();
        render();
    }

    async function submit(personId) {
        if (busy || picked.size === 0) return;
        busy = true;
        render();
        const self = personId === getUser().id;
        try {
            const result = await apiCall('/enquiries/assign-items', {
                method: 'POST',
                body: JSON.stringify({ itemIds: [...picked.keys()], sourcingUserId: personId }),
            });
            const done = plural(result.assigned, 'item');
            const left = result.skipped ? ` (${result.skipped} could not be moved: already taken or no longer open)` : '';
            showToast(self ? `Claimed ${done}${left}` : `Assigned ${done}${left}`, result.skipped ? 'info' : 'success');
            picked.clear();
            busy = false;
            await cfg.afterChange(result, self);
        } catch (error) {
            showToast(error.message || 'Could not assign these items', 'error');
        } finally {
            busy = false;
            sync();
        }
    }

    return {
        init(options) { cfg = { ...cfg, ...options }; ensureBar(); render(); },
        checkbox(enquiryId, itemId) {
            if (!mayPick()) return '';
            return `<input type="checkbox" class="bulk-pick" aria-label="Select this item" data-item="${escapeHtml(itemId)}" data-enquiry="${escapeHtml(enquiryId)}" ${picked.has(String(itemId)) ? 'checked' : ''} onclick="event.stopPropagation()" onchange="BulkAssign.toggle(this)">`;
        },
        allBox(containerId) {
            if (!mayPick()) return '';
            return `<input type="checkbox" class="bulk-pick-all" aria-label="Select all items in this group" data-scope="${escapeHtml(containerId)}" onclick="event.stopPropagation()" onchange="BulkAssign.toggleScope(this)">`;
        },
        // "Assign all" on a group: tick everything in it, then go straight to choosing the person
        pickGroup(containerId) {
            const scope = el(containerId);
            if (!scope) return;
            scope.querySelectorAll('.bulk-pick').forEach(box => { box.checked = true; picked.set(box.dataset.item, box.dataset.enquiry); });
            refreshAllBoxes();
            render();
            const person = el('bulkPerson');
            if (person && el('bulkAssignGroup').style.display !== 'none') person.focus(); else if (el('bulkClaim')) el('bulkClaim').focus();
        },
        toggle, toggleScope, clear, sync,
        get count() { return picked.size; },
    };
})();
