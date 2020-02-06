import { Schema, type, ArraySchema, MapSchema, filter, Definition } from "../src";
import { ChangeTree } from "../src/ChangeTree";

/**
 * No filters example
 */
export class Player {
  @type("string")
  name: string;

  @type("number")
  x: number;

  @type("number")
  y: number;

  constructor (name?: string, x?: number, y?: number) {
    this.name = name;
    this.x = x;
    this.y = y;
  }
}

export class State {
  @type('string')
  fieldString: string;

  @type('number') // varint
  fieldNumber: number;

  @type(Player)
  player: Player;

  @type([ Player ])
  arrayOfPlayers: ArraySchema<Player>;

  @type({ map: Player })
  mapOfPlayers: MapSchema<Player>;
}

/**
 * Deep example
 */
export class Position {
  @type("float32") x: number;
  @type("float32") y: number;
  @type("float32") z: number;

  constructor (x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

export class Another {
  @type(Position)
  position: Position = new Position(0, 0, 0);
}

export class DeepEntity {
  @type("string")
  name: string;

  @type(Another)
  another: Another = new Another();
}

export class DeepEntity2 extends DeepEntity {
}

export class DeepChild {
  @type(DeepEntity)
  entity = new DeepEntity();
}

export class DeepMap {
  @type([DeepChild])
  arrayOfChildren = new ArraySchema<DeepChild>();
}

export class DeepState {
  @type({ map: DeepMap })
  map = new MapSchema<DeepMap>();
}


/**
 * Filters example
 */
export class Inventory {
  @type("number")
  items: number;
}

export class Unit {
  @type("number")
  x: number;

  @type("number")
  y: number;

  @filter(function(this: Unit, client: any, value: Unit['inventory'], root: StateWithFilter) {
    return root.units[client.sessionId] === this;
  })
  @type(Inventory)
  inventory: Inventory;
}

export class Bullet {
  @type("number")
  x: number;

  @type("number")
  y: number;
}

const filters = {
  byDistance: function(this: StateWithFilter, client: any, value: Player | Bullet) {
    const currentPlayer = this.unitsWithDistanceFilter[client.sessionId]

    var a = value.x - currentPlayer.x;
    var b = value.y - currentPlayer.y;

    return (Math.sqrt(a * a + b * b)) <= 10;
  }
}

export class StateWithFilter {
  @type("string")
  unfilteredString: string;

  @type({ map: Unit })
  units = new MapSchema<Unit>();

  @type({ map: Bullet })
  bullets: MapSchema<Bullet>;

//   @filter(filters.byDistance)
  @filter((client) => client.sessionId === "three")
  @type({ map: Unit })
  unitsWithDistanceFilter = new MapSchema<Unit>();

  @type("string")
  unfilteredString2: string;

  @filter(function(client: any) {
    return client.sessionId === "one";
  })
  @type("number")
  filteredNumber: number;
}