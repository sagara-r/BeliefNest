async function getItemFromChest(bot, chestPosition, itemsToGet) {
    // return if chestPosition is not Vec3
    if (!(chestPosition instanceof Vec3)) {
        throw new Error("chestPosition for getItemFromChest must be a Vec3");
    }
    if (!checkValidPosition(chestPosition, bot)){
        throw new Error("chestPosition for getItemFromChest is out of environment. Perhaps you forgot to account for the offset.");
    }
    await moveToChest(bot, chestPosition);
    const chestBlock = bot.blockAt(chestPosition);
    const chest = await bot.openContainer(chestBlock);
    const initialItems = getInventoryDict()
    const initialEquipment = getEquipment()
    let gotItems = {};
    for (const name in itemsToGet) {
        const itemByName = mcData.itemsByName[name];
        if (!itemByName) {
            await think(bot, `No item named ${name}`);
            continue;
        }

        const item = chest.findContainerItem(itemByName.id);
        if (!item) {
            await think(bot, `I don't see ${name} in this chest`);
            continue;
        }
        try {
            await chest.withdraw(item.type, null, itemsToGet[name]);
            gotItems[name] = itemsToGet[name];
        } catch (err) {
            await think(bot, `Not enough ${name} in chest.`);
        }
    }
    await bot.waitForTicks(40)
    const chestItems = await closeChest(bot, chestBlock);
    
    await restoreInitialInventory(bot, initialItems, initialEquipment)
    for(const name in gotItems){
        bot.chat(`/give @s ${name} ${gotItems[name]}`)
        await bot.waitForTicks(1)
    }

    const msgObj = {
        name: "getItemFromChest",
        chestPos: chestPosition.minus(bot.offsetVec3),
        gotItems: gotItems,
        chestItems: chestItems
    }
    bot.emit("event", dumpToJson(msgObj));
}

async function depositItemIntoChest(bot, chestPosition, itemsToDeposit) {
    // return if chestPosition is not Vec3
    if (!(chestPosition instanceof Vec3)) {
        throw new Error(
            "chestPosition for depositItemIntoChest must be a Vec3"
        );
    }
    if (!checkValidPosition(chestPosition, bot)){
        throw new Error("chestPosition for depositItemIntoChest is out of environment. Perhaps you forgot to account for the offset.");
    }
    await moveToChest(bot, chestPosition);
    const chestBlock = bot.blockAt(chestPosition);
    const chest = await bot.openContainer(chestBlock);
    const initialItems = getInventoryDict()
    const initialEquipment = getEquipment()
    let depositedItems = {};
    for (const name in itemsToDeposit) {
        const itemByName = mcData.itemsByName[name];
        if (!itemByName) {
            await think(bot, `No item named ${name}`);
            continue;
        }
        const item = bot.inventory.findInventoryItem(itemByName.id);
        if (!item) {
            await think(bot, `No ${name} in inventory`);
            continue;
        }
        try {
            await chest.deposit(item.type, null, itemsToDeposit[name]);
            depositedItems[name] = itemsToDeposit[name];
        } catch (err) {
            await think(bot, `Not enough ${name} in inventory.`);
        }
    }
    await bot.waitForTicks(40)
    const chestItems = await closeChest(bot, chestBlock);

    await restoreInitialInventory(bot, initialItems, initialEquipment)
    for(const name in depositedItems){
        bot.chat(`/clear @s ${name} ${depositedItems[name]}`)
        await bot.waitForTicks(1)
    }

    const msgObj = {
        name: "depositItemIntoChest",
        chestPos: chestPosition.minus(bot.offsetVec3),
        depositedItems: depositedItems,
        chestItems: chestItems
    };
    bot.emit("event", dumpToJson(msgObj));
}

async function moveToChest(bot, chestPosition) {
    if (!(chestPosition instanceof Vec3)) {
        throw new Error(
            "chestPosition for moveToChest must be a Vec3"
        );
    }
    if (!checkValidPosition(chestPosition, bot)){
        throw new Error("chestPosition for moveToChest is out of environment. Perhaps you forgot to account for the offset.");
    }
    const chestBlock = bot.blockAt(chestPosition);
    await bot.pathfinder.goto(
        new GoalLookAtBlock(chestBlock.position, bot.world, {})
    );
    if (chestBlock.name !== "chest") {
        //bot.emit("removeChest", chestPosition);
    }
    return chestBlock;
}

async function listItemsInChest(bot, chestBlock) {
    const chest = await bot.openContainer(chestBlock);
    const items = chest.containerItems();
    const itemDict = items.reduce((acc, obj) => {
        if (acc[obj.name]) {
            acc[obj.name] += obj.count;
        } else {
            acc[obj.name] = obj.count;
        }
        return acc;
    }, {});
    return itemDict;
}

async function closeChest(bot, chestBlock) {
    let itemDict = {};
    try {
        itemDict = await listItemsInChest(bot, chestBlock);
        const chest = await bot.openContainer(chestBlock);
        await chest.close();
    } catch (err) {
        await bot.closeWindow(chestBlock);
    }
    await bot.waitForTicks(5) // Prevent chests from remaining open
    return itemDict;
}

function itemByName(items, name) {
    for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        if (item && item.name === name) return item;
    }
    return null;
}

function getInventoryDict(){
    let inventoryDict = {}
    bot.inventory.items().forEach(item => {
        if(!inventoryDict[item.name]){
            inventoryDict[item.name] = 0
        }
        inventoryDict[item.name] += item.count
    });
    return inventoryDict
}

function itemToObs(item) {
    if (!item) return null;
    return item.name;
}

function getEquipment() {
    const slots = bot.inventory.slots;
    const mainHand = bot.heldItem;
    return slots
        .slice(5, 9)
        .concat(mainHand, slots[45])
        .map(itemToObs);
}

async function restoreInitialInventory(bot, initialItems, initialEquipment){
    bot.chat(`/clear @s`)
    await bot.waitForTicks(1)
    bot.chat(`/give @s fishing_rod{display:{Name:'[{"text":"dummy item"}]'}} 36`)
    await bot.waitForTicks(1)
    bot.chat(`/clear @s`)
    await bot.waitForTicks(1)
    for(const name in initialItems){
        let count = initialItems[name]
        bot.chat(`/give @s ${name} ${count}`)
        await bot.waitForTicks(1)
    }

    const equipmentNames = [
        "armor.head",
        "armor.chest",
        "armor.legs",
        "armor.feet",
        "weapon.mainhand",
        "weapon.offhand",
    ];
    for (let i = 0; i < 6; i++) {
        if (i === 4) continue;
        if (initialEquipment[i]) {
            bot.chat(
                `/item replace entity @s ${equipmentNames[i]} with minecraft:${initialEquipment[i]}`
            );
            await bot.waitForTicks(1)
        }
    }
}