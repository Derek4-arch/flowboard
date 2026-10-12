/* Accounts: sign up, sign in, sign out, current user. */
'use strict';
module.exports = function (r, { engine, http, config }) {
  const signupLimit = http.rateLimiter(20, 3600e3);
  const loginLimit = http.rateLimiter(10, 15 * 60e3);
  const COOKIE = 'fb_sid';
  const setSession = (ctx, user) => {
    const token = engine.createSession(user.id);
    const secure = config.cookieSecure === '1' || config.cookieSecure === 'true' || (config.cookieSecure === 'auto' && http.isHttps(ctx.req));
    ctx.cookies.push(http.cookie(COOKIE, token, { maxAge: config.sessionDays * 86400, secure }));
  };

  r.get('/api/me', ctx => ({ user: ctx.user || null }));

  r.post('/api/auth/signup', ctx => {
    if (!signupLimit.hit(ctx.ip)) throw new engine.UserError('Too many sign-ups from this computer. Please try again later.', undefined, 429);
    const user = engine.register(ctx.body);
    setSession(ctx, user);
    return { user };
  });

  r.post('/api/auth/signin', ctx => {
    const email = String(ctx.body.email || '').trim().toLowerCase();
    if (!loginLimit.hit(ctx.ip + '|' + email)) throw new engine.UserError('Too many sign-in attempts. Wait 15 minutes and try again.', undefined, 429);
    if (!email || !ctx.body.password) throw new engine.UserError(!email ? 'Enter your email address.' : 'Enter your password.', !email ? 'email' : 'password');
    const user = engine.authenticate(email, ctx.body.password);
    if (!user) throw new engine.UserError('That email and password combination is incorrect.', 'password', 401, 'bad_credentials');
    loginLimit.reset(ctx.ip + '|' + email);
    setSession(ctx, user);
    return { user };
  });

  r.post('/api/auth/signout', ctx => {
    engine.deleteSession(ctx.token);
    ctx.cookies.push(http.cookie(COOKIE, '', { maxAge: 0 }));
    return {};
  });
};
