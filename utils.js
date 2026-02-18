// Utility functions

export function generateRoomId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}

export function generateUsername() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < 5; i++) {
        suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `User_${suffix}`;
}

export function showMessage(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = `<div class="message ${type}">${message}</div>`;
    setTimeout(() => {
        el.innerHTML = '';
    }, 5000);
}

export function clearChat() {
    const container = document.getElementById('chatMessages');
    if (container) {
        container.innerHTML = '';
    }
}

export function addChatMessage(username, message) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'chat-message';
    div.innerHTML = `<strong>${username}:</strong> ${message}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}
