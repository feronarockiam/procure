// "Needs you today": a strip of cards under the page title telling this person what is waiting on them, each one a link to where
// they can deal with it. The server works out the list from their role (GET /api/enquiries/todo); this only draws it.
//
// Pages load this file; nothing else is needed. refreshTodo() redraws it (screens call it after they reload their data).

function ensureTodoHost() {
    let host = document.getElementById('todoPanel');
    if (host) return host;
    const header = document.querySelector('.main-content .header');
    if (!header) return null;
    host = document.createElement('section');
    host.id = 'todoPanel';
    host.className = 'todo-panel';
    host.setAttribute('aria-label', 'What needs you today');
    header.insertAdjacentElement('afterend', host);
    return host;
}

function todoCardHtml(task) {
    const tag = task.href ? `a href="${escapeHtml(task.href)}"` : 'div';
    return `
        <${tag} class="todo-card tone-${escapeHtml(task.tone || 'info')}">
            <span class="todo-count">${Number(task.count)}</span>
            <span class="todo-text"><b>${escapeHtml(task.label)}</b>${task.hint ? `<small>${escapeHtml(task.hint)}</small>` : ''}</span>
            ${task.href ? '<i class="ph ph-arrow-right" aria-hidden="true"></i>' : ''}
        </${task.href ? 'a' : 'div'}>`;
}

let todoSeq = 0;
async function refreshTodo() {
    const host = ensureTodoHost();
    if (!host) return;
    const seq = ++todoSeq;
    try {
        const data = await apiCall('/enquiries/todo', { silent: true });
        if (seq !== todoSeq || !data || data.applicable === false) { if (!data || data.applicable === false) host.innerHTML = ''; return; }
        const n = data.tasks.length;
        if (typeof renderGreeting === 'function') renderGreeting(data.allClear ? '' : `${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} you today.`); // all clear: the green strip below says so
        host.innerHTML = data.allClear
            ? `<div class="todo-clear"><i class="ph ph-check-circle" aria-hidden="true"></i> You're all caught up. Nothing is waiting on you right now.</div>`
            : `<h2 class="todo-title">Needs you today</h2><div class="todo-grid">${data.tasks.map(todoCardHtml).join('')}</div>`;
    } catch (_) {
        host.innerHTML = ''; // never get in the way of the page itself
    }
}

document.addEventListener('DOMContentLoaded', () => { if (typeof getToken === 'function' && getToken()) refreshTodo(); });
