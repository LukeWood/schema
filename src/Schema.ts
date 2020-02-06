import { END_OF_STRUCTURE, NIL, INDEX_CHANGE, TYPE_ID } from './spec';
import { Definition, FilterCallback, Client, PrimitiveType, Context } from "./annotations";

import * as encoding from "./encoding/encode";
import * as decoding from "./encoding/decode";

import { ArraySchema } from "./types/ArraySchema";
import { MapSchema } from "./types/MapSchema";

import { ChangeTree } from "./ChangeTree";
import { NonFunctionProps } from './types/HelperTypes';
import { EventEmitter } from './events/EventEmitter';

export interface DataChange<T=any> {
    field: string;
    value: T;
    previousValue: T;
}

export interface IStaticSchema {
    new (...args: any[]): any;
    _context: Context;
    _typeid: number;
    _schema: Definition;
    _indexes: {[field: string]: number};
    _fieldsByIndex: {[index: number]: string};
    _filters: {[field: string]: FilterCallback};
    _deprecated: {[field: string]: boolean};
    _descriptors: PropertyDescriptorMap & ThisType<any>;
}

export function isSchema (instance: any) {
    return instance && instance.constructor._schema;
}

class EncodeSchemaError extends Error {}

function assertType(value: any, type: string, klass: Schema, field: string) {
    let typeofTarget: string;
    let allowNull: boolean = false;

    switch (type) {
        case "number":
        case "int8":
        case "uint8":
        case "int16":
        case "uint16":
        case "int32":
        case "uint32":
        case "int64":
        case "uint64":
        case "float32":
        case "float64":
            typeofTarget = "number";
            if (isNaN(value)) {
                console.log(`trying to encode "NaN" in ${klass.constructor.name}#${field}`);
            }
            break;
        case "string":
            typeofTarget = "string";
            allowNull = true;
            break;
        case "boolean":
            // boolean is always encoded as true/false based on truthiness
            return;
    }

    if (typeof (value) !== typeofTarget && (!allowNull || (allowNull && value !== null))) {
        let foundValue = `'${JSON.stringify(value)}'${(value && value.constructor && ` (${value.constructor.name})`)}`;
        throw new EncodeSchemaError(`a '${typeofTarget}' was expected, but ${foundValue} was provided in ${klass.constructor.name}#${field}`);
    }
}

function assertInstanceType(value: Schema, type: typeof Schema | typeof ArraySchema | typeof MapSchema, klass: Schema, field: string) {
    if (!(value instanceof type)) {
        throw new EncodeSchemaError(`a '${type.name}' was expected, but '${(value as any).constructor.name}' was provided in ${klass.constructor.name}#${field}`);
    }
}

function encodePrimitiveType (type: PrimitiveType, bytes: number[], value: any, klass: Schema, field: string) {
    assertType(value, type as string, klass, field);

    const encodeFunc = encoding[type as string];

    if (encodeFunc) {
        encodeFunc(bytes, value);

    } else {
        throw new EncodeSchemaError(`a '${type}' was expected, but ${value} was provided in ${klass.constructor.name}#${field}`);
    }
}

function decodePrimitiveType (type: string, bytes: number[], it: decoding.Iterator) {
    return decoding[type as string](bytes, it);
}


function _encodeEndOfStructure(instance: Schema, root: Schema, bytes: number[]) {
    if (instance !== root) {
        bytes.push(END_OF_STRUCTURE);
    }
}

function tryEncodeTypeId(bytes: number[], type: IStaticSchema, targetType: IStaticSchema) {
    if (type._typeid !== targetType._typeid) {
        encoding.uint8(bytes, TYPE_ID);
        encoding.uint8(bytes, targetType._typeid);
    }
}

function createTypeInstance(context: Context, bytes: number[], it: decoding.Iterator, type: IStaticSchema): Schema {
    if (bytes[it.offset] === TYPE_ID) {
        it.offset++;
        const anotherType = context.get(decoding.uint8(bytes, it));
        return new (anotherType as any)();

    } else {
        return new (type as any)();
    }
}

export function encode(instance: any, root: any = instance, encodeAll = false, client?: Client, bytes: number[] = []) {
    const $changes: ChangeTree = instance.$changes;

    // skip if nothing has changed
    if (!$changes.changed && !encodeAll) {
        _encodeEndOfStructure(instance, root, bytes);
        return bytes;
    }

    const schema = (instance.constructor as IStaticSchema)._schema;
    const indexes = (instance.constructor as IStaticSchema)._indexes;
    const fieldsByIndex = (instance.constructor as IStaticSchema)._fieldsByIndex;
    const filters = (instance.constructor as IStaticSchema)._filters;
    const changes = Array.from(
        (encodeAll) //  || client
            ? $changes.allChanges
            : $changes.changes
    ).sort();

    // console.log({ schema, indexes, fieldsByIndex, changes });

    for (let i = 0, l = changes.length; i < l; i++) {
        const field = fieldsByIndex[changes[i]] || changes[i] as string;
        const _field = `_${field}`;

        const type = schema[field];
        const filter = (filters && filters[field]);
        // const value = (filter && instance.$allChanges[field]) || changes[field];
        const value = instance[_field];
        const fieldIndex = indexes[field];

        // console.log("ENCODING", { field, type, fieldIndex, value });

        if (value === undefined) {
            encoding.uint8(bytes, NIL);
            encoding.number(bytes, fieldIndex);

        } else if ((type as any)._schema) {
            if (client && filter) {
                // skip if not allowed by custom filter
                if (!filter.call(instance, client, value, root)) {
                    continue;
                }
            }

            if (!value) {
                // value has been removed
                encoding.uint8(bytes, NIL);
                encoding.number(bytes, fieldIndex);

            } else {
                // encode child object
                encoding.number(bytes, fieldIndex);
                assertInstanceType(value, type as unknown as IStaticSchema, instance, field);

                tryEncodeTypeId(bytes, type as IStaticSchema, value.constructor as IStaticSchema);

                encode(value, root, encodeAll, client, bytes);
            }

        } else if (Array.isArray(type)) {
            const $changes: ChangeTree = value.$changes;

            if (client && filter) {
                // skip if not allowed by custom filter
                if (!filter.call(instance, client, value, root)) {
                    continue;
                }
            }

            encoding.number(bytes, fieldIndex);

            // total number of items in the array
            encoding.number(bytes, value.length);

            const arrayChanges = Array.from(
                (encodeAll) //  || client
                    ? $changes.allChanges
                    : $changes.changes
            )
                .filter(index => instance[_field][index] !== undefined)
                .sort((a: number, b: number) => a - b);

            // ensure number of changes doesn't exceed array length
            const numChanges = arrayChanges.length;

            // number of changed items
            encoding.number(bytes, numChanges);

            const isChildSchema = typeof (type[0]) !== "string";

            // assert ArraySchema was provided
            assertInstanceType(instance[_field], ArraySchema, instance, field);

            // encode Array of type
            for (let j = 0; j < numChanges; j++) {
                const index = arrayChanges[j];
                const item = instance[_field][index];

                /**
                 * TODO: filter array by items instead of the whole object
                 */
                // if (client && filter) {
                //     // skip if not allowed by custom filter
                //     if (!filter.call(instance, client, item, root)) {
                //         continue;
                //     }
                // }

                if (isChildSchema) { // is array of Schema
                    encoding.number(bytes, index);

                    if (!encodeAll) {
                        const indexChange = $changes.getIndexChange(item);
                        if (indexChange !== undefined) {
                            encoding.uint8(bytes, INDEX_CHANGE);
                            encoding.number(bytes, indexChange);
                        }
                    }

                    assertInstanceType(item, type[0] as unknown as IStaticSchema, instance, field);
                    tryEncodeTypeId(bytes, type[0] as unknown as IStaticSchema, item.constructor as IStaticSchema);

                    encode(item, root, encodeAll, client, bytes);

                } else if (item !== undefined) { // is array of primitives
                    encoding.number(bytes, index);
                    encodePrimitiveType(type[0], bytes, item, instance, field);
                }
            }

            if (!encodeAll && !client) {
                $changes.discard();
            }

        } else if ((type as any).map) {
            const $changes: ChangeTree = value.$changes;

            if (client && filter) {
                // skip if not allowed by custom filter
                if (!filter.call(instance, client, value, root)) {
                    continue;
                }
            }

            // encode Map of type
            encoding.number(bytes, fieldIndex);

            // TODO: during `encodeAll`, removed entries are not going to be encoded
            const keys = Array.from(
                (encodeAll) //  || client
                    ? $changes.allChanges
                    : $changes.changes
            );

            encoding.number(bytes, keys.length)

            // const previousKeys = Object.keys(instance[_field]); // this is costly!
            const previousKeys = Array.from($changes.allChanges);
            const isChildSchema = typeof ((type as any).map) !== "string";
            const numChanges = keys.length;

            // assert MapSchema was provided
            assertInstanceType(instance[_field], MapSchema, instance, field);

            for (let i = 0; i < numChanges; i++) {
                const key = keys[i];
                const item = instance[_field][key];

                let mapItemIndex: number = undefined;

                /**
                 * TODO: filter map by items instead of the whole object
                 */
                // if (client && filter) {
                //     // skip if not allowed by custom filter
                //     if (!filter.call(instance, client, item, root)) {
                //         continue;
                //     }
                // }

                if (encodeAll) {
                    if (item === undefined) {
                        // previously deleted items are skipped during `encodeAll`
                        continue;
                    }

                } else {
                    // encode index change
                    const indexChange = $changes.getIndexChange(item);
                    if (item && indexChange !== undefined) {
                        encoding.uint8(bytes, INDEX_CHANGE);
                        encoding.number(bytes, instance[_field]._indexes.get(indexChange));
                    }

                    /**
                     * - Allow item replacement
                     * - Allow to use the index of a deleted item to encode as NIL
                     */
                    mapItemIndex = (!$changes.isDeleted(key) || !item)
                        ? instance[_field]._indexes.get(key)
                        : undefined;
                }

                const isNil = (item === undefined);

                /**
                 * Invert NIL to prevent collision with data starting with NIL byte
                 */
                if (isNil) {

                    // TODO: remove item
                    // console.log("REMOVE KEY INDEX", { key });
                    // instance[_field]._indexes.delete(key);
                    encoding.uint8(bytes, NIL);
                }

                if (mapItemIndex !== undefined) {
                    encoding.number(bytes, mapItemIndex);

                } else {
                    encoding.string(bytes, key);
                }

                if (item && isChildSchema) {
                    assertInstanceType(item, (type as any).map, instance, field);
                    tryEncodeTypeId(bytes, (type as any).map, item.constructor as IStaticSchema);
                    encode(item, root, encodeAll, client, bytes);

                } else if (!isNil) {
                    encodePrimitiveType((type as any).map, bytes, item, instance, field);
                }

            }

            if (!encodeAll && !client) {
                $changes.discard();

                // TODO: track array/map indexes per client (for filtering)?

                // TODO: do not iterate though all MapSchema indexes here.
                instance[_field]._updateIndexes(previousKeys);
            }

        } else {
            if (client && filter) {
                // skip if not allowed by custom filter
                if (!filter.call(instance, client, value, root)) {
                    continue;
                }
            }

            encoding.number(bytes, fieldIndex);
            encodePrimitiveType(type as PrimitiveType, bytes, value, instance, field)
        }
    }

    // flag end of Schema object structure
    _encodeEndOfStructure(instance, root, bytes);

    if (!encodeAll && !client) {
        $changes.discard();
    }

    return bytes;
}

export function encodeFiltered(root: any, client: Client, bytes?: number[]) {
    return encode(root, false, client, bytes);
}

export function encodeAll(root: any, bytes?: number[]) {
    return encode(root, true, undefined, bytes);
}

export function encodeAllFiltered(root: any, client: Client, bytes?: number[]) {
    return encode(root, true, client, bytes);
}

export function decode(instance: any, bytes: number[], it: decoding.Iterator = { offset: 0 }) {
    const changes: DataChange[] = [];

    const schema = (instance.constructor as IStaticSchema)._schema;
    const fieldsByIndex = (instance.constructor as IStaticSchema)._fieldsByIndex;

    const totalBytes = bytes.length;

    // skip TYPE_ID of existing instances
    if (bytes[it.offset] === TYPE_ID) {
        it.offset += 2;
    }

    while (it.offset < totalBytes) {
        const isNil = decoding.nilCheck(bytes, it) && ++it.offset;
        const index = bytes[it.offset++];

        if (index === END_OF_STRUCTURE) {
            // reached end of strucutre. skip.
            break;
        }

        const field = fieldsByIndex[index];
        const _field = `_${field}`;

        let type = schema[field];
        let value: any;

        let change: any; // for triggering onChange
        let hasChange = false;

        if (!field) {
            continue;

        } else if (isNil) {
            value = null;
            hasChange = true;

        } else if ((type as any)._schema) {
            value = instance[_field] || createTypeInstance((instance.constructor as IStaticSchema)._context, bytes, it, type as IStaticSchema);
            decode(value, bytes, it);

            hasChange = true;

        } else if (Array.isArray(type)) {
            type = type[0];
            change = [];

            const valueRef: ArraySchema = instance[_field] || new ArraySchema();
            value = valueRef.clone(true);

            const newLength = decoding.number(bytes, it);
            const numChanges = Math.min(decoding.number(bytes, it), newLength);
            hasChange = (numChanges > 0);

            // FIXME: this may not be reliable. possibly need to encode this variable during serialization
            let hasIndexChange = false;

            // ensure current array has the same length as encoded one
            if (value.length > newLength) {
                // decrease removed items from number of changes.
                // no need to iterate through them, as they're going to be removed.

                Array.prototype.splice.call(value, newLength).forEach((itemRemoved, i) => {
                    if (itemRemoved && itemRemoved.onRemove) {
                        try {
                            itemRemoved.onRemove();
                        } catch (e) {
                            Schema.onError(e);
                        }
                    }

                    if (valueRef.onRemove) {
                        try {
                            valueRef.onRemove(itemRemoved, newLength + i);
                        } catch (e) {
                            Schema.onError(e);
                        }
                    }
                });
            }

            for (let i = 0; i < numChanges; i++) {
                const newIndex = decoding.number(bytes, it);

                let indexChangedFrom: number; // index change check
                if (decoding.indexChangeCheck(bytes, it)) {
                    decoding.uint8(bytes, it);
                    indexChangedFrom = decoding.number(bytes, it);
                    hasIndexChange = true;
                }

                let isNew = (!hasIndexChange && value[newIndex] === undefined) || (hasIndexChange && indexChangedFrom === undefined);

                if (type['_schema']) { // is a reference to Schema?
                    let item: Schema;

                    if (isNew) {
                        item = createTypeInstance((instance.constructor as IStaticSchema)._context, bytes, it, type as unknown as IStaticSchema);

                    } else if (indexChangedFrom !== undefined) {
                        item = valueRef[indexChangedFrom];

                    } else {
                        item = valueRef[newIndex]
                    }

                    if (!item) {
                        item = createTypeInstance((instance.constructor as IStaticSchema)._context, bytes, it, type as unknown as IStaticSchema);
                        isNew = true;
                    }

                    decode(item, bytes, it);
                    value[newIndex] = item;

                } else {
                    value[newIndex] = decodePrimitiveType(type as string, bytes, it);
                }

                if (isNew) {
                    if (valueRef.onAdd) {
                        try {
                            valueRef.onAdd(value[newIndex], newIndex);
                        } catch (e) {
                            Schema.onError(e);
                        }
                    }

                } else if (valueRef.onChange) {
                    try {
                        valueRef.onChange(value[newIndex], newIndex);
                    } catch (e) {
                        Schema.onError(e);
                    }
                }

                change.push(value[newIndex]);
            }


        } else if ((type as any).map) {
            type = (type as any).map;

            const valueRef: MapSchema = instance[_field] || new MapSchema();
            value = valueRef.clone(true);

            const length = decoding.number(bytes, it);
            hasChange = (length > 0);

            // FIXME: this may not be reliable. possibly need to encode this variable during
            // serializagion
            let hasIndexChange = false;

            const previousKeys = Object.keys(valueRef);

            for (let i = 0; i < length; i++) {
                // `encodeAll` may indicate a higher number of indexes it actually encodes
                // TODO: do not encode a higher number than actual encoded entries
                if (
                    bytes[it.offset] === undefined ||
                    bytes[it.offset] === END_OF_STRUCTURE
                ) {
                    break;
                }

                const isNilItem = decoding.nilCheck(bytes, it) && ++it.offset;

                // index change check
                let previousKey: string;
                if (decoding.indexChangeCheck(bytes, it)) {
                    decoding.uint8(bytes, it);
                    previousKey = previousKeys[decoding.number(bytes, it)];
                    hasIndexChange = true;
                }

                const hasMapIndex = decoding.numberCheck(bytes, it);
                const isSchemaType = typeof(type) !== "string";

                const newKey = (hasMapIndex)
                    ? previousKeys[decoding.number(bytes, it)]
                    : decoding.string(bytes, it);

                let item;
                let isNew = (!hasIndexChange && valueRef[newKey] === undefined) || (hasIndexChange && previousKey === undefined && hasMapIndex);

                if (isNew && isSchemaType) {
                    item = createTypeInstance((instance.constructor as IStaticSchema)._context, bytes, it, type as unknown as IStaticSchema);

                } else if (previousKey !== undefined) {
                    item = valueRef[previousKey];

                } else {
                    item = valueRef[newKey]
                }

                if (isNilItem) {
                    if (item && item.onRemove) {
                        try {
                            item.onRemove();
                        } catch (e) {
                            Schema.onError(e);
                        }

                    }

                    if (valueRef.onRemove) {
                        try {
                            valueRef.onRemove(item, newKey);
                        } catch (e) {
                            Schema.onError(e);
                        }
                    }

                    delete value[newKey];
                    continue;

                } else if (!isSchemaType) {
                    value[newKey] = decodePrimitiveType(type as string, bytes, it);

                } else {
                    decode(item, bytes, it);
                    value[newKey] = item;
                }

                if (isNew) {
                    if (valueRef.onAdd) {
                        try {
                            valueRef.onAdd(value[newKey], newKey);
                        } catch (e) {
                            Schema.onError(e);
                        }
                    }

                } else if (valueRef.onChange) {
                    try {
                        valueRef.onChange(value[newKey], newKey);
                    } catch (e) {
                        Schema.onError(e);
                    }
                }

            }

        } else {
            value = decodePrimitiveType(type as string, bytes, it);

            // FIXME: should not even have encoded if value haven't changed in the first place!
            // check FilterTest.ts: "should not trigger `onChange` if field haven't changed"
            hasChange = (value !== instance[_field]);
        }

        // if (hasChange && (instance.onChange || instance.$listeners[field])) {
        //     changes.push({
        //         field,
        //         value: change || value,
        //         previousValue: instance[_field]
        //     });
        // }

        instance[_field] = value;
    }

    // this._triggerChanges(changes);

    return instance;
}


export function toJSON(instance) {
    const schema = instance._schema;
    const deprecated = instance._deprecated;

    const obj = {}
    for (let field in schema) {
        if (!deprecated[field] && instance[field] !== null && typeof (instance[field]) !== "undefined") {
            obj[field] = (isSchema(instance[field]))
                ? toJSON(instance[field])
                : instance[`_${field}`];
        }
    }
    return obj;
}

export function discardAllChanges(instance: any) {
    const schema = instance._schema;
    const changes = Array.from(instance.$changes.changes);
    const fieldsByIndex = instance._fieldsByIndex;

    for (const index in changes) {
        const field = fieldsByIndex[index];
        const type = schema[field];
        const value = instance[field];

        // skip unchagned fields
        if (value === undefined) { continue; }

        if ((type as any)._schema) {
            discardAllChanges(value);

        } else if (Array.isArray(type)) {
            for (let i = 0, l = value.length; i < l; i++) {
                const index = value[i];
                const item = instance[`_${field}`][index];

                if (typeof (type[0]) !== "string" && item) { // is array of Schema
                    discardAllChanges(item);
                }
            }

            value.$changes.discard();

        } else if ((type as any).map) {
            const keys = value;
            const mapKeys = Object.keys(instance[`_${field}`]);

            for (let i = 0; i < keys.length; i++) {
                const key = mapKeys[keys[i]] || keys[i];
                const item = instance[`_${field}`][key];

                if (isSchema(item)) {
                    discardAllChanges(item);
                }
            }

            value.$changes.discard();
        }
    }

    instance.$changes.discard();
}


/**
 * Schema encoder / decoder
 */
export abstract class Schema {
    static extensionTypes: { [id: string]: any } = {
        array: ArraySchema,
        map: MapSchema,
    };

    static _typeid: number;
    static _context: Context;

    static _schema: Definition;
    static _indexes: {[field: string]: number};
    static _fieldsByIndex: {[index: number]: string};
    static _filters: {[field: string]: FilterCallback};
    static _deprecated: {[field: string]: boolean};
    static _descriptors: PropertyDescriptorMap & ThisType<any>;

    static onError(e) {
        console.error(e);
    }

    protected $changes: ChangeTree;
    protected $listeners: { [field: string]: EventEmitter<(a: any, b: any) => void> };

    public onChange?(changes: DataChange[]);
    public onRemove?();

    get $changed () { return this.$changes.changed; }

    public listen <K extends NonFunctionProps<this>>(attr: K, callback: (value: this[K], previousValue: this[K]) => void) {
        if (!this.$listeners[attr as string]) {
            this.$listeners[attr as string] = new EventEmitter();
        }
        this.$listeners[attr as string].register(callback);
    }

    /*
    clone () {
        const cloned = new ((this as any).constructor);
        const schema = this._schema;
        for (let field in schema) {
            if (
                typeof (this[field]) === "object" &&
                typeof (this[field].clone) === "function"
            ) {
                // deep clone
                cloned[field] = this[field].clone();

            } else {
                // primitive values
                cloned[field] = this[field];
            }
        }
        return cloned;
    }

    triggerAll() {
        if (!this.onChange) {
            return;
        }

        const changes: DataChange[] = [];
        const schema = this._schema;

        for (let field in schema) {
            if (this[field] !== undefined) {
                changes.push({
                    field,
                    value: this[field],
                    previousValue: undefined
                });
            }
        }

        try {
            this.onChange(changes);
        } catch (e) {
            Schema.onError(e);
        }
    }

    private _triggerChanges(changes: DataChange[]) {
        if (changes.length > 0) {
            for (let i = 0; i < changes.length; i++) {
                const change = changes[i];
                const listener = this.$listeners[change.field];
                if (listener) {
                    try {
                        listener.invoke(change.value, change.previousValue);
                    } catch (e) {
                        Schema.onError(e);
                    }
                }
            }

            if (this.onChange) {
                try {
                    this.onChange(changes);
                } catch (e) {
                    Schema.onError(e);
                }
            }
        }

    }
    */
}
