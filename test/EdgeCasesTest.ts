import * as assert from "assert";
import * as nanoid from "nanoid";
import { MapSchema, Schema, type, ArraySchema, encode, encodeAll, decode } from "../src";

import { State, Player } from "./Schema";

describe("Edge cases", () => {

    it("NIL check should not collide", () => {
        class State {
            @type("int32") num: number;
            @type({ map: "int32" }) mapOfNum = new MapSchema<number>();
            @type(["int32"]) arrayOfNum = new ArraySchema<number>();
        }

        const state = new State();
        state.num = 3519;
        state.mapOfNum['one'] = 3519;
        state.arrayOfNum[0] = 3519;

        const decodedState = new State();
        decode(decodedState, encode(state));

        /**
         * 3520 is encoded as [192, 13, 0, 0]
         * (192 is the NIL byte indicator)
         */
        state.num = 3520;
        state.mapOfNum['one'] = 3520;
        state.arrayOfNum[0] = 3520;

        decode(decodedState, encode(state));

        // assert.deepEqual(decodedState.toJSON(), {
        //     num: 3520,
        //     mapOfNum: { one: 3520 },
        //     arrayOfNum: [3520]
        // });

        state.num = undefined;
        delete state.mapOfNum['one'];
        state.arrayOfNum.pop();

        decode(decodedState, encode(state));

        // assert.deepEqual(decodedState.toJSON(), {
        //     mapOfNum: {},
        //     arrayOfNum: []
        // });
    });

    it("string: containing specific UTF-8 characters", () => {
        let bytes: number[];

        const state = new State();
        const decodedState = new State();

        state.fieldString = "гхб";
        bytes = encode(state);
        decode(decodedState, bytes);
        assert.equal("гхб", decodedState.fieldString);

        state.fieldString = "Пуредоминаце";
        bytes = encode(state);
        decode(decodedState, bytes);
        assert.equal("Пуредоминаце", decodedState.fieldString);

        state.fieldString = "未知の選手";
        bytes = encode(state);
        decode(decodedState, bytes);
        assert.equal("未知の選手", decodedState.fieldString);

        state.fieldString = "알 수없는 플레이어";
        bytes = encode(state);
        decode(decodedState, bytes);
        assert.equal("알 수없는 플레이어", decodedState.fieldString);
    });

    it("MapSchema: index with high number of items should be preserved", () => {
        const state = new State();
        state.mapOfPlayers = new MapSchema<Player>();

        let i = 0;

        // add 20 players
        // for (let i = 0; i < 2; i++) { state.mapOfPlayers[nanoid(8)] = new Player("Player " + i, i * 2, i * 2); }

        encodeAll(state);

        const decodedState1 = new State();
        decode(decodedState1, encodeAll(state));
        state.mapOfPlayers[nanoid(8)] = new Player("Player " + i++, i++, i++);

        const decodedState2 = new State();
        state.mapOfPlayers[nanoid(8)] = new Player("Player " + i++, i++, i++);
        decode(decodedState2, encodeAll(state));

        const decodedState3 = new State();
        decode(decodedState3, encodeAll(state));
        state.mapOfPlayers[nanoid(8)] = new Player("Player " + i++, i++, i++);

        // // add 20 players
        // for (let i = 0; i < 2; i++) { state.mapOfPlayers[nanoid(8)] = new Player("Player " + i, i * 2, i * 2); }

        const encoded = encode(state);
        decode(decodedState1, encoded);
        decode(decodedState2, encoded);
        decode(decodedState3, encoded);

        const decodedState4 = new State();
        state.mapOfPlayers[nanoid(8)] = new Player("Player " + i++, i++, i++);
        decode(decodedState4, encodeAll(state));

        assert.equal(JSON.stringify(decodedState1), JSON.stringify(decodedState2));
        assert.equal(JSON.stringify(decodedState2), JSON.stringify(decodedState3));

        decode(decodedState3, encode(state));
        assert.equal(JSON.stringify(decodedState3), JSON.stringify(decodedState4));
    });
});
