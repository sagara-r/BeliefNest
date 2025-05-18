// Craft 8 oak_planks from 2 oak_log at craftingTable vec3(0, 40, 0) (do the recipe 2 times): 
// const craftingTablePos = new Vec3(0, 40, 0);
// craftItem(bot, "oak_planks", craftingTablePos, 2);
// You must place a crafting table before calling this function
async function craftItem(bot, name, craftingTablePos, count = 1) {
    const item = mcData.itemsByName[name];

    await bot.pathfinder.goto(
        new GoalLookAtBlock(craftingTablePos, bot.world)
    );
    const craftingTable = bot.blockAt(craftingTablePos);
    const recipe = bot.recipesFor(item.id, null, 1, craftingTable)[0];
    await bot.craft(recipe, count, craftingTable);
}
