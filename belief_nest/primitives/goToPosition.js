async function goToPosition(bot, position, dist=2) {
    if (!(position instanceof Vec3)) {
        throw new Error(`position for goToPosition must be a Vec3`);
    }
    if (!checkValidPosition(position, bot)){
        throw new Error("position for goToPosition is out of environment. Perhaps you forgot to account for the offset.");
    }

    const startPos = bot.entity.position;
    
    let error = null
    for(let d = 0; d <= dist; d+=1){
        done = false
        try{
            await bot.pathfinder.goto(
                new GoalNear(position.x, position.y, position.z, d)
            );
            const msgObj = {
                "name": "moveTo",
                "startPos": startPos.minus(bot.offsetVec3),
                "goalPos": position.minus(bot.offsetVec3),  
            };
            bot.emit("event", dumpToJson(msgObj));
            done = true
        }catch(err){
            error = err
        }
        
        if(done){
            break
        }
    }

    if(!done){
        throw error
    }
}