/* Live collaboration over Server-Sent Events (SSE): one long-lived GET per open board.
   SSE is plain HTTP, reconnects automatically in every browser and needs no extra protocol code.
   Events:  hello    {presence}                     sent on connect
            change   {version, clientId, activity}   after every change on the board
            presence {users}                         when someone opens/closes the board
            deleted / removed                        the board was deleted / you were removed */
'use strict';
const { SECURITY_HEADERS } = require('./http');

function createRealtime({ log } = {}) {
  const boards = new Map(); // boardId -> Set<client>
  const R = {};
  const write = (c, event, data) => { try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) { /* closed */ } };
  const presence = boardId => {
    const seen = new Map();
    (boards.get(boardId) || []).forEach(c => { if (!seen.has(c.user.id)) seen.set(c.user.id, { id: c.user.id, name: c.user.name, color: c.user.color }); });
    return [...seen.values()];
  };
  const broadcastPresence = boardId => { const users = presence(boardId); (boards.get(boardId) || []).forEach(c => write(c, 'presence', { users })); };

  R.subscribe = function (boardId, user, clientId, req, res) {
    res.writeHead(200, Object.assign({}, SECURITY_HEADERS, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'
    }));
    res.write('retry: 2000\n\n');
    req.socket.setKeepAlive(true);
    req.socket.setTimeout(0);
    const client = { user, clientId, res };
    if (!boards.has(boardId)) boards.set(boardId, new Set());
    boards.get(boardId).add(client);
    write(client, 'hello', { users: presence(boardId) });
    broadcastPresence(boardId);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* closed */ } }, 25000);
    const close = () => {
      clearInterval(ping);
      const set = boards.get(boardId);
      if (!set || !set.delete(client)) return;
      if (!set.size) boards.delete(boardId); else broadcastPresence(boardId);
    };
    req.on('close', close);
    res.on('close', close);
  };

  R.publish = function (boardId, payload) {
    const set = boards.get(boardId);
    if (!set) return;
    const event = payload.type === 'deleted' ? 'deleted' : 'change';
    set.forEach(c => write(c, event, payload));
    if (event === 'deleted') { set.forEach(c => { try { c.res.end(); } catch (e) { /* ignore */ } }); boards.delete(boardId); }
  };

  R.kick = function (boardId, userId) {
    const set = boards.get(boardId);
    if (!set) return;
    [...set].filter(c => c.user.id === userId).forEach(c => { write(c, 'removed', {}); try { c.res.end(); } catch (e) { /* ignore */ } set.delete(c); });
    broadcastPresence(boardId);
  };

  R.count = () => [...boards.values()].reduce((n, s) => n + s.size, 0);
  R.closeAll = () => { boards.forEach(set => set.forEach(c => { try { c.res.end(); } catch (e) { /* ignore */ } })); boards.clear(); };
  return R;
}
module.exports = { createRealtime };
