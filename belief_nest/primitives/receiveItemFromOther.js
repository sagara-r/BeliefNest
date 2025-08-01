async function receiveItemFromOther(bot, othername, item, num) {
    maxDist = 3

    if (typeof othername !== "string") {
        throw new Error(`othername for receiveItemFromOther must be a string`);
    }
    if (typeof item !== "string") {
        throw new Error(`item for receiveItemFromOther must be a string`);
    }
    if (typeof num !== "number") {
        throw new Error(`num for receiveItemFromOther must be a number`);
    }

    const otherAgentName = othername;
    const otherMcName = bot.agentInfo[otherAgentName].mcName;

    if (!bot.players[otherMcName]?.entity){
        await think(bot, `player ${otherAgentName} not found.`);
        return false
    }
    if (otherMcName === bot.entity.username){
        await think(bot, `cannot receive items from myself.`);
        return false
    }
    other = bot.players[otherMcName]
    if (bot.entity.position.distanceTo(other.entity.position) > maxDist){
        await think(bot, `player ${otherAgentName} is too far to receive items.`);
        return false
    }

    const OBJ = `itemQuery`;
    bot.chat(`/scoreboard objectives add ${OBJ} dummy`);
    await bot.waitForTicks(1);

    let hasReset = false;

    const count = await new Promise(async (resolve, reject) => {
        const to = setTimeout(() => {
            bot.off('scoreUpdated', handler);
            reject(new Error('Failed to receive items.'));
        }, 10000);

        const handler = (scoreboard, boardItem) => {
            if(!hasReset){
                if(boardItem.value === -1){
                    hasReset = true
                }
                return;
            }
            
            if (scoreboard.name === OBJ && boardItem.name === bot.username) {
                bot.off('scoreUpdated', handler)
                clearTimeout(to)
                resolve(boardItem.value)
            }
        }
        bot.on('scoreUpdated', handler)

        bot.chat(`/scoreboard objectives setdisplay sidebar ${OBJ}`)
        bot.chat(`/scoreboard players set ${bot.username} ${OBJ} -2`) // dummy
        await bot.waitForTicks(1);
        bot.chat(`/scoreboard players set ${bot.username} ${OBJ} -1`) // to reset the board
        await bot.waitForTicks(5);
        bot.chat(`/execute store result score ${bot.username} ${OBJ} run clear ${otherMcName} ${item} 0`) // number of items
    })

    await bot.waitForTicks(1);
    bot.chat(`/scoreboard objectives setdisplay sidebar`)
    bot.chat(`/scoreboard players reset ${bot.username} ${OBJ}`)

    if(count < num){
        await think(bot, `${otherAgentName} doesn't have enough ${item} to give. (${count} < ${num})`);
        return false
    }
    
    await bot.waitForTicks(1);
    bot.chat(`/give ${bot.entity.username} ${item} ${num}`)
    await bot.waitForTicks(1);
    bot.chat(`/clear ${otherMcName} ${item} ${num}`)
    await think(bot, `I received ${num} ${item} from ${otherAgentName}.`)

    const msgObj = {
        name: "receiveItemFromOther",
        otherAgentName: otherAgentName,
        itemName: item,
        count: num,
    };
    bot.emit("event", dumpToJson(msgObj));

    await bot.waitForTicks(1);

    return true
}
