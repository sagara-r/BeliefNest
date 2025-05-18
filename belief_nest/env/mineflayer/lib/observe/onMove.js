const Event = require("./event");
const { loadFromJson, roundVec3 } = require("../utils");

class OnMove extends Event {
    static name = "OnMove";
    constructor(bot, args) {
        super(bot, OnMove.name, "player");
        this.handler = this.onUpdate.bind(this);

        if(!args){
            args = {}
        }
    }

    async start(){
        this.bot.on('moveTo', this.handler);
    }

    async stop(){
        this.bot.removeListener('moveTo', this.handler);
    }

    async onUpdate(agentName, eventJsonMsg) {
        const event = loadFromJson(eventJsonMsg);

        this.obs.push({
            eventName: "moveTo",
            agentName: agentName,
            visible: {
                startPos: roundVec3(event.startPos, 1),
                goalPos: roundVec3(event.goalPos, 1),
            },
            hidden: null
        });
    }
}

module.exports = OnMove;
