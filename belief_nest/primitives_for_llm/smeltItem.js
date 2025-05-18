// Smelt 1 raw_iron into 1 iron_ingot using 1 oak_planks as fuel at furnace vec3(0, 40, 0):
// const furnacePos = new Vec3(0, 40, 0);
// smeltItem(bot, "raw_iron", "oak_planks", furnacePos);
// You must place a furnace before calling this function
async function smeltItem(bot, itemName, fuelName, furnacePos, count = 1) {
    const item = mcData.itemsByName[itemName];
    const fuel = mcData.itemsByName[fuelName];
    const furnaceBlock = bot.blockAt(furnacePos);
    await bot.pathfinder.goto(
        new GoalLookAtBlock(furnaceBlock.position, bot.world)
    );
    const furnace = await bot.openFurnace(furnaceBlock);
    for (let i = 0; i < count; i++) {
        await furnace.putFuel(fuel.id, null, 1);
        await furnace.putInput(item.id, null, 1);
        // Wait 12 seconds for the furnace to smelt the item
        await bot.waitForTicks(12 * 20);
        await furnace.takeOutput();
    }
    await furnace.close();
}
