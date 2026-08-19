function access_key() {
    return localStorage.getItem('admin/key') || localStorage.getItem('server/key') || '';
}

export async function fetch_sessions(device) {
    const res = await fetch(`/api/sessions?device=${encodeURIComponent(device)}`, {
        headers: { 'X-Access-Key': access_key() }
    });
    if (!res.ok) throw new Error('failed to fetch sessions');
    return (await res.json()).sessions;
}

export async function fetch_session_data(device, session) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(session)}/data?device=${encodeURIComponent(device)}`, {
        headers: { 'X-Access-Key': access_key() }
    });
    if (!res.ok) throw new Error('failed to fetch session data');
    return (await res.json()).records;
}

export async function hide_session(device, session) {
    const res = await fetch('/api/sessions/hide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Key': access_key() },
        body: JSON.stringify({ device, session })
    });
    if (!res.ok) throw new Error('failed to hide session');
}

export async function rename_session(device, session, name) {
    const res = await fetch('/api/sessions/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Key': access_key() },
        body: JSON.stringify({ device, session, name })
    });
    if (!res.ok) throw new Error('failed to rename session');
}
