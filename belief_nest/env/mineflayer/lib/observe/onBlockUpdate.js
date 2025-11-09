const Vec3 = require('vec3');
const Event = require("./event");

class OnBlockUpdate extends Event {
    static name = "onBlockUpdate";
    constructor(bot, args) {
        super(bot, OnBlockUpdate.name, "block");
        this.observeBound = this.onUpdate.bind(this);

        if(!args){
            args = {}
        }
    }

    async start(){
        this.bot.on('blockUpdate', this.observeBound);
    }

    async stop(){
        this.bot.removeListener('blockUpdate', this.observeBound);
    }

    async onUpdate(oldBlock, newBlock) {
        const absPos = newBlock.position;
        const bot = this.bot;

        const o = bot.offsetVec3;
        const absEnvBox = [bot.envBox[0].plus(o), bot.envBox[1].plus(o)];

        if( absEnvBox[0].x <= absPos.x && absPos.x <= absEnvBox[1].x &&
            absEnvBox[0].y <= absPos.y && absPos.y <= absEnvBox[1].y &&
            absEnvBox[0].z <= absPos.z && absPos.z <= absEnvBox[1].z
        ){
            const block = {
                name: newBlock.name,
                stateId: newBlock.stateId,
            };
            const props = newBlock.getProperties();
            if(props){
                block.properties = props;
            }
            this.obs.push({
                eventName: "blockUpdate",
                blockPos: absPos.minus(this.bot.offsetVec3),
                visible: block,
                hidden: null
            });
        }
    }
}

module.exports = OnBlockUpdate;
