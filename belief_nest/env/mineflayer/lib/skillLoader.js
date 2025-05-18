function inject(bot, args) {

    const allAgentsInfo = args["allAgentsInfo"];
    const minDistToRecord = args["minDistToRecord"]
    let allowedArea = args["allowedArea"] // [[Number,Number,Number],[Number,Number,Number]]

    bot._sleep = bot.sleep;
    bot.sleep = async (bedBlock) => {
        await bot.waitForTicks(20);
        await bot._sleep(bedBlock);
        await bot.waitForTicks(135);
    };

    bot._fish = bot.fish;
    bot.fish = async () => {
        if (bot.heldItem?.name !== "fishing_rod") {
            bot.chat("/tell @s I'm not holding a fishing rod!");
            return;
        }
        let timeout = null;
        await Promise.race([
            bot._fish(),
            new Promise(
                (resolve, reject) =>
                    (timeout = setTimeout(() => {
                        bot.activateItem();
                        reject(
                            new Error(
                                "Finishing timeout, make sure you get to and look at a water block!"
                            )
                        );
                    }, 60000))
            ),
        ]);
        clearTimeout(timeout);
        await bot.waitForTicks(20);
    };

    bot._consume = bot.consume;
    bot.consume = async () => {
        // action_count.activateItem++;
        await bot._consume();
        await bot.waitForTicks(20);
    };

    bot._useOn = bot.useOn;
    bot.useOn = async (entity) => {
        if (entity.position.distanceTo(bot.entity.position) > 6) {
            bot.chat("/tell @s Please goto a place near the entity first!");
            return;
        }
        await bot._useOn(entity);
        await bot.waitForTicks(20);
    };

    bot._activateBlock = bot.activateBlock;
    bot.activateBlock = async (block) => {
        if (block.position.distanceTo(bot.entity.position) > 6) {
            bot.chat("/tell @s Please goto a place near the block first!");
            return;
        }
        // action_count.activateBlock++;
        await bot._activateBlock(block);
    };

    bot._chat = bot.chat;
    bot.chat = (message) => {
        // action_count.chat++;
        if(message.startsWith("/tell")){
            bot.emit("tellCommand", bot.entity.username, message);
        }
        bot._chat(message);
    };

    bot.inventoryUsed = () => {
        return bot.inventory.slots.slice(9, 45).filter((item) => item !== null)
            .length;
    };

    bot.save = function (eventName) {
        bot.emit("save", eventName);
    };

    const { Vec3 } = require("vec3");

    if (allowedArea){
        // x,y,z of allowedArea[0] must not be grater than x,y,z of allowedArea[1].
        for(let i=0; i<3; i++){
            if(allowedArea[0][i] > allowedArea[1][i]){
                // swap
                const tmp = allowedArea[0][i];
                allowedArea[0][i] = allowedArea[1][i];
                allowedArea[1][i] = tmp;
            }
        }
        allowedArea = [
            new Vec3(allowedArea[0][0], allowedArea[0][1], allowedArea[0][2]),
            new Vec3(allowedArea[1][0], allowedArea[1][1], allowedArea[1][2])
        ]
    }

    const originalGoto = bot.pathfinder.goto;
    bot.pathfinder.goto = async function (goal){
        const startPos = bot.entity.position;

        let intFunc = null;
        let outOfArea = false;
        let outPos = null;

        if (allowedArea){
            intFunc = setInterval(()=>{
                const p = bot.entity.position;
                let x = p.x
                let y = p.y
                let z = p.z
                if(p.x < allowedArea[0].x){
                    x = allowedArea[0].x
                }else if(p.x > allowedArea[1].x){
                    x = allowedArea[1].x
                }
                if(p.y < allowedArea[0].y){
                    y = allowedArea[0].y
                }else if(p.y > allowedArea[1].y){
                    y = allowedArea[1].y
                }
                if(p.z < allowedArea[0].z){
                    z = allowedArea[0].z
                }else if(p.z > allowedArea[1].z){
                    z = allowedArea[1].z
                }

                const newPos = new Vec3(x,y,z);
                if (newPos.distanceTo(p) > 0.01){
                    outOfArea = true;
                    outPos = p;
                    bot.pathfinder.setGoal(null)
                    bot.chat(`/tp @s ${x} ${y} ${z}`)
                }
            }, 200)
        }

        try{
            await originalGoto(goal);
        }catch(err){
            if(outOfArea){
                err = Error(`I stopped because I was out of the allowed area. My position was ${outPos}`)
            }
            bot.chat(`/tell @s Failed to move. ${err}`)
            throw err

        }finally{
            if (intFunc){
                clearInterval(intFunc)
            }
        }
        const p = bot.entity.position;

        // If the distance moved is less than threshold, not recorded as an action.
        if (startPos.minus(p).norm() < minDistToRecord){
            return
        }

        // round
        const startPosStr = `(${startPos.x.toFixed(1)}, ${startPos.y.toFixed(1)}, ${startPos.z.toFixed(1)})`
        const endPosStr = `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`
        for(const mcName in allAgentsInfo){
            bot.chat(`/tell ${mcName} EVENT:moveTo;${bot.entity.username};${startPosStr};${endPosStr}`)
            await bot.waitForTicks(1)
        }
    }
}

// export all control_primitives
module.exports = { inject };
