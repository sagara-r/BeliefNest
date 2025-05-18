async function craftItem(bot, name, craftingTablePos, count = 1) {
    // return if name is not string
    if (typeof name !== "string") {
        throw new Error("name for craftItem must be a string");
    }
    // return if count is not number
    if (typeof count !== "number") {
        throw new Error("count for craftItem must be a number");
    }
    if (!(craftingTablePos instanceof Vec3)) {
        throw new Error("craftingTablePos for craftItem must be a Vec3");
    }
    if (!checkValidPosition(craftingTablePos, bot)){
        throw new Error("craftingTablePos for craftItem is out of environment. Perhaps you forgot to account for the offset.");
    }
    const itemByName = mcData.itemsByName[name];
    if (!itemByName) {
        throw new Error(`No item named ${name}`);
    }
    
    const craftingTable = bot.blockAt(craftingTablePos);
    if (!craftingTable) {
        await think(bot, "Craft without a crafting table");
    } else {
        await bot.pathfinder.goto(
            new GoalLookAtBlock(craftingTable.position, bot.world)
        );
    }
    const recipe = bot.recipesFor(itemByName.id, null, 1, craftingTable)[0];
    if (recipe) {
        await think(bot, `I can make ${name}`);
        try {
            const beforeInventory = getInventoryCountMap(bot);
            await bot.craft(recipe, count, craftingTable);
            const afterInventory = getInventoryCountMap(bot);
            await think(bot, `I did the recipe for ${name} ${count} times`);
            const msgObj = {
                name: "craftItem",
                itemName: name,
                count: count,
                consumedItems: getConsumedItems(beforeInventory, afterInventory)
            };
            bot.emit("event", dumpToJson(msgObj));
        } catch (err) {
            await think(bot, `I cannot do the recipe for ${name} ${count} times`);
        }
    } else {
        await failedCraftFeedback(bot, name, itemByName, craftingTable);
        _craftItemFailCount++;
        if (_craftItemFailCount > 10) {
            throw new Error(
                "craftItem failed too many times, check chat log to see what happened"
            );
        }
    }
}


function getInventoryCountMap(bot) {
    const countMap = new Map();
    for (const item of bot.inventory.items()) {
      const key = item.name;
      countMap.set(key, (countMap.get(key) || 0) + item.count);
    }
    return countMap;
  }
  
  function getConsumedItems(beforeMap, afterMap) {
    const consumed = {};
    for (const [name, beforeCount] of beforeMap.entries()) {
      const afterCount = afterMap.get(name) || 0;
      if (afterCount < beforeCount) {
        consumed[name] = beforeCount - afterCount;
      }
    }
    return consumed;
  }