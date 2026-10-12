/* Lists: create, rename, reorder, delete. */
'use strict';
module.exports = function (r, { engine }) {
  const auth = { auth: true };
  const actor = ctx => ({ uid: ctx.user.id, clientId: String(ctx.req.headers['x-client-id'] || '').slice(0, 64) || null });
  r.post('/api/boards/:id/lists', auth, ctx => engine.createList(actor(ctx), ctx.params.id, ctx.body));
  r.patch('/api/lists/:id', auth, ctx => engine.renameList(actor(ctx), ctx.params.id, ctx.body));
  r.post('/api/lists/:id/move', auth, ctx => engine.moveList(actor(ctx), ctx.params.id, ctx.body));
  r.del('/api/lists/:id', auth, ctx => engine.deleteList(actor(ctx), ctx.params.id));
};
