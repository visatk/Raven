import { Hono } from 'hono';
import { webhookCallback, Bot } from 'grammy';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { setupBot } from './bot';
import { Env, BotContext } from './types';
import { orders } from './db/schema';

const app = new Hono<{ Bindings: Env }>();

// 1. Telegram Webhook
app.post('/webhook', async (c) => {
  const bot = setupBot(c.env.TELEGRAM_BOT_TOKEN);
  bot.use(async (ctx: BotContext, next) => {
    ctx.env = c.env;
    ctx.db = drizzle(c.env.DB);
    await next();
  });
  const handler = webhookCallback(bot, 'hono');
  return handler(c);
});

// 2. Apirone Live Payment Webhook
app.post('/apirone-callback', async (c) => {
  const body = await c.req.json();
  
  // Apirone sends: { invoice: string, status: string, account: string }
  const invoiceId = body.invoice;
  const status = body.status;

  if (!invoiceId || !status) return c.text('*error*', 400);

  const db = drizzle(c.env.DB);
  
  // Find the order
  const order = await db.select().from(orders).where(eq(orders.invoiceId, invoiceId)).get();
  if (!order) return c.text('*ok*', 200); // Acknowledge to stop retries if order not found

  // Update order status in D1
  await db.update(orders).set({ status: status }).where(eq(orders.invoiceId, invoiceId)).run();

  // If the invoice is fully paid or completed, fulfill the order
  if (status === 'paid' || status === 'completed') {
    // Ensure we only notify once
    if (order.status !== 'paid' && order.status !== 'completed') {
      const bot = new Bot(c.env.TELEGRAM_BOT_TOKEN);
      
      const successMsg = `✅ **PAYMENT SUCCESSFUL**\n\n` +
        `Order #${order.id} for **${order.productName}** has been confirmed on the blockchain!\n\n` +
        `Please forward this message to the admin @rcpws to receive your digital assets instantly.`;
      
      try {
        await bot.api.sendMessage(order.telegramId, successMsg, { parse_mode: "Markdown" });
      } catch (err) {
        console.error("Failed to notify user via Telegram", err);
      }
    }
  }

  // Apirone requires strictly "*ok*" as plain text to acknowledge the callback
  return c.text('*ok*', 200);
});

export default app;
