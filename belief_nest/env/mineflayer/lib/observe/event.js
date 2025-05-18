class Event{
    constructor(bot, name, obsType){
        this.bot = bot;
        if(!name){
            throw new Error("Set name.");
        }
        this.name = name;

        if(!["block", "player"].includes(obsType)){
            throw new Error(`Invalid obsType ${obsType}`);
        }
        this.obsType = obsType;

        this.obs = [];
    }

    async start(){
        throw new Error("Override start()");
    }

    async stop(){
        throw new Error("Override stop()")
    }

    deleteCache(){
        this.obs = [];
    }

    get(){
        const obs = this.obs;
        this.obs = [];
        return obs;
    }
}

module.exports = Event;