async function turnOnLever(bot, leverPosition) {
    if (!checkValidPosition(leverPosition, bot)){
        throw new Error("leverPosition for turnOnLever is out of environment. Perhaps you forgot to account for the offset.");
    }
    await goToPosition(bot, leverPosition);
    const block = bot.blockAt(leverPosition);
    if (!block || block.name !== 'lever') {
        await think(bot, 'Lever not found.');
        return;
    }
  
    const isOn = block.getProperties()?.powered === 'true';
    if (isOn) {
        await think(bot, 'Lever is already on.');
        return;
    }
  
    try {
        await bot.activateBlock(block);
    } catch (err) {
        await think(bot, 'Failed to turn on lever.');
        return;
    }

    const msgObj = {
        name: "useLever",
        leverPos: leverPosition.minus(bot.offsetVec3),
        type: "turn_on",
    }
    bot.emit("event", dumpToJson(msgObj));
}
  
async function turnOffLever(bot, leverPosition) {
    if (!checkValidPosition(leverPosition, bot)){
        throw new Error("leverPosition for turnOffLever is out of environment. Perhaps you forgot to account for the offset.");
    }
    await goToPosition(bot, leverPosition);
    const block = bot.blockAt(leverPosition);
    if (!block || block.name !== 'lever') {
        await think(bot, 'Lever not found.');
        return;
    }
  
    const isOff = block.getProperties()?.powered === 'false';
    if (isOff) {
        await think(bot, 'Lever is already off.');
        return;
    }
  
    try {
        await bot.activateBlock(block);
    } catch (err) {
        await think(bot, 'Failed to turn off lever.');
        return;
    }

    const msgObj = {
        name: "useLever",
        leverPos: leverPosition.minus(bot.offsetVec3),
        type: "turn_off",
    }
    bot.emit("event", dumpToJson(msgObj));
}
  