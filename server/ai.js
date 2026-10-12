/* Optional AI write-ups for Standup Mode via any OpenAI-compatible /chat/completions endpoint
   (OpenAI, Azure OpenAI-compatible proxies, OpenRouter, Groq, Together, Ollama's /v1, LM Studio …).
   Configure AI_API_KEY, AI_BASE_URL and AI_MODEL in .env. Only card titles, list names, member names
   and counts are sent (no emails, passwords or descriptions). */
'use strict';

function createAI(config) {
  const A = {};
  A.configured = () => !!config.ai.key;

  A.facts = function (rep) {
    const slim = r => ({ title: r.title, list: r.list, assignees: r.assignees, due: r.due || undefined, overdueDays: r.overdueDays || undefined, labels: r.labels.length ? r.labels : undefined });
    return {
      board: rep.board.name, windowHours: rep.hours, today: rep.today, stats: rep.stats,
      done: rep.done.map(slim), inProgress: rep.inProgress.map(slim), blocked: rep.blocked.map(slim), overdue: rep.overdue.map(slim), dueToday: (rep.dueToday || []).map(slim),
      moves: rep.moves.slice(-20).map(m => ({ card: m.card, from: m.from, to: m.to, by: m.by })),
      needsOwner: rep.needsOwner.map(r => r.title),
      people: rep.people.map(p => ({ name: p.name, focusScore: p.focus.score, focusLevel: p.focus.level, openCards: p.focus.open, overdueCards: p.focus.overdue, cardsTouched24h: p.focus.switches, done: p.done.map(r => r.title), workingOn: p.inProgress.map(r => r.title), blocked: p.blocked.map(r => r.title), overdue: p.overdue.map(r => r.title) }))
    };
  };

  A.writeStandup = async function (rep) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), config.ai.timeoutMs);
    try {
      const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.key}` },
        body: JSON.stringify({
          model: config.ai.model, temperature: 0.3, max_tokens: 900,
          messages: [
            { role: 'system', content: 'You write concise, friendly daily standup summaries for a product team from kanban board data. Use ONLY the facts provided; never invent cards, people or dates. Output Markdown with these sections in order: "## Summary" (2–3 sentences on momentum and risks), "## Done", "## In progress", "## Blocked" (suggest one concrete next step per blocked card), "## Overdue", "## Team focus" (one bullet per person with their focus score and a short, kind recommendation). Use "- " bullets, keep it under 300 words, no tables, no emojis.' },
            { role: 'user', content: 'Board activity facts (JSON):\n' + JSON.stringify(A.facts(rep)) }
          ]
        })
      });
      if (!res.ok) throw new Error(`AI endpoint returned HTTP ${res.status}`);
      const j = await res.json();
      const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!text || typeof text !== 'string') throw new Error('AI endpoint returned no text');
      return text.slice(0, 8000);
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('AI request timed out');
      throw new Error(e.message && /fetch failed|ECONNREFUSED|ENOTFOUND/.test(e.message) ? 'AI endpoint unreachable' : e.message);
    } finally { clearTimeout(timer); }
  };
  return A;
}
module.exports = { createAI };
