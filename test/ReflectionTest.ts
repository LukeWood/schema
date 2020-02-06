import * as assert from "assert";
import { Reflection, Schema, type, MapSchema, ArraySchema, Context, encode, encodeAll, decode } from "../src";

const testContext = new Context();

/**
 * No filters example
 */
class Player {
  @type("string", testContext) name: string;
  @type("number", testContext) x: number;
  @type("number", testContext) y: number;

  constructor (name?: string, x?: number, y?: number) {
    this.name = name;
    this.x = x;
    this.y = y;
  }
}

export class State {
  @type('string', testContext) fieldString: string;
  @type('number', testContext) fieldNumber: number;
  @type(Player, testContext) player: Player;
  @type([ Player ], testContext) arrayOfPlayers: ArraySchema<Player>;
  @type({ map: Player }, testContext) mapOfPlayers: MapSchema<Player>;
}

describe("Reflection", () => {

    it("should encode schema definitions", () => {
        const state = new State();
        const reflected = new Reflection();
        assert.equal(
            JSON.stringify(decode(reflected, Reflection.encode(state))),
            '{"types":[{"id":0,"fields":[{"name":"name","type":"string"},{"name":"x","type":"number"},{"name":"y","type":"number"}]},{"id":1,"fields":[{"name":"fieldString","type":"string"},{"name":"fieldNumber","type":"number"},{"name":"player","type":"ref","referencedType":0},{"name":"arrayOfPlayers","type":"array","referencedType":0},{"name":"mapOfPlayers","type":"map","referencedType":0}]}],"rootType":1}'
        );
    });

    it("should initialize ref types with empty structures", () => {
        const state = new State();
        const stateReflected = Reflection.decode(Reflection.encode(state)) as State;

        assert.equal(stateReflected.arrayOfPlayers.length, 0);
        assert.equal(Object.keys(stateReflected.mapOfPlayers).length, 0);
        assert.equal(JSON.stringify(stateReflected.player), "{}");
    });

    it("should decode schema and be able to use it", () => {
        const state = new State();
        const stateReflected = Reflection.decode(Reflection.encode(state)) as State;

        assert.deepEqual(state['_indexes'], stateReflected['_indexes']);

        state.fieldString = "Hello world!";
        state.fieldNumber = 10;
        state.player = new Player("directly referenced player", 1, 1);
        state.mapOfPlayers = new MapSchema({
            'one': new Player("player one", 2, 2),
            'two': new Player("player two", 3, 3)
        })
        state.arrayOfPlayers = new ArraySchema(new Player("in array", 4, 4));

        decode(stateReflected, encode(state));

        assert.equal(stateReflected.fieldString, "Hello world!");
        assert.equal(stateReflected.fieldNumber, 10);

        assert.equal(stateReflected.player.name, "directly referenced player");
        assert.equal(stateReflected.player.x, 1);
        assert.equal(stateReflected.player.y, 1);

        assert.equal(Object.keys(stateReflected.mapOfPlayers).length, 2);
        assert.equal(stateReflected.mapOfPlayers['one'].name, "player one");
        assert.equal(stateReflected.mapOfPlayers['one'].x, 2);
        assert.equal(stateReflected.mapOfPlayers['one'].y, 2);
        assert.equal(stateReflected.mapOfPlayers['two'].name, "player two");
        assert.equal(stateReflected.mapOfPlayers['two'].x, 3);
        assert.equal(stateReflected.mapOfPlayers['two'].y, 3);

        assert.equal(stateReflected.arrayOfPlayers.length, 1);
        assert.equal(stateReflected.arrayOfPlayers[0].name, "in array");
        assert.equal(stateReflected.arrayOfPlayers[0].x, 4);
        assert.equal(stateReflected.arrayOfPlayers[0].y, 4);
    });

    it("should allow extending another Schema type", () => {
        class Point {
            @type("number") x: number;
            @type("number") y: number;

            constructor (x: number, y: number) {
                this.x = x;
                this.y = y;
            }
        }

        class Player extends Point {
            @type("string") name: string;

            constructor (x: number, y: number, name: string) {
                super(x, y);
                this.name = name;
            }
        }

        class MyState {
            @type([ Point ])
            points = new ArraySchema<Point>();

            @type([ Player ])
            players = new ArraySchema<Player>();
        }

        const state = new MyState();
        const encodedReflection = Reflection.encode(state);

        const decodedState = Reflection.decode(encodedReflection) as MyState;
        assert.deepEqual(Object.keys(decodedState['_schema'].points[0]._schema), ['x', 'y'])
        assert.deepEqual(Object.keys(decodedState['_schema'].players[0]._schema), ['x', 'y', 'name'])
    });

    it("should reflect map of primitive type", () => {
        class MyState {
            @type({map: "string"})
            mapOfStrings: MapSchema<string> = new MapSchema();
        }

        const state = new MyState();
        const decodedState = Reflection.decode(Reflection.encode(state)) as MyState;

        state.mapOfStrings['one'] = "one";
        state.mapOfStrings['two'] = "two";
        decode(decodedState, encode(state));

        assert.equal(JSON.stringify(decodedState), '{"mapOfStrings":{"one":"one","two":"two"}}');
    });

    it("should reflect array of primitive type", () => {
        class MyState {
            @type([ "string" ])
            arrayOfStrings: ArraySchema<string> = new ArraySchema();
        }

        const state = new MyState();
        const decodedState = Reflection.decode(Reflection.encode(state)) as MyState;

        state.arrayOfStrings.push("one")
        state.arrayOfStrings.push("two");
        decode(decodedState, encode(state));

        assert.equal(JSON.stringify(decodedState), '{"arrayOfStrings":["one","two"]}');
    });

    it("should reflect and be able to use multiple structures of primitive tyes", () => {
        class MyState {
            @type("string")
            currentTurn: string;

            @type({ map: "number" })
            players: MapSchema<number>;

            @type(["number"])
            board: ArraySchema<number>;

            @type("string")
            winner: string;

            @type("boolean")
            draw: boolean;
        }

        const state = new MyState();
        state.currentTurn = "one";
        state.players = new MapSchema();
        state.board = new ArraySchema(0, 0, 0, 0, 0, 0, 0, 0, 0);
        state.players['one'] = 1;

        const decodedState = Reflection.decode(Reflection.encode(state)) as MyState;
        decode(decodedState, encodeAll(state));

        const decodedState2 = Reflection.decode(Reflection.encode(state)) as MyState;
        decode(decodedState2, encodeAll(state));

        assert.equal(JSON.stringify(decodedState),  '{"currentTurn":"one","players":{"one":1},"board":[0,0,0,0,0,0,0,0,0]}');
        assert.equal(JSON.stringify(decodedState2), '{"currentTurn":"one","players":{"one":1},"board":[0,0,0,0,0,0,0,0,0]}');
    });
});