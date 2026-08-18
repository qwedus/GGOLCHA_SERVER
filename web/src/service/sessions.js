export async function fetch_sessions(device) {
    const res = await fetch(`/api/sessions?device=${encodeURIComponent(device)}`);
    if (!res.ok) throw new Error('failed to fetch sessions');
    return (await res.json()).sessions;
}

export async function hide_session(device, session) {
    const res = await fetch('/api/sessions/hide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device, session })
    });
    if (!res.ok) throw new Error('failed to hide session');
}

export async function fetch_session_data(device, session) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(session)}/data?device=${encodeURIComponent(device)}`);
    if (!res.ok) throw new Error('failed to fetch session data');
    return (await res.json()).records;
}
