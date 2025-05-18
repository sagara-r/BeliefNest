function checkValidPosition(absPos, bot){
    const o = bot.offsetVec3;
    const absBox = [bot.envBox[0].plus(o), bot.envBox[1].plus(o)];
    return (absBox[0].x <= absPos.x && absPos.x <= absBox[1].x) && (absBox[0].y <= absPos.y && absPos.y <= absBox[1].y) && (absBox[0].z <= absPos.z && absPos.z <= absBox[1].z)
}