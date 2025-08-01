async function smeltItem(bot, itemName, fuelName, furnacePos, count = 1) {
    // return if itemName or fuelName is not string
    if (typeof itemName !== "string" || typeof fuelName !== "string") {
        throw new Error("itemName or fuelName for smeltItem must be a string");
    }
    // return if count is not a number
    if (typeof count !== "number") {
        throw new Error("count for smeltItem must be a number");
    }
    if (!checkValidPosition(furnacePos, bot)){
        throw new Error("furnacePos for smeltItem is out of environment. Perhaps you forgot to account for the offset.");
    }
    const item = mcData.itemsByName[itemName];
    const fuel = mcData.itemsByName[fuelName];
    if (!item) {
        throw new Error(`No item named ${itemName}`);
    }
    if (!fuel) {
        throw new Error(`No item named ${fuelName}`);
    }
    const furnaceBlock = bot.blockAt(furnacePos);
    if (!furnaceBlock) {
        throw new Error("No furnace nearby");
    } else {
        await bot.pathfinder.goto(
            new GoalLookAtBlock(furnaceBlock.position, bot.world)
        );
    }
    const beforeInventory = getInventoryCountMap(bot);

    const furnace = await bot.openFurnace(furnaceBlock);
    for (let i = 0; i < count; i++) {
        if (!bot.inventory.findInventoryItem(item.id, null)) {
            await think(bot, `No ${itemName} to smelt in inventory`);
            break;
        }
        if (furnace.fuelSeconds < 15 && furnace.fuelItem()?.name !== fuelName) {
            if (!bot.inventory.findInventoryItem(fuel.id, null)) {
                await think(bot, `No ${fuelName} as fuel in inventory`);
                break;
            }
            await furnace.putFuel(fuel.id, null, 1);
            await bot.waitForTicks(20);
            if (!furnace.fuel && furnace.fuelItem()?.name !== fuelName) {
                throw new Error(`${fuelName} is not a valid fuel`);
            }
        }
        await furnace.putInput(item.id, null, 1);
        await bot.waitForTicks(12 * 20);
        if (!furnace.outputItem()) {
            throw new Error(`${itemName} is not a valid input`);
        }
        await furnace.takeOutput();
    }
    furnace.close();

    const afterInventory = getInventoryCountMap(bot);
    const producedItems = getProducedItems(beforeInventory, afterInventory);
    if (Object.keys(producedItems).length > 1){
        throw new Error(`Smelting record failed: unrelated items were picked up.`);
    }

    if (Object.keys(producedItems).length == 1){
        const producedItemName = Object.keys(producedItems)[0];
        const producedCount = producedItems[producedItemName];

        const consumedItems = getConsumedItems(beforeInventory, afterInventory);

        await think(bot, `Smelted ${itemName} into ${producedCount} ${producedItemName}(s).`);
        const msgObj = {
            name: "smeltItem",
            materialName: itemName,
            producedCount: producedCount,
            producedItemName: producedItemName,
            consumedItems: consumedItems,
            furnacePos: furnacePos,
        };
        bot.emit("event", dumpToJson(msgObj));
    }else {
        await think(bot, `Failed to smelt ${itemName}, please check the fuel and input.`);
        _smeltItemFailCount++;
        if (_smeltItemFailCount > 10) {
            throw new Error(
                `smeltItem failed too many times, please check the fuel and input.`
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