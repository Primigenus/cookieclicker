Games = new Mongo.Collection("games");
Buildings = new Mongo.Collection("buildings");
Upgrades = new Mongo.Collection("upgrades");

Meteor.methods({
  clickCookie() {
    const game = Games.findOne({userId: Meteor.userId()});
    if (!game) return;
    Games.update({userId: Meteor.userId()}, {$inc: {
      cookies: game.cookiesPerClick
    }});
  },
  buyBuilding(buildingId, amount, buyOrSell) {
    const buying = buyOrSell === 'buy';
    let building = Buildings.findOne(buildingId);
    const buildingName = building.name;
    let game = Games.findOne({userId: Meteor.userId()});
    if (!game) return;

    if (!building) throw new Error("Invalid building ID");

    const ownedBuilding = game.buildings[buildingName];
    if (ownedBuilding)
      building = ownedBuilding;

    const cost = buying ? building.cost : building.cost * 0.5;

    if (game.cookies - cost < 0)
      return;

    const factor = 1.15042 * (1 + ((Math.random() * 3) / 10));

    Games.update({userId: Meteor.userId()}, {
      $set: {
        [`buildings.${buildingName}.cost`]: buying ? (cost * factor) : cost,
        [`buildings.${buildingName}.cps`]: building.cps
      }
    });
    Games.update({userId: Meteor.userId()}, {
      $inc: {
        [`buildings.${buildingName}.owned`]: buying ? amount : -amount,
        cookies: buying ? (cost * -amount) : (cost * amount)
      }
    });
  },
  buyUpgrade(upgradeId) {
    Games.update({userId: Meteor.userId()}, {
      $addToSet: {
        upgrades: upgradeId
      }
    });

    const upgrade = Upgrades.findOne(upgradeId);
    const game = Games.findOne({userId: Meteor.userId()});

    switch (upgrade.effect) {
      case "2x_mouse_cursors":
        Games.update({userId: Meteor.userId()}, {
          $set: {
            'buildings.Cursor.cps': game.buildings.Cursor.cps * 2,
            cookiesPerClick: game.cookiesPerClick * 2
          }
        });
        break;
      case "+1%_cps":
        Games.update({userId: Meteor.userId()}, {
          $set: {
            cookiesPerClick: game.cookiesPerClick * 1.01
          }
        });
        break;
      default:
        break;
    }
  }
});

if (Meteor.isClient) {

  Meteor.startup(() => {
    Session.setDefault("buyAmount", 1);
    Session.setDefault("buyOrSell", "buy");
  });

  Template.options.events({
    'click .buyOptions .button'(evt) {
      const buying = $(evt.target).data('type') === 'buy';
      Session.set('buyOrSell', buying ? 'buy' : 'sell');
    },
    'click .amountOptions .button'(evt) {
      const amount = parseInt($(evt.target).data('amount'));
      Session.set('buyAmount', amount);
    }
  });

  Template.options.helpers({
    buying:    () => Session.equals("buyOrSell", "buy"),
    amount1:   () => Session.equals("buyAmount", 1),
    amount10:  () => Session.equals("buyAmount", 10),
    amount100: () => Session.equals("buyAmount", 100)
  });

  Template.cursor.onRendered(function() {
    // XXX: need to invalidate and resequence after we buy a new cursor,
    // or they won't go nicely in a row like intended ;-)
    const game = Games.findOne({userId: Meteor.userId()});
    const cursorNum = parseInt(Template.instance().data);
    const doClick = () => {
      Meteor.call("clickCookie");
      $cursor = this.$('.cursor');
      $cursor.addClass("clicking");
      Meteor.setTimeout(() => {
        $cursor.removeClass("clicking");
      }, 300);
    }
    Meteor.setTimeout(() => {
      this.interval = Meteor.setInterval(doClick, 10000);
      doClick();
    }, 1000 * cursorNum);
  });
  Template.cursor.onDestroyed(function() {
    Meteor.clearInterval(this.interval);
  });

  Template.cookieclicker.helpers({
    numCookies() {
      const game = Games.findOne({userId: Meteor.userId()});
      return game ? ~~game.cookies : 0;
    },
    cookiesPerSecond() {
      const game = Games.findOne({userId: Meteor.userId()});
      if (!game) return 0;
      return Math.round(_.reduce(game.buildings, (total, curr) => {
        return total + (curr.owned * curr.cps);
      }, 0) * 100) / 100;
    },
    ownedCursor() {
      const game = Games.findOne({userId: Meteor.userId()});
      if (!game) return 0;
      return game.buildings && game.buildings.Cursor && _.range(game.buildings.Cursor.owned);
    },
    ownedBuildings() {
      const game = Games.findOne({userId: Meteor.userId()});
      if (!game) return;
      return _.map(game.buildings, (building, name) => {
        return {name: name, amount: building.owned};
      });
    }
  });
  Template.cookieclicker.events({
    "click .cookie"() {
      Meteor.call("clickCookie");
    }
  });

  Template.store.helpers({
    building() {
      return Buildings.find();
    },
    cost() {
      const game = Games.findOne({userId: Meteor.userId()});
      const factor = Session.equals("buyOrSell", "buy") ? 1 : 0.5;
      if (!game) return false;
      const ownedBuilding = game.buildings[this.name];
      if (ownedBuilding)
        return Math.round(ownedBuilding.cost) * factor;
      return Math.round(this.cost) * factor;
    },
    cps() {
      const game = Games.findOne({userId: Meteor.userId()});
      if (!game) return;
      const ownedBuilding = game.buildings[this.name];
      if (ownedBuilding)
        return ownedBuilding.cps;
      return this.cps;
    },
    purchasable() {
      const game = Games.findOne({userId: Meteor.userId()});
      if (!game) return false;

      const ownedBuilding = game.buildings[this.name];
      if (ownedBuilding) {
        if (Session.equals("buyOrSell", "sell") && ownedBuilding.owned > 0)
          return true;
        return game.cookies - ownedBuilding.cost >= 0;
      }

      const building = Buildings.findOne({name: this.name});
      return game.cookies - building.cost >= 0;
    },
    numOwned() {
      const game = Games.findOne({userId: Meteor.userId()});
      if (!game) return;
      const ownedBuilding = game.buildings[this.name];
      return ownedBuilding ? ownedBuilding.owned : 0;
    }
  });

  Template.store.events({
    "click .building.canBuy"() {
      Meteor.call("buyBuilding", this._id, Session.get("buyAmount"), Session.get("buyOrSell"));
    }
  });

  Template.upgrades.helpers({
    availableUpgrade() {
      const game = Games.findOne({userId: Meteor.userId()});
      if (!game) return;
      return Upgrades.find({_id: {$nin: game.upgrades}});
    },
    canBuy() {
      const game = Games.findOne({userId: Meteor.userId()});
      if (!game) return;
      return game.cookies - this.cost >= 0;
    }
  });
  Template.upgrades.events({
    'click .upgrade.canBuy'() {
      Meteor.call("buyUpgrade", this._id);
    }
  });

}

if (Meteor.isServer) {

  Accounts.onCreateUser((options, user) => {
    const game = Games.findOne({userId: user._id});
    if (game) return;
    Games.insert({
      userId: user._id,
      cookies: 0,
      buildings: [],
      upgrades: [],
      achievements: []
    });
    if (options.profile)
      user.profile = options.profile;
    return user;
  });

  Meteor.setInterval(() => {
    Games.find().forEach((game) => {
      Games.update(game._id, {$inc: {cookies: _.reduce(game.buildings, (total, curr) => {
        return total + curr.owned * curr.cps;
      }, 0)}});
    });
  }, 1000);

  Meteor.users.allow({
    update() { return true; }
  });

  Meteor.methods({
    resetBuildings() {
      Buildings.remove({});
      Buildings.insert({name: "Cursor", cost: 10, cps: 0.1});
      Buildings.insert({name: "Grandma", cost: 20, cps: 2});
      Buildings.insert({name: "Farm", cost: 500, cps: 10});
      Buildings.insert({name: "Mine", cost: 10000, cps: 50});
      Buildings.insert({name: "Factory", cost: 200000, cps: 250});
    },
    resetGame() {
      Games.remove({});
      Games.insert({
        userId: this.userId,
        cookies: 0,
        cookiesPerClick: 1,
        buildings: {},
        upgrades: [],
        achievements: {}
      });
    },
    resetUpgrades() {
      Upgrades.remove({});
      Upgrades.insert({
        name: "Reinforced index finger",
        cost: 100,
        description: "The mouse and cursors are twice as efficient",
        effect: "2x_mouse_cursors"
      });
      Upgrades.insert({
        name: "Plastic mouse",
        cost: 50000,
        description: "Clicking gains +1% of your CpS",
        effect: "+1%_cps"
      })
    }
  });

}
