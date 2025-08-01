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

    let craftedCount = 0;
    const recipe = bot.recipesFor(itemByName.id, null, 1, craftingTable)[0];
    if (recipe) {
        await think(bot, `I can make ${name}`);
        await bot.waitForTicks(1);
        const beforeInventory = getInventoryCountMap(bot);
        try {
            for(let i = 0; i < count; i++){
                await bot.craft(recipe, 1, craftingTable);
                await bot.waitForTicks(1);
                craftedCount++;
            }
        } catch (err) {
            // shortage of ingredients
            ;
        } 

        if(craftedCount){
            const afterInventory = getInventoryCountMap(bot);
            await think(bot, `I did the recipe for ${name} ${craftedCount} times`);
            await bot.waitForTicks(1);
            const msgObj = {
                name: "craftItem",
                itemName: name,
                producedCount: getProducedItems(beforeInventory, afterInventory)[name],
                consumedItems: getConsumedItems(beforeInventory, afterInventory),
                craftingTablePos: craftingTablePos,
            };
            bot.emit("event", dumpToJson(msgObj));
        } else {
            await think(bot, `I cannot do the recipe for ${name}`);
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

function getProducedItems(beforeMap, afterMap) {
    const produced = {};
    for (const [name, afterCount] of afterMap.entries()) {
        const beforeCount = beforeMap.get(name) || 0;
        if (afterCount > beforeCount) {
            produced[name] = afterCount - beforeCount;
        }
    }
    return produced;
}
