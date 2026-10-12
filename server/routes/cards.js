/* Cards and card details: labels, assignees, checklist, comments, link attachments. */
'use strict';
module.exports = function (r, { engine }) {
  const auth = { auth: true };
  const actor = ctx => ({ uid: ctx.user.id, clientId: String(ctx.req.headers['x-client-id'] || '').slice(0, 64) || null });
  r.post('/api/lists/:id/cards', auth, ctx => engine.createCard(actor(ctx), ctx.params.id, ctx.body));
  r.get('/api/cards/:id', auth, ctx => engine.card(ctx.user.id, ctx.params.id));
  r.patch('/api/cards/:id', auth, ctx => engine.updateCard(actor(ctx), ctx.params.id, ctx.body));
  r.post('/api/cards/:id/move', auth, ctx => engine.moveCard(actor(ctx), ctx.params.id, ctx.body));
  r.del('/api/cards/:id', auth, ctx => engine.deleteCard(actor(ctx), ctx.params.id));

  r.put('/api/cards/:id/labels/:labelId', auth, ctx => engine.setCardLabel(actor(ctx), ctx.params.id, ctx.params.labelId, true));
  r.del('/api/cards/:id/labels/:labelId', auth, ctx => engine.setCardLabel(actor(ctx), ctx.params.id, ctx.params.labelId, false));
  r.put('/api/cards/:id/assignees/:userId', auth, ctx => engine.setAssignee(actor(ctx), ctx.params.id, ctx.params.userId, true));
  r.del('/api/cards/:id/assignees/:userId', auth, ctx => engine.setAssignee(actor(ctx), ctx.params.id, ctx.params.userId, false));

  r.post('/api/cards/:id/checklist', auth, ctx => engine.addChecklistItem(actor(ctx), ctx.params.id, ctx.body));
  r.patch('/api/checklist/:id', auth, ctx => engine.updateChecklistItem(actor(ctx), ctx.params.id, ctx.body));
  r.del('/api/checklist/:id', auth, ctx => engine.deleteChecklistItem(actor(ctx), ctx.params.id));

  r.post('/api/cards/:id/comments', auth, ctx => engine.addComment(actor(ctx), ctx.params.id, ctx.body));
  r.del('/api/comments/:id', auth, ctx => engine.deleteComment(actor(ctx), ctx.params.id));
  r.post('/api/cards/:id/attachments', auth, ctx => engine.addAttachment(actor(ctx), ctx.params.id, ctx.body));
  r.del('/api/attachments/:id', auth, ctx => engine.deleteAttachment(actor(ctx), ctx.params.id));
};
