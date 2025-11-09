const { getChunkCornersInBox, isVec3, cloneObj } = require("./utils")

const Vec3 = require('vec3');

async function teleport({ bot, mcNameToTeleport, position, pitch, yaw, isRelative=true, timeout=5, teleportOffset=new Vec3(0,1,0), ignoreFailure=false }){
    return new Promise(async (resolve, reject) => {
        if(!bot.isAdmin){
            return reject(new Error("teleport is only for admin player."));
        }
        if(!isVec3(position)){
            throw new Error(`position must be Vec3, not ${position.constructor?.name || typeof position}.`);
        }
        if(!mcNameToTeleport){
            return reject(new Error("Set mcNameToTeleport."));
        }
        
        if(isRelative){
            position = position.plus(bot.offsetVec3);
        }
        const targetPos = position.plus(teleportOffset);
        let command = `/tp ${mcNameToTeleport} ${targetPos.x} ${targetPos.y} ${targetPos.z}`;
        if(![undefined, null].includes(pitch) && ![undefined, null].includes(yaw)){
            // pitch
            // mineflayer: PI/2(up), 0(front), -PI/2(down)
            // command:     -90(up), 0(front),    90(down)
            const convPitch = -pitch / Math.PI * 180;

            // yaw
            // mineflayer: PI(south), PI/2(west),   0(north), 3*PI/2(east)
            // command:     0(south),   90(west), 180(north),    270(east)
            
            const convYaw = (-yaw+Math.PI) / Math.PI * 180;
            command += ` ${convYaw} ${convPitch}`;
        }
        bot.chat(command);

        const player = await getPlayer({bot, mcName:mcNameToTeleport})
        const checkInterval = 0.02;

        const horizontalTol = 1.0;
        const verticalTol = 3;

        const timeoutHandler = setTimeout(() => {
            clearInterval(interval);
            if(ignoreFailure){
                resolve();
            } else {
                reject(new Error(`${mcNameToTeleport} did not arrive within ${timeout} seconds.`));
            }
        }, timeout*1000);
    
        const interval = setInterval(() => {
            const nowPos = player?.entity?.position;
            if(nowPos === undefined){
                clearInterval(interval);
                clearTimeout(timeoutHandler);
                resolve();
                return;
            }
        
            const horizontalDist = Math.sqrt(
                Math.pow(nowPos.x - targetPos.x, 2) +
                Math.pow(nowPos.z - targetPos.z, 2)
            );
            const verticalDist = Math.abs(nowPos.y - targetPos.y);
        
            if (horizontalDist <= horizontalTol && verticalDist <= verticalTol) {
                clearInterval(interval);
                clearTimeout(timeoutHandler);
                resolve();
                return;
            } 
        }, checkInterval*1000);
    });
}

async function setBlocks({ bot, blockInfoList, isRelative=true, maxPlacementRate=60, timeout=50, leaf_persistent=false }){

    function isPropsUpdated(oldBlock, newBlockInfo){
        const props = oldBlock.getProperties();
        return (Object.keys(props).length && JSON.stringify(props) !== JSON.stringify(newBlockInfo.properties))
    }

    function isBlockUpdated(oldBlock, newBlockInfo){
        return oldBlock.name !== newBlockInfo.name || isPropsUpdated(oldBlock, newBlockInfo)
    }
    
    return new Promise(async (resolve, reject) => {
        if(!bot.isAdmin){
            return reject(new Error("setBlocks is only for admin player."));
        }
        if([undefined, null].includes(bot)){
            return reject(new Error(`bot is not set. bot=${bot}`));
        }
        if([undefined, null].includes(blockInfoList)){
            return reject(new Error(`blockInfoList is not set. blockInfoList=${blockInfoList}`));
        }

        let setNum = 0;
        let lastBlockOrigInfo = null;
        let checkInterval = 0.2;

        for(const blockInfo of blockInfoList){
            if([undefined, null].includes(blockInfo.position)){
                return reject(new Error(`blockInfo.position is not set. blockInfo.position=${blockInfo.position}`))
            }
            if(!isVec3(blockInfo.position)){
                throw new Error(`position must be Vec3, not ${blockInfo.position.constructor?.name || typeof blockInfo.position}.`);
            }

            let absPos;
            if(isRelative) absPos = blockInfo.position.plus(bot.offsetVec3);
            else           absPos = blockInfo.position;

            const block = await blockAt({bot, position:absPos, isRelative:false});
            if(isBlockUpdated(block, blockInfo)){
                lastBlockOrigInfo = {
                    name: block.name,
                    updateTo: blockInfo.name,
                    absPos: absPos,
                }

                const base = `/setblock ${absPos.x} ${absPos.y} ${absPos.z} ${blockInfo.name}`
                let propStrs = []
                for(let prop in blockInfo.properties){
                    let val = blockInfo.properties[prop];
                    if(leaf_persistent && prop === "persistent" && blockInfo.name.endsWith("_leaves")){
                        val = "true";
                    }
                    propStrs.push(`${prop}=${val}`)
                }
                
                const command = `${base}[${propStrs.join(',')}]`
                bot.chat(command);

                let msg = `mcUtils.setBlocks(): ${command}`;
                if(isPropsUpdated(block, blockInfo)){
                    msg += `     property update`;
                }
                console.log(msg)

                setNum++;
                if(setNum >= maxPlacementRate){
                    await bot.waitForTicks(1);
                    setNum = 0;
                }
            }
        }

        if(!lastBlockOrigInfo){
            // there were no blocks to update
            return resolve();
        }

        // wait for updating the last block
        const timeoutHandler = setTimeout(() => {
            clearInterval(interval);
            reject(new Error(`Blocks were not updated in ${timeout} sec.`));
        }, timeout*1000);
    
        const interval = setInterval(async () => {
            const lastBlock = await blockAt({bot, position:lastBlockOrigInfo.absPos, isRelative:false});
        
            //console.log(`block at ${lastBlockOrigInfo.absPos} was ${lastBlockOrigInfo.name}, now ${block.name}, updateTo ${lastBlockOrigInfo.updateTo}`)
            if (isBlockUpdated(lastBlock, lastBlockOrigInfo)) {
                clearInterval(interval);
                clearTimeout(timeoutHandler);
                resolve();
            } 
        }, checkInterval*1000);
    });
}

async function clearBox({bot, timeout=50}){
    const o = bot.offsetVec3;
    const absBox = [bot.envBox[0].plus(o), bot.envBox[1].plus(o)]

    const chunkCorners = getChunkCornersInBox({envBox:absBox, isRelative:false});
    const absBlockInfoList = [];
    for(const el of chunkCorners){
        for(const key of ["minCorner", "maxCorner"]){
            absBlockInfoList.push({
                position: el[key], name: "respawn_anchor"
            })
        }
    }
    await setBlocks({bot, blockInfoList: absBlockInfoList, isRelative:false});

    const size = 20;  // size^3 must be smaller than 32768
    for(let x = absBox[0].x; x <= absBox[1].x; x += size){
        for(let y = absBox[0].y; y <= absBox[1].y; y += size){
            for(let z = absBox[0].z; z <= absBox[1].z; z += size){
                const endX = Math.min(x + size - 1, absBox[1].x);
                const endY = Math.min(y + size - 1, absBox[1].y);
                const endZ = Math.min(z + size - 1, absBox[1].z);
                bot.chat(`/fill ${x} ${y} ${z} ${endX} ${endY} ${endZ} air`);
                await bot.waitForTicks(1);
            }
        }
    }
        
    let isTimeout = false;
    const timeoutHandler = setTimeout(() => {
        isTimeout = true;
        throw new Error(`Blocks were not cleared in ${timeout} sec.`);
    }, timeout*1000);

    for(const blockInfo of absBlockInfoList){
        while(!isTimeout){
            const block = await blockAt({bot, position:blockInfo.position, isRelative:false});
            if(block.name === "air"){
                break;
            }
            await bot.waitForTicks(1);
        }
    }

    clearTimeout(timeoutHandler);
    await bot.waitForTicks(1);
}

async function setContainer({bot, pos, items, isRelative=true}){
    const SLOT_NUM = 27;
    if(isRelative){
        pos = pos.plus(bot.offsetVec3);
    }
    items = cloneObj(items);

    let itemIdx = 0;
    const itemNameArr = Object.keys(items);
    for(let slotIdx=0; slotIdx < SLOT_NUM; slotIdx++){
        let itemName;
        let count;
        if(itemIdx < itemNameArr.length){
            itemName = itemNameArr[itemIdx];
            const stackSize = bot.registry.itemsByName[itemName].stackSize;
            if(items[itemName] <= stackSize){
                count = items[itemName];
                itemIdx++;
                delete items[itemName];
            } else {
                count = stackSize;
                items[itemName] -= count;
            }
        } else {
            itemName = "air";
            count = 1;
        }
        bot.chat(`/item replace block ${pos.x} ${pos.y} ${pos.z} container.${slotIdx} with ${itemName} ${count}`);
    }
    if(Object.keys(items).length){
        throw new Error(`Too many items to set into a chest. itemNameArr=[${itemNameArr}]`);
    }
}

async function setInventoryAndEquipment({bot, agentName, inventory, equipment}){
    /* clear Inventory */
    const mcName = bot.agentInfo[agentName].mcName;
    bot.chat(`/clear ${mcName}`);
    await bot.waitForTicks(5);

    /* equipment */
    let mainhandItem = null;
    if(equipment){
        mainhandItem = await setEquipment({
            bot, 
            agentName, 
            equipment,
            clear: false,
            mainhand: true,
        })
    }

    /* inventory */
    if(inventory){
        await setInventory({
            bot, 
            agentName, 
            inventory,
            clear: false,
            mainhandItem: mainhandItem,
        });
    }
}

async function setInventory({bot, agentName, inventory, clear=true, mainhandItem=null}){
    const mcName = bot.agentInfo[agentName].mcName;
    if(clear){
        bot.chat(`/clear ${mcName}`);
        await bot.waitForTicks(5);
    }
    for(let [itemName, count] of Object.entries(inventory)){
        if(itemName === mainhandItem){
            count -= 1;
            if(count === 0){
                continue;
            }
        }
        bot.chat(`/give ${mcName} ${itemName} ${count}`);
        await bot.waitForTicks(1);
    }
}

async function setEquipment({bot, agentName, equipment, mainhand=false, clear=false}){
    const mcName = bot.agentInfo[agentName].mcName;
    if(clear){
        bot.chat(`/clear ${mcName}`);
        await bot.waitForTicks(5);
    }

    const parts = ["armor.head", "armor.chest", "armor.legs", "armor.feet", "weapon.mainhand", "weapon.offhand"];
    for(let i = 0; i < 6; i++){
        if(i === 4 && !mainhand){
            continue;
        }
        let item = equipment[i]
        if(!item){
            item = "air";
        }
        bot.chat(`/item replace entity ${mcName} ${parts[i]} with ${item}`);
        //await bot.waitForTicks(1);
    }

    const mainhandItem = equipment[4];
    return mainhandItem;
}

function execMcCommands({bot, commands}){
    if(!Array.isArray(commands)){
        commands = [commands];
    }
    for(let c of commands){
        bot.chat(c);
    }
}

async function blockAt({bot, position, isRelative=true, maxRetries=30, extraInfos=true}) {
    if([undefined, null].includes(bot)){
        throw new Error(`bot is not set. bot=${bot}`);
    }
    if([undefined, null].includes(position)){
        throw new Error(`position is not set. position=${position}`);
    }

    if(!isVec3(position)){
        throw new Error(`position must be Vec3, not ${typeof position}.`);
    }

    let absPos;
    if(isRelative){
        absPos = position.plus(bot.offsetVec3);
    } else {
        absPos = position;
    }
    let block = bot.blockAt(absPos, extraInfos);

    if (block !== null) {
        return block;
    }

    await teleport({bot, mcNameToTeleport:bot.entity.username, position:absPos, isRelative:false})
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        await bot.waitForTicks(1);

        block = bot.blockAt(absPos, extraInfos);
        if (block !== null) {
            return block;
        }
    }

    throw new Error(`Could not get block information at ${absPos}`);
}

async function getPlayer({bot, mcName, maxRetries=30}){
    let player = bot.players[mcName];
    if(player && player.entity) return player;

    await teleport({bot, mcNameToTeleport:bot.entity.username, position:new Vec3(0,0,0), pitch:0, yaw:0})
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        await bot.waitForTicks(1);

        player = bot.players[mcName];
        if (player && player.entity) {
            return player;
        }
    }

    throw new Error(`Could not find player ${mcName}`);
}

function enableTransparency({bot, agentName=null}){
    let mcName;
    if(agentName){
        mcName = bot.agentInfo[agentName].mcName;
    } else {
        mcName = "@s";
    }
    bot.chat(`/effect give ${mcName} invisibility 999999 0 true`);
}

function disableTransparency({bot, agentName=null}){
    let mcName;
    if(agentName){
        mcName = bot.agentInfo[agentName].mcName;
    } else {
        mcName = "@s";
    }
    bot.chat(`/effect clear ${mcName} invisibility`);
}

module.exports = { teleport, setBlocks, clearBox, setContainer, setInventoryAndEquipment, setInventory, setEquipment, execMcCommands, blockAt, enableTransparency, disableTransparency };