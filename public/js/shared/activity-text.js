/* Flowboard: turns an activity entry into a readable sentence. Shared by the browser (activity panel,
   card history) and the server (standup write-ups). Names are captured in `data` when the change happens. */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.FB = root.FB || {}; root.FB.activityText = mod; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = d => { if (!d) return ''; const [y, m, day] = String(d).split('-').map(Number); return `${day} ${MONTHS[m - 1]} ${y}`; };
  const q = s => `“${s == null ? '' : s}”`;

  function describe(type, d) {
    d = d || {};
    const card = q(d.card);
    switch (type) {
      case 'board.create': return 'created this board';
      case 'board.rename': return `renamed the board to ${q(d.to)}`;
      case 'board.color': return `changed the board colour to ${d.color}`;
      case 'member.add': return `added ${d.member} to the board`;
      case 'member.remove': return `removed ${d.member} from the board`;
      case 'member.leave': return 'left the board';
      case 'label.create': return `created the label ${q(d.label)}`;
      case 'label.update': return `updated the label ${q(d.label)}`;
      case 'label.delete': return `deleted the label ${q(d.label)}`;
      case 'list.create': return `added the list ${q(d.list)}`;
      case 'list.rename': return `renamed the list ${q(d.from)} to ${q(d.to)}`;
      case 'list.move': return `moved the list ${q(d.list)} to position ${d.index + 1}`;
      case 'list.delete': return `deleted the list ${q(d.list)}${d.count ? ` and its ${d.count} card${d.count === 1 ? '' : 's'}` : ''}`;
      case 'card.create': return `added ${card} to ${d.list}`;
      case 'card.rename': return `renamed ${q(d.from)} to ${q(d.to)}`;
      case 'card.move': return d.from === d.to ? `reordered ${card} in ${d.to}` : `moved ${card} from ${d.from} to ${d.to}`;
      case 'card.delete': return `deleted ${card} from ${d.list}`;
      case 'card.desc': return `updated the description of ${card}`;
      case 'card.due': return d.due ? `set the due date of ${card} to ${fmtDate(d.due)}` : `removed the due date from ${card}`;
      case 'card.block': return `marked ${card} as blocked`;
      case 'card.unblock': return `unblocked ${card}`;
      case 'card.label': return `added the label ${q(d.label)} to ${card}`;
      case 'card.unlabel': return `removed the label ${q(d.label)} from ${card}`;
      case 'card.assign': return d.self ? `joined ${card}` : `assigned ${d.member} to ${card}`;
      case 'card.unassign': return d.self ? `left ${card}` : `removed ${d.member} from ${card}`;
      case 'checklist.add': return `added ${q(d.item)} to the checklist on ${card}`;
      case 'checklist.check': return `completed ${q(d.item)} on ${card}`;
      case 'checklist.uncheck': return `marked ${q(d.item)} as not done on ${card}`;
      case 'checklist.edit': return `edited a checklist item on ${card}`;
      case 'checklist.delete': return `removed ${q(d.item)} from the checklist on ${card}`;
      case 'comment.add': return `commented on ${card}`;
      case 'comment.delete': return `deleted a comment on ${card}`;
      case 'attachment.add': return `attached ${q(d.title)} to ${card}`;
      case 'attachment.delete': return `removed the attachment ${q(d.title)} from ${card}`;
      default: return 'made a change';
    }
  }
  return { describe, fmtDate, MONTHS };
});
