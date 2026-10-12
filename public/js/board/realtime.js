/* Flowboard live collaboration client (Server-Sent Events).
   Emits: 'live' (status: connecting | on | off), 'presence' (users), 'board-change' (payload + own flag).
   Remote changes trigger a board reload; after a reconnect the board is reloaded to catch missed events. */
(function (FB) {
  'use strict';
  let es = null, boardId = null, status = 'off', wasDown = false, retryTimer = null;
  const setStatus = s => { if (s !== status) { status = s; FB.emit('live', s); } };

  function connect(id) {
    disconnect();
    boardId = id;
    open();
  }
  function open() {
    if (!boardId) return;
    setStatus('connecting');
    es = new EventSource(`/api/boards/${encodeURIComponent(boardId)}/events?clientId=${encodeURIComponent(FB.util.clientId)}`);
    es.addEventListener('open', () => {
      setStatus('on');
      if (wasDown) { wasDown = false; FB.store.refresh(); FB.emit('board-change', { own: false, reconnect: true, activity: [], cardIds: [] }); }
    });
    es.addEventListener('error', () => {
      wasDown = true;
      setStatus('off');
      // The browser retries on its own; if it gave up (CLOSED), try again ourselves.
      if (es && es.readyState === 2) { es.close(); es = null; clearTimeout(retryTimer); retryTimer = setTimeout(open, 3000); }
    });
    const parse = e => { try { return JSON.parse(e.data); } catch (err) { return {}; } };
    es.addEventListener('hello', e => FB.emit('presence', parse(e).users || []));
    es.addEventListener('presence', e => FB.emit('presence', parse(e).users || []));
    es.addEventListener('change', e => {
      const d = parse(e);
      d.own = d.clientId === FB.util.clientId;
      if (!d.own) FB.store.refresh();
      FB.emit('board-change', d);
    });
    es.addEventListener('deleted', e => {
      const d = parse(e);
      const own = d.clientId === FB.util.clientId;
      disconnect();
      if (!own) FB.emit('board-gone', { reason: 'This board was deleted by its owner.' });
    });
    es.addEventListener('removed', () => {
      disconnect();
      FB.emit('board-gone', { reason: 'You were removed from this board.' });
    });
  }
  function disconnect() {
    clearTimeout(retryTimer);
    if (es) { es.close(); es = null; }
    boardId = null; wasDown = false;
    setStatus('off');
  }
  addEventListener('pagehide', () => { if (es) es.close(); });
  FB.realtime = { connect, disconnect, status: () => status };
})(window.FB = window.FB || {});
