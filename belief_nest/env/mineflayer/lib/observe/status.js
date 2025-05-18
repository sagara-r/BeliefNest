const { roundVec3 } = require("../utils");

function getStatus(bot) {
    let status = {}
    for(const agentName in bot.agentInfo){
        const mcName = bot.agentInfo[agentName].mcName;
        const player = bot.players[mcName];
        const relativePos = player.entity.position.minus(bot.offsetVec3);

        status[agentName] = {
            visible: {
                position: roundVec3(relativePos, 3),
                velocity: roundVec3(player.entity.velocity, 3),
                yaw: Math.round(player.entity.yaw*100)/100,
                pitch: Math.round(player.entity.pitch*100)/100,
                onGround: player.entity.onGround,
                equipment: bot.additionalStatus[agentName]?.equipment,
                isInWater: player.entity.isInWater,
                isInLava: player.entity.isInLava,
                isInWeb: player.entity.isInWeb,
            },
            hidden: {
                inventory: bot.additionalStatus[agentName]?.inventory,
                health: bot.additionalStatus[agentName]?.health,
                food: bot.additionalStatus[agentName]?.food,
                saturation: bot.additionalStatus[agentName]?.saturation,
                oxygen: bot.additionalStatus[agentName]?.oxygen,
                isCollidedHorizontally: player.entity.isCollidedHorizontally,
                isCollidedVertically: player.entity.isCollidedVertically,
                biome: bot.blockAt(relativePos)
                        ? bot.blockAt(relativePos).biome.name
                        : "None",
                timeOfDay: _getTime(bot),      
            }
            
        };
    }
    return status;
}

function getMyAdditionalStatus(bot){
    return {
        equipment: _getEquipment(bot),
        inventory: _listItems(bot),
        health: bot.health,
        food: bot.food,
        saturation: bot.foodSaturation,
        oxygen: bot.oxygenLevel !== undefined ? bot.oxygenLevel : null,
    }
}

function _getTime(bot) {
    const timeOfDay = bot.time.timeOfDay;
    let time = "";
    if (timeOfDay < 1000) {
        time = "sunrise";
    } else if (timeOfDay < 6000) {
        time = "day";
    } else if (timeOfDay < 12000) {
        time = "noon";
    } else if (timeOfDay < 13000) {
        time = "sunset";
    } else if (timeOfDay < 18000) {
        time = "night";
    } else if (timeOfDay < 22000) {
        time = "midnight";
    } else {
        time = "sunrise";
    }
    return time;
}

function _getEquipment(bot) {
    const slots = bot.inventory.slots;
    const mainHand = bot.heldItem;
    return slots
        .slice(5, 9)
        .concat(mainHand, slots[45])
        .map(_itemToObs);
}

function _itemToObs(item) {
    if (!item) return null;
    return item.name;
}

function _listItems(bot) {
    const items = _getInventoryItems(bot);
    return items.reduce(_itemToDict, {});
}

function _getInventoryItems(bot) {
    const inventory = bot.currentWindow || bot.inventory;
    return inventory.items();
}

function _itemToDict(acc, cur) {
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

module.exports = { getStatus, getMyAdditionalStatus };
