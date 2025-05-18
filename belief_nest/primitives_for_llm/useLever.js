async function turnOnLever(bot, leverPosition) {
    await goToPosition(bot, leverPosition);
    const block = bot.blockAt(leverPosition);
    const isOn = block.properties?.powered === 'true';
    if (isOn) {
        await think(bot, 'Lever is already on.');
        return;
    }
    await bot.activateBlock(block);
}
  
async function turnOffLever(bot, leverPosition) {
    await goToPosition(bot, leverPosition);
    const block = bot.blockAt(leverPosition);
    const isOff = block.properties?.powered === 'false';
    if (isOff) {
        await think(bot, 'Lever is already off.');
        return;
    }
    await bot.activateBlock(block);
}