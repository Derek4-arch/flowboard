/* Boards, members, labels, activity, standup and the live event stream. */
'use strict';
module.exports = function (r, { engine, realtime }) {
  const auth = { auth: true };
  const actor = ctx => ({ uid: ctx.user.id, clientId: String(ctx.req.headers['x-client-id'] || '').slice(0, 64) || null });

  r.get('/api/boards', auth, ctx => ({ boards: engine.listBoards(ctx.user.id) }));
  r.post('/api/boards', auth, ctx => engine.createBoard(actor(ctx), ctx.body));
  r.get('/api/boards/:id', auth, ctx => engine.board(ctx.user.id, ctx.params.id));
  r.patch('/api/boards/:id', auth, ctx => engine.updateBoard(actor(ctx), ctx.params.id, ctx.body));
  r.del('/api/boards/:id', auth, ctx => engine.deleteBoard(actor(ctx), ctx.params.id));
  r.put('/api/boards/:id/star', auth, ctx => engine.starBoard(ctx.user.id, ctx.params.id, ctx.body.starred !== false));

  r.post('/api/boards/:id/members', auth, ctx => engine.addMember(actor(ctx), ctx.params.id, ctx.body));
  r.del('/api/boards/:id/members/:userId', auth, ctx => engine.removeMember(actor(ctx), ctx.params.id, ctx.params.userId));

  r.post('/api/boards/:id/labels', auth, ctx => engine.createLabel(actor(ctx), ctx.params.id, ctx.body));
  r.patch('/api/labels/:id', auth, ctx => engine.updateLabel(actor(ctx), ctx.params.id, ctx.body));
  r.del('/api/labels/:id', auth, ctx => engine.deleteLabel(actor(ctx), ctx.params.id));

  r.get('/api/boards/:id/activity', auth, ctx => engine.activity(ctx.user.id, ctx.params.id, ctx.query));
  r.get('/api/boards/:id/standup', auth, ctx => engine.standup(ctx.user.id, ctx.params.id, ctx.query));

  // Server-Sent Events stream for live collaboration.
  r.get('/api/boards/:id/events', auth, ctx => {
    if (!engine.canView(ctx.params.id, ctx.user.id)) throw new engine.UserError('Board not found.', undefined, 404);
    realtime.subscribe(ctx.params.id, ctx.user, String(ctx.query.clientId || '').slice(0, 64), ctx.req, ctx.res);
  });
};
