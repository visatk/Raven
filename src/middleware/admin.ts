import { NextFunction } from "grammy";
import { eq } from "drizzle-orm";
import { BotContext } from "../types";
import { users } from "../db/schema";

/**
 * Enterprise-grade authorization middleware.
 * Verifies user existence in D1 and attaches role to context.
 */
export async function requireAdmin(ctx: BotContext, next: NextFunction) {
  if (!ctx.from) return;

  const userRecord = await ctx.db.select().from(users).where(eq(users.telegramId, ctx.from.id)).get();
  
  if (!userRecord || (userRecord.role !== 'admin' && userRecord.role !== 'superadmin')) {
    await ctx.reply("⛔️ Unauthorized: This command requires administrative privileges.");
    return;
  }

  ctx.userRole = userRecord.role;
  await next();
}
