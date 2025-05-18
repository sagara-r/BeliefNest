//go to (1, -32, -92), goToPosition(bot, new Vec3(1, -32, -92))
async function goToPosition(bot, position) {
    const dist = 1;
    await bot.pathfinder.goto(
        new GoalNear(position.x, position.y, position.z, dist)
    )
}