import { Bot, InlineKeyboard } from 'grammy';
import { BotContext } from './types';
import { users, orderIntents } from './db/schema';
import { adminGuard } from './middleware/admin';
import { CATEGORIES, getProductById } from './catalog';

export function setupBot(token: string): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  // --- STANDARD MIDDLEWARE ---
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

  // --- UI COMPONENTS ---
  const buildMainMenu = () => {
    const keyboard = new InlineKeyboard();
    Object.entries(CATEGORIES).forEach(([key, cat]) => {
      keyboard.text(cat.title, `cat_${key}`).row();
    });
    return keyboard;
  };

  const buildCategoryMenu = (categoryKey: keyof typeof CATEGORIES) => {
    const category = CATEGORIES[categoryKey];
    const keyboard = new InlineKeyboard();
    category.products.forEach(p => {
      keyboard.text(`${p.name} - $${p.price}`, `prod_${p.id}`).row();
    });
    keyboard.text("🔙 Back to Categories", "menu_main");
    return keyboard;
  };

  // --- COMMANDS ---
  bot.command(['start', 'shop'], async (ctx) => {
    const welcomeText = `👋 **Welcome to the Premium Digital Store**\n\n` +
      `Browse our high-quality digital assets below.\n` +
      `⚡️ *Limited Stock: First Come & First Get*\n\n` +
      `Join our official community: @drkingbd`;

    await ctx.reply(welcomeText, {
      parse_mode: "Markdown",
      reply_markup: buildMainMenu()
    });
  });

  // --- CALLBACK QUERY ROUTERS (Button Clicks) ---
  
  // Handle Main Menu Navigation
  bot.callbackQuery('menu_main', async (ctx) => {
    await ctx.editMessageText("🛍 **Select a Category:**", {
      parse_mode: "Markdown",
      reply_markup: buildMainMenu()
    });
    await ctx.answerCallbackQuery();
  });

  // Handle Category Selection
  bot.callbackQuery(/cat_(.+)/, async (ctx) => {
    const categoryKey = ctx.match[1] as keyof typeof CATEGORIES;
    if (!CATEGORIES[categoryKey]) return ctx.answerCallbackQuery("Category not found.");

    await ctx.editMessageText(`📂 **${CATEGORIES[categoryKey].title}**\nSelect a product to view details:`, {
      parse_mode: "Markdown",
      reply_markup: buildCategoryMenu(categoryKey)
    });
    await ctx.answerCallbackQuery();
  });

  // Handle Product Selection
  bot.callbackQuery(/prod_(.+)/, async (ctx) => {
    const productId = ctx.match[1];
    const product = getProductById(productId);
    
    if (!product) return ctx.answerCallbackQuery("Product not found.");

    // Log the intent for admin analytics via Edge DB
    if (ctx.from) {
      await ctx.db.insert(orderIntents).values({
        telegramId: ctx.from.id,
        productId: product.id,
        productName: product.name,
        price: product.price
      }).run();
    }

    let details = `🧾 **Product Details**\n\n`;
    details += `📦 **Item:** ${product.name}\n`;
    details += `💵 **Price:** $${product.price}\n`;
    if (product.bulkPrice) details += `🤝 **Bulk Price:** $${product.bulkPrice} (10+ orders)\n`;
    details += `🛡 **Warranty:** ${product.warranty}\n`;
    if (product.notes) details += `📝 **Note:** ${product.notes}\n\n`;
    
    details += `━━━ **HOW TO BUY** ━━━\n`;
    details += `📣 **DM @rcpws to purchase.**\n`;
    details += `🌐 *Official updates: @drkingbd*`;

    const backKeyboard = new InlineKeyboard().text("🔙 Browse More Products", "menu_main");

    await ctx.editMessageText(details, {
      parse_mode: "Markdown",
      reply_markup: backKeyboard
    });
    await ctx.answerCallbackQuery();
  });

  // --- ADMIN SYSTEM ---
  const adminBot = bot.filter((ctx) => true);
  adminBot.use(adminGuard);

  adminBot.command('intents', async (ctx) => {
    const intents = await ctx.db.select().from(orderIntents).orderBy(orderIntents.createdAt).limit(10).all();
    if (intents.length === 0) return ctx.reply("No purchase intents logged yet.");
    
    let msg = "📊 **Recent Purchase Clicks:**\n\n";
    intents.forEach(i => {
      msg += `- User ${i.telegramId} clicked **${i.productName}** ($${i.price})\n`;
    });
    
    await ctx.reply(msg, { parse_mode: "Markdown" });
  });

  return bot;
}
