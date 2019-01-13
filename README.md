# @colyseus/state

> WORK-IN-PROGRESS EXPERIMENT OF A NEW SERIALIZATION ALGORITHM FOR [COLYSEUS](https://github.com/gamestdio/colyseus)

> THIS IS NOT STABLE AND THE API MAY CHANGE COMPLETELY AT ANY TIME

Initial thoghts/assumptions:
- no bottleneck to detect state changes.
- have a schema definition on both server and client
- better experience on staticaly-typed languages (C#, C++)
- mutations should be cheap.

Practical Colyseus issues this should solve:
- Avoid decoding large objects that haven't been patched
- Allow to send different patches for each client
- Better developer experience on statically-typed languages

Current problems when listening to changes:

```
// given that "position" is an object containing x and y
// e.g. {"x": 100, "y": 200};
room.listen("entities/:id/position/:axis", (change) => {
  // this callback will be called twice
  // - first for "x"
  // - second for "y"
});
```

## Defining Schema

As Colyseus is written in TypeScript, the schema is defined as type annotations inside the state class. Additional server logic may be added to that class, but client-side generated (not implemented) files will consider only the schema itself.

- I'm using decorators to allow defining the schema at runtime and quickstart the project
- Parsing types from plain TypeScript would be possible for generating client-side state/schema files (see next section)

See [example/State.ts](example/State.ts).

## Supported types

- `@sync("string") name: string;`
- `@sync("number") level: number;`
- `@sync(Player) player: Player;`
- `@sync([ Player ]) arrayOfPlayers: Player[];`
- `@sync([ "number" ]) arrayOfNumbers: number[];`
- `@sync([ "string" ]) arrayOfStrings: string[];`
- `@sync({ map: Player }) mapOfPlayers: {[id: string]: Player};`

## Generating client-side state/schema files:

> THIS HAS NOT BEEN IMPLEMENTED

```
# TypeScript
statefy ./schemas/State.ts --output ./ts-project/State.ts

# LUA/Defold
statefy ./schemas/State.ts --output ./lua-project/State.lua

# C/C++
statefy ./schemas/State.ts --output ./cpp-project/State.c

# C#/Unity
statefy ./schemas/State.ts --output ./unity-project/State.cs

# Haxe
statefy ./schemas/State.ts --output ./haxe-project/State.hx
```

## Aimed usage on Colyseus

This is the ideal scenario that should be possible to achieve.

### Customizing which data each client will receive

```typescript
class MyRoom extends Room<State> {
  onInit() {
    this.setState(new State());
  }

  onPatch (client: Client, state: State) {
    const player = state.players[client.sessionId];

    // filter enemies closer to current player
    state.enemies = state.enemies.filter(enemy =>
      distance(enemy.x, enemy.y, player.x, player.y) < 50);

    return state;
  }
}
```

### Broadcasting different patches for each client

```typescript
class Room<T> {
  // ...
  public onPatch?(client: Client, state: T);

  // ...
  broadcastPatch() {
    if (this.onPatch) {
      for (let i=0; i<this.clients.length; i++) {
        const client = this.clients[i];

        const filteredState = this.onPatch(client, this.state.clone());
        send(client, filteredState.encode());
      }

    } else {
      this.broadcast(this.state.encode());
    }
  }

}
```

## Benchmarks:

| Scenario | `@colyseus/state` | `msgpack` + `fossil-delta` |
|---|---|---|
| Initial state size (100 entities) | 2671 | 3283 |
| Updating x/y of 1 entity after initial state | 9 | 26 |
| Updating x/y of 50 entities after initial state | 342 | 684 |
| Updating x/y of 100 entities after initial state | 668 | 1529 |


## Inspiration:

- [schemapack](https://github.com/phretaddin/schemapack/)
- [avro](https://avro.apache.org/docs/current/spec.html)
- [flatbuffers](https://google.github.io/flatbuffers/flatbuffers_white_paper.html)


## License

MIT
