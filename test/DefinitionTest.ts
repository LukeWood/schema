import * as assert from "assert";

import { Schema, type, MapSchema, encode, decode } from "../src";
import { defineTypes } from "../src/annotations";

describe("Definition", () => {

    it("private Schema fields should be part of enumerable keys", () => {
        class Player {
            @type("number") x: number;
            @type("number") y: number;
            somethingPrivate: number = 10;
        }
        class MySchema {
            @type("string")
            str: string;

            @type({map: Player})
            players = new MapSchema<Player>();

            notSynched: boolean = true;
        }

        const obj = new MySchema();
        obj.players['one'] = new Player();

        assert.deepEqual(Object.keys(obj), ['str', 'players', 'notSynched']);
        assert.deepEqual(Object.keys(obj.players), ['one']);
        assert.deepEqual(Object.keys(obj.players['one']), ['x', 'y', 'somethingPrivate']);
    });

    it("should allow a Schema instance with no fields", () => {
        class IDontExist {}

        const obj = new IDontExist();
        assert.deepEqual(Object.keys(obj), []);
    });

    describe("defineTypes", () => {
        it("should be equivalent", () => {
            class MyExistingStructure {}
            defineTypes(MyExistingStructure, { name: "string" });

            const state = new MyExistingStructure();
            (state as any).name = "hello world!";

            const decodedState = new MyExistingStructure();
            decode(decodedState, encode(state));
            assert.equal((decodedState as any).name, "hello world!");
        });
    });
});