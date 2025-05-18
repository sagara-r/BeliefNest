async function mineBlock(bot, blockPosition, blockName) {
    if (!(blockPosition instanceof Vec3)) {
        throw new Error(`blockPosition for mineBlock must be a Vec3`);
    }
    if (typeof blockName !== "string") {
        throw new Error(`name for mineBlock must be a string`);
    }
    if (!checkValidPosition(blockPosition, bot)){
        throw new Error("blockPosition for mineBlock is out of environment. Perhaps you forgot to account for the offset.");
    }
    
    const blockByName = mcData.blocksByName[blockName];
    if (!blockByName) {
        throw new Error(`No block named ${blockName}`);
    }

    const block = bot.blockAt(blockPosition);
    if (block.name !== blockName){
        await think(bot, `The block at ${blockPosition} is not ${blockName}`)
        return
    }

    await bot.pathfinder.goto(
        new GoalLookAtBlock(blockPosition, bot.world, {})
    );

    /* pick up a dropped item */
    let targetEntity;
    function onDrop(entity){
        if (entity.position.distanceTo(block.position.offset(0.5, 0.5, 0.5)) <= 0.5) {
            targetEntity = entity;
        }
    }
    bot.on('itemDrop', onDrop);

    await bot.dig(block);
    const timeoutHandler = setTimeout(()=>{
        throw new Error(`mineBlock timeout`);
    }, 5000);

    while(!targetEntity){
        await bot.waitForTicks(10);
    }
    clearInterval(timeoutHandler);
    bot.removeListener('itemDrop', onDrop);

    await bot.pathfinder.goto(
        new GoalFollow(targetEntity, 1)
    );

    const msgObj = {
        "name": "mineBlock",
        "pos": blockPosition.minus(bot.offsetVec3),
        "blockName": blockName,
    };
    bot.emit("event", dumpToJson(msgObj));
}
