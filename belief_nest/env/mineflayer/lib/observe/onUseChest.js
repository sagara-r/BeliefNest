const Event = require("./event");
const { loadFromJson } = require("../utils");

class OnUseChest extends Event {
    static name = "OnUseChest";
    constructor(bot, args) {
        super(bot, OnUseChest.name, "player");
        this.handler = this.onUpdate.bind(this);

        if(!args){
            args = {}
        }
    }

    async start(){
        this.bot.on('getItemFromChest', this.handler);
        this.bot.on('depositItemIntoChest', this.handler);
    }

    async stop(){
        this.bot.removeListener('getItemFromChest', this.handler);
        this.bot.removeListener('depositItemIntoChest', this.handler);
    }

    async onUpdate(agentName, eventJsonMsg) {
        const event = loadFromJson(eventJsonMsg);

        const obs = {
            agentName: agentName,
            visible: {
                chestPos: event.chestPos,
            },
            hidden: {
                chestItems: event.chestItems,
            }
        };
        switch(event.name){
            case "getItemFromChest":
                obs.eventName = "getItemFromChest";
                obs.visible.gotItems = event.gotItems; 
                break;
            case "depositItemIntoChest": 
                obs.eventName = "depositItemIntoChest";
                obs.visible.depositedItems = event.depositedItems; 
                break;
            default: throw new Error(`Invalid event name "${event.name}"`);            
        }

        this.obs.push(obs);
    }
}

module.exports = OnUseChest;
