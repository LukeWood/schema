import { ChangeTree } from './ChangeTree';
import { Schema, IStaticSchema } from './Schema';

export type Constructor<T> = new (...args:any[]) => T;

/**
 * Data types
 */
export type PrimitiveType =
    "string" |
    "number" |
    "boolean" |
    "int8" |
    "uint8" |
    "int16" |
    "uint16" |
    "int32" |
    "uint32" |
    "int64" |
    "uint64" |
    "float32" |
    "float64" |
    Constructor<any>;

export type DefinitionType = ( PrimitiveType | PrimitiveType[] | { map: PrimitiveType });
export type Definition = { [field: string]: DefinitionType };
export type FilterCallback<
    T = any,
    V = any,
    R = any
> = (this: T, client: Client, value: V, root?: R) => boolean;

// Colyseus integration
export type Client = { sessionId: string } & any;

export class Context {
    types: {[id: number]: typeof Schema} = {};
    schemas = new Map<typeof Schema, number>();

    has(schema: typeof Schema) {
        return this.schemas.has(schema);
    }

    get(typeid: number) {
        return this.types[typeid];
    }

    add(schema: typeof Schema) {
        schema._typeid = this.schemas.size;
        this.types[schema._typeid] = schema;
        this.schemas.set(schema, schema._typeid);
    }
}

export const globalContext = new Context();

/**
 * `@type()` decorator for proxies
 */

export function type (type: DefinitionType, context: Context = globalContext): PropertyDecorator {
    return function (target: typeof Schema, field: string) {
        const constructor = target.constructor as typeof Schema;
        constructor._context = context;

        /*
         * static schema
         */
        if (!context.has(constructor)) {
            context.add(constructor);

            // support inheritance
            constructor._schema = Object.assign({}, constructor._schema || {});
            constructor._indexes = Object.assign({}, constructor._indexes || {});
            constructor._fieldsByIndex = Object.assign({}, constructor._fieldsByIndex || {});
            constructor._descriptors = Object.assign({}, constructor._descriptors || {});
            constructor._deprecated = Object.assign({}, constructor._deprecated || {});
        }

        const index = Object.keys(constructor._schema).length;
        constructor._fieldsByIndex[index] = field;
        constructor._indexes[field] = index;
        constructor._schema[field] = type;

        /**
         * skip if descriptor already exists for this field (`@deprecated()`)
         */
        if (constructor._descriptors[field]) {
            return;
        }

        /**
         * TODO: `isSchema` / `isArray` / `isMap` is repeated on many places!
         * need to refactor all of them.
         */
        const isArray = Array.isArray(type);
        const isMap = !isArray && (type as any).map;
        const isSchema = (typeof(constructor._schema[field]) === "function");

        const fieldCached = `_${field}`;

        Object.defineProperty(target, fieldCached, {
            enumerable: false,
            configurable: false,
            writable: true,
        });

        if (!Object.getOwnPropertyDescriptor(target, "$changes")) {
            Object.defineProperty(target, "$changes", {
                get: function () {
                    if (!this.$$changes) {
                        Object.defineProperty(this, "$$changes", {
                            value: new ChangeTree(constructor._indexes),
                            enumerable: false,
                            configurable: false,
                            writable: true,
                        });
                    }
                    return this.$$changes;
                },

                set: function (this: any, value: any) {
                    this.$$changes = value;
                },

                enumerable: false,
                configurable: false,
            });
        }

        Object.defineProperty(target, field, {
            get: function () {
                return this[fieldCached];
            },

            set: function (this: Schema, value: any) {
                /**
                 * Create Proxy for array or map items
                 */
                if (isArray || isMap) {
                    value = new Proxy(value, {
                        get: (obj, prop) => obj[prop],
                        set: (obj, prop, setValue) => {
                            if (prop !== "length" && (prop as string).indexOf("$") !== 0) {
                                // ensure new value has a parent
                                const key = (isArray) ? Number(prop) : String(prop);

                                if (!obj.$sorting) {
                                    // track index change
                                    const previousIndex = obj.$changes.getIndex(setValue);
                                    if (previousIndex !== undefined) {
                                        obj.$changes.mapIndexChange(setValue, previousIndex);
                                    }
                                    obj.$changes.mapIndex(setValue, key);
                                }

                                // if (isMap) {
                                //     obj._indexes.delete(prop);
                                // }

                                // (THIS IS NEW)
                                // if (setValue instanceof Schema) {
                                if (setValue && setValue['constructor']._schema) {

                                    // new items are flagged with all changes
                                    if (!setValue.$changes.parent) {
                                        setValue.$changes = new ChangeTree(setValue._indexes, key, obj.$changes);
                                        setValue.$changes.changeAll(setValue);
                                    }

                                } else {
                                    obj[prop] = setValue;
                                }

                                // apply change on ArraySchema / MapSchema
                                obj.$changes.change(key);

                            } else if (setValue !== obj[prop]) {
                                // console.log("SET NEW LENGTH:", setValue);
                                // console.log("PREVIOUS LENGTH: ", obj[prop]);
                            }

                            obj[prop] = setValue;

                            return true;
                        },

                        deleteProperty: (obj, prop) => {
                            const deletedValue = obj[prop];

                            if (isMap && deletedValue !== undefined) {
                                obj.$changes.deleteIndex(deletedValue);
                                obj.$changes.deleteIndexChange(deletedValue);

                                if (deletedValue.$changes) { // deletedValue may be a primitive value
                                    delete deletedValue.$changes.parent;
                                }

                                // obj._indexes.delete(prop);
                            }

                            delete obj[prop];

                            const key = (isArray) ? Number(prop) : String(prop);
                            obj.$changes.change(key, true);

                            return true;
                        },
                    });
                }

                // skip if value is the same as cached.
                if (value === this[fieldCached]) {
                    return;
                }

                this[fieldCached] = value;

                if (isArray) {
                    // directly assigning an array of items as value.
                    this.$changes.change(field);
                    value.$changes = new ChangeTree({}, field, this.$changes);

                    for (let i = 0; i < value.length; i++) {
                        if (value[i] instanceof Schema) {
                            value[i].$changes = new ChangeTree(value[i]._indexes, i, value.$changes);
                            value[i].$changes.changeAll(value[i]);
                        }
                        value.$changes.mapIndex(value[i], i);
                        value.$changes.change(i);
                    }

                } else if (isMap) {
                    // directly assigning a map
                    value.$changes = new ChangeTree({}, field, this.$changes);
                    this.$changes.change(field);

                    for (let key in value) {
                        if (value[key] instanceof Schema) {
                            value[key].$changes = new ChangeTree(value[key]._indexes, key, value.$changes);
                            value[key].$changes.changeAll(value[key]);
                        }
                        value.$changes.mapIndex(value[key], key);
                        value.$changes.change(key);
                    }

                } else if (isSchema) {
                    // directly assigning a `Schema` object
                    // value may be set to null
                    this.$changes.change(field);

                    if (value) {
                        value.$changes = new ChangeTree(value._indexes, field, this.$changes);
                        value.$changes.changeAll(value);
                    }

                } else {
                    // directly assigning a primitive type
                    this.$changes.change(field);
                }
            },

            enumerable: true,
            configurable: true
        });
    }
}

/**
 * `@filter()` decorator for defining data filters per client
 */

export function filter<T, V, R>(cb: FilterCallback<T, V, R>): PropertyDecorator {
    return function (target: any, field: string) {
        const constructor = target.constructor as typeof Schema;

        /*
         * static filters
         */
        if (!constructor._filters) {
            constructor._filters = {};
        }

        constructor._filters[field] = cb;
    }
}

/**
 * `@deprecated()` flag a field as deprecated.
 * The previous `@type()` annotation should remain along with this one.
 */

export function deprecated(throws: boolean = true, context: Context = globalContext): PropertyDecorator {
    return function (target: typeof Schema, field: string) {
        const constructor = target.constructor as typeof Schema;
        constructor._deprecated[field] = true;

        if (throws) {
            constructor._descriptors[field] = {
                get: function () { throw new Error(`${field} is deprecated.`); },
                set: function (this: Schema, value: any) { /* throw new Error(`${field} is deprecated.`); */ },
                enumerable: false,
                configurable: true
            };
        }
    }
}

export function defineTypes(target: any, fields: {[property: string]: DefinitionType}, context: Context = globalContext) {
    for (let field in fields) {
        type(fields[field], context)(target.prototype, field);
    }
    return target;
}
