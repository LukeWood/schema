import { Schema } from "./";
import { ChangeTree } from "./ChangeTree";
import { MapSchema } from "./types/MapSchema";
import { ArraySchema } from "./types/ArraySchema";
import { isSchema } from "./Schema";

export function dumpChanges(schema: any) {
    const dump = {};

    const $changes: ChangeTree = (schema as any).$changes;
    const fieldsByIndex = schema['_fieldsByIndex'] || {};

    for (const fieldIndex of Array.from($changes.changes)) {
        const field = fieldsByIndex[fieldIndex] || fieldIndex;

        if (
            schema[field] instanceof MapSchema ||
            schema[field] instanceof ArraySchema ||
            isSchema(schema[field])
        ) {
            dump[field] = dumpChanges(schema[field]);

        } else {
            dump[field] = schema[field];
        }

    }

    return dump;
}