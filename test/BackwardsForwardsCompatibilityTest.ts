import * as assert from "assert";
import { Reflection, type, Schema, MapSchema, ArraySchema, encode, decode } from "../src";
import { deprecated } from "../src/annotations";

describe("backwards/forwards compatibility", () => {

    class PlayerV1 {
        @type("number") x: number = Math.random();
        @type("number") y: number = Math.random();
    }

    class StateV1 {
        @type("string") str: string;
        @type({ map: PlayerV1 }) map = new MapSchema<PlayerV1>();
    }

    class PlayerV2 {
        @type("number") x: number = Math.random();
        @type("number") y: number = Math.random();
        @type("string") name = "Jake Badlands";
        @type(["string"]) arrayOfStrings = new ArraySchema<string>("one", "two", "three");
    }

    class StateV2 {
        @type("string") str: string;

        @deprecated()
        @type({ map: PlayerV2 }) map = new MapSchema<PlayerV2>();

        @type("number") countdown: number;
    }

    it("should be backward compatible", () => {
        const state = new StateV1();
        state.str = "Hello world";
        state.map['one'] = new PlayerV1();

        const decodedStateV2 = new StateV2();
        decode(decodedStateV2, encode(state));
        assert.equal("Hello world", decodedStateV2.str);
        // assert.equal(10, decodedStateV2.countdown);

        assert.throws(() => {
            return decodedStateV2.map;
        }, "should throw an error trying to get deprecated attribute");
    });

    it("should be forward compatible", () => {
        const state = new StateV2();
        state.str = "Hello world";
        state.countdown = 10;

        const decodedStateV1 = new StateV1();
        decode(decodedStateV1, encode(state));
        assert.equal("Hello world", decodedStateV1.str);
    });

    it("should allow reflection", () => {
        const state = new StateV2();
        const reflectionBytes = Reflection.encode(state);

        const reflected = Reflection.decode(reflectionBytes);
    });
});
