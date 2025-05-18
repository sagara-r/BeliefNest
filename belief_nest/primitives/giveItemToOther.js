async function giveItemToOther(bot, othername, item, num) {
    maxDist = 3

    if (typeof othername !== "string") {
        throw new Error(`othername for giveItemToOther must be a string`);
    }
    if (typeof item !== "string") {
        throw new Error(`item for giveItemToOther must be a string`);
    }
    if (typeof num !== "number") {
        throw new Error(`num for giveItemToOther must be a number`);
    }

    const otherAgentName = othername;
    const otherMcName = bot.agentInfo[otherAgentName].mcName;

    if (!bot.players[otherMcName]?.entity){
        await think(bot, `player ${otherAgentName} not found.`);
        return false
    }
    if (otherMcName === bot.entity.username){
        await think(bot, `cannot give item to myself.`);
        return false
    }
    other = bot.players[otherMcName]
    if (bot.entity.position.distanceTo(other.entity.position) > maxDist){
        await think(bot, `player ${otherAgentName} is too far to give items.`);
        return false
    }

    function itemToDict(acc, cur) {
        if (cur.name && cur.count) {
            //if both name and count property are defined
            if (acc[cur.name]) {
                //if the item is already in the dict
                acc[cur.name] += cur.count;
            } else {
                //if the item is not in the dict
                acc[cur.name] = cur.count;
            }
        }
        return acc;
    }

    const itemdict = bot.inventory.items().reduce(itemToDict, {});
    num_in_inventory = itemdict[item]
    if(!num_in_inventory || num_in_inventory < num){
        await think(bot, `I don't have enough ${item} to give ${otherAgentName}.`);
        return false
    }
    
    bot.chat(`/clear ${bot.entity.username} ${item} ${num}`)
    bot.chat(`/give ${otherMcName} ${item} ${num}`)
    await think(bot, `I gave ${num} ${item} to ${otherAgentName}.`)

    const msgObj = {
        name: "giveItemToOther",
        otherAgentName: otherAgentName,
        itemName: item,
        count: num,
    };
    bot.emit("event", dumpToJson(msgObj));

    return true
}
