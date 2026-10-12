/* Flowboard board store: holds the open board's state, reloads it after changes and exposes lookups.
   Reloads are coalesced (one in flight, at most one queued) and deferred while a drag is in progress. */
(function (FB) {
  'use strict';
  const S = { state: null, boardId: null };
  let inflight = null, queued = false, deferred = false;

  S.reset = function (boardId) { S.state = null; S.boardId = boardId; inflight = null; queued = false; deferred = false; };

  S.load = async function (boardId) {
    S.reset(boardId);
    const res = await FB.api.get(`/api/boards/${encodeURIComponent(boardId)}`);
    if (S.boardId !== boardId) return { ok: false, stale: true };
    if (res.ok) S.state = res;
    return res;
  };

  // Re-fetch the board and emit 'board' with the new state.
  S.refresh = function () {
    if (!S.boardId) return Promise.resolve();
    if (FB.dnd && FB.dnd.active) { deferred = true; return Promise.resolve(); }
    if (inflight) { queued = true; return inflight; }
    const id = S.boardId;
    inflight = (async () => {
      const res = await FB.api.get(`/api/boards/${encodeURIComponent(id)}`);
      if (S.boardId !== id) return;
      if (res.ok) { S.state = res; FB.emit('board', res); }
      else if (res.status === 404 || res.status === 403) FB.emit('board-gone', { reason: res.error });
    })().finally(() => {
      inflight = null;
      if (queued) { queued = false; S.refresh(); }
    });
    return inflight;
  };
  FB.on('dnd-end', () => { if (deferred) { deferred = false; S.refresh(); } });

  // Run a mutation, toast on failure and always resync the board afterwards.
  S.act = async function (promise, opts) {
    const res = await promise;
    if (!res.ok && !(opts && opts.quiet)) FB.toast(res.error || 'That didn’t work. Please try again.', { type: 'error' });
    S.refresh();
    return res;
  };

  // Lookups on the current state.
  S.list = id => S.state && S.state.lists.find(l => l.id === id);
  S.card = id => S.state && S.state.cards.find(c => c.id === id);
  S.member = id => S.state && S.state.members.find(m => m.id === id);
  S.label = id => S.state && S.state.labels.find(l => l.id === id);
  S.cardsIn = listId => (S.state ? S.state.cards.filter(c => c.listId === listId).sort((a, b) => a.position - b.position) : []);
  S.isOwner = () => !!(S.state && S.state.board.role === 'owner');

  // Optimistic local move so a re-render before the server answers keeps the dropped order.
  S.localMoveCard = function (cardId, listId, index) {
    const c = S.card(cardId);
    if (!c) return;
    const from = c.listId;
    const target = S.cardsIn(listId).filter(x => x.id !== cardId);
    target.splice(Math.max(0, Math.min(index, target.length)), 0, c);
    c.listId = listId;
    target.forEach((x, i) => { x.position = i; });
    if (from !== listId) S.cardsIn(from).forEach((x, i) => { x.position = i; });
  };
  S.localMoveList = function (listId, index) {
    const lists = S.state.lists.filter(l => l.id !== listId);
    const l = S.list(listId);
    if (!l) return;
    lists.splice(Math.max(0, Math.min(index, lists.length)), 0, l);
    lists.forEach((x, i) => { x.position = i; });
    S.state.lists = lists;
  };

  FB.store = S;
})(window.FB = window.FB || {});
