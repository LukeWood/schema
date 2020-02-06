import { ChangeTree } from "../ChangeTree";

export class MapSchema<V=any> {

    protected $changes: ChangeTree;
    // protected map = new Map<string, V>();

    constructor (obj: any = {}) {
        for (let key in obj) {
            this[key] = obj[key];
        }

        Object.defineProperties(this, {
            $changes:     { value: undefined, enumerable: false, writable: true },

            onAdd:        { value: undefined, enumerable: false, writable: true },
            onRemove:     { value: undefined, enumerable: false, writable: true },
            onChange:     { value: undefined, enumerable: false, writable: true },

            clone: {
                value: (isDecoding?: boolean) => {
                    let cloned: MapSchema;

                    if (isDecoding) {
                        // client-side
                        cloned = Object.assign(new MapSchema(), this);
                        cloned.onAdd = this.onAdd;
                        cloned.onRemove = this.onRemove;
                        cloned.onChange = this.onChange;

                    } else {
                        // server-side
                        const cloned = new MapSchema();
                        for (let key in this) {
                            if (typeof (this[key]) === "object") {
                                cloned[key] = this[key].clone();

                            } else {
                                cloned[key] = this[key];
                            }
                        }
                    }

                    return cloned;
                }
            },

            triggerAll: {
                value: () => {
                    if (!this.onAdd) {
                        return;
                    }

                    for (let key in this) {
                        this.onAdd(this[key], key);
                    }
                }
            },

            toJSON: {
                value: () => {
                    const map: any = {};
                    for (let key in this) {
                        map[key] = (typeof(this[key].toJSON) === "function")
                            ? this[key].toJSON()
                            : this[key];
                    }
                    return map;
                }
            },

            _indexes: { value: new Map<string, number>(), enumerable: false, writable: true },
            _updateIndexes: {
                value: (allKeys) => {
                    let index: number = 0;

                    let indexes = new Map<string, number>();
                    for (let key of allKeys) {
                        indexes.set(key, index++);
                    }

                    this._indexes = indexes;
                }
            },
        });
    }

    // TODO: remove me!
    [key: string]: V | any;

    // clear() {
    //     this.map.clear();
    // }

    // delete(key: string) {
    //     this.map.delete(key)
    // }

    // forEach(callbackfn: (value: V, key: string, map: Map<string, V>) => void, thisArg?: any): void {
    //     return this.map.forEach(callbackfn);
    // }

    // get(key: string): V | undefined {
    //     return this.map.get(key);
    // }

    // has(key: string): boolean {
    //     return this.map.has(key);
    // }

    // set(key: string, value: V): this {
    //     this.map.set(key, value);
    //     return this;
    // }

    clone: (isDecoding?: boolean) => MapSchema<V>;

    onAdd: (item: V, key: string) => void;
    onRemove: (item: V, key: string) => void;
    onChange: (item: V, key: string) => void;

    triggerAll: () => void;

    _indexes: Map<string, number>;
    _updateIndexes: (keys: string[]) => void;
}
