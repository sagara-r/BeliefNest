const mineflayer = require('mineflayer');
const { once } = require('events');

class McWorldManager{
    constructor(){
        this.mcWorlds = {};
        this.inverseDict = {};
        this.operatorMcName = "operator";
    }
    
    async addSim(beliefPath, mcHost, mcPort, adminMcName){
        const address = `${mcHost}:${mcPort}`
        if(this.inverseDict[beliefPath]){
            throw new Error(`beliefPath "${beliefPath}" already exist.`);
        }

        let bot;

        if(!this.mcWorlds[address]){
            bot = mineflayer.createBot({
                host: mcHost,
                port: mcPort,
                username: this.operatorMcName,
                disableChatSigning: true,
                checkTimeoutInterval: 60 * 60 * 1000,
            });
            this.mcWorlds[address] = {
                sims: [],
                operatorBot: bot
            }
        } else{
            bot = this.mcWorlds[address].operatorBot
        }
        this.mcWorlds[address].sims.push(beliefPath)
        this.inverseDict[beliefPath] = address;

        if(!bot.entity){
            await once(bot, 'spawn');
            const hasOp = await this.checkOpByTp(bot);
            if(!hasOp){
                throw new Error(`Player "${this.operatorMcName}" in "${address}" must have OP permission. Type "/op ${this.operatorMcName}" in the Minecraft server console in advance.`)
            }
            bot.chat("/effect give @s invisibility 999999 0 true")
        }
        bot.chat(`/op ${adminMcName}`)
    }

    removeSim(beliefPath){
        const address = this.inverseDict[beliefPath];
        if(!address){
            throw new Error(`beliefPath "${beliefPath}" does not exist.`);
        }
        const idx = this.mcWorlds[address].sims.indexOf(beliefPath);
        if(idx < 0){
            throw new Error(`beliefPath "${beliefPath}" does not exist.`)
        }
        this.mcWorlds[address].sims.splice(idx, 1);
        delete this.inverseDict[beliefPath]

        if(this.mcWorlds[address].sims.length === 0){
            this.mcWorlds[address].operatorBot.end();
            delete this.mcWorlds[address];
        }
    }

    async checkOpByTp(bot) {
        return new Promise((resolve) => {
            const originalPos = bot.entity.position.clone();
            
            bot.chat(`/tp ${bot.username} ~10 ~ ~`);
            
            const MAX_WAIT_TIME = 2000;
            let timeoutId;

            const checkPosition = () => {
                const currentPos = bot.entity.position;
                const xDist = currentPos.x - originalPos.x;

                if (xDist > 5) {
                    cleanup(true);
                }
            };

            function cleanup(result) {
                bot.removeListener('physicsTick', checkPosition);
                clearTimeout(timeoutId);
                resolve(result);
            }

            bot.on('physicTick', checkPosition);

            timeoutId = setTimeout(() => {
                cleanup(false);
            }, MAX_WAIT_TIME);
        });
    }

}

module.exports = { McWorldManager }