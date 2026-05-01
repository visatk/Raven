import { Hono } from 'hono';
import { webhookCallback } from 'grammy';
import { drizzle } from 'drizzle-orm/d1';
import { setupBot } from './bot';
import { Env, BotContext } from './types';

const app = new Hono<{ Bindings: Env }>();

// Webhook endpoint for Telegram
app.post('/webhook', async (c) => {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  if (!token) return c.json({ error: 'Missing Bot Token' }, 500);

  const bot = setupBot(token);

  // Inject bindings into the grammY context BEFORE processing
  bot.use(async (ctx: BotContext, next) => {
    ctx.env = c.env;
    ctx.db = drizzle(c.env.DB);
    await next();
  });

  // Adapt grammY's webhook callback to work with Hono
  const handler = webhookCallback(bot, 'hono');
  return handler(c);
});

// Setup route to easily register the webhook with Telegram
app.get('/setup', async (c) => {
  const url = new URL(c.req.url);
  const webhookUrl = `${url.protocol}//${url.host}/webhook`;
  
  const response = await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
  const data = await response.json();
  
  return c.json({
    status: 'Webhook configured',
    webhookUrl,
    telegramResponse: data
  });
});

export default app;
