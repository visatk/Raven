import { Hono } from 'hono';
import { webhookCallback, Bot } from 'grammy';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { setupBot } from './bot';
import { Env, BotContext } from './types';
import { orders } from './db/schema';

const app = new Hono<{ Bindings: Env }>();

app.post('/webhook', async (c) => {
  const bot = setupBot(c.env.TELEGRAM_BOT_TOKEN);
  bot.use(async (ctx: BotContext, next) => {
    ctx.env = c.env;
    ctx.db = drizzle(c.env.DB);
    await next();
  });
  return webhookCallback(bot, 'hono')(c);
});

// Secured Apirone Webhook
app.post('/apirone-callback', async (c) => {
  const secret = c.req.query('secret');
  const body = await c.req.json();
  
  const invoiceId = body.invoice;
  const status = body.status;

  if (!invoiceId || !status || !secret) return c.text('*error*', 400);

  const db = drizzle(c.env.DB);
  const order = await db.select().from(orders).where(eq(orders.invoiceId, invoiceId)).get();
  
  // Acknowledge unknown invoices to stop Apirone retries
  if (!order) return c.text('*ok*', 200); 

  // Security Check: Validate the secret[cite: 4]
  if (order.callbackSecret !== secret) return c.text('*error*', 403);

  // Update order status
  await db.update(orders).set({ status: status }).where(eq(orders.invoiceId, invoiceId)).run();

  // Handle successful payment states[cite: 2]
  if (status === 'paid' || status === 'completed') {
    if (order.status !== 'paid' && order.status !== 'completed') {
      const bot = new Bot(c.env.TELEGRAM_BOT_TOKEN);
      
      const successMsg = `✅ **PAYMENT CONFIRMED**\n\n` +
        `Order \`#${order.id}\` for **${order.productName}** is successful!\n\n` +
        `Forward this message to @drkingbd to receive your assets instantly.`;
      
      try {
        await bot.api.sendMessage(order.telegramId, successMsg, { parse_mode: "Markdown" });
      } catch (err) {
        console.error("Telegram delivery failed", err);
      }
    }
  }

  // Apirone requires strictly "*ok*" to acknowledge
  return c.text('*ok*', 200);
});

export default app;
