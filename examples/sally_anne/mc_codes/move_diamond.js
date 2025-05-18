await getItemFromChest(bot, new Vec3(-2, -51, -4), {'diamond': 1});
await bot.waitForTicks(20);
await depositItemIntoChest(bot, new Vec3(2, -51, -4), {'diamond': 1});
