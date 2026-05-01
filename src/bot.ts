import { Bot } from 'grammy';
import { BotContext } from './types';
import { adminGuard } from './middleware/admin';
import { users } from './db/schema';

export function setupBot(token: string): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  // --- STANDARD MIDDLEWARE ---
  // Register user automatically on first interaction
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      await ctx.db.insert(users).values({
        telegramId: ctx.from.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
      }).onConflictDoNothing().run();
    }
    await next();
  });

  // --- PUBLIC COMMANDS ---
  bot.command('start', async (ctx) => {
    await ctx.reply(
      "🚀 **RavenHQ Universal Engine Initialized.**\n\n" +
      "I am a highly scalable edge-native bot.\n" +
      "Updates and official community: @drkingbd",
      { parse_mode: "Markdown" }
    );
  });

  // --- ADMIN COMMANDS (Protected by adminGuard) ---
  const adminBot = bot.filter((ctx) => true); // Create a sub-router
  adminBot.use(adminGuard);

  adminBot.command('stats', async (ctx) => {
    // Requires Drizzle aggregation query in real production
    const allUsers = await ctx.db.select().from(users).all();
    await ctx.reply(`📊 **Bot Statistics**\n\nTotal Users: ${allUsers.length}`, { parse_mode: "Markdown" });
  });

  adminBot.command('broadcast', async (ctx) => {
    const message = ctx.match;
    if (!message) return ctx.reply("Usage: /broadcast <message>");
    
    // In a real scenario, use Cloudflare Queues for bulk broadcasting
    await ctx.reply("Broadcast queued (Integration with Cloudflare Queues pending).");
  });

  return bot;
}
