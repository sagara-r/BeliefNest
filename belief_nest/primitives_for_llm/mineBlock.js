// Mine cobblestone at (0, 41, 8): mineBlock(bot, new Vec3(0, 41, 8), "cobblestone");
async function mineBlock(bot, blockPosition, blockName) {
    const block = bot.blockAt(blockPosition);
    if (block.name !== blockName){
        await think(bot, `The block at ${position} is not ${blockName}`)
        return
    }
    await bot.pathfinder.goto(
        new GoalLookAtBlock(blockPosition, bot.world, {})
    );
    const targets = [bot.blockAt(blockPosition)];
    await bot.collectBlock.collect(targets, { ignoreNoPath: true });
}
